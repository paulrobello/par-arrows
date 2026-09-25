import { describe, expect, test } from "bun:test";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type {
  ArrowDefinition,
  Cell,
  DirectionalSpotDefinition,
  FaceId,
  LevelDefinition,
} from "../src/core/types";
import { solveLevel, validateLevel } from "../src/core/validation";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

function spot(
  x: number,
  y: number,
  heading: DirectionalSpotDefinition["heading"],
  face: FaceId = "front",
): DirectionalSpotDefinition {
  return { cell: cell(face, x, y), heading };
}

function spotLevel(options: {
  arrows: readonly ArrowDefinition[];
  spots?: readonly DirectionalSpotDefinition[];
  stops?: readonly Cell[];
  gridSize?: number;
  lives?: number;
  id?: number;
}): LevelDefinition {
  return {
    id: options.id ?? 900,
    title: "Directional fixture",
    gridSize: options.gridSize ?? 6,
    lives: options.lives ?? 3,
    arrows: options.arrows,
    ...(options.spots && options.spots.length > 0
      ? { directionals: options.spots }
      : {}),
    ...(options.stops && options.stops.length > 0
      ? { stops: options.stops }
      : {}),
  };
}

const eastbound: ArrowDefinition = {
  id: "runner",
  path: [cell("front", 1, 2), cell("front", 2, 2)],
};

const wrappedFaces: LevelDefinition["edgePolicies"] = [
  {
    face: "front",
    edge: "west",
    policy: "continue",
    neighbor: { face: "left", entering: "west" },
  },
  {
    face: "left",
    edge: "east",
    policy: "continue",
    neighbor: { face: "front", entering: "east" },
  },
];

describe("directional spots", () => {
  test("a head entering a spot bends onto the spot's heading and keeps it", () => {
    const level = spotLevel({
      arrows: [eastbound],
      spots: [spot(3, 2, "north")],
    });
    expect(validateLevel(level).valid).toBe(true);

    const result = simulateMove(level, createGameState(level), "runner");
    expect(result.kind).toBe("exit");
    expect(result.route.map(cellKey)).toEqual([
      cellKey(cell("front", 2, 2)),
      cellKey(cell("front", 3, 2)),
      cellKey(cell("front", 3, 1)),
      cellKey(cell("front", 3, 0)),
    ]);
  });

  test("consecutive spots chain their headings", () => {
    const level = spotLevel({
      arrows: [eastbound],
      spots: [spot(3, 2, "north"), spot(3, 1, "west")],
    });
    const result = simulateMove(level, createGameState(level), "runner");
    expect(result.kind).toBe("exit");
    expect(result.route.map(cellKey)).toEqual([
      cellKey(cell("front", 2, 2)),
      cellKey(cell("front", 3, 2)),
      cellKey(cell("front", 3, 1)),
      cellKey(cell("front", 2, 1)),
      cellKey(cell("front", 1, 1)),
      cellKey(cell("front", 0, 1)),
    ]);
  });

  test("an arrow parked after a bend resumes with the post-bend heading", () => {
    const level = spotLevel({
      arrows: [eastbound],
      spots: [spot(3, 2, "north")],
      stops: [cell("front", 3, 1)],
    });
    const parked = applyMove(
      level,
      createGameState(level),
      simulateMove(level, createGameState(level), "runner"),
    );
    expect(parked.offsets).toEqual({ runner: 2 });

    const resumed = simulateMove(level, parked, "runner");
    expect(resumed.kind).toBe("exit");
    expect(resumed.route.map(cellKey)).toEqual([
      cellKey(cell("front", 3, 1)),
      cellKey(cell("front", 3, 0)),
    ]);
    expect(applyMove(level, parked, resumed).status).toBe("won");
  });

  test("a redirected head parks on a circle and rebounds to it after a failure", () => {
    const level = spotLevel({
      arrows: [
        eastbound,
        {
          id: "blocker",
          path: [cell("front", 5, 0), cell("front", 4, 0), cell("front", 3, 0)],
        },
      ],
      spots: [spot(3, 2, "north")],
      stops: [cell("front", 3, 1)],
    });
    let state = createGameState(level);

    const parked = simulateMove(level, state, "runner");
    expect(parked.kind).toBe("paused");
    state = applyMove(level, state, parked);
    expect(state.lives).toBe(3);

    const blocked = simulateMove(level, state, "runner");
    expect(blocked.kind).toBe("blocked");
    expect(blocked.blockerId).toBe("blocker");
    state = applyMove(level, state, blocked);
    expect(state.lives).toBe(2);
    expect(state.failedIds).toEqual(["runner"]);
    expect(state.offsets).toEqual({ runner: 2 });

    const retry = applyMove(level, state, simulateMove(level, state, "runner"));
    expect(retry.lives).toBe(2);
  });

  test("a head that enters a spot head-on reverses back over its own body", () => {
    const level = spotLevel({
      arrows: [
        {
          id: "long",
          path: [cell("front", 1, 2), cell("front", 2, 2), cell("front", 3, 2)],
        },
      ],
      spots: [spot(4, 2, "west")],
    });
    const state = createGameState(level);
    const result = simulateMove(level, state, "long");
    expect(result.kind).toBe("exit");
    expect(result.route.map(cellKey)).toEqual(
      [
        cell("front", 3, 2),
        cell("front", 4, 2),
        cell("front", 3, 2),
        cell("front", 2, 2),
        cell("front", 1, 2),
        cell("front", 0, 2),
      ].map(cellKey),
    );
    expect(validateLevel(level).valid).toBe(true);
    expect(applyMove(level, state, result).status).toBe("won");
  });

  test("a head travelling the spot's direction passes straight through", () => {
    const level = spotLevel({
      arrows: [
        { id: "runner", path: [cell("front", 0, 2), cell("front", 1, 2)] },
      ],
      spots: [spot(3, 2, "east")],
    });
    const result = simulateMove(level, createGameState(level), "runner");
    expect(result.kind).toBe("exit");
    expect(result.route.at(-1)).toEqual(cell("front", 5, 2));
  });

  test("two spots facing each other are rejected as a loop, not a self-collision", () => {
    const level = spotLevel({
      arrows: [
        { id: "ping", path: [cell("front", 0, 2), cell("front", 1, 2)] },
      ],
      spots: [spot(3, 2, "west"), spot(2, 2, "east")],
    });
    const result = simulateMove(level, createGameState(level), "ping");
    expect(result.kind).toBe("invalid");
    expect(result.reason).toContain("nonterminating continuation cycle");
    expect(validateLevel(level).errors).toContain(
      "Arrow ping has a nonterminating continuation loop from its head endpoint.",
    );
  });

  test("a redirected head that meets another arrow blocks once, then retries free", () => {
    const level = spotLevel({
      arrows: [
        eastbound,
        {
          id: "blocker",
          path: [cell("front", 5, 1), cell("front", 4, 1), cell("front", 3, 1)],
        },
      ],
      spots: [spot(3, 2, "north")],
    });
    let state = createGameState(level);

    const blocked = simulateMove(level, state, "runner");
    expect(blocked.kind).toBe("blocked");
    expect(blocked.blockerId).toBe("blocker");
    expect(blocked.route.map(cellKey)).toEqual([
      cellKey(cell("front", 2, 2)),
      cellKey(cell("front", 3, 2)),
      cellKey(cell("front", 3, 1)),
    ]);
    state = applyMove(level, state, blocked);
    expect(state.lives).toBe(2);
    expect(state.failedIds).toEqual(["runner"]);
    expect(state.offsets).toEqual({});

    const retry = applyMove(level, state, simulateMove(level, state, "runner"));
    expect(retry.lives).toBe(2);
  });

  test("a bend pointed at a continuation edge wraps to the neighbor face", () => {
    const level: LevelDefinition = {
      ...spotLevel({
        arrows: [
          { id: "wrapper", path: [cell("front", 2, 1), cell("front", 1, 1)] },
        ],
        spots: [spot(0, 1, "west")],
        gridSize: 4,
      }),
      edgePolicies: wrappedFaces,
    };
    expect(validateLevel(level).valid).toBe(true);

    const result = simulateMove(level, createGameState(level), "wrapper");
    expect(result.kind).toBe("exit");
    expect(result.route.some((entry) => entry.face === "left")).toBe(true);
  });

  test("a double-ended arrow's head walk bends like any other", () => {
    const level = spotLevel({
      arrows: [
        {
          id: "span",
          kind: "double",
          path: [cell("front", 2, 2), cell("front", 3, 2), cell("front", 4, 2)],
        },
      ],
      spots: [spot(5, 2, "north")],
    });
    const result = simulateMove(level, createGameState(level), "span", "head");
    expect(result.kind).toBe("exit");
    expect(result.route.map(cellKey)).toEqual([
      cellKey(cell("front", 4, 2)),
      cellKey(cell("front", 5, 2)),
      cellKey(cell("front", 5, 1)),
      cellKey(cell("front", 5, 0)),
    ]);
  });

  test("simulating and applying moves never mutates authored paths", () => {
    const level = spotLevel({
      arrows: [
        eastbound,
        {
          id: "blocker",
          path: [cell("front", 5, 0), cell("front", 4, 0), cell("front", 3, 0)],
        },
      ],
      spots: [spot(3, 2, "north")],
      stops: [cell("front", 3, 1)],
    });
    const snapshot = JSON.stringify(level);
    let state = createGameState(level);
    for (let tap = 0; tap < 4; tap += 1) {
      state = applyMove(level, state, simulateMove(level, state, "runner"));
      if (state.status !== "playing") break;
    }
    expect(JSON.stringify(level)).toBe(snapshot);
  });

  test("validateLevel rejects misplaced, duplicated, and stacking spots", () => {
    const onStop = spotLevel({
      arrows: [eastbound],
      spots: [spot(3, 2, "north")],
      stops: [cell("front", 3, 2)],
    });
    expect(onStop.directionals?.length).toBe(1);
    const onStopCheck = validateLevel(onStop);
    expect(onStopCheck.valid).toBe(false);
    expect(onStopCheck.errors.join("\n")).toContain(
      "shares its cell with a stop circle",
    );

    const onArrow = spotLevel({
      arrows: [eastbound],
      spots: [spot(2, 2, "north")],
    });
    const onArrowCheck = validateLevel(onArrow);
    expect(onArrowCheck.valid).toBe(false);
    expect(onArrowCheck.errors.join("\n")).toContain(
      "sits on an arrow's starting cell",
    );

    const duplicated = spotLevel({
      arrows: [eastbound],
      spots: [spot(3, 2, "north"), spot(3, 2, "south")],
    });
    const duplicatedCheck = validateLevel(duplicated);
    expect(duplicatedCheck.valid).toBe(false);
    expect(duplicatedCheck.errors.join("\n")).toContain(
      "declared more than once",
    );

    const outside = spotLevel({
      arrows: [eastbound],
      spots: [spot(9, 9, "north")],
    });
    const outsideCheck = validateLevel(outside);
    expect(outsideCheck.valid).toBe(false);
    expect(outsideCheck.errors.join("\n")).toContain("out of bounds");
  });

  test("a shared-tail group shares a spot cube only while its routes avoid every spot", () => {
    const arrows: readonly ArrowDefinition[] = [
      {
        id: "north",
        path: [cell("front", 0, 2), cell("front", 1, 2), cell("front", 1, 1)],
      },
      {
        id: "east",
        path: [cell("front", 0, 2), cell("front", 1, 2), cell("front", 2, 2)],
      },
    ];
    const clear = spotLevel({ arrows, spots: [spot(4, 4, "north")] });
    expect(validateLevel(clear)).toEqual({ valid: true, errors: [] });
    const crossed = spotLevel({ arrows, spots: [spot(4, 2, "north")] });
    const check = validateLevel(crossed);
    expect(check.valid).toBe(false);
    expect(check.errors).toContain(
      "Shared-tail group east|north has a member route through a directional spot.",
    );
  });

  test("facing spots form a rejected loop, simulate as invalid, and truncate tracks", () => {
    const level = spotLevel({
      arrows: [eastbound],
      spots: [spot(3, 2, "east"), spot(4, 2, "west")],
    });
    const check = validateLevel(level);
    expect(check.valid).toBe(false);
    expect(check.errors.join("\n")).toContain(
      "nonterminating continuation loop",
    );

    const result = simulateMove(level, createGameState(level), "runner");
    expect(result.kind).toBe("invalid");
    expect(result.reason).toContain("nonterminating continuation cycle");

    const track = arrowTrack(level, eastbound);
    expect(track.length).toBeLessThan(50);
  });

  test("a head-on pair needs its spot: solvable with it, dead without it", () => {
    const level = spotLevel({
      arrows: [
        { id: "westbound", path: [cell("front", 5, 2), cell("front", 4, 2)] },
        eastbound,
      ],
      spots: [spot(3, 2, "north")],
    });
    expect(validateLevel(level).valid).toBe(true);
    const certificate = solveLevel(level);
    expect(certificate).toBeDefined();
    expect(certificate).toEqual(["westbound", "runner"]);

    const stripped: LevelDefinition = { ...level, directionals: [] };
    const dead = createGameState(stripped);
    const west = simulateMove(stripped, dead, "westbound");
    expect(west.kind).toBe("blocked");
    expect(west.blockerId).toBe("runner");
    const east = simulateMove(stripped, dead, "runner");
    expect(east.kind).toBe("blocked");
    expect(east.blockerId).toBe("westbound");
    expect(solveLevel(stripped)).toBeUndefined();
  });
});
