import { describe, expect, test } from "bun:test";
import { simulateMove } from "../src/core/movement";
import { hasLeapPads, isLeapPad, MAX_LEAP_PADS } from "../src/core/leaps";
import { arrowTrack, maximumOffset } from "../src/core/stops";
import { cellKey, cellToWorld } from "../src/core/topology";
import { linkHeading } from "../src/core/wormholes";
import { solveLevel, validateLevel } from "../src/core/validation";
import type { Cell, LevelDefinition } from "../src/core/types";

const c = (face: string, x: number, y: number): Cell =>
  ({ face, x, y }) as Cell;

function leapLevel(overrides: Partial<LevelDefinition> = {}): LevelDefinition {
  return {
    id: 1,
    title: "leap scratch",
    gridSize: 6,
    lives: 5,
    leaps: [c("front", 2, 2)],
    arrows: [{ id: "p", path: [c("front", 0, 2), c("front", 1, 2)] }],
    ...overrides,
  };
}

describe("leap pads", () => {
  test("lookups and level predicates", () => {
    const level = leapLevel();
    expect(isLeapPad(level, c("front", 2, 2))).toBe(true);
    expect(isLeapPad(level, c("front", 3, 2))).toBe(false);
    expect(hasLeapPads(level)).toBe(true);
    expect(hasLeapPads({ ...level, leaps: [] })).toBe(false);
    expect(MAX_LEAP_PADS).toBe(2);
  });

  test("a head entering the pad skips the next cell and lands two cells on", () => {
    const level = leapLevel();
    expect(validateLevel(level).valid).toBe(true);
    const result = simulateMove(level, ["p"], "p");
    expect(result.kind).toBe("exit");
    // The skipped cell (3, 2) never appears in the route.
    expect(result.route.map(cellKey)).toEqual([
      cellKey(c("front", 1, 2)),
      cellKey(c("front", 2, 2)),
      cellKey(c("front", 4, 2)),
      cellKey(c("front", 5, 2)),
    ]);
    expect(result.leaps).toEqual([
      {
        from: c("front", 2, 2),
        over: c("front", 3, 2),
        to: c("front", 4, 2),
        step: 2,
      },
    ]);
  });

  test("an arrow body on the skipped cell never collides", () => {
    const level = leapLevel({
      arrows: [
        { id: "p", path: [c("front", 0, 2), c("front", 1, 2)] },
        { id: "b", path: [c("front", 3, 2), c("front", 3, 1)] },
      ],
    });
    expect(validateLevel(level).valid).toBe(true);
    const result = simulateMove(level, ["p", "b"], "p");
    expect(result.kind).toBe("exit");
    expect(result.route.map(cellKey)).toEqual([
      cellKey(c("front", 1, 2)),
      cellKey(c("front", 2, 2)),
      cellKey(c("front", 4, 2)),
      cellKey(c("front", 5, 2)),
    ]);
  });

  test("a spot, stop, or portal on the skipped cell never triggers", () => {
    const spot = leapLevel({
      directionals: [{ cell: c("front", 3, 2), heading: "south" }],
    });
    const spotResult = simulateMove(spot, ["p"], "p");
    expect(spotResult.kind).toBe("exit");
    expect(spotResult.route.at(-1)).toEqual(c("front", 5, 2));

    const stop = leapLevel({ stops: [c("front", 3, 2)] });
    const stopResult = simulateMove(stop, ["p"], "p");
    expect(stopResult.kind).toBe("exit");

    const portal = leapLevel({
      wormholes: [{ id: "w", a: c("front", 3, 2), b: c("back", 2, 2) }],
    });
    const portalResult = simulateMove(portal, ["p"], "p");
    expect(portalResult.kind).toBe("exit");
    expect(portalResult.portals).toBeUndefined();
    expect(portalResult.leaps?.[0]?.over).toEqual(c("front", 3, 2));
  });

  test("a closed gate on the skipped cell is leapt over; on the landing it gates", () => {
    const over = leapLevel({
      locks: [{ id: "l", key: c("back", 2, 2), lock: c("front", 3, 2) }],
    });
    expect(validateLevel(over).valid).toBe(true);
    expect(simulateMove(over, ["p"], "p").kind).toBe("exit");

    const at = leapLevel({
      locks: [{ id: "l", key: c("back", 2, 2), lock: c("front", 4, 2) }],
    });
    const atResult = simulateMove(at, ["p"], "p");
    expect(atResult.kind).toBe("gated");
    expect(atResult.gate).toEqual(c("front", 4, 2));
  });

  test("a fragile cell under the leap is not consumed", () => {
    const level = leapLevel({
      fragile: [c("front", 3, 2)],
      arrows: [
        { id: "p", path: [c("front", 0, 2), c("front", 1, 2)] },
        { id: "x", path: [c("front", 3, 4), c("front", 3, 3)] },
      ],
    });
    const p = simulateMove(level, ["p", "x"], "p");
    expect(p.kind).toBe("exit");
    expect(p.collapses).toBeUndefined();
    const x = simulateMove(level, ["p", "x"], "x");
    expect(x.kind).toBe("exit");
    expect(x.collapses?.length).toBe(1);
    expect(x.collapses?.[0]?.cell).toEqual(c("front", 3, 2));
  });

  test("a blocker on the landing blocks halfway across the last hop", () => {
    const level = leapLevel({
      arrows: [
        { id: "p", path: [c("front", 0, 2), c("front", 1, 2)] },
        { id: "b", path: [c("front", 4, 2), c("front", 4, 1)] },
      ],
    });
    const result = simulateMove(level, ["p", "b"], "p");
    expect(result.kind).toBe("blocked");
    expect(result.distance).toBe(2.5);
    expect(result.blockerId).toBe("b");
  });

  test("a stop on the landing parks, and resuming continues east", () => {
    const level = leapLevel({ stops: [c("front", 4, 2)] });
    const result = simulateMove(level, ["p"], "p");
    expect(result.kind).toBe("paused");
    expect(result.pausedSteps).toBe(2);
    expect(result.route.at(-1)).toEqual(c("front", 4, 2));
    const resumed = simulateMove(level, ["p"], "p", "head", 0, { p: 2 });
    expect(resumed.kind).toBe("exit");
    expect(resumed.route.at(-1)).toEqual(c("front", 5, 2));
  });

  test("a portal on the landing teleports after the hop", () => {
    const level = leapLevel({
      wormholes: [{ id: "w", a: c("front", 4, 2), b: c("back", 2, 2) }],
    });
    const result = simulateMove(level, ["p"], "p");
    expect(result.kind).toBe("exit");
    expect(result.leaps).toEqual([
      {
        from: c("front", 2, 2),
        over: c("front", 3, 2),
        to: c("front", 4, 2),
        step: 2,
      },
    ]);
    expect(result.portals).toEqual([
      { from: c("front", 4, 2), to: c("back", 2, 2), step: 2 },
    ]);
    expect(result.route.map(cellKey)).toEqual([
      cellKey(c("front", 1, 2)),
      cellKey(c("front", 2, 2)),
      cellKey(c("back", 2, 2)),
      cellKey(c("back", 3, 2)),
      cellKey(c("back", 4, 2)),
      cellKey(c("back", 5, 2)),
    ]);
  });

  test("an off-cube landing exits past the skipped cell; a pad at the edge exits in place", () => {
    // Pad at (5, 1): the first hop is off-cube, so the head exits at the
    // pad's edge like an ordinary step.
    const atEdge = leapLevel({
      leaps: [c("front", 5, 1)],
      arrows: [{ id: "p", path: [c("front", 3, 1), c("front", 4, 1)] }],
    });
    expect(validateLevel(atEdge).valid).toBe(true);
    const edgeResult = simulateMove(atEdge, ["p"], "p");
    expect(edgeResult.kind).toBe("exit");
    const padCenter = cellToWorld(c("front", 5, 1), 6);
    expect(edgeResult.exit?.edgePoint).toEqual([
      padCenter[0] + 1 / 6,
      padCenter[1],
      padCenter[2],
    ]);

    // Pad at (4, 1): the skipped cell (5, 1) is on the cube and the landing
    // is off it, so the head flies past (5, 1) and exits at the far edge.
    const over = leapLevel({
      leaps: [c("front", 4, 1)],
      arrows: [{ id: "p", path: [c("front", 2, 1), c("front", 3, 1)] }],
    });
    const overResult = simulateMove(over, ["p"], "p");
    expect(overResult.kind).toBe("exit");
    const farCenter = cellToWorld(c("front", 5, 1), 6);
    expect(overResult.exit?.edgePoint).toEqual([
      farCenter[0] + 1 / 6,
      farCenter[1],
      farCenter[2],
    ]);
  });

  test("a wrapping edge wraps the landing onto the neighbor face", () => {
    const level = leapLevel({
      leaps: [c("front", 4, 2)],
      arrows: [{ id: "p", path: [c("front", 2, 2), c("front", 3, 2)] }],
      edgePolicies: [
        {
          face: "front",
          edge: "east",
          policy: "continue",
          neighbor: { face: "right", entering: "east" },
        },
      ],
    });
    expect(validateLevel(level).valid).toBe(true);
    const result = simulateMove(level, ["p"], "p");
    expect(result.kind).toBe("exit");
    expect(result.leaps?.[0]?.to.face).toBe("right");
    expect(result.route.some((cell) => cell.face === "right")).toBe(true);
  });

  test("a track derives through the pad and keeps its offset arithmetic", () => {
    const level = leapLevel();
    const p = level.arrows[0] as NonNullable<(typeof level.arrows)[number]>;
    const track = arrowTrack(level, p);
    expect(track.map(cellKey)).toEqual([
      cellKey(c("front", 0, 2)),
      cellKey(c("front", 1, 2)),
      cellKey(c("front", 2, 2)),
      cellKey(c("front", 4, 2)),
      cellKey(c("front", 5, 2)),
    ]);
    expect(maximumOffset(level, p)).toBe(3);
  });

  test("linkHeading resolves a leap link and nothing else from a pad", () => {
    const level = leapLevel();
    expect(linkHeading(level, c("front", 2, 2), c("front", 4, 2))).toBe("east");
    expect(
      linkHeading(level, c("front", 2, 2), c("front", 4, 3)),
    ).toBeUndefined();
    expect(linkHeading(level, c("front", 1, 2), c("front", 2, 2))).toBe("east");
  });

  test("a double leaps from its head end and parks across the pad and landing", () => {
    const level = leapLevel({
      stops: [c("front", 4, 2)],
      arrows: [
        { id: "d", kind: "double", path: [c("front", 0, 2), c("front", 1, 2)] },
      ],
    });
    const head = simulateMove(level, ["d"], "d", "head");
    expect(head.kind).toBe("paused");
    expect(head.settledPath?.map(cellKey)).toEqual([
      cellKey(c("front", 2, 2)),
      cellKey(c("front", 4, 2)),
    ]);
  });

  test("validation rejects a group whose member track crosses a pad", () => {
    const level = leapLevel({
      leaps: [c("back", 1, 0)],
      arrows: [
        { id: "p", path: [c("front", 0, 2), c("front", 1, 2)] },
        {
          id: "g1",
          path: [c("back", 0, 2), c("back", 1, 2), c("back", 1, 1)],
        },
        {
          id: "g2",
          path: [c("back", 0, 2), c("back", 1, 2), c("back", 1, 3)],
        },
      ],
    });
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes("through a leap pad")),
    ).toBe(true);
  });

  test("leap pads reject every shared cell", () => {
    const base = leapLevel();
    const rejects = (level: LevelDefinition, fragment: string): void => {
      const result = validateLevel(level);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes(fragment))).toBe(
        true,
      );
    };
    rejects(
      { ...base, leaps: [c("front", 1, 2)] },
      "sits on an arrow's starting cell",
    );
    rejects(
      { ...base, stops: [c("front", 2, 2)] },
      "shares its cell with a stop circle",
    );
    rejects(
      {
        ...base,
        directionals: [{ cell: c("front", 2, 2), heading: "north" }],
      },
      "shares its cell with a directional spot",
    );
    rejects(
      {
        ...base,
        wormholes: [{ id: "w", a: c("front", 2, 2), b: c("back", 2, 2) }],
      },
      "shares its cell with a wormhole end",
    );
    rejects(
      { ...base, fragile: [c("front", 2, 2)] },
      "shares its cell with a fragile cell",
    );
    rejects(
      {
        ...base,
        locks: [{ id: "l", key: c("front", 2, 2), lock: c("back", 2, 2) }],
      },
      "shares its cell with a lock cell",
    );
    rejects(
      {
        ...base,
        mirrors: [{ cell: c("front", 2, 2), orientation: "/" }],
      },
      "shares its cell with a mirror",
    );
    rejects(
      { ...base, leaps: [c("front", 2, 2), c("front", 2, 2)] },
      "declared more than once",
    );
    rejects({ ...base, leaps: [c("front", 99, 99)] }, "is out of bounds");
    rejects(
      {
        ...base,
        leaps: [c("front", 0, 0), c("front", 1, 1), c("front", 2, 2)],
      },
      "at most 2 leap pads",
    );
  });

  test("the leap is required: the stripped cube can never pass the closed gate", () => {
    // The pad lets the head leap over the closed gate and cross the key
    // behind it; stripped, the gate is terrain the head can never pass and
    // the key behind it is unreachable, so the solver never clears.
    const level = leapLevel({
      locks: [{ id: "l", key: c("front", 4, 2), lock: c("front", 3, 2) }],
    });
    expect(validateLevel(level).valid).toBe(true);
    expect(solveLevel(level)).not.toBeUndefined();
    const stripped = { ...level, leaps: [] };
    expect(validateLevel(stripped).valid).toBe(true);
    expect(solveLevel(stripped)).toBeUndefined();
  });

  test("a rebound back through the pad leaps again and stays deterministic", () => {
    // The head leaps east, a spot on the landing sends it back west, it
    // re-enters the pad and leaps west past its own tail, exiting. The move
    // never collides with the arrow's own body.
    const level = leapLevel({
      directionals: [{ cell: c("front", 4, 2), heading: "west" }],
    });
    const result = simulateMove(level, ["p"], "p");
    expect(result.kind).toBe("exit");
    expect(result.route.map(cellKey)).toEqual([
      cellKey(c("front", 1, 2)),
      cellKey(c("front", 2, 2)),
      cellKey(c("front", 4, 2)),
      cellKey(c("front", 3, 2)),
      cellKey(c("front", 2, 2)),
      cellKey(c("front", 0, 2)),
    ]);
    expect(result.leaps?.length).toBe(2);
  });
});
