import { describe, expect, test } from "bun:test";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { overlappingArrowIds } from "../src/core/overlap";
import { seamTransition, stepSurface } from "../src/core/topology";
import type {
  ArrowDefinition,
  Cell,
  Heading,
  LevelDefinition,
} from "../src/core/types";
import { solveLevel, validateLevel } from "../src/core/validation";

function level(
  arrows: readonly ArrowDefinition[],
  gridSize = 5,
): LevelDefinition {
  return { id: 900, title: "Overlap fixture", gridSize, lives: 2, arrows };
}

const pair: readonly ArrowDefinition[] = [
  {
    id: "north",
    path: [
      { face: "front", x: 0, y: 2 },
      { face: "front", x: 1, y: 2 },
      { face: "front", x: 1, y: 1 },
    ],
  },
  {
    id: "east",
    path: [
      { face: "front", x: 0, y: 2 },
      { face: "front", x: 1, y: 2 },
      { face: "front", x: 2, y: 2 },
    ],
  },
];

function faceCell(x: number, y: number): Cell {
  return { face: "front", x, y };
}

interface Leg {
  readonly heading: Heading;
  readonly steps: number;
}

/**
 * Walk a concrete surface route from a seeded cell. Seam crossings re-derive
 * the continuation heading from the topology core, never by hand.
 */
function walk(
  start: Cell,
  legs: readonly Leg[],
  gridSize = 5,
): readonly Cell[] {
  const cells: Cell[] = [start];
  let current = start;
  let heading: Heading | undefined;
  for (const leg of legs) {
    heading = leg.heading;
    for (let step = 0; step < leg.steps; step += 1) {
      if (!heading) throw new Error("Walk lost its heading.");
      const next = stepSurface(current, heading, gridSize);
      if (next.face !== current.face) {
        heading = seamTransition(current, heading, gridSize).heading;
      }
      cells.push(next);
      current = next;
    }
  }
  return cells;
}

describe("overlapping arrow groups", () => {
  test("finds staggered same-direction shared tail segments and ordinary singletons", () => {
    const staggered = level([
      {
        id: "early",
        path: [
          { face: "front", x: 0, y: 1 },
          { face: "front", x: 1, y: 1 },
          { face: "front", x: 2, y: 1 },
          { face: "front", x: 2, y: 0 },
        ],
      },
      {
        id: "late",
        path: [
          { face: "front", x: 1, y: 1 },
          { face: "front", x: 2, y: 1 },
          { face: "front", x: 3, y: 1 },
          { face: "front", x: 3, y: 0 },
        ],
      },
      {
        id: "alone",
        path: [
          { face: "back", x: 0, y: 1 },
          { face: "back", x: 1, y: 1 },
        ],
      },
    ]);
    expect(overlappingArrowIds(staggered, "late")).toEqual(["early", "late"]);
    expect(overlappingArrowIds(staggered, "alone")).toEqual(["alone"]);
    expect(validateLevel(staggered).valid).toBe(true);
  });

  test("a tap on either member exits and clears the whole group", () => {
    const fixture = level(pair);
    const initial = createGameState(fixture);
    const result = simulateMove(fixture, initial, "east");
    expect(result.kind).toBe("exit");
    expect(result.arrowId).toBe("east");
    expect(result.members?.map((member) => member.arrowId)).toEqual([
      "north",
      "east",
    ]);
    expect(result.members?.every((member) => member.kind === "exit")).toBe(
      true,
    );
    const settled = applyMove(fixture, initial, result);
    expect(settled.remainingIds).toEqual([]);
    expect(settled.status).toBe("won");
    expect(solveLevel(fixture)).toEqual(["north"]);
  });

  test("a blocked nonclicked member blocks and marks the group with one life", () => {
    const fixture = level([
      ...pair,
      {
        id: "wall",
        path: [
          { face: "front", x: 3, y: 2 },
          { face: "front", x: 3, y: 3 },
        ],
      },
    ]);
    const initial = createGameState(fixture);
    const result = simulateMove(fixture, initial, "north");
    expect(result.kind).toBe("blocked");
    expect(
      result.members?.find((member) => member.arrowId === "north")?.kind,
    ).toBe("exit");
    expect(
      result.members?.find((member) => member.arrowId === "east")?.kind,
    ).toBe("blocked");
    const first = applyMove(fixture, initial, result);
    expect(first.failedIds).toEqual(["north", "east"]);
    expect(first.lives).toBe(1);
    const retry = applyMove(
      fixture,
      first,
      simulateMove(fixture, first, "east"),
    );
    expect(retry.failedIds).toEqual(["north", "east"]);
    expect(retry.lives).toBe(1);
    expect(applyMove(fixture, retry, result)).toBe(retry);
  });

  test("an invalid member prevents a blocked sibling from charging a life", () => {
    const fixture = level([
      {
        id: "east",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 3, y: 2 },
        ],
      },
      {
        id: "invalid",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 4, y: 4 },
        ],
      },
      {
        id: "wall",
        path: [
          { face: "front", x: 3, y: 2 },
          { face: "front", x: 3, y: 3 },
        ],
      },
    ]);
    const initial = createGameState(fixture);
    const result = simulateMove(fixture, initial, "east");
    expect(result.kind).toBe("invalid");
    expect(applyMove(fixture, initial, result)).toBe(initial);
  });

  test("rejects opposite-direction shared links and shared heads", () => {
    const opposite = level([
      {
        id: "forward",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 2, y: 2 },
        ],
      },
      {
        id: "reverse",
        path: [
          { face: "front", x: 2, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 0, y: 2 },
        ],
      },
    ]);
    expect(validateLevel(opposite).valid).toBe(false);
    const sharedHead = level([
      {
        id: "one",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 2, y: 2 },
        ],
      },
      {
        id: "two",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 2, y: 2 },
          { face: "front", x: 2, y: 1 },
        ],
      },
    ]);
    expect(validateLevel(sharedHead).valid).toBe(false);
    const [firstMember, secondMember] = pair;
    if (!firstMember || !secondMember)
      throw new Error("Overlap fixture is incomplete.");
    const doubleMember = level([
      { ...firstMember, kind: "double" },
      secondMember,
    ]);
    expect(validateLevel(doubleMember).valid).toBe(false);
  });

  test("rejects future travel paths that meet after members leave the shared segment", () => {
    const fixture = level([
      {
        id: "eastbound",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 1, y: 1 },
          { face: "front", x: 2, y: 1 },
        ],
      },
      {
        id: "northbound",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 1, y: 3 },
          { face: "front", x: 2, y: 3 },
          { face: "front", x: 3, y: 3 },
          { face: "front", x: 3, y: 2 },
        ],
      },
    ]);
    expect(validateLevel(fixture).valid).toBe(false);
  });

  test("rejects groups larger than three", () => {
    const fixture = level([
      {
        id: "one",
        path: [
          { face: "front", x: 0, y: 3 },
          { face: "front", x: 1, y: 3 },
          { face: "front", x: 2, y: 3 },
          { face: "front", x: 3, y: 3 },
        ],
      },
      {
        id: "two",
        path: [
          { face: "front", x: 0, y: 3 },
          { face: "front", x: 1, y: 3 },
          { face: "front", x: 2, y: 3 },
          { face: "front", x: 2, y: 2 },
        ],
      },
      {
        id: "three",
        path: [
          { face: "front", x: 0, y: 3 },
          { face: "front", x: 1, y: 3 },
          { face: "front", x: 2, y: 3 },
          { face: "front", x: 2, y: 4 },
        ],
      },
      {
        id: "four",
        path: [
          { face: "front", x: 0, y: 3 },
          { face: "front", x: 1, y: 3 },
          { face: "front", x: 2, y: 3 },
          { face: "front", x: 3, y: 3 },
          { face: "front", x: 4, y: 3 },
        ],
      },
    ]);
    expect(validateLevel(fixture).errors).toContain(
      "Shared-tail group four|one|three|two has more than three arrows.",
    );
  });

  test("rejects a stop the group cannot reach before a sibling exits", () => {
    const fixture: LevelDefinition = {
      ...level(
        [
          {
            id: "north",
            path: [
              faceCell(0, 3),
              faceCell(1, 3),
              faceCell(2, 3),
              faceCell(2, 2),
            ],
          },
          {
            id: "south",
            path: [
              faceCell(0, 3),
              faceCell(1, 3),
              faceCell(2, 3),
              faceCell(2, 4),
            ],
          },
        ],
        8,
      ),
      stops: [faceCell(2, 7)],
    };
    expect(validateLevel(fixture).errors).toContain(
      "Shared-tail group north|south has a stop circle it can never park on.",
    );
    const reachable = { ...fixture, stops: [faceCell(2, 1)] };
    expect(validateLevel(reachable).valid).toBe(true);
  });
});

describe("shared-tail groups on spot cubes", () => {
  // `north` runs (1,1) -> (1,0) -> exit; `east` runs (3,2) -> (4,2) -> exit.
  test("a group whose members' routes avoid every spot validates", () => {
    const fixture: LevelDefinition = {
      ...level(pair),
      directionals: [
        { cell: faceCell(4, 4), heading: "north" },
        { cell: faceCell(3, 4), heading: "west", kind: "flip" },
      ],
    };
    expect(validateLevel(fixture)).toEqual({ valid: true, errors: [] });
    expect(solveLevel(fixture)).toBeDefined();
  });

  test("rejects a group whose member route crosses a static spot", () => {
    const fixture: LevelDefinition = {
      ...level(pair),
      directionals: [{ cell: faceCell(3, 2), heading: "south" }],
    };
    expect(validateLevel(fixture).errors).toContain(
      "Shared-tail group east|north has a member route through a directional spot.",
    );
  });

  test("rejects a group whose member route crosses a flip spot", () => {
    const fixture: LevelDefinition = {
      ...level(pair),
      directionals: [{ cell: faceCell(1, 0), heading: "west", kind: "flip" }],
    };
    expect(validateLevel(fixture).errors).toContain(
      "Shared-tail group east|north has a member route through a directional spot.",
    );
  });

  test("a group parks by shared offset on a flip cube and then exits together", () => {
    const fixture: LevelDefinition = {
      ...level(pair),
      directionals: [{ cell: faceCell(4, 4), heading: "north", kind: "flip" }],
      stops: [faceCell(3, 2)],
    };
    expect(validateLevel(fixture)).toEqual({ valid: true, errors: [] });
    let state = createGameState(fixture);
    const parked = simulateMove(fixture, state, "north");
    expect(parked.kind).toBe("paused");
    state = applyMove(fixture, state, parked);
    expect(state.offsets).toEqual({ north: 1, east: 1 });
    expect(state.settledPaths).toEqual({});
    const exit = simulateMove(fixture, state, "east");
    expect(exit.kind).toBe("exit");
    state = applyMove(fixture, state, exit);
    expect(state.status).toBe("won");
    expect(state.lives).toBe(fixture.lives);
  });
});

describe("wrapped shared-tail groups", () => {
  test("a wrapped member exits cleanly with its sibling through the shared tail", () => {
    const north: ArrowDefinition = {
      id: "north",
      path: walk(faceCell(0, 2), [
        { heading: "east", steps: 2 },
        { heading: "south", steps: 2 },
      ]),
    };
    const wrap: ArrowDefinition = {
      id: "wrap",
      path: walk(faceCell(0, 2), [
        { heading: "east", steps: 5 },
        { heading: "north", steps: 2 },
      ]),
    };
    const fixture = level([north, wrap]);
    const shared: Cell[] = [
      ...walk(faceCell(0, 2), [{ heading: "east", steps: 2 }]),
    ];
    expect(north.path.slice(0, 3)).toEqual(shared);
    expect(wrap.path.slice(0, 3)).toEqual(shared);
    expect(overlappingArrowIds(fixture, "wrap")).toEqual(["north", "wrap"]);
    expect(validateLevel(fixture).valid).toBe(true);
    const initial = createGameState(fixture);
    const result = simulateMove(fixture, initial, "wrap");
    expect(result.kind).toBe("exit");
    expect(result.members?.map((member) => member.arrowId)).toEqual([
      "north",
      "wrap",
    ]);
    expect(result.members?.every((member) => member.kind === "exit")).toBe(
      true,
    );
    const wrapMember = result.members?.find(
      (member) => member.arrowId === "wrap",
    );
    expect(wrapMember?.route[0]?.face).toBe("right");
    const settled = applyMove(fixture, initial, result);
    expect(settled.remainingIds).toEqual([]);
    expect(settled.status).toBe("won");
    expect(solveLevel(fixture)).toEqual(["north"]);
  });

  test("a staggered pair whose late member wraps a seam derives and exits as one group", () => {
    const early: ArrowDefinition = {
      id: "early",
      path: walk(faceCell(0, 1), [
        { heading: "east", steps: 1 },
        { heading: "south", steps: 3 },
      ]),
    };
    const late: ArrowDefinition = {
      id: "late",
      path: walk(faceCell(0, 1), [{ heading: "east", steps: 6 }]),
    };
    const fixture = level([early, late]);
    expect(overlappingArrowIds(fixture, "late")).toEqual(["early", "late"]);
    expect(validateLevel(fixture).valid).toBe(true);
    const initial = createGameState(fixture);
    const result = simulateMove(fixture, initial, "late");
    expect(result.kind).toBe("exit");
    expect(result.members?.map((member) => member.arrowId)).toEqual([
      "early",
      "late",
    ]);
    expect(result.members?.every((member) => member.kind === "exit")).toBe(
      true,
    );
    const settled = applyMove(fixture, initial, result);
    expect(settled.remainingIds).toEqual([]);
    expect(settled.status).toBe("won");
  });

  test("a trio containing a wrapped member validates and exits as one group", () => {
    const fixture = level([
      {
        id: "north",
        path: walk(faceCell(0, 2), [
          { heading: "east", steps: 2 },
          { heading: "north", steps: 2 },
        ]),
      },
      {
        id: "south",
        path: walk(faceCell(0, 2), [
          { heading: "east", steps: 2 },
          { heading: "south", steps: 2 },
        ]),
      },
      {
        id: "wrap",
        path: walk(faceCell(0, 2), [
          { heading: "east", steps: 5 },
          { heading: "south", steps: 2 },
        ]),
      },
    ]);
    expect(overlappingArrowIds(fixture, "wrap")).toEqual([
      "north",
      "south",
      "wrap",
    ]);
    expect(validateLevel(fixture).valid).toBe(true);
    const initial = createGameState(fixture);
    const result = simulateMove(fixture, initial, "wrap");
    expect(result.kind).toBe("exit");
    expect(result.members?.map((member) => member.arrowId)).toEqual([
      "north",
      "south",
      "wrap",
    ]);
    expect(result.members?.every((member) => member.kind === "exit")).toBe(
      true,
    );
    const settled = applyMove(fixture, initial, result);
    expect(settled.remainingIds).toEqual([]);
    expect(settled.status).toBe("won");
  });

  test("rejects a wrapped member whose future route contacts a sibling's body", () => {
    const far: ArrowDefinition = {
      id: "far",
      path: walk(faceCell(0, 3), [{ heading: "east", steps: 7 }]),
    };
    const wrap: ArrowDefinition = {
      id: "wrap",
      path: walk(faceCell(0, 3), [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 3 },
        { heading: "east", steps: 3 },
        { heading: "south", steps: 2 },
      ]),
    };
    const result = validateLevel(level([far, wrap]));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Shared-tail group far|wrap has crossing or contacting travel paths.",
    );
  });

  test("an outside arrow blocking the wrapped member fails the whole group for one life", () => {
    const wrapPath = walk(faceCell(0, 2), [{ heading: "east", steps: 6 }]);
    const wall: ArrowDefinition = {
      id: "wall",
      path: walk(stepSurface(wrapPath[wrapPath.length - 1]!, "east", 5), [
        { heading: "south", steps: 1 },
      ]),
    };
    const fixture = level([
      {
        id: "north",
        path: walk(faceCell(0, 2), [
          { heading: "east", steps: 2 },
          { heading: "north", steps: 2 },
        ]),
      },
      { id: "wrap", path: wrapPath },
      wall,
    ]);
    expect(validateLevel(fixture).valid).toBe(true);
    const initial = createGameState(fixture);
    const result = simulateMove(fixture, initial, "north");
    expect(result.kind).toBe("blocked");
    expect(
      result.members?.find((member) => member.arrowId === "north")?.kind,
    ).toBe("exit");
    const wrapMember = result.members?.find(
      (member) => member.arrowId === "wrap",
    );
    expect(wrapMember?.kind).toBe("blocked");
    expect(wrapMember?.blockerId).toBe("wall");
    expect(wrapMember?.contact?.cell).toEqual(wall.path[0]);
    const first = applyMove(fixture, initial, result);
    expect(first.failedIds).toEqual(["north", "wrap"]);
    expect(first.lives).toBe(1);
    expect(first.status).toBe("playing");
    const retry = applyMove(
      fixture,
      first,
      simulateMove(fixture, first, "wrap"),
    );
    expect(retry.failedIds).toEqual(["north", "wrap"]);
    expect(retry.lives).toBe(1);
    expect(applyMove(fixture, retry, result)).toBe(retry);
  });
});
