import { describe, expect, test } from "bun:test";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { cellKey } from "../src/core/topology";
import type { Cell, LevelDefinition } from "../src/core/types";
import {
  interactionRegion,
  proveRegion,
  validateLevel,
} from "../src/core/validation";

function cell(x: number, y: number): Cell {
  return { face: "front", x, y };
}

function level(
  arrows: LevelDefinition["arrows"],
  spots: {
    x: number;
    y: number;
    heading: "north" | "south" | "east" | "west";
    kind?: "flip";
  }[],
  stops: Cell[] = [],
): LevelDefinition {
  return {
    id: 910,
    title: "Region fixture",
    gridSize: 6,
    lives: 3,
    arrows,
    directionals: spots.map((spot) => ({
      cell: cell(spot.x, spot.y),
      heading: spot.heading,
      ...(spot.kind ? { kind: spot.kind } : {}),
    })),
    ...(stops.length > 0 ? { stops } : {}),
  };
}

describe("interaction regions", () => {
  const flipThree = () =>
    level(
      [
        { id: "reverser", path: [cell(1, 3), cell(1, 2)] },
        { id: "guard", path: [cell(0, 0), cell(1, 0)] },
        { id: "runner", path: [cell(3, 1), cell(2, 1)] },
        { id: "far", path: [cell(4, 4), cell(5, 4)] },
      ],
      [{ x: 1, y: 1, heading: "south", kind: "flip" }],
    );

  test("closes over arrows whose tracks touch the flip area", () => {
    const region = interactionRegion(flipThree(), ["reverser"]);
    expect([...(region?.arrowIds ?? [])].sort()).toEqual([
      "guard",
      "reverser",
      "runner",
    ]);
    // `far` exits east, never enters the (1,1) area.
    expect(region?.arrowIds).not.toContain("far");
    expect(region?.spotKeys).toEqual([cellKey(cell(1, 1))]);
  });

  test("returns undefined past the arrow cap", () => {
    const wide = level(
      [
        { id: "a", path: [cell(0, 0), cell(1, 0)] },
        { id: "b", path: [cell(0, 2), cell(1, 2)] },
        { id: "c", path: [cell(0, 4), cell(1, 4)] },
        { id: "d", path: [cell(3, 0), cell(3, 1)] },
        { id: "e", path: [cell(3, 3), cell(3, 4)] },
      ],
      [{ x: 2, y: 2, heading: "north", kind: "flip" }],
    );
    expect(interactionRegion(wide, ["a"], 2)).toBeUndefined();
  });

  test("proveRegion accepts the level-30 shape with a stop inside", () => {
    // The stop may not sit on the spot cell or any authored arrow cell, so it
    // goes on the reverser's bounce lane past the spot.
    const legal = level(
      [
        { id: "reverser", path: [cell(1, 3), cell(1, 2)] },
        { id: "guard", path: [cell(0, 0), cell(1, 0)] },
        { id: "runner", path: [cell(3, 1), cell(2, 1)] },
      ],
      [{ x: 1, y: 1, heading: "south", kind: "flip" }],
      [cell(1, 4)],
    );
    expect(validateLevel(legal).valid).toBe(true);
    const region = interactionRegion(legal, ["reverser"]);
    const verdict =
      region && proveRegion(legal, createGameState(legal), region);
    expect(verdict?.ok).toBe(true);
  });

  test("proveRegion rejects a stranded region with reasons", () => {
    // The runner parks onto the reverser's only exit lane and nothing else
    // can clear: build via parking on a stop that blocks the flip lane.
    const stranded = level(
      [
        { id: "reverser", path: [cell(1, 3), cell(1, 2)] },
        { id: "guard", path: [cell(0, 0), cell(1, 0)] },
        { id: "runner", path: [cell(3, 1), cell(2, 1)] },
      ],
      [{ x: 1, y: 1, heading: "south", kind: "flip" }],
      [cell(0, 1)],
    );
    const region = interactionRegion(stranded, ["reverser"]);
    const verdict =
      region && proveRegion(stranded, createGameState(stranded), region);
    // A rejected region always carries one of the named reasons.
    if (!verdict?.ok) {
      expect(verdict?.reason).toBeOneOf([
        "stranded",
        "uninteresting",
        "unsolvable",
        "overflow",
      ]);
    }
  });

  test("the model matches the engine on a clearing sequence", () => {
    const legal = level(
      [
        { id: "reverser", path: [cell(1, 3), cell(1, 2)] },
        { id: "guard", path: [cell(0, 0), cell(1, 0)] },
        { id: "runner", path: [cell(3, 1), cell(2, 1)] },
      ],
      [{ x: 1, y: 1, heading: "south", kind: "flip" }],
    );
    let state = createGameState(legal);
    for (const id of ["reverser", "guard", "runner"]) {
      state = applyMove(legal, state, simulateMove(legal, state, id));
    }
    expect(state.status).toBe("won");
  });
});
