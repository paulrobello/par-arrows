import { describe, expect, test } from "bun:test";
import { simulateMove } from "../src/core/movement";
import {
  hasMirrors,
  mirrorAt,
  mirrorHeadingAt,
  reflectedHeading,
} from "../src/core/mirrors";
import { arrowTrack, maximumOffset } from "../src/core/stops";
import { validateLevel } from "../src/core/validation";
import { cellKey } from "../src/core/topology";
import type { Cell, LevelDefinition } from "../src/core/types";

const c = (face: string, x: number, y: number): Cell =>
  ({ face, x, y }) as Cell;

function mirrorLevel(
  overrides: Partial<LevelDefinition> = {},
): LevelDefinition {
  return {
    id: 1,
    title: "mirror scratch",
    gridSize: 4,
    lives: 5,
    mirrors: [{ cell: c("front", 1, 1), orientation: "/" }],
    arrows: [{ id: "p", path: [c("front", 1, 3), c("front", 1, 2)] }],
    ...overrides,
  };
}

describe("mirror reflections", () => {
  test("maps every heading across each diagonal and is involutive", () => {
    expect(reflectedHeading("/", "east")).toBe("north");
    expect(reflectedHeading("/", "north")).toBe("east");
    expect(reflectedHeading("/", "west")).toBe("south");
    expect(reflectedHeading("/", "south")).toBe("west");
    expect(reflectedHeading("\\", "east")).toBe("south");
    expect(reflectedHeading("\\", "south")).toBe("east");
    expect(reflectedHeading("\\", "west")).toBe("north");
    expect(reflectedHeading("\\", "north")).toBe("west");
    for (const orientation of ["/", "\\"] as const) {
      for (const heading of ["east", "west", "south", "north"] as const) {
        expect(
          reflectedHeading(orientation, reflectedHeading(orientation, heading)),
        ).toBe(heading);
      }
    }
  });

  test("lookups and level predicates", () => {
    const level = mirrorLevel();
    expect(mirrorAt(level, c("front", 1, 1))?.orientation).toBe("/");
    expect(mirrorAt(level, c("front", 2, 1))).toBeUndefined();
    expect(mirrorHeadingAt(level, c("front", 1, 1), "east")).toBe("north");
    expect(mirrorHeadingAt(level, c("front", 2, 1), "east")).toBeUndefined();
    expect(hasMirrors(level)).toBe(true);
    expect(hasMirrors({ ...level, mirrors: [] })).toBe(false);
  });

  test("a head bends at the mirror and exits on the reflected lane", () => {
    const level = mirrorLevel();
    expect(validateLevel(level).valid).toBe(true);
    const result = simulateMove(level, ["p"], "p");
    expect(result.kind).toBe("exit");
    expect(result.route.map(cellKey)).toEqual([
      cellKey(c("front", 1, 2)),
      cellKey(c("front", 1, 1)),
      cellKey(c("front", 2, 1)),
      cellKey(c("front", 3, 1)),
    ]);
  });

  test("the same mirror routes two approaches to two destinations", () => {
    // P arrives northbound and leaves east; Q arrives southbound (its body
    // crosses the top seam) and leaves west.
    const level = mirrorLevel({
      arrows: [
        { id: "p", path: [c("front", 1, 3), c("front", 1, 2)] },
        {
          id: "q",
          path: [
            c("top", 1, 1),
            c("top", 1, 2),
            c("top", 1, 3),
            c("front", 1, 0),
          ],
        },
      ],
    });
    expect(validateLevel(level).valid).toBe(true);
    const p = simulateMove(level, ["p", "q"], "p");
    const q = simulateMove(level, ["p", "q"], "q");
    expect(p.kind).toBe("exit");
    expect(p.route.map(cellKey)).toEqual([
      cellKey(c("front", 1, 2)),
      cellKey(c("front", 1, 1)),
      cellKey(c("front", 2, 1)),
      cellKey(c("front", 3, 1)),
    ]);
    expect(q.kind).toBe("exit");
    expect(q.route.map(cellKey)).toEqual([
      cellKey(c("front", 1, 0)),
      cellKey(c("front", 1, 1)),
      cellKey(c("front", 0, 1)),
    ]);
  });

  test("a track derives through the mirror and keeps its offset arithmetic", () => {
    const level = mirrorLevel();
    const p = level.arrows[0] as NonNullable<(typeof level.arrows)[number]>;
    const track = arrowTrack(level, p);
    expect(track.map(cellKey)).toEqual([
      cellKey(c("front", 1, 3)),
      cellKey(c("front", 1, 2)),
      cellKey(c("front", 1, 1)),
      cellKey(c("front", 2, 1)),
      cellKey(c("front", 3, 1)),
    ]);
    expect(maximumOffset(level, p)).toBe(3);
  });

  test("a spot bends onto a mirror and the mirror reflects the result", () => {
    // A head leaves the mirror travelling east and the spot on the exit lane
    // then sends it south: composition is one deterministic pass.
    const level = mirrorLevel({
      directionals: [{ cell: c("front", 2, 1), heading: "south" }],
      arrows: [{ id: "p", path: [c("front", 1, 3), c("front", 1, 2)] }],
    });
    expect(validateLevel(level).valid).toBe(true);
    const result = simulateMove(level, ["p"], "p");
    expect(result.kind).toBe("exit");
    expect(result.route.map(cellKey)).toEqual([
      cellKey(c("front", 1, 2)),
      cellKey(c("front", 1, 1)),
      cellKey(c("front", 2, 1)),
      cellKey(c("front", 2, 2)),
      cellKey(c("front", 2, 3)),
    ]);
  });

  test("mirrors reject every shared cell", () => {
    const base = mirrorLevel();
    const rejects = (level: LevelDefinition, fragment: string): void => {
      const result = validateLevel(level);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes(fragment))).toBe(
        true,
      );
    };
    rejects(
      { ...base, mirrors: [{ cell: c("front", 1, 2), orientation: "/" }] },
      "sits on an arrow's starting cell",
    );
    rejects(
      { ...base, stops: [c("front", 1, 1)] },
      "shares its cell with a stop circle",
    );
    rejects(
      {
        ...base,
        directionals: [{ cell: c("front", 1, 1), heading: "north" }],
      },
      "shares its cell with a directional spot",
    );
    rejects(
      {
        ...base,
        wormholes: [{ id: "w", a: c("front", 1, 1), b: c("back", 2, 2) }],
      },
      "shares its cell with a wormhole end",
    );
    rejects(
      { ...base, fragile: [c("front", 1, 1)] },
      "shares its cell with a fragile cell",
    );
    rejects(
      {
        ...base,
        locks: [{ id: "l", key: c("front", 1, 1), lock: c("back", 2, 2) }],
      },
      "shares its cell with a lock cell",
    );
    rejects(
      {
        ...base,
        mirrors: [
          { cell: c("front", 1, 1), orientation: "/" },
          { cell: c("front", 1, 1), orientation: "\\" },
        ],
      },
      "declared more than once",
    );
    rejects(
      { ...base, mirrors: [{ cell: c("front", 4, 4), orientation: "/" }] },
      "is out of bounds",
    );
  });

  test("a level carries at most two mirrors", () => {
    const level = mirrorLevel({
      arrows: [{ id: "p", path: [c("front", 1, 3), c("front", 1, 2)] }],
    });
    const result = validateLevel({
      ...level,
      mirrors: [
        { cell: c("front", 1, 1), orientation: "/" },
        { cell: c("front", 2, 2), orientation: "\\" },
        { cell: c("front", 3, 3), orientation: "/" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes("at most 2 mirrors")),
    ).toBe(true);
  });

  test("a shared-tail group keeps off mirror cells", () => {
    // A group whose member track would cross the mirror is refused; a group
    // elsewhere on the cube is fine.
    const through: LevelDefinition = {
      ...mirrorLevel({
        mirrors: [{ cell: c("back", 1, 0), orientation: "/" }],
        arrows: [
          { id: "p", path: [c("front", 1, 3), c("front", 1, 2)] },
          {
            id: "g1",
            path: [c("back", 0, 2), c("back", 1, 2), c("back", 1, 1)],
          },
          {
            id: "g2",
            path: [c("back", 0, 2), c("back", 1, 2), c("back", 1, 3)],
          },
        ],
      }),
    };
    const result = validateLevel(through);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes("through a mirror")),
    ).toBe(true);
  });
});
