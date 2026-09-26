# Wormholes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add paired two-way wormholes (at most two per level) that teleport a moving head between their ends, with an authored intro at level 35 and optional generation from level 36.

**Architecture:** One new core module, `src/core/wormholes.ts`, owns every portal rule: partner lookup, the portal-aware step (`advanceWithPortals`), and the portal-aware link heading (`linkHeading` / `pathHeading`). Every existing caller of `advanceHead` and of `headingForPath` on arrow paths switches to these wrappers, so movement, tracks, loop checks, storage and generation all see the same rule. The renderer treats a portal link as a zero-length gap segment in `ExpandedPath`.

**Tech Stack:** TypeScript, three.js, Vite, Bun (`bun test`), Playwright browser suite.

**Spec:** `docs/superpowers/specs/2026-09-25-wormholes-design.md`

## Global Constraints

- At most 2 wormholes per level. Ends A ≠ B. An end may not sit on an arrow's starting cell, a stop, a spot, or another end.
- A head stepping onto an end is placed on the partner's cell in the same step. The face-local heading is unchanged (heading `h` on A's face is heading `h` on B's face).
- The body follows cell by cell. End cells are never occupied, because a head never rests on one.
- A blocked exit (partner cell or the cell after it covered by another arrow) is an ordinary collision.
- Loops through portals are rejected by `validateLevel`. The runtime repeated-state check stays.
- Level 35 is authored, with seed `par-arrows:runtime:7:level:35:wormhole-intro:1`. `?feature=wormhole` (aliases `portal`, `wormholes`) opens it.
- Generation from 36 uses its own `:wormhole-plan` / `:wormhole-core` streams. Frequency is 0.25 at 36, rising linearly to 0.60 at 90, then holding. A second wormhole is possible from 50. Zero-wormhole levels stay byte-identical. `GENERATOR_VERSION` stays 8.
- Colors: wormhole 1 is orange, wormhole 2 is deep blue. Both ends of one wormhole share its color.
- `CONTENT_VERSION` becomes 13.
- Gate: `make checkall`. Browser-relevant tasks also run `WORMHOLE_ONLY=1 make browser-test`.

## Review Focus

1. **Straddling arrow.** An arrow that parks with its body split across a portal must reload and resume exactly. Pinned in Task 3.
2. **Double arrow in transit.** A double whose tail direction runs back through the portal it came in by must return correctly. Pinned in Task 2.
3. **Collision exactly on B.** This must cost one life and rewind to the start without drawing a segment between A and B. Pinned in Task 2 (core) and Task 6 (browser).
4. **Portal chained with a flip spot.** Loop validation must catch a loop that exists only after a flip. Pinned in Task 2.
5. **Seam then portal.** An arrow crossing a cube seam and immediately entering an end must keep its post-seam heading. Pinned in Task 1.

---

### Task 1: Wormhole data model and core helpers

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/core/wormholes.ts`
- Modify: `src/core/validation.ts` (structural checks in `validateLevel`)
- Test: `tests/wormhole.test.ts`

**Interfaces:**
- Produces:
  - `interface WormholeDefinition { readonly id: string; readonly a: Cell; readonly b: Cell }`
  - `LevelDefinition.wormholes?: readonly WormholeDefinition[]`
  - `type PortalSource = Pick<LevelDefinition, "gridSize" | "edgePolicies" | "wormholes">`
  - `wormholePartner(level: Pick<LevelDefinition,"wormholes">, cell: Cell): Cell | undefined`
  - `wormholeKeys(level): ReadonlySet<string>`
  - `advanceWithPortals(level: PortalSource, cell: Cell, heading: Heading): ForwardInfo & { readonly portal?: Cell }`. `portal` is the entered end. `next` is the partner. `heading` is the post-seam heading, unchanged by the jump.
  - `linkHeading(level: PortalSource, from: Cell, to: Cell): Heading | undefined`. This is the heading a head arrives with at `to`: an adjacent link (seam-aware, like `headingForPath([from,to])`), or a jump where some heading from `from` enters an end whose partner is `to`.
  - `pathHeading(level: PortalSource, path: readonly Cell[]): Heading | undefined`. This is `linkHeading` of the last two cells.
  - `isPortalLink(level, from, to): boolean`

- [ ] **Step 1: Write failing tests** in `tests/wormhole.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  advanceWithPortals,
  linkHeading,
  pathHeading,
  wormholePartner,
} from "../src/core/wormholes";
import type { Cell, FaceId, LevelDefinition } from "../src/core/types";
import { validateLevel } from "../src/core/validation";

const c = (face: FaceId, x: number, y: number): Cell => ({ face, x, y });
const base = (extra: Partial<LevelDefinition> = {}): LevelDefinition => ({
  id: 99, title: "t", gridSize: 4, lives: 3,
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
    const level = base({ wormholes: [{ id: "w1", a: c("front", 2, 1), b: c("front", 1, 3) }] });
    const step = advanceWithPortals(level, c("front", 1, 1), "east");
    expect(step.next).toEqual(c("front", 1, 3));
    expect(step.heading).toBe("east");
  });

  test("a seam crossing that lands on an end keeps the post-seam heading", () => {
    // front east edge at y=1 crosses into right x=0; put an end there.
    const level = base({
      arrows: [{ id: "p", path: [c("front", 2, 1), c("front", 3, 1)] }],
      edgePolicies: [{ face: "front", edge: "east", policy: "continue", neighbor: { face: "right", entering: "east" } }],
      wormholes: [{ id: "w1", a: c("right", 0, 1), b: c("top", 2, 2) }],
    });
    const step = advanceWithPortals(level, c("front", 3, 1), "east");
    expect(step.next).toEqual(c("top", 2, 2));
    expect(step.heading).toBe("east");
  });

  test("link and path headings accept a portal jump", () => {
    const level = base();
    expect(linkHeading(level, c("front", 1, 1), c("right", 1, 2))).toBe("east");
    expect(pathHeading(level, [c("front", 0, 1), c("front", 1, 1), c("right", 1, 2)])).toBe("east");
    expect(linkHeading(level, c("front", 0, 0), c("right", 1, 2))).toBeUndefined();
  });
});

describe("wormhole validation", () => {
  test("a well-formed wormhole validates", () => {
    expect(validateLevel(base()).errors).toEqual([]);
  });
  test.each([
    ["an end on an arrow start", { wormholes: [{ id: "w1", a: c("front", 1, 1), b: c("right", 1, 2) }] }],
    ["both ends on one cell", { wormholes: [{ id: "w1", a: c("right", 1, 2), b: c("right", 1, 2) }] }],
    ["an end on a stop", { stops: [c("right", 1, 2)] }],
    ["an end on a spot", { directionals: [{ cell: c("right", 1, 2), heading: "north" as const }] }],
    ["two wormholes sharing a cell", { wormholes: [
      { id: "w1", a: c("front", 2, 1), b: c("right", 1, 2) },
      { id: "w2", a: c("right", 1, 2), b: c("top", 0, 0) } ] }],
    ["three wormholes", { wormholes: [
      { id: "w1", a: c("front", 2, 1), b: c("right", 1, 2) },
      { id: "w2", a: c("back", 0, 0), b: c("top", 0, 0) },
      { id: "w3", a: c("left", 0, 0), b: c("bottom", 0, 0) } ] }],
    ["duplicate ids", { wormholes: [
      { id: "w1", a: c("front", 2, 1), b: c("right", 1, 2) },
      { id: "w1", a: c("back", 0, 0), b: c("top", 0, 0) } ] }],
    ["an out-of-bounds end", { wormholes: [{ id: "w1", a: c("front", 2, 1), b: c("right", 4, 0) }] }],
  ])("rejects %s", (_name, extra) => {
    expect(validateLevel(base(extra as Partial<LevelDefinition>)).valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `bun test tests/wormhole.test.ts`. Expect FAIL (module missing).

- [ ] **Step 3: Implement.** Add to `src/core/types.ts`:

```ts
/** Two paired portal cells; a head entering either end leaves the other. */
export interface WormholeDefinition {
  readonly id: string;
  readonly a: Cell;
  readonly b: Cell;
}
```

Also add `readonly wormholes?: readonly WormholeDefinition[];` to `LevelDefinition`, with the doc comment `/** At most two portal pairs; see src/core/wormholes.ts. */`.

Create `src/core/wormholes.ts`:

```ts
import { advanceHead, cellKey, cellsEqual, headingForPath } from "./topology";
import type { Cell, ForwardInfo, Heading, LevelDefinition } from "./types";

export type PortalSource = Pick<LevelDefinition, "gridSize" | "edgePolicies" | "wormholes">;

export const MAX_WORMHOLES = 2;

export function wormholePartner(
  level: Pick<LevelDefinition, "wormholes">,
  cell: Cell,
): Cell | undefined {
  for (const hole of level.wormholes ?? []) {
    if (cellsEqual(hole.a, cell)) return hole.b;
    if (cellsEqual(hole.b, cell)) return hole.a;
  }
  return undefined;
}

export function wormholeKeys(level: Pick<LevelDefinition, "wormholes">): ReadonlySet<string> {
  return new Set((level.wormholes ?? []).flatMap((hole) => [cellKey(hole.a), cellKey(hole.b)]));
}

/** One head step; entering an end lands on its partner with the heading unchanged. */
export function advanceWithPortals(
  level: PortalSource,
  cell: Cell,
  heading: Heading,
): ForwardInfo & { readonly portal?: Cell } {
  const forward = advanceHead(level, cell, heading);
  if (forward.exits || !forward.next) return forward;
  const partner = wormholePartner(level, forward.next);
  return partner ? { ...forward, next: partner, portal: forward.next } : forward;
}

const HEADINGS: readonly Heading[] = ["east", "west", "south", "north"];

/** The heading a head arrives at `to` with, through an adjacent link or a portal jump. */
export function linkHeading(level: PortalSource, from: Cell, to: Cell): Heading | undefined {
  const adjacent = headingForPath([from, to], level.gridSize);
  if (adjacent && !wormholePartner(level, to)) return adjacent;
  for (const heading of HEADINGS) {
    const step = advanceWithPortals(level, from, heading);
    if (step.portal && step.next && cellsEqual(step.next, to)) return step.heading;
  }
  return adjacent;
}

export function isPortalLink(level: PortalSource, from: Cell, to: Cell): boolean {
  return HEADINGS.some((heading) => {
    const step = advanceWithPortals(level, from, heading);
    return step.portal !== undefined && step.next !== undefined && cellsEqual(step.next, to);
  });
}

export function pathHeading(level: PortalSource, path: readonly Cell[]): Heading | undefined {
  const previous = path[path.length - 2];
  const head = path[path.length - 1];
  return previous && head ? linkHeading(level, previous, head) : undefined;
}
```

Note on `linkHeading`: an adjacent link whose target is an end is never a real body link, because a head never stops on an end. That's why the adjacent answer is used only when `to` isn't an end.

In `validateLevel`, after the spot loop, add:

```ts
  const wormholes = level.wormholes ?? [];
  if (wormholes.length > MAX_WORMHOLES) {
    errors.push(`A level may carry at most ${MAX_WORMHOLES} wormholes.`);
  }
  const holeIds = new Set<string>();
  const holeCells = new Set<string>();
  for (const hole of wormholes) {
    if (!hole.id || holeIds.has(hole.id)) errors.push(`Wormhole ids must be nonempty and unique: ${hole.id || "<empty>"}.`);
    holeIds.add(hole.id);
    if (cellKey(hole.a) === cellKey(hole.b)) errors.push(`Wormhole ${hole.id} has both ends on one cell.`);
    for (const end of [hole.a, hole.b]) {
      const key = cellKey(end);
      if (!inBounds(end, level.gridSize)) errors.push(`Wormhole ${hole.id} end ${key} is out of bounds.`);
      if (holeCells.has(key) && cellKey(hole.a) !== cellKey(hole.b)) errors.push(`Wormhole end ${key} is declared more than once.`);
      holeCells.add(key);
      if (arrowCells.has(key)) errors.push(`Wormhole end ${key} sits on an arrow's starting cell.`);
      if (stopCells.has(key)) errors.push(`Wormhole end ${key} shares its cell with a stop circle.`);
      if (spotCells.has(key)) errors.push(`Wormhole end ${key} shares its cell with a directional spot.`);
    }
  }
```

Import `MAX_WORMHOLES` from `./wormholes`.

- [ ] **Step 4: Run** `bun test tests/wormhole.test.ts`. Expect PASS. Then run `make checkall`. Expect green, because no caller uses wormholes yet.
- [ ] **Step 5: Commit** with message `feat(core): wormhole data model, portal step and validation`.

---

### Task 2: Movement, tracks and loop checks through portals

**Files:**
- Modify: `src/core/movement.ts` (`simulateSingle`)
- Modify: `src/core/stops.ts` (`arrowTrack`, `trackKeys`, `maximumOffset`, `currentPath` level `Pick`s)
- Modify: `src/core/validation.ts` (`loopError`, the path-adjacency check in `validateLevel`, the `Pick` in `occupancyKeys`)
- Test: `tests/wormhole.test.ts`

**Interfaces:**
- Consumes: `advanceWithPortals`, `pathHeading`, `linkHeading`, `PortalSource` from Task 1.
- Produces: `simulateMove`, `applyMove`, `arrowTrack` and `validateLevel` become wormhole-aware with unchanged signatures. `MoveResult.route` may now contain a portal link (non-adjacent consecutive cells). `MoveResult` gains `readonly portals?: readonly { readonly from: Cell; readonly to: Cell; readonly step: number }[]`. It lists each jump the head made, where `step` is the forward step that landed on `to`. This is renderer-only data.

- [ ] **Step 1: Write failing tests** (append to `tests/wormhole.test.ts`):

```ts
import { applyMove, createGameState, simulateMove } from "../src/core/game-state";
import { arrowTrack } from "../src/core/stops";
import { solveLevelTargets } from "../src/core/validation";

describe("moving through a wormhole", () => {
  test("a head jumps and exits from the partner face", () => {
    const level = base();
    const result = simulateMove(level, createGameState(level), "p");
    expect(result.kind).toBe("exit");
    expect(result.route[1]).toEqual(c("right", 1, 2));
    expect(result.portals).toEqual([{ from: c("front", 2, 1), to: c("right", 1, 2), step: 1 }]);
  });

  test("an arrow covering the partner end blocks the jump and costs one life", () => {
    const level = base({ arrows: [
      { id: "p", path: [c("front", 0, 1), c("front", 1, 1)] },
      { id: "g", path: [c("right", 1, 3), c("right", 1, 2)] },
    ] });
    const state = createGameState(level);
    const result = simulateMove(level, state, "p");
    expect(result.kind).toBe("blocked");
    expect(result.blockerId).toBe("g");
    const after = applyMove(level, state, result);
    expect(after.lives).toBe(state.lives - 1);
    expect(after.failedIds).toContain("p");
  });

  test("an arrow covering the cell after the partner blocks there", () => {
    const level = base({ arrows: [
      { id: "p", path: [c("front", 0, 1), c("front", 1, 1)] },
      { id: "g", path: [c("right", 2, 3), c("right", 2, 2)] },
    ] });
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
    const level = base({ arrows: [{ id: "d", kind: "double", path: [c("front", 0, 1), c("front", 1, 1)] }] });
    expect(simulateMove(level, createGameState(level), "d", "head").kind).toBe("exit");
    expect(simulateMove(level, createGameState(level), "d", "tail").kind).toBe("exit");
    expect(solveLevelTargets(level)).toBeDefined();
  });

  test("validation rejects a portal loop", () => {
    // Exiting B east re-enters A east forever: A=front(1,1) B=front(0,1) on the same row.
    const level = base({
      arrows: [{ id: "p", path: [c("front", 0, 3), c("front", 0, 2)] }],
      edgePolicies: [],
      wormholes: [{ id: "w1", a: c("front", 2, 1), b: c("front", 1, 1) }],
      directionals: [{ cell: c("front", 0, 1), heading: "east" }],
    });
    expect(validateLevel(level).errors.some((e) => e.includes("loop"))).toBe(true);
  });

  test("validation rejects a loop that exists only after a flip", () => {
    const level = base({
      arrows: [{ id: "p", path: [c("front", 0, 3), c("front", 0, 2)] }],
      wormholes: [{ id: "w1", a: c("front", 2, 1), b: c("front", 1, 1) }],
      directionals: [{ cell: c("front", 0, 1), heading: "west", kind: "flip" }],
    });
    expect(validateLevel(level).errors.some((e) => e.includes("loop"))).toBe(true);
  });
});
```

Walking through the first loop test: `p` heads north from (0,2) to (0,1). The spot turns it east, so it steps to (1,1), which is end B, and lands on A (2,1) still heading east. It continues to (3,1) and then exits. That route does not loop. The implementer must author the loop fixtures so they actually loop, and assert that with a direct trace. If a fixture above turns out not to loop, change its coordinates until `loopError` reports a loop, keeping the test's intent. For example, use two ends on one row where exiting one lands back in front of the other, with a continue edge wrapping the row back around.

- [ ] **Step 2: Run the tests.** Expect FAIL.

- [ ] **Step 3: Implement.**
  - **`movement.ts`:**
    - Replace `advanceHead(level, current, currentHeading)` with `advanceWithPortals(...)` and `headingForPath(path, …)` with `pathHeading(level, path)`.
    - When `forward.portal` is set, push `{ from: forward.portal, to: next, step }` to a local `portals` array. Spread `...(portals.length ? { portals } : {})` into the exit, blocked and paused results, as `flipResult()` does.
    - For a blocked result whose `next` came through a portal, set `contact.point` to `cellToWorld(next)`. The ribbon rewinds from inside B, and the midpoint between A and B would be meaningless.
  - **`stops.ts`:**
    - Change the level `Pick`s to include `"wormholes"`.
    - In `arrowTrack`, use `pathHeading` and `advanceWithPortals`.
  - **`validation.ts`:**
    - In `loopError`, use `pathHeading` and `advanceWithPortals`.
    - Take an extra `spotHeadings` argument, and read spots via `spotHeadingAt(level, head, spotHeadings)`.
    - In `validateLevel`, when the level has wormholes, call it once per flip combination. Build the combos the same way the fold check does, and hoist that combo builder into a local `flipCombos(level)` function used by both.
    - Replace the per-link `headingForPath([previous, current], …)` adjacency check with `linkHeading(level, previous, current)`. An authored path may straddle a portal.
    - Include `"wormholes"` in the `Pick` of `occupancyKeys` and any other helper that forwards the level into `arrowTrack`.
  - Search for remaining `advanceHead(` and `headingForPath(` call sites on arrow paths in `src/core` with parsight `find_code` scoped to par-arrows. Switch each to the wrapper, except the definitions in `topology.ts` and the wrapper itself.

- [ ] **Step 4: Run** `bun test tests/wormhole.test.ts`, then `make checkall`. Expect PASS and green. Every existing level has no wormholes, so its behavior and fingerprints are unchanged.
- [ ] **Step 5: Commit** with message `feat(core): route moves, tracks and loop checks through wormholes`.

---

### Task 3: Saved-game validation

**Files:**
- Modify: `src/storage.ts` (`CONTENT_VERSION`, path-link check near line 292)
- Test: `tests/storage.test.ts`

**Interfaces:**
- Consumes: `linkHeading`, `isPortalLink` from Task 1.

- [ ] **Step 1: Write failing tests** in `tests/storage.test.ts`. Follow the file's existing save/load helpers; read how the flip `settledPaths` cases build a save and reuse that pattern.
  - A level with one wormhole and a stop right after B. Park `p` on the stop, so its path is `[front(1,1), right(1,2), right(2,2)]` or similar, depending on length. Save, reload, and assert that the parked path and offset are restored and that the next move exits.
  - A forged `settledPaths` entry whose consecutive cells are neither adjacent nor a real portal link. Assert the attempt is refreshed (rejected).
  - A save written with content version 12 refreshes once.

- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.** Set `CONTENT_VERSION = 13`. Replace `headingForPath([previous, current], level.gridSize)` in the path check with `linkHeading(level, previous, current)`. Update the storage comments and the CLAUDE.md Storage section to say content 13.
- [ ] **Step 4: Run** `bun test tests/storage.test.ts`, then `make checkall`. Expect PASS and green.
- [ ] **Step 5: Commit** with message `feat(storage): accept portal links in saved paths, content 13`.

---

### Task 4: Level 35, walkthrough and preview

**Files:**
- Create: `src/content/wormhole-intro.ts`
- Modify: `src/content/procedural.ts` (`AUTHORED_LEVEL_IDS`, `seedForLevel`, `generateLevel`)
- Modify: `src/tutorial.ts` (add `WORMHOLE_INTRO_SCRIPT`, register it)
- Modify: `src/content/level-preview.ts` (feature `wormhole`, aliases `portal`, `wormholes`)
- Modify: `tests/fixtures/v8-layouts.json` (entry 35)
- Test: `tests/wormhole-content.test.ts`

**Interfaces:**
- Produces: `WORMHOLE_INTRO_LEVEL: LevelDefinition` with arrow ids `wormhole-intro-portal`, `wormhole-intro-gate`, plus face fillers `wormhole-intro-back|left|top|bottom`.

**Layout constraints.** Model it on `flip-intro.ts`: grid 4, 5 lives, `arrowScale: 1`, no edge policies, one wormhole with id `w1`.
- The **portal** arrow on the front face heads east along a row. The first cell ahead of its head is end A.
- The **gate** arrow sits in that row past A. It enters the front face from the right face across the seam, heading west, so it would run into the portal arrow's body. Starting candidate:
  - portal `[front(0,2), front(1,2)]`
  - A = `front(2,2)`
  - gate `[right(0,2), front(3,2)]`
  - B = `right(2,0)`
- Without the wormhole, the portal arrow's lane (3,2) holds the gate and the gate's lane (1,2) holds the portal arrow, so the cube deadlocks.
- With the wormhole, the portal arrow enters A, leaves B east and exits. The gate then enters A, leaves B heading west, and must exit.
- If the validator or solver rejects the candidate, move B, keeping these properties, until the tests below pass. One filler arrow per remaining face, placed like level 30's fillers, off every route.

- [ ] **Step 1: Write failing tests** in `tests/wormhole-content.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { WORMHOLE_INTRO_LEVEL } from "../src/content/wormhole-intro";
import { parseLevelPreview, resolveLevelPreview } from "../src/content/level-preview";
import { generateLevel, isAuthoredLevel, seedForLevel } from "../src/content/procedural";
import { applyMove, createGameState, simulateMove } from "../src/core/game-state";
import { hasStrandingState, solveLevelTargets, validateLevel } from "../src/core/validation";
import { scriptForLevel } from "../src/tutorial";

describe("wormhole introduction", () => {
  test("level 35 is the authored wormhole cube", () => {
    expect(generateLevel(35)).toBe(WORMHOLE_INTRO_LEVEL);
    expect(isAuthoredLevel(35)).toBe(true);
    expect(seedForLevel(35)).toBe("par-arrows:runtime:7:level:35:wormhole-intro:1");
    expect(validateLevel(WORMHOLE_INTRO_LEVEL).errors).toEqual([]);
    expect(solveLevelTargets(WORMHOLE_INTRO_LEVEL)).toBeDefined();
    expect(hasStrandingState(WORMHOLE_INTRO_LEVEL)).toBe(false);
  });

  test("the wormhole is required", () => {
    expect(solveLevelTargets({ ...WORMHOLE_INTRO_LEVEL, wormholes: [] })).toBeUndefined();
  });

  test("the portal arrow goes first, then the gate", () => {
    const level = WORMHOLE_INTRO_LEVEL;
    let state = createGameState(level);
    expect(simulateMove(level, state, "wormhole-intro-gate").kind).toBe("blocked");
    const portal = simulateMove(level, state, "wormhole-intro-portal");
    expect(portal.kind).toBe("exit");
    expect(portal.portals?.length).toBe(1);
    state = applyMove(level, state, portal);
    expect(simulateMove(level, state, "wormhole-intro-gate").kind).toBe("exit");
  });

  test("the walkthrough gates the portal arrow first", () => {
    const script = scriptForLevel(35);
    expect(script?.steps[0]?.highlightId).toBe("wormhole-intro-portal");
  });

  test.each(["wormhole", "portal", "wormholes"])("?feature=%s previews level 35", (name) => {
    const preview = parseLevelPreview(new URLSearchParams(`feature=${name}`));
    expect(resolveLevelPreview(preview)?.level.id ?? resolveLevelPreview(preview)).toBeTruthy();
  });
});
```

Before finalizing, adjust the preview assertion to the real return shape of `resolveLevelPreview`. Read `tests/flip-content.test.ts`'s preview test and copy its exact assertion form, with 35 in place of 30.

- [ ] **Step 2: Run the tests.** Expect FAIL.
- [ ] **Step 3: Implement.**
  - Write the level, and add 35 to `AUTHORED_LEVEL_IDS`.
  - In `seedForLevel`, add `if (id === 35) return "par-arrows:runtime:7:level:35:wormhole-intro:1";` next to id 30.
  - In `generateLevel`, add `if (id === 35) return WORMHOLE_INTRO_LEVEL;`.
  - Add the script. Copy `FLIP_INTRO_SCRIPT`'s shape with two steps (portal, then gate) and copy text explaining that "a head entering a ring comes out of the matching ring, still heading the same way".
  - Add the preview feature.
  - Regenerate the id-35 entry in `tests/fixtures/v8-layouts.json` with the same mechanism the fixture's test uses. Read `tests/flip-generation.test.ts` for the fingerprint helper. Only entry 35 may change.
  - Check whether any flip-frequency code treats 35 as generated. `flipCoreFrequency` already returns 0 for authored ids.
- [ ] **Step 4: Run** `bun test tests/wormhole-content.test.ts tests/flip-generation.test.ts`, then `make checkall`. Expect PASS and green.
- [ ] **Step 5: Commit** with message `feat(content): authored wormhole intro at level 35`.

---

### Task 5: Generation from level 36

**Files:**
- Modify: `src/content/procedural.ts`
- Modify: `tests/fixtures/v8-layouts.json` (only ids that gain a wormhole)
- Test: `tests/wormhole-generation.test.ts`

**Interfaces:**
- Produces:
  - `wormholeFrequency(id: number): number`. Returns 0 below 36 and for authored ids, otherwise `0.25 + 0.35 * min(1, (id - 36) / 54)`.
  - `wormholePlan(id: number): 0 | 1 | 2`. Uses `coreStream(id, "wormhole-plan", 0)`. The first draw is compared against `wormholeFrequency`. A second draw is taken only when `id >= 50` and the first succeeded, and gives 2 with probability 0.3.
  - `wormholeCore(id, level, occupied, restart): { arrows: ArrowDefinition[]; wormhole: WormholeDefinition; certificate: MoveTarget[] } | undefined`. Draws on `coreStream(id, "wormhole-core", restart)`.
  - `decorativeWormhole(id, level, occupied, rng): WormholeDefinition | undefined`.

**Placement rules.**
- `wormholeCore` rotates the level-35 two-arrow pattern with `patternCell(base, dx, dy, rotation)`, the same way `doubleCore` does, and places B on a random other face cell not in `occupied`.
- It accepts a placement only when all of these hold:
  - the core validates alone;
  - `solveLevelTargets` of the core alone succeeds;
  - `solveLevelTargets` of the core with `wormholes: []` fails.
- Reserve into `occupied`: both ends, every core arrow's track cells, and the cell after B along each traverser's exit.
- It is placed right after the double core in `generateLevel`, only when the tier certificates. Its certificate entries lead the replay, the same way the double core's do.
- `decorativeWormhole` picks two cells from cells some existing arrow's track passes through. Both must be off `occupied`, off every flip region and group track, and off every stop and spot. It accepts only if the assembled level still validates, which covers loops, and `replayCertificate` still passes. It tries 24 candidates, then gives up.
- A core or decorative wormhole that fails placement is dropped, never failing the restart.
- `plan === 0` must touch neither stream beyond the single plan draw, so every zero-wormhole level keeps its fingerprint.

- [ ] **Step 1: Write failing tests** in `tests/wormhole-generation.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { generateLevel, wormholeFrequency } from "../src/content/procedural";
import { solveLevelTargets, validateLevel } from "../src/core/validation";
import { interactionRegion } from "../src/core/validation";
import { cellKey } from "../src/core/topology";
import layouts from "./fixtures/v8-layouts.json";
import { layoutFingerprint } from "../src/storage"; // use the helper the flip sweep imports

describe("wormhole generation", () => {
  test("frequency curve", () => {
    expect(wormholeFrequency(35)).toBe(0);
    expect(wormholeFrequency(36)).toBeCloseTo(0.25);
    expect(wormholeFrequency(90)).toBeCloseTo(0.6);
    expect(wormholeFrequency(150)).toBeCloseTo(0.6);
  });

  test("sweep 36-200", () => {
    let withHoles = 0;
    for (let id = 36; id <= 200; id += 1) {
      const level = generateLevel(id);
      const holes = level.wormholes ?? [];
      expect(holes.length).toBeLessThanOrEqual(id >= 50 ? 2 : 1);
      expect(validateLevel(level).valid).toBe(true);
      if (holes.length === 0) {
        expect(layoutFingerprint(level)).toBe((layouts as Record<string, string>)[String(id)]);
        continue;
      }
      withHoles += 1;
      const ends = new Set(holes.flatMap((h) => [cellKey(h.a), cellKey(h.b)]));
      for (const region of interactionRegion(level) ?? []) {
        // region shape: read interactionRegion's return type and assert no end key is in its cell set
      }
    }
    expect(withHoles).toBeGreaterThan(30);
  }, 600_000);

  test("a level carrying a wormhole core needs its wormholes", () => {
    const cored = [...Array(165).keys()].map((i) => i + 36)
      .map(generateLevel)
      .filter((level) => level.arrows.some((a) => a.id.includes("-wormhole-")));
    expect(cored.length).toBeGreaterThan(10);
    for (const level of cored.slice(0, 6)) {
      expect(solveLevelTargets({ ...level, wormholes: [] })).toBeUndefined();
    }
  }, 600_000);
});
```

Before Step 2, replace the `interactionRegion` loop with the concrete assertion. Read the function's return type (`src/core/validation.ts:901`) and assert that no wormhole end key appears in any region's cell set. Import `layoutFingerprint` from wherever `tests/flip-generation.test.ts` gets it, and reuse `tests/generated-levels.ts` for caching so the sweep isn't run twice. The required-use check solves six full levels without wormholes. If that exceeds the timeout, check the core arrows alone instead: build a level holding only the arrows whose id contains `-wormhole-` plus the wormhole, and assert that it's solvable with the wormhole and unsolvable without it.

- [ ] **Step 2: Run** `bun test tests/wormhole-generation.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** the four functions and their calls in `generateLevel`, per the rules above. Name the core arrows `r${id}-wormhole-portal` and `r${id}-wormhole-gate`. Attach `wormholes` to every level object assembled after placement: the `assemble(...)` helper, the trimmed-spot fallback, and the final tier. Use a grep for `directionals: [` inside `generateLevel` to find them all. Regenerate `tests/fixtures/v8-layouts.json` for ids that now carry a wormhole, using the fixture's regeneration path. Diff the fixture and confirm every changed id carries `wormholes`.
- [ ] **Step 4: Run** `bun test tests/wormhole-generation.test.ts tests/flip-generation.test.ts tests/region-generation.test.ts tests/procedural.test.ts tests/shape-variety.test.ts`, then `make checkall`. Expect PASS and green.
- [ ] **Step 5: Commit** with message `feat(generation): wormhole cores and decorative wormholes from level 36`.

---

### Task 6: Rendering, palette, diagnostics and the browser suite

**Files:**
- Modify: `src/render/renderer.ts`
- Modify: `src/app.ts` (`diagnosticText`)
- Create: `tests/wormhole-browser.ts`
- Modify: `tests/browser-runner.ts` (register the module, `WORMHOLE_ONLY=1` mode)
- Test: `tests/wormhole-render.test.ts`

**Interfaces:**
- Consumes: `MoveResult.portals`, `isPortalLink`, `WormholeDefinition`.
- Produces:
  - `ThemePalette.wormhole: readonly [number, number]`. Light theme: `[0xe07a10, 0x1f3fbf]`. Dark theme: `[0xffa040, 0x4f6bff]`.
  - `ExpandedPath` gains `readonly gaps?: readonly boolean[]`, parallel to `segmentFaces`.
  - `expandedPoints(cells, gridSize, level?: PortalSource)`.

**Rendering rules.**
- In `expandedPoints`, a portal link from `p` to `B` (where `isPortalLink(level, p, B)`) emits three segments:
  1. a normal segment from `p` to the center of end A, on A's face (the part that shrinks into A);
  2. a gap segment from A's center to B's center, with `gaps[i] = true`;
  3. the normal continuation from B.
- `pathLength` and `slicePath` count a gap segment as zero length, so travel time and distances are unchanged.
- `ribbonSections` / `ribbonVertices` break the strip at a gap. Emit the two sides as separate slices and build one ribbon mesh per contiguous run, so no quad ever joins A to B.
- The head glyph is placed at the end of the last run.
- `createWormholes(level)` draws each end as a ring (`THREE.RingGeometry`) plus an inner swirl (`TorusGeometry` or a spiral line) on the face, using `palette.wormhole[index]` where `index` is the wormhole's position in `level.wormholes`. Both ends of a wormhole use the same index. Recolor on theme change, next to `palette.flip`, and dispose in the level-clear path, next to `clearDirectionals`.
- `diagnosticText` adds `wormholes: level.wormholes?.map((h, i) => ({ id: h.id, a: h.a, b: h.b, color: i }))`.

- [ ] **Step 1: Write failing unit tests** in `tests/wormhole-render.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { expandedPoints, slicePath } from "../src/render/renderer";
import { THEME_PALETTES } from "../src/render/renderer"; // export it if not exported
import type { Cell, FaceId, LevelDefinition } from "../src/core/types";

const c = (face: FaceId, x: number, y: number): Cell => ({ face, x, y });
const level: LevelDefinition = {
  id: 99, title: "t", gridSize: 4, lives: 3, arrows: [],
  wormholes: [{ id: "w1", a: c("front", 2, 1), b: c("right", 1, 2) }],
};

describe("portal ribbons", () => {
  test("a portal link becomes a zero-length gap", () => {
    const path = expandedPoints([c("front", 1, 1), c("right", 1, 2), c("right", 2, 2)], 4, level);
    expect(path.gaps?.filter(Boolean).length).toBe(1);
    const plain = expandedPoints([c("front", 1, 1), c("front", 2, 1), c("front", 3, 1)], 4);
    const full = slicePath(path, 0, 100);
    const straight = slicePath(plain, 0, 100);
    const length = (s: typeof full) => s.points.slice(1).reduce((t, p, i) => t + p.distanceTo(s.points[i]!), 0);
    // Travelled distance ignores the jump: two cell links either way.
    expect(length(full) - (full.points.length ? 0 : 0)).toBeGreaterThan(0);
    expect(Math.abs(length(straight) - 2 * (2 / 4))).toBeLessThan(1e-6);
  });

  test("wormhole colors are unique and distinct from every mechanic color", () => {
    for (const palette of Object.values(THEME_PALETTES)) {
      const [first, second] = palette.wormhole;
      expect(first).not.toBe(second);
      const others = [palette.stop, palette.directional, palette.flip, palette.doubleTail,
        palette.doubleHead, palette.failed, palette.arrow, palette.selected, palette.nudge];
      expect(others).not.toContain(first);
      expect(others).not.toContain(second);
    }
  });
});
```

The first test's distance assertion is weak as sketched. Before running, tighten it: compute the travelled distance with the renderer's own `pathLength` (export it for testing), and assert that it equals the plain two-link path's distance within 1e-6.

- [ ] **Step 2: Run** `bun test tests/wormhole-render.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** the rendering rules above. Pass `this.level` into every `expandedPoints` call (`createArrow`, `refreshSettledPaths`, `arrowMotionTrack`). Export `THEME_PALETTES` and `pathLength` if needed.
- [ ] **Step 4: Write** `tests/wormhole-browser.ts`, modelled on `tests/flip-browser.ts`, with its helpers and `?test=1` hooks. It must:
  1. open `?level=35&test=1` and assert via `render_game_to_text` that there is one wormhole with color 0;
  2. tap the gate, then assert lives dropped by one, the gate is red, and it rewound;
  3. follow the walkthrough: tap the portal, sample a canvas screenshot mid-move and assert the head pixels are near B while no ribbon pixels lie on the straight screen segment between A and B's projections, then confirm the move ends in an exit;
  4. reload mid-level and assert the state is restored;
  5. find the first generated id from 50 with two wormholes (compute it in the test via `generateLevel`), open it, and assert via diagnostics that the two wormholes have colors 0 and 1, then sample both rings' pixels and assert different hues.

  Register it in `tests/browser-runner.ts` in the full sweep and under `WORMHOLE_ONLY=1`, copying the `FLIP_ONLY` wiring.
- [ ] **Step 5: Run** `make checkall` and `WORMHOLE_ONLY=1 make browser-test`. Expect green, then run the full `make browser-test`. Also run `FLIP_ONLY=1`, `DOUBLE_ONLY=1` and `OVERLAP_ONLY=1`, since the ribbon code is shared.
- [ ] **Step 6: Commit** with message `feat(render): wormhole rings, split ribbons and browser coverage`.

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md` (Project paragraph, a new "Wormholes" subsection under Architecture following the Flip spots layout, Generation and seeds, Storage content 13, Tests)
- Modify: `README.md` (mechanics list, authored levels, preview selectors)

- [ ] **Step 1:** Write the docs from the implemented code, not from this plan. Re-read `src/core/wormholes.ts` and the generation code first.
- [ ] **Step 2:** Run `make checkall`. Expect green.
- [ ] **Step 3: Commit** with message `docs: wormholes`.
