import {
  cellKey,
  forwardInfo,
  seamTransition,
  stepAcrossSeam,
} from "../core/topology";
import type {
  ArrowDefinition,
  Cell,
  FaceId,
  LevelDefinition,
} from "../core/types";

const FACES: readonly FaceId[] = [
  "front",
  "back",
  "right",
  "left",
  "top",
  "bottom",
];

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

function pair(id: string, face: FaceId, y: number): readonly ArrowDefinition[] {
  return [
    { id: `${id}-a`, path: [cell(face, 0, y), cell(face, 1, y)] },
    { id: `${id}-b`, path: [cell(face, 2, y), cell(face, 3, y)] },
  ];
}

function bentDependency(
  id: string,
  face: FaceId,
  y: number,
): readonly ArrowDefinition[] {
  return [
    {
      id: `${id}-a`,
      path: [cell(face, 0, y), cell(face, 0, y + 1), cell(face, 1, y + 1)],
    },
    { id: `${id}-b`, path: [cell(face, 2, y + 1), cell(face, 3, y + 1)] },
  ];
}

function chain(
  id: string,
  face: FaceId,
  y: number,
): readonly ArrowDefinition[] {
  return [
    { id: `${id}-a`, path: [cell(face, 0, y), cell(face, 1, y)] },
    { id: `${id}-b`, path: [cell(face, 2, y), cell(face, 3, y)] },
    { id: `${id}-c`, path: [cell(face, 4, y), cell(face, 5, y)] },
  ];
}

function clearTerminal(
  id: string,
  face: FaceId,
  gridSize: number,
): ArrowDefinition {
  return {
    id,
    path: [cell(face, gridSize - 2, 0), cell(face, gridSize - 1, 0)],
  };
}

function wrappedTerminal(
  id: string,
  face: FaceId,
  gridSize: number,
): ArrowDefinition {
  const tail = cell(face, gridSize - 1, 0);
  return { id, path: [tail, stepAcrossSeam(tail, "east", gridSize)] };
}

function bentTerminal(
  id: string,
  face: FaceId,
  gridSize: number,
): ArrowDefinition {
  return {
    id,
    path: [
      cell(face, gridSize - 2, 0),
      cell(face, gridSize - 2, 1),
      cell(face, gridSize - 1, 1),
    ],
  };
}

function verticalTerminal(
  id: string,
  face: FaceId,
  gridSize: number,
): ArrowDefinition {
  return {
    id,
    path: [
      cell(face, gridSize - 1, gridSize - 1),
      cell(face, gridSize - 1, gridSize - 2),
    ],
  };
}

/** A deliberate long route that crosses front, right, then back. */
function threeFaceRoute(id: string, gridSize: number): ArrowDefinition {
  const path: Cell[] = [cell("front", gridSize - 1, gridSize - 1)];
  let current = path[0];
  if (!current) throw new Error("Three-face route needs a starting cell.");
  let transition = seamTransition(current, "east", gridSize);
  path.push(transition.cell);
  current = transition.cell;
  let heading = transition.heading;
  for (let step = 0; step < gridSize; step += 1) {
    const forward = forwardInfo(current, heading, gridSize);
    if (forward.exits) {
      transition = seamTransition(current, heading, gridSize);
      path.push(transition.cell);
      current = transition.cell;
      heading = transition.heading;
    } else if (forward.next) {
      path.push(forward.next);
      current = forward.next;
    }
  }
  return { id, path };
}

function hasOpenCells(
  arrows: readonly ArrowDefinition[],
  candidates: readonly ArrowDefinition[],
): boolean {
  const used = new Set(arrows.flatMap((arrow) => arrow.path.map(cellKey)));
  const proposed = candidates.flatMap((arrow) => arrow.path.map(cellKey));
  return (
    proposed.length === new Set(proposed).size &&
    proposed.every((key) => !used.has(key))
  );
}

function curatedLevel(
  id: number,
  gridSize: number,
  targetCount: number,
): LevelDefinition {
  const arrows: ArrowDefinition[] = [];
  if (id >= 5) arrows.push(threeFaceRoute(`l${id}-three-face-route`, gridSize));
  for (const face of FACES) {
    const candidates: ArrowDefinition[] = [
      clearTerminal(`l${id}-${face}-clear`, face, gridSize),
    ];
    if (face === "front" && id >= 2)
      candidates.unshift(
        wrappedTerminal(`l${id}-front-wrap`, "front", gridSize),
      );
    if (face === "back" && id >= 3)
      candidates.unshift(bentTerminal(`l${id}-back-bend`, "back", gridSize));
    candidates.push(
      verticalTerminal(`l${id}-${face}-vertical`, face, gridSize),
    );
    const terminal = candidates.find((candidate) =>
      hasOpenCells(arrows, [candidate]),
    );
    if (!terminal)
      throw new Error(`Curated level ${id} cannot place its ${face} terminal.`);
    arrows.push(terminal);
  }

  let remaining = targetCount - arrows.length;
  if (id >= 5) {
    const dependencyChain = chain(`l${id}-depth-three`, "top", 1);
    if (!hasOpenCells(arrows, dependencyChain))
      throw new Error(`Curated level ${id} cannot place its dependency chain.`);
    arrows.push(...dependencyChain);
    remaining -= dependencyChain.length;
  }
  let useBentDependency = id >= 4;
  for (let row = 1; remaining > 0 && row < gridSize - 1; row += 1) {
    for (const face of FACES) {
      if (remaining === 0) break;
      const bent = bentDependency(`l${id}-${face}-bend${row}`, face, row);
      const straight = pair(`l${id}-${face}-row${row}`, face, row);
      const motifs =
        useBentDependency && row + 1 < gridSize ? [bent, straight] : [straight];
      const motif = motifs.find((candidate) => hasOpenCells(arrows, candidate));
      if (!motif || motif.length > remaining) continue;
      arrows.push(...motif);
      remaining -= motif.length;
      useBentDependency = false;
    }
  }
  if (remaining !== 0)
    throw new Error(
      `Curated level ${id} has no safe motif for ${remaining} arrows.`,
    );
  return {
    id,
    title: `Cube ${id}`,
    gridSize,
    lives: id <= 3 ? 5 : id <= 6 ? 4 : 3,
    arrows,
  };
}

/** Ten authored deterministic layouts with seams, turns, and removal dependencies. */
export const LEVELS: readonly LevelDefinition[] = [
  curatedLevel(1, 4, 6),
  curatedLevel(2, 4, 12),
  curatedLevel(3, 5, 16),
  curatedLevel(4, 5, 20),
  curatedLevel(5, 6, 24),
  curatedLevel(6, 6, 28),
  curatedLevel(7, 6, 32),
  curatedLevel(8, 7, 36),
  curatedLevel(9, 8, 40),
  curatedLevel(10, 8, 42),
];

export const DEMO_BLOCKED_ID = "demo-blocked";
export const DEMO_SUCCESS_ID = "demo-success";

/** Small independent onboarding fixture: fail visibly, then remove its blocker. */
export const DEMO_LEVEL: LevelDefinition = {
  id: 0,
  title: "First Flight",
  gridSize: 4,
  lives: 2,
  arrows: [
    { id: DEMO_BLOCKED_ID, path: [cell("front", 0, 1), cell("front", 1, 1)] },
    { id: DEMO_SUCCESS_ID, path: [cell("front", 2, 1), cell("front", 3, 1)] },
    { id: "demo-clear", path: [cell("front", 0, 2), cell("front", 1, 2)] },
  ],
};
