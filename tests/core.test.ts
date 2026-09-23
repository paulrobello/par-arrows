import { describe, expect, test } from "bun:test";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import {
  advanceHead,
  simulateMove as simulatePath,
} from "../src/core/movement";
import {
  cellsEqual,
  edgePoint,
  faceHeadingVector,
  faceNormal,
  forwardInfo,
  headingForPath,
  oppositeHeading,
  seamTransition,
  stepAcrossSeam,
} from "../src/core/topology";
import type { Cell, FaceId, Heading, LevelDefinition } from "../src/core/types";
import { validateLevel } from "../src/core/validation";

const SIMPLE_LEVEL: LevelDefinition = {
  id: 1,
  title: "Core fixture",
  gridSize: 4,
  lives: 2,
  arrows: [
    {
      id: "blocked",
      path: [
        { face: "front", x: 0, y: 1 },
        { face: "front", x: 1, y: 1 },
      ],
    },
    {
      id: "blocker",
      path: [
        { face: "front", x: 2, y: 1 },
        { face: "front", x: 3, y: 1 },
      ],
    },
  ],
};

describe("cube topology", () => {
  const faces: readonly FaceId[] = [
    "front",
    "back",
    "right",
    "left",
    "top",
    "bottom",
  ];
  const boundaries: Readonly<Record<Heading, readonly [number, number]>> = {
    east: [3, 1],
    west: [0, 1],
    south: [1, 3],
    north: [1, 0],
  };

  test("maps every directional seam in both directions", () => {
    for (const face of faces) {
      for (const [heading] of Object.entries(boundaries) as [
        Heading,
        readonly [number, number],
      ][]) {
        for (let lane = 0; lane < 4; lane += 1) {
          const source = {
            face,
            x: heading === "east" ? 3 : heading === "west" ? 0 : lane,
            y: heading === "south" ? 3 : heading === "north" ? 0 : lane,
          };
          const transition = seamTransition(source, heading, 4);
          const roundTrip = stepAcrossSeam(
            transition.cell,
            oppositeHeading(transition.heading),
            4,
          );
          expect(cellsEqual(roundTrip, source)).toBe(true);
          expect(faceHeadingVector(face, heading)).toEqual(
            faceNormal(transition.cell.face),
          );
          expect(
            faceHeadingVector(
              transition.cell.face,
              oppositeHeading(transition.heading),
            ),
          ).toEqual(faceNormal(face));
        }
      }
    }
  });

  test("derives a head heading from a wrapped authored path", () => {
    const tail = { face: "front" as const, x: 3, y: 0 };
    const head = stepAcrossSeam(tail, "east", 4);
    expect(headingForPath([tail, head], 4)).toBe("east");
  });

  test("a head just past a seam keeps the heading it entered with", () => {
    for (const face of faces) {
      for (const heading of Object.keys(boundaries) as Heading[]) {
        const tail = {
          face,
          x: heading === "east" ? 3 : heading === "west" ? 0 : 1,
          y: heading === "south" ? 3 : heading === "north" ? 0 : 1,
        };
        const transition = seamTransition(tail, heading, 4);
        expect(headingForPath([tail, transition.cell], 4)).toBe(
          transition.heading,
        );
      }
    }
  });

  test("an arrow whose head sits past a seam travels the way it is drawn", () => {
    const level: LevelDefinition = {
      id: 1,
      title: "Seam head",
      gridSize: 4,
      lives: 1,
      arrows: [
        {
          id: "wrapped",
          path: [
            { face: "top", x: 2, y: 0 },
            { face: "top", x: 3, y: 0 },
            { face: "right", x: 3, y: 0 },
          ],
        },
      ],
    };
    const result = simulatePath(level, ["wrapped"], "wrapped");
    expect(result.kind).toBe("exit");
    expect(result.route).toEqual([
      { face: "right", x: 3, y: 0 },
      { face: "right", x: 3, y: 1 },
      { face: "right", x: 3, y: 2 },
      { face: "right", x: 3, y: 3 },
    ]);
  });
});

describe("settled game results", () => {
  test("charges a first blocked arrow once and keeps later failures free", () => {
    const initial = createGameState(SIMPLE_LEVEL);
    const firstMove = simulateMove(SIMPLE_LEVEL, initial, "blocked");
    expect(firstMove.kind).toBe("blocked");
    expect(firstMove.distance).toBe(0.5);
    expect(firstMove.contact?.distance).toBe(0.5);
    expect(firstMove.blockerId).toBe("blocker");
    const first = applyMove(SIMPLE_LEVEL, initial, firstMove);
    expect(first).toMatchObject({
      lives: 1,
      failedIds: ["blocked"],
      status: "playing",
      revision: 1,
    });

    const repeatMove = simulateMove(SIMPLE_LEVEL, first, "blocked");
    const repeat = applyMove(SIMPLE_LEVEL, first, repeatMove);
    expect(repeat).toMatchObject({
      lives: 1,
      failedIds: ["blocked"],
      revision: 2,
    });
    expect(initial).toMatchObject({ lives: 2, failedIds: [], revision: 0 });
  });

  test("removes a clear blocker and refuses stale results", () => {
    const initial = createGameState(SIMPLE_LEVEL);
    const exit = simulateMove(SIMPLE_LEVEL, initial, "blocker");
    expect(exit.kind).toBe("exit");
    expect(exit.distance).toBe(0.5);
    expect(exit.exit?.tangent).toEqual([1, 0, 0]);
    const afterExit = applyMove(SIMPLE_LEVEL, initial, exit);
    expect(afterExit.remainingIds).toEqual(["blocked"]);
    expect(applyMove(SIMPLE_LEVEL, afterExit, exit)).toBe(afterExit);
    expect(simulateMove(SIMPLE_LEVEL, afterExit, "blocked").kind).toBe("exit");
  });

  test("uses the reverse path for a double-ended arrow contract fixture", () => {
    const level: LevelDefinition = {
      id: 2,
      title: "Double endpoint contract",
      gridSize: 4,
      lives: 1,
      arrows: [
        {
          id: "double",
          kind: "double",
          path: [
            { face: "front", x: 0, y: 1 },
            { face: "front", x: 1, y: 1 },
            { face: "front", x: 2, y: 1 },
          ],
        },
      ],
    };
    expect(validateLevel(level).valid).toBe(true);
    const result = simulateMove(
      level,
      createGameState(level),
      "double",
      "tail",
    );
    expect(result).toMatchObject({
      kind: "exit",
      endpoint: "tail",
      distance: 0.5,
    });
    expect(result.exit?.tangent).toEqual([-1, 0, 0]);
  });

  test("moves through a declared continuation and exits from the next face", () => {
    const level: LevelDefinition = {
      id: 3,
      title: "Continuation contract",
      gridSize: 4,
      lives: 1,
      arrows: [
        {
          id: "edge",
          path: [
            { face: "front", x: 2, y: 1 },
            { face: "front", x: 3, y: 1 },
          ],
        },
      ],
      edgePolicies: [
        {
          face: "front",
          edge: "east",
          policy: "continue",
          neighbor: { face: "right", entering: "east" },
        },
      ],
    };
    expect(validateLevel(level)).toEqual({ valid: true, errors: [] });
    const result = simulateMove(level, createGameState(level), "edge");
    expect(result.kind).toBe("exit");
    expect(result.route[1]).toEqual(
      seamTransition({ face: "front", x: 3, y: 1 }, "east", 4).cell,
    );
    const seamCell = result.route[1];
    if (!seamCell)
      throw new Error("Expected the move route to cross its seam.");
    const blocked = simulatePath(
      {
        ...level,
        arrows: [
          ...level.arrows,
          {
            id: "seam-blocker",
            path: [seamCell, { ...seamCell, x: seamCell.x + 1 }],
          },
        ],
      },
      ["edge", "seam-blocker"],
      "edge",
    );
    expect(blocked.kind).toBe("blocked");
    expect(blocked.contact?.cell).toEqual(seamCell);
    expect(blocked.contact?.point).toEqual(
      edgePoint({ face: "front", x: 3, y: 1 }, "east", 4),
    );
  });

  test("advanceHead follows one, two, or three declared seams with transported headings", () => {
    const policies: {
      face: FaceId;
      edge: Heading;
      policy: "continue";
      neighbor: { face: FaceId; entering: Heading };
    }[] = [];
    const level: LevelDefinition = {
      id: 5,
      title: "Seam chain",
      gridSize: 4,
      lives: 1,
      arrows: [],
      edgePolicies: policies,
    };
    let cell: Cell = { face: "front", x: 3, y: 1 };
    let heading: Heading = "east";
    for (let seam = 0; seam < 3; seam += 1) {
      while (!forwardInfo(cell, heading, level.gridSize).exits) {
        const next = forwardInfo(cell, heading, level.gridSize).next;
        if (!next) throw new Error("Expected an in-bounds test step.");
        cell = next;
      }
      const transition = seamTransition(cell, heading, level.gridSize);
      policies.push({
        face: cell.face,
        edge: heading,
        policy: "continue",
        neighbor: { face: transition.cell.face, entering: transition.heading },
      });
      const next = advanceHead(level, cell, heading);
      expect(next.exits).toBe(false);
      expect(next.next).toEqual(transition.cell);
      cell = transition.cell;
      heading = transition.heading;
    }
  });

  test("uses the transported heading for exit geometry after multiple seams", () => {
    const policies: {
      face: FaceId;
      edge: Heading;
      policy: "continue";
      neighbor: { face: FaceId; entering: Heading };
    }[] = [];
    const level: LevelDefinition = {
      id: 7,
      title: "Turned seam route",
      gridSize: 4,
      lives: 1,
      arrows: [
        {
          id: "traveler",
          path: [
            { face: "front", x: 1, y: 1 },
            { face: "front", x: 1, y: 0 },
          ],
        },
      ],
      edgePolicies: policies,
    };
    const traveler = level.arrows[0];
    const initialHead = traveler?.path[traveler.path.length - 1];
    if (!initialHead) throw new Error("Expected a test arrow head.");
    let cell = initialHead;
    let heading: Heading = "north";
    for (let seam = 0; seam < 2; seam += 1) {
      while (!forwardInfo(cell, heading, level.gridSize).exits) {
        const next = forwardInfo(cell, heading, level.gridSize).next;
        if (!next) throw new Error("Expected an in-bounds test step.");
        cell = next;
      }
      const transition = seamTransition(cell, heading, level.gridSize);
      policies.push({
        face: cell.face,
        edge: heading,
        policy: "continue",
        neighbor: { face: transition.cell.face, entering: transition.heading },
      });
      cell = transition.cell;
      heading = transition.heading;
    }
    expect(heading).toBe("south");
    const result = simulatePath(level, ["traveler"], "traveler");
    const exitCell = result.route.at(-1);
    expect(result.kind).toBe("exit");
    expect(exitCell).toBeDefined();
    if (!exitCell) throw new Error("Expected the route to reach an exit.");
    expect(result.exit?.tangent).toEqual(
      faceHeadingVector(exitCell.face, heading),
    );
    expect(result.exit?.edgePoint).toEqual(edgePoint(exitCell, heading, 4));
  });

  test("rejects a closed continuation route", () => {
    const allFaces: readonly FaceId[] = [
      "front",
      "back",
      "right",
      "left",
      "top",
      "bottom",
    ];
    const edgeHeadings: readonly Heading[] = ["east", "west", "south", "north"];
    const policies = allFaces.flatMap((face) =>
      edgeHeadings.map((edge) => {
        const boundary: Cell =
          edge === "east" || edge === "west"
            ? { face, x: edge === "east" ? 3 : 0, y: 1 }
            : { face, x: 1, y: edge === "south" ? 3 : 0 };
        const transition = seamTransition(boundary, edge, 4);
        return {
          face,
          edge,
          policy: "continue" as const,
          neighbor: {
            face: transition.cell.face,
            entering: transition.heading,
          },
        };
      }),
    );
    const level: LevelDefinition = {
      id: 6,
      title: "Closed continuation route",
      gridSize: 4,
      lives: 1,
      arrows: [
        {
          id: "loop",
          path: [
            { face: "front", x: 0, y: 1 },
            { face: "front", x: 1, y: 1 },
          ],
        },
      ],
      edgePolicies: policies,
    };
    const result = simulatePath(level, ["loop"], "loop");
    expect(result.kind).toBe("invalid");
    expect(result.reason).toContain("nonterminating continuation cycle");
    expect(validateLevel(level).errors).toContain(
      "Arrow loop has a nonterminating continuation loop from its head endpoint.",
    );
  });

  test("a head past a continuation seam passes back over its own body", () => {
    const path: readonly Cell[] = [
      { face: "right", x: 2, y: 1 },
      { face: "right", x: 1, y: 1 },
      { face: "right", x: 0, y: 1 },
      { face: "right", x: 0, y: 2 },
      { face: "front", x: 3, y: 2 },
      { face: "front", x: 2, y: 2 },
      { face: "front", x: 2, y: 1 },
      { face: "front", x: 3, y: 1 },
    ];
    const level: LevelDefinition = {
      id: 8,
      title: "Wrapped self-contact",
      gridSize: 4,
      lives: 1,
      arrows: [{ id: "wrapped-contact", path }],
      edgePolicies: [
        {
          face: "front",
          edge: "east",
          policy: "continue",
          neighbor: { face: "right", entering: "east" },
        },
      ],
    };
    expect(
      simulatePath(level, ["wrapped-contact"], "wrapped-contact").kind,
    ).toBe("exit");
    expect(validateLevel(level).valid).toBe(true);

    const vacatedTailLevel = {
      ...level,
      arrows: [{ id: "wrapped-contact", path: path.slice(2) }],
    };
    expect(
      simulatePath(vacatedTailLevel, ["wrapped-contact"], "wrapped-contact")
        .kind,
    ).toBe("exit");
    expect(validateLevel(vacatedTailLevel).valid).toBe(true);
  });

  test("rejects malformed continuation contracts", () => {
    const malformed: LevelDefinition = {
      id: 4,
      title: "Malformed continuation",
      gridSize: 4,
      lives: 1,
      arrows: [
        {
          id: "edge",
          path: [
            { face: "front", x: 2, y: 1 },
            { face: "front", x: 3, y: 1 },
          ],
        },
      ],
      edgePolicies: [
        {
          face: "front",
          edge: "east",
          policy: "continue",
          neighbor: { face: "left", entering: "north" },
        },
      ],
    };
    expect(validateLevel(malformed).errors).toContain(
      "Continuation edge front:east does not match the cube seam transition.",
    );
  });
});

describe("level validation", () => {
  test("reports no self-contact for an arrow whose route crosses its own body", () => {
    const invalid: LevelDefinition = {
      id: 1,
      title: "Hidden self contact",
      gridSize: 4,
      lives: 1,
      arrows: [
        {
          id: "loop",
          path: [
            { face: "front", x: 0, y: 0 },
            { face: "front", x: 1, y: 0 },
            { face: "front", x: 2, y: 0 },
            { face: "front", x: 3, y: 0 },
            { face: "front", x: 3, y: 1 },
            { face: "front", x: 3, y: 2 },
            { face: "front", x: 2, y: 2 },
            { face: "front", x: 1, y: 2 },
            { face: "front", x: 0, y: 2 },
            { face: "front", x: 0, y: 1 },
            { face: "front", x: 1, y: 1 },
          ],
        },
        {
          id: "external-blocker",
          path: [
            { face: "front", x: 2, y: 1 },
            { face: "front", x: 2, y: 2 },
          ],
        },
      ],
    };
    const result = validateLevel(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Arrow external-blocker overlaps cell front:2:2 already used by loop.",
    );
    expect(
      result.errors.some((error) => error.includes("contact its own body")),
    ).toBe(false);
  });
});
