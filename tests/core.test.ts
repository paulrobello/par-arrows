import { describe, expect, test } from "bun:test";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import {
  cellsEqual,
  faceHeadingVector,
  faceNormal,
  headingForPath,
  oppositeHeading,
  seamTransition,
  stepAcrossSeam,
} from "../src/core/topology";
import { validateLevel } from "../src/core/validation";
import type { FaceId, Heading, LevelDefinition } from "../src/core/types";

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
      for (const [heading, [x, y]] of Object.entries(boundaries) as [
        Heading,
        readonly [number, number],
      ][]) {
        const source = { face, x, y };
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
  });

  test("derives a head heading from a wrapped authored path", () => {
    const tail = { face: "front" as const, x: 3, y: 0 };
    const head = stepAcrossSeam(tail, "east", 4);
    expect(headingForPath([tail, head], 4)).toBe("east");
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

  test("accepts a typed continuation contract but rejects its unshipped runtime behavior", () => {
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
    expect(result.kind).toBe("invalid");
    expect(result.reason).toContain("not playable in the MVP");
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
  test("rejects a self-contact even when another arrow blocks the earlier route", () => {
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
    expect(
      result.errors.some((error) => error.includes("contact its own body")),
    ).toBe(true);
  });
});
