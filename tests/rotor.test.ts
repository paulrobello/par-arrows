import { describe, expect, test } from "bun:test";
import {
  advancedSpotHeading,
  hasRotorSpots,
  hasStatefulSpots,
  isRotorSpot,
  rotatedHeading,
  spotHeadingAt,
  spotStates,
} from "../src/core/directionals";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { cellKey } from "../src/core/topology";
import type {
  Cell,
  FaceId,
  GameState,
  Heading,
  LevelDefinition,
} from "../src/core/types";
import {
  flipHeadingProbes,
  flipInterest,
  hasStrandingState,
  interactionRegion,
  occupancyKeys,
  proveRegion,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";

function cell(x: number, y: number, face: FaceId = "front"): Cell {
  return { face, x, y };
}

type SpotKind = "static" | "flip" | "rotor";

function rotorLevel(
  arrows: LevelDefinition["arrows"],
  spots: { cell: Cell; heading: Heading; kind?: SpotKind }[],
  stops: Cell[] = [],
  gridSize = 6,
): LevelDefinition {
  return {
    id: 902,
    title: "Rotor fixture",
    gridSize,
    lives: 3,
    arrows,
    directionals: spots.map((spot) => ({
      cell: spot.cell,
      heading: spot.heading,
      kind: spot.kind ?? "rotor",
    })),
    ...(stops.length > 0 ? { stops } : {}),
  };
}

const keys = (cells: readonly Cell[] | undefined): string[] =>
  (cells ?? []).map(cellKey);

describe("rotor spot state", () => {
  test("turns a quarter clockwise and cycles four ways", () => {
    expect(rotatedHeading("north")).toBe("east");
    expect(rotatedHeading("east")).toBe("south");
    expect(rotatedHeading("south")).toBe("west");
    expect(rotatedHeading("west")).toBe("north");
    expect(
      spotStates({ cell: cell(0, 0), heading: "west", kind: "rotor" }),
    ).toEqual(["west", "north", "east", "south"]);
    expect(
      spotStates({ cell: cell(0, 0), heading: "west", kind: "flip" }),
    ).toEqual(["west", "east"]);
    expect(spotStates({ cell: cell(0, 0), heading: "west" })).toEqual(["west"]);
  });

  test("reads its current direction from game state and advances clockwise", () => {
    const level = rotorLevel([], [{ cell: cell(2, 2), heading: "north" }]);
    const key = cellKey(cell(2, 2));
    expect(isRotorSpot(level, cell(2, 2))).toBe(true);
    expect(hasRotorSpots(level)).toBe(true);
    expect(hasStatefulSpots(level)).toBe(true);
    expect(spotHeadingAt(level, cell(2, 2))).toBe("north");
    expect(spotHeadingAt(level, cell(2, 2), { [key]: "west" })).toBe("west");
    expect(advancedSpotHeading(level, cell(2, 2))).toBe("east");
    expect(advancedSpotHeading(level, cell(2, 2), { [key]: "west" })).toBe(
      "north",
    );
    expect(createGameState(level).spotHeadings).toEqual({});
  });

  test("a static spot never advances", () => {
    const level = rotorLevel(
      [],
      [{ cell: cell(2, 2), heading: "north", kind: "static" }],
    );
    expect(advancedSpotHeading(level, cell(2, 2))).toBeUndefined();
    expect(hasStatefulSpots(level)).toBe(false);
    expect(hasRotorSpots(level)).toBe(false);
  });
});

describe("rotor movement", () => {
  // One arrow approaching the rotor at (3,2) from the west on an empty face.
  const lane = (heading: Heading) =>
    rotorLevel(
      [{ id: "a", path: [cell(0, 2), cell(1, 2)] }],
      [{ cell: cell(3, 2), heading }],
    );
  const rotorKey = cellKey(cell(3, 2));

  test("travelling with the rotor's direction passes straight through", () => {
    const level = lane("east");
    const result = simulateMove(level, createGameState(level), "a");
    expect(result.kind).toBe("exit");
    expect(keys(result.route)).toEqual(
      keys([cell(1, 2), cell(2, 2), cell(3, 2), cell(4, 2), cell(5, 2)]),
    );
  });

  test("travelling against it reverses back over the arrow's own body", () => {
    const level = lane("west");
    const result = simulateMove(level, createGameState(level), "a");
    expect(result.kind).toBe("exit");
    expect(keys(result.route)).toEqual(
      keys([
        cell(1, 2),
        cell(2, 2),
        cell(3, 2),
        cell(2, 2),
        cell(1, 2),
        cell(0, 2),
      ]),
    );
  });

  test("arriving from the side bends onto its direction", () => {
    const level = lane("north");
    const result = simulateMove(level, createGameState(level), "a");
    expect(result.kind).toBe("exit");
    expect(keys(result.route)).toEqual(
      keys([cell(1, 2), cell(2, 2), cell(3, 2), cell(3, 1), cell(3, 0)]),
    );
  });

  test("four full passes cycle it back to the authored heading", () => {
    const level = lane("east");
    let spotHeadings: Readonly<Record<string, Heading>> = {};
    const seen: Heading[] = [];
    const exits: string[] = [];
    for (let pass = 0; pass < 4; pass += 1) {
      const state: GameState = { ...createGameState(level), spotHeadings };
      const result = simulateMove(level, state, "a");
      expect(result.kind).toBe("exit");
      expect(keys(result.spotFlips?.map((flip) => flip.cell))).toEqual([
        rotorKey,
      ]);
      exits.push(cellKey(result.route.at(-1) as Cell));
      spotHeadings = applyMove(level, state, result).spotHeadings ?? {};
      seen.push(spotHeadings?.[rotorKey] as Heading);
    }
    expect(seen).toEqual(["south", "west", "north", "east"]);
    // Pass, bend south, reverse west, bend north.
    expect(exits).toEqual(
      keys([cell(5, 2), cell(3, 5), cell(0, 2), cell(3, 0)]),
    );
    expect(spotHeadings).toEqual({ [rotorKey]: "east" });
  });

  test("advances only once no cell of the arrow remains on it", () => {
    const level = rotorLevel(
      [{ id: "a", path: [cell(1, 2), cell(2, 2)] }],
      [{ cell: cell(3, 2), heading: "east" }],
      [],
      8,
    );
    const result = simulateMove(level, createGameState(level), "a");
    expect(result.kind).toBe("exit");
    // The head enters (3,2) at step 1; the tail leaves it at step 3.
    expect(result.spotFlips).toEqual([{ cell: cell(3, 2), step: 3 }]);
  });

  test("a parked arrow on the rotor leaves the advance pending until it moves off", () => {
    const level = rotorLevel(
      [{ id: "mover", path: [cell(0, 2), cell(1, 2)] }],
      [{ cell: cell(2, 2), heading: "north" }],
      [cell(2, 1)],
    );
    let state = createGameState(level);
    const parked = simulateMove(level, state, "mover");
    expect(parked.kind).toBe("paused");
    expect(parked.spotFlips ?? []).toEqual([]);
    state = applyMove(level, state, parked);
    expect(state.spotHeadings).toEqual({});
    // A lone single on a rotor level parks by its exact path, not an offset.
    expect(keys(state.settledPaths?.mover)).toEqual(
      keys([cell(2, 2), cell(2, 1)]),
    );
    expect(state.offsets).toEqual({});
    const onward = simulateMove(level, state, "mover");
    expect(onward.kind).toBe("exit");
    state = applyMove(level, state, onward);
    expect(state.spotHeadings).toEqual({ [cellKey(cell(2, 2))]: "east" });
  });

  test("a collision before the arrow clears the rotor leaves it put", () => {
    const level = rotorLevel(
      [
        { id: "mover", path: [cell(0, 2), cell(1, 2), cell(2, 2)] },
        { id: "wall", path: [cell(4, 1), cell(3, 1)] },
      ],
      [{ cell: cell(3, 2), heading: "north" }],
    );
    const state = createGameState(level);
    const result = simulateMove(level, state, "mover");
    expect(result.kind).toBe("blocked");
    expect(result.spotFlips ?? []).toEqual([]);
    const next = applyMove(level, state, result);
    expect(next.spotHeadings).toEqual({});
    expect(next.lives).toBe(level.lives - 1);
  });

  test("a collision after clearing the rotor restores its direction", () => {
    const level = rotorLevel(
      [
        { id: "mover", path: [cell(0, 3), cell(1, 3)] },
        { id: "wall", path: [cell(1, 0), cell(2, 0)] },
      ],
      [{ cell: cell(2, 3), heading: "north" }],
    );
    const state = createGameState(level);
    const result = simulateMove(level, state, "mover");
    expect(result.kind).toBe("blocked");
    expect(keys(result.spotFlips?.map((flip) => flip.cell))).toEqual([
      cellKey(cell(2, 3)),
    ]);
    const next = applyMove(level, state, result);
    expect(next.spotHeadings).toEqual({});
    expect(next.lives).toBe(level.lives - 1);
  });

  test("a parked arrow that collides keeps its pending advance", () => {
    const level = rotorLevel(
      [
        { id: "mover", path: [cell(0, 2), cell(1, 2)] },
        { id: "wall", path: [cell(3, 0), cell(2, 0)] },
      ],
      [{ cell: cell(2, 2), heading: "north" }],
      [cell(2, 1)],
    );
    let state = createGameState(level);
    state = applyMove(level, state, simulateMove(level, state, "mover"));
    const blocked = simulateMove(level, state, "mover");
    expect(blocked.kind).toBe("blocked");
    state = applyMove(level, state, blocked);
    expect(state.spotHeadings).toEqual({});
    expect(keys(state.settledPaths?.mover)).toEqual(
      keys([cell(2, 2), cell(2, 1)]),
    );
  });

  test("a head re-entering a rotor its body still covers advances it once", () => {
    // Head-on into the west rotor at (4,2): the head reverses and runs back
    // over its body, which stays on (4,2) until the tail catches up.
    const level = rotorLevel(
      [{ id: "long", path: [cell(1, 2), cell(2, 2), cell(3, 2)] }],
      [{ cell: cell(4, 2), heading: "west" }],
    );
    const result = simulateMove(level, createGameState(level), "long");
    expect(result.kind).toBe("exit");
    expect(result.spotFlips).toHaveLength(1);
  });

  test("a loop that exists only under a turned rotor is invalid at no life cost", () => {
    // Authored east, the rotor at (2,2) sends both arrows off the east edge.
    // Once "b" has bent through it, it points south into a ring of static
    // spots that never returns to the rotor, so "a" circles forever.
    const level = rotorLevel(
      [
        { id: "a", path: [cell(0, 2), cell(1, 2)] },
        { id: "b", path: [cell(2, 0), cell(2, 1)] },
      ],
      [
        { cell: cell(2, 2), heading: "east" },
        { cell: cell(2, 3), heading: "south", kind: "static" },
        { cell: cell(2, 4), heading: "east", kind: "static" },
        { cell: cell(3, 4), heading: "north", kind: "static" },
        { cell: cell(3, 3), heading: "west", kind: "static" },
      ],
    );
    expect(validateLevel(level).valid).toBe(true);
    let state = createGameState(level);
    expect(simulateMove(level, state, "a").kind).toBe("exit");
    const bend = simulateMove(level, state, "b");
    expect(bend.kind).toBe("exit");
    state = applyMove(level, state, bend);
    expect(state.spotHeadings).toEqual({ [cellKey(cell(2, 2))]: "south" });
    const looped = simulateMove(level, state, "a");
    expect(looped.kind).toBe("invalid");
    expect(looped.reason).toContain("cycle");
    const after = applyMove(level, state, looped);
    expect(after).toBe(state);
    expect(after.lives).toBe(level.lives);
  });

  test("a double arrow respects the rotor each endpoint runs into", () => {
    // Head end runs east into (5,3); tail end runs west into (0,3).
    const level = rotorLevel(
      [
        {
          id: "d",
          kind: "double",
          path: [cell(2, 3), cell(3, 3), cell(4, 3)],
        },
      ],
      [
        { cell: cell(5, 3), heading: "north" },
        { cell: cell(0, 3), heading: "south" },
      ],
      [],
      7,
    );
    const state = createGameState(level);
    const head = simulateMove(level, state, "d", "head");
    expect(head.kind).toBe("exit");
    expect(keys(head.route)).toEqual(
      keys([cell(4, 3), cell(5, 3), cell(5, 2), cell(5, 1), cell(5, 0)]),
    );
    expect(applyMove(level, state, head).spotHeadings).toEqual({
      [cellKey(cell(5, 3))]: "east",
    });
    const tail = simulateMove(level, state, "d", "tail");
    expect(tail.kind).toBe("exit");
    expect(keys(tail.route)).toEqual(
      keys([
        cell(2, 3),
        cell(1, 3),
        cell(0, 3),
        cell(0, 4),
        cell(0, 5),
        cell(0, 6),
      ]),
    );
    expect(applyMove(level, state, tail).spotHeadings).toEqual({
      [cellKey(cell(0, 3))]: "west",
    });
    // Turned to face the tail head-on, the west rotor sends it back over its
    // own body and out through the east rotor, advancing both.
    const turned: GameState = {
      ...state,
      spotHeadings: { [cellKey(cell(0, 3))]: "east" },
    };
    const back = simulateMove(level, turned, "d", "tail");
    expect(back.kind).toBe("exit");
    expect(back.route.at(-1)).toEqual(cell(5, 0));
    expect(applyMove(level, turned, back).spotHeadings).toEqual({
      [cellKey(cell(0, 3))]: "south",
      [cellKey(cell(5, 3))]: "east",
    });
  });
});

describe("rotor validation and solving", () => {
  // The level-30 layout with the flip spot replaced by a rotor: the reverser
  // turns it from south to west, which frees the runner's lane.
  const intro = () =>
    rotorLevel(
      [
        { id: "reverser", path: [cell(1, 3), cell(1, 2)] },
        { id: "guard", path: [cell(0, 0), cell(1, 0)] },
        { id: "runner", path: [cell(3, 1), cell(2, 1)] },
      ],
      [{ cell: cell(1, 1), heading: "south" }],
      [],
      4,
    );

  test("a small rotor level validates, solves, never strands, and the rotor matters", () => {
    const level = intro();
    expect(validateLevel(level).errors).toEqual([]);
    expect(solveLevelTargets(level)).toBeDefined();
    expect(hasStrandingState(level)).toBe(false);
    expect(flipInterest(level)).toBe(true);
    let state = createGameState(level);
    expect(simulateMove(level, state, "runner").kind).toBe("blocked");
    state = applyMove(level, state, simulateMove(level, state, "reverser"));
    expect(state.spotHeadings).toEqual({ [cellKey(cell(1, 1))]: "west" });
    expect(simulateMove(level, state, "runner").kind).toBe("exit");
  });

  test("the same spot made static carries no spot interest", () => {
    const level = intro();
    const still: LevelDefinition = {
      ...level,
      directionals: (level.directionals ?? []).map((spot) => ({
        ...spot,
        kind: "static" as const,
      })),
    };
    expect(flipInterest(still)).toBe(false);
  });

  test("region probes and occupancy cover all four rotor directions", () => {
    const level = intro();
    const probes = flipHeadingProbes(level);
    expect(probes.map((probe) => probe.directionals?.[0]?.heading)).toEqual([
      "south",
      "west",
      "north",
      "east",
    ]);
    const runner = level.arrows.find((arrow) => arrow.id === "runner");
    if (!runner) throw new Error("fixture lost its runner");
    const reach = occupancyKeys(level, runner);
    // South, west and north exits from the rotor all count.
    for (const target of [cell(1, 3), cell(0, 1), cell(1, 0)]) {
      expect(reach.has(cellKey(target))).toBe(true);
    }
    const region = interactionRegion(level, ["reverser"]);
    expect([...(region?.arrowIds ?? [])].sort()).toEqual([
      "guard",
      "reverser",
      "runner",
    ]);
    expect(region?.spotKeys).toEqual([cellKey(cell(1, 1))]);
    if (!region) throw new Error("region overflowed");
    expect(proveRegion(level, createGameState(level), region).ok).toBe(true);
  });

  test("rejects a rotor on a stop circle", () => {
    const level = rotorLevel(
      [{ id: "a", path: [cell(0, 0), cell(1, 0)] }],
      [{ cell: cell(3, 3), heading: "north" }],
      [cell(3, 3)],
    );
    expect(validateLevel(level).errors).toContain(
      "Rotor spot front:3:3 shares its cell with a stop circle.",
    );
  });

  test("rejects a rotor on a wormhole end", () => {
    const level: LevelDefinition = {
      ...rotorLevel(
        [{ id: "a", path: [cell(0, 0), cell(1, 0)] }],
        [{ cell: cell(3, 3), heading: "north" }],
      ),
      wormholes: [{ id: "w", a: cell(3, 3), b: cell(4, 4, "back") }],
    };
    expect(validateLevel(level).errors).toContain(
      "Wormhole end front:3:3 shares its cell with a directional spot.",
    );
  });

  test("rejects a stop that parks an arrow folded over itself in a turned rotor state", () => {
    // The first tap parks the head on the stop at (3,2). Authored north, the
    // rotor at (4,2) then bends the head away and nothing folds. Turned west,
    // it sends the head straight back onto the stop, parking the body as
    // (3,2) (4,2) (3,2).
    const level = rotorLevel(
      [{ id: "long", path: [cell(0, 2), cell(1, 2), cell(2, 2)] }],
      [{ cell: cell(4, 2), heading: "north" }],
      [cell(3, 2)],
    );
    expect(validateLevel(level).errors).toContain(
      "Stop circle front:3:2 would park arrow long folded over itself.",
    );
    expect(
      validateLevel({
        ...level,
        directionals: [{ cell: cell(4, 2), heading: "north", kind: "static" }],
      }).valid,
    ).toBe(true);
  });

  test("rejects a flip spot that shares an interaction region with a rotor", () => {
    const base = intro();
    const mixed: LevelDefinition = {
      ...base,
      // The runner's west exit, open once the rotor turns, runs over (0,1).
      directionals: [
        ...(base.directionals ?? []),
        { cell: cell(0, 1), heading: "west", kind: "flip" },
      ],
    };
    expect(validateLevel(mixed).errors).toContain(
      "Flip spot front:0:1 shares an interaction region with a rotor spot.",
    );
  });

  test("accepts a flip spot in a region apart from every rotor", () => {
    const base = intro();
    const apart: LevelDefinition = {
      ...base,
      arrows: [
        ...base.arrows,
        { id: "far", path: [cell(0, 1, "back"), cell(1, 1, "back")] },
      ],
      directionals: [
        ...(base.directionals ?? []),
        { cell: cell(2, 1, "back"), heading: "south", kind: "flip" },
      ],
    };
    expect(validateLevel(apart).errors).toEqual([]);
  });
});
