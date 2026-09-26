import { describe, expect, test } from "bun:test";
import {
  advanceWithPortals,
  linkHeading,
  pathHeading,
  wormholePartner,
} from "../src/core/wormholes";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { arrowTrack } from "../src/core/stops";
import type { Cell, FaceId, LevelDefinition } from "../src/core/types";
import { solveLevelTargets, validateLevel } from "../src/core/validation";

const c = (face: FaceId, x: number, y: number): Cell => ({ face, x, y });
const base = (extra: Partial<LevelDefinition> = {}): LevelDefinition => ({
  id: 99,
  title: "t",
  gridSize: 4,
  lives: 3,
  arrows: [{ id: "p", path: [c("front", 0, 1), c("front", 1, 1)] }],
  wormholes: [{ id: "w1", a: c("front", 2, 1), b: c("right", 1, 2) }],
  ...extra,
});

describe("wormhole helpers", () => {
  test("partner lookup is symmetric", () => {
    const level = base();
    expect(wormholePartner(level, c("front", 2, 1))).toEqual(c("right", 1, 2));
    expect(wormholePartner(level, c("right", 1, 2))).toEqual(c("front", 2, 1));
    expect(wormholePartner(level, c("front", 0, 0))).toBeUndefined();
  });

  test("stepping onto an end lands on the partner with the same face-local heading", () => {
    const step = advanceWithPortals(base(), c("front", 1, 1), "east");
    expect(step.next).toEqual(c("right", 1, 2));
    expect(step.heading).toBe("east");
    expect(step.portal).toEqual(c("front", 2, 1));
  });

  test("same-face ends jump within the face", () => {
    const level = base({
      wormholes: [{ id: "w1", a: c("front", 2, 1), b: c("front", 1, 3) }],
    });
    const step = advanceWithPortals(level, c("front", 1, 1), "east");
    expect(step.next).toEqual(c("front", 1, 3));
    expect(step.heading).toBe("east");
  });

  test("a seam crossing that lands on an end keeps the post-seam heading", () => {
    // front east edge at y=1 crosses into right x=0; put an end there.
    const level = base({
      arrows: [{ id: "p", path: [c("front", 2, 1), c("front", 3, 1)] }],
      edgePolicies: [
        {
          face: "front",
          edge: "east",
          policy: "continue",
          neighbor: { face: "right", entering: "east" },
        },
      ],
      wormholes: [{ id: "w1", a: c("right", 0, 1), b: c("top", 2, 2) }],
    });
    const step = advanceWithPortals(level, c("front", 3, 1), "east");
    expect(step.next).toEqual(c("top", 2, 2));
    expect(step.heading).toBe("east");
  });

  test("link and path headings accept a portal jump", () => {
    const level = base();
    expect(linkHeading(level, c("front", 1, 1), c("right", 1, 2))).toBe("east");
    expect(
      pathHeading(level, [
        c("front", 0, 1),
        c("front", 1, 1),
        c("right", 1, 2),
      ]),
    ).toBe("east");
    expect(
      linkHeading(level, c("front", 0, 0), c("right", 1, 2)),
    ).toBeUndefined();
  });
});

describe("wormhole validation", () => {
  test("a well-formed wormhole validates", () => {
    expect(validateLevel(base()).errors).toEqual([]);
  });
  test.each([
    [
      "an end on an arrow start",
      { wormholes: [{ id: "w1", a: c("front", 1, 1), b: c("right", 1, 2) }] },
    ],
    [
      "both ends on one cell",
      { wormholes: [{ id: "w1", a: c("right", 1, 2), b: c("right", 1, 2) }] },
    ],
    ["an end on a stop", { stops: [c("right", 1, 2)] }],
    [
      "an end on a spot",
      { directionals: [{ cell: c("right", 1, 2), heading: "north" as const }] },
    ],
    [
      "two wormholes sharing a cell",
      {
        wormholes: [
          { id: "w1", a: c("front", 2, 1), b: c("right", 1, 2) },
          { id: "w2", a: c("right", 1, 2), b: c("top", 0, 0) },
        ],
      },
    ],
    [
      "three wormholes",
      {
        wormholes: [
          { id: "w1", a: c("front", 2, 1), b: c("right", 1, 2) },
          { id: "w2", a: c("back", 0, 0), b: c("top", 0, 0) },
          { id: "w3", a: c("left", 0, 0), b: c("bottom", 0, 0) },
        ],
      },
    ],
    [
      "duplicate ids",
      {
        wormholes: [
          { id: "w1", a: c("front", 2, 1), b: c("right", 1, 2) },
          { id: "w1", a: c("back", 0, 0), b: c("top", 0, 0) },
        ],
      },
    ],
    [
      "an out-of-bounds end",
      { wormholes: [{ id: "w1", a: c("front", 2, 1), b: c("right", 4, 0) }] },
    ],
  ])("rejects %s", (_name, extra) => {
    expect(validateLevel(base(extra as Partial<LevelDefinition>)).valid).toBe(
      false,
    );
  });
});

describe("moving through a wormhole", () => {
  test("a head jumps and exits from the partner face", () => {
    const level = base();
    const result = simulateMove(level, createGameState(level), "p");
    expect(result.kind).toBe("exit");
    expect(result.route[1]).toEqual(c("right", 1, 2));
    expect(result.portals).toEqual([
      { from: c("front", 2, 1), to: c("right", 1, 2), step: 1 },
    ]);
  });

  test("an arrow covering the partner end blocks the jump and costs one life", () => {
    const level = base({
      arrows: [
        { id: "p", path: [c("front", 0, 1), c("front", 1, 1)] },
        { id: "g", path: [c("right", 1, 3), c("right", 1, 2)] },
      ],
    });
    const state = createGameState(level);
    const result = simulateMove(level, state, "p");
    expect(result.kind).toBe("blocked");
    expect(result.blockerId).toBe("g");
    const after = applyMove(level, state, result);
    expect(after.lives).toBe(state.lives - 1);
    expect(after.failedIds).toContain("p");
  });

  test("an arrow covering the cell after the partner blocks there", () => {
    const level = base({
      arrows: [
        { id: "p", path: [c("front", 0, 1), c("front", 1, 1)] },
        { id: "g", path: [c("right", 2, 3), c("right", 2, 2)] },
      ],
    });
    const result = simulateMove(level, createGameState(level), "p");
    expect(result.kind).toBe("blocked");
    expect(result.route.at(-1)).toEqual(c("right", 2, 2));
  });

  test("the static track follows the portal", () => {
    const track = arrowTrack(base(), base().arrows[0]!);
    expect(track).toContainEqual(c("right", 1, 2));
    expect(track).not.toContainEqual(c("front", 2, 1));
  });

  test("a stop right after the partner end parks the head there", () => {
    const level = base({ stops: [c("right", 2, 2)] });
    const state = createGameState(level);
    const result = simulateMove(level, state, "p");
    expect(result.kind).toBe("paused");
    const after = applyMove(level, state, result);
    const again = simulateMove(level, after, "p");
    expect(again.kind).toBe("exit");
  });

  test("a double runs forward through the portal and back out the way it came", () => {
    const level = base({
      arrows: [
        { id: "d", kind: "double", path: [c("front", 0, 1), c("front", 1, 1)] },
      ],
    });
    const head = simulateMove(level, createGameState(level), "d", "head");
    expect(head.kind).toBe("exit");
    expect(head.route).toContainEqual(c("right", 1, 2));
    expect(simulateMove(level, createGameState(level), "d", "tail").kind).toBe(
      "exit",
    );
    expect(solveLevelTargets(level)).toBeDefined();
  });

  test("an arrow folding back over its own body through a portal never self-collides", () => {
    // The head enters a = front(0,1), lands on b = right(1,2) heading west
    // and meets the head-on spot at right(0,2), which sends it back east
    // through end b: that second jump drops it on front(0,1) facing east,
    // and it runs over its own body cells (1,1) and (2,1) and off the east
    // edge. Occupancy only tracks other arrows, so the fold-back is a clean
    // exit, not a collision.
    const level = base({
      arrows: [{ id: "p", path: [c("front", 2, 1), c("front", 1, 1)] }],
      directionals: [{ cell: c("right", 0, 2), heading: "east" }],
      wormholes: [{ id: "w1", a: c("front", 0, 1), b: c("right", 1, 2) }],
    });
    const result = simulateMove(level, createGameState(level), "p");
    expect(result.kind).toBe("exit");
    expect(result.portals).toEqual([
      { from: c("front", 0, 1), to: c("right", 1, 2), step: 1 },
      { from: c("right", 1, 2), to: c("front", 0, 1), step: 3 },
    ]);
    expect(result.route).toEqual([
      c("front", 1, 1),
      c("right", 1, 2),
      c("right", 0, 2),
      c("front", 0, 1),
      c("front", 1, 1),
      c("front", 2, 1),
      c("front", 3, 1),
    ]);
    expect(solveLevelTargets(level)).toBeDefined();
  });

  test("a double whose tail-direction move jumps the portal, like its head-direction move", () => {
    // Both endpoints face an end: the tail runs west into w1's a and the
    // head runs east into w2's a, so each selection transits a portal and
    // flies off the partner face.
    const level = base({
      arrows: [
        { id: "d", kind: "double", path: [c("front", 1, 1), c("front", 2, 1)] },
      ],
      wormholes: [
        { id: "w1", a: c("front", 0, 1), b: c("right", 2, 2) },
        { id: "w2", a: c("front", 3, 1), b: c("back", 0, 1) },
      ],
    });
    const tail = simulateMove(level, createGameState(level), "d", "tail");
    expect(tail.kind).toBe("exit");
    expect(tail.portals).toEqual([
      { from: c("front", 0, 1), to: c("right", 2, 2), step: 1 },
    ]);
    const head = simulateMove(level, createGameState(level), "d", "head");
    expect(head.kind).toBe("exit");
    expect(head.portals).toEqual([
      { from: c("front", 3, 1), to: c("back", 0, 1), step: 1 },
    ]);
    expect(solveLevelTargets(level)).toBeDefined();
  });

  test("a shared-tail group whose members jump portals parks as one offset", () => {
    // east's head route enters w1's a and jumps to right(1,2); north's head
    // route enters w2's a and jumps to top(1,2). A stop on right(2,2) parks
    // the group at the earliest member's circle: both members travel the
    // same distance and share one offset after applyMove.
    const level = base({
      arrows: [
        {
          id: "east",
          path: [c("front", 0, 2), c("front", 1, 2), c("front", 2, 2)],
        },
        {
          id: "north",
          path: [c("front", 0, 2), c("front", 1, 2), c("front", 1, 1)],
        },
      ],
      stops: [c("right", 2, 2)],
      wormholes: [
        { id: "w1", a: c("front", 3, 2), b: c("right", 1, 2) },
        { id: "w2", a: c("front", 1, 0), b: c("top", 1, 2) },
      ],
    });
    expect(validateLevel(level).errors).toEqual([]);
    const state = createGameState(level);
    const result = simulateMove(level, state, "east");
    expect(result.kind).toBe("paused");
    expect(result.portals).toEqual([
      { from: c("front", 3, 2), to: c("right", 1, 2), step: 1 },
    ]);
    const eastMember = result.members?.find((m) => m.arrowId === "east");
    const northMember = result.members?.find((m) => m.arrowId === "north");
    expect(eastMember?.route).toContainEqual(c("right", 1, 2));
    expect(northMember?.portals).toEqual([
      { from: c("front", 1, 0), to: c("top", 1, 2), step: 1 },
    ]);
    const after = applyMove(level, state, result);
    expect(after.offsets["east"]).toBe(2);
    expect(after.offsets["east"]).toBe(after.offsets["north"]);
    expect(solveLevelTargets(level)).toBeDefined();
  });

  test("validation rejects a portal loop", () => {
    // Row 1 runs east into end a; the jump drops the head back on b and it
    // runs east into a again, so the trace cycles b -> (1,1) -> (2,1) -> a.
    // Without the wormhole the row exits east, so the portal causes the loop.
    const level = base({
      arrows: [{ id: "p", path: [c("front", 1, 1), c("front", 2, 1)] }],
      edgePolicies: [],
      wormholes: [{ id: "w1", a: c("front", 3, 1), b: c("front", 0, 1) }],
    });
    expect(validateLevel(level).errors.some((e) => e.includes("loop"))).toBe(
      true,
    );
    expect(
      validateLevel({ ...level, wormholes: [] }).errors.some((e) =>
        e.includes("loop"),
      ),
    ).toBe(false);
  });

  test("validation rejects a loop that exists only after a flip", () => {
    // The head runs north onto the flip spot at (2,1). Flipped east it bends
    // the head into the eastward lane that continues over the front.east seam
    // onto end b=right(3,1); the jump drops it on a=front(0,1) still heading
    // east and it runs east through the spot and the seam back to b forever.
    // Authored west the spot instead bends the head onto a=front(0,1) heading
    // west; the jump drops it on right(3,1) facing west, and that face holds
    // no ends, so it falls off the cube.
    const level = base({
      arrows: [{ id: "p", path: [c("front", 2, 3), c("front", 2, 2)] }],
      edgePolicies: [
        {
          face: "front",
          edge: "east",
          policy: "continue",
          neighbor: { face: "right", entering: "east" },
        },
      ],
      wormholes: [{ id: "w1", a: c("front", 0, 1), b: c("right", 3, 1) }],
      directionals: [{ cell: c("front", 2, 1), heading: "west", kind: "flip" }],
    });
    expect(validateLevel(level).errors.some((e) => e.includes("loop"))).toBe(
      true,
    );
    // The same cube with the spot static exits over the right.west edge: no
    // loop under the authored spot state.
    const staticSpot: LevelDefinition = {
      ...level,
      directionals: [{ cell: c("front", 2, 1), heading: "west" }],
    };
    expect(
      validateLevel(staticSpot).errors.some((e) => e.includes("loop")),
    ).toBe(false);
  });
});
