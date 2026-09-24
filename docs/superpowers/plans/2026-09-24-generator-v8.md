# Generator V8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-roll the campaign once (generator v8) so reversal and self-passing become deliberate puzzle content, prove flip-safety by bounded whole-region enumeration instead of footprint isolation, let overlap groups share spot cubes, and delete every legacy save-resume ladder.

**Architecture:** A new `interactionRegion` extractor in core validation closes a set of arrows, flip spots and stops under reachability and proves it strand-free and flip-interesting with the existing enumerator, with outside arrows as static blockers. The generator places regions wherever they fit (all tiers), adds reversal blockers and bounce park patterns, raises flip density, and stops rejecting groups on spot cubes (keeping the routes-avoid-spots rule). Storage keeps the layout fingerprint and drops the content-9/10/11 ladders.

**Tech Stack:** TypeScript, Bun test runner, three.js, Vite, Biome, Playwright headed browser tests.

**Spec:** `docs/superpowers/specs/2026-09-24-generator-v8-design.md`

## Global Constraints

- No collision-free move may ever make a level unwinnable. Only collisions cost lives.
- Hints stay free and unlimited until V1.
- No player-facing rule changes; every mechanic used here already ships.
- Authored levels 1, 5, 11, 15, 20, 25, 30 keep their layouts and pinned seeds.
- `GENERATOR_VERSION` becomes 8. `CONTENT_VERSION` stays 12.
- Every region must pass: zero stranded states, `flipInterest` true, solvable. Overflow shrinks or falls back — never ships unproven.
- Outside regions, non-region arrows' tracks never touch region cells; groups' member routes never touch any spot cell.
- A save resumes only when its fingerprint matches the resolved level; every other save refreshes once keeping unlocks and tutorial completion.
- Each task ends with its focused tests green, `make checkall` green, and an atomic commit. No registry publishing.

## Review Focus

1. **Region closure is sound.** An arrow whose track touches a region cell must be in the region or its cells must be unreachable by region arrows; otherwise composition fails. Task 2's closure property test pins it on generated levels.
2. **The conservative-blocker model.** Outside arrows modeled as static blockers must over-approximate the game: a region provably clearable under blockers is clearable when they move. Task 2 pins it by playing every generated region level's region-clearing sequence in the real engine.
3. **Enumeration overflow never ships.** Task 2's fallback test pins: an oversized region shrinks or drops to an isolated core; the level still validates.
4. **Group route/spot separation.** A group member's solo route (the thing a shared offset rides) must avoid spot cells on every generated level. Task 5's sweep pins it.
5. **No legacy resume path survives.** A content-11 save must refresh everywhere (including previously-unchanged ids like 22); only exact-fingerprint content-12 saves resume. Task 6 pins it, including deleting the dead code.

---

### Task 1: `interactionRegion` extraction in core

**Files:**
- Modify: `src/core/validation.ts`
- Create: `tests/region.test.ts`

**Interfaces:**
- Consumes: `hasStrandingState` (validation.ts:524), `flipInterest` (:574), `arrowTrack`/`settledPathOf` (src/core/stops.ts), `spotHeadingAt`/`isFlipSpot`/`hasFlipSpots` (src/core/directionals.ts).
- Produces:

```ts
export interface InteractionRegion {
  /** Arrow ids in the region, including the seed arrows. */
  readonly arrowIds: readonly string[];
  /** Flip-spot and stop cell keys inside the region. */
  readonly spotKeys: readonly string[];
  readonly stopKeys: readonly string[];
  /** Every cell any region arrow can occupy under any spot state (tracks + bodies). */
  readonly cells: ReadonlySet<string>;
}

/**
 * Close a set of seed arrows under reachability: add every arrow whose track
 * touches a cell a region arrow can occupy, and every spot/stop on those
 * tracks, until stable. `undefined` when the closure exceeds `maxArrows`.
 */
export function interactionRegion(
  level: LevelDefinition,
  seedArrowIds: readonly string[],
  maxArrows = 6,
): InteractionRegion | undefined;

/**
 * Prove a region: outside remaining arrows become static blockers on their
 * settled cells; the extracted mini-level must have zero stranded states,
 * flipInterest true, and solve. Returns false or "overflow" reasons.
 */
export function proveRegion(
  level: LevelDefinition,
  state: GameState,
  region: InteractionRegion,
  limit = 5000,
): { readonly ok: boolean; readonly reason?: "stranded" | "uninteresting" | "unsolvable" | "overflow" };
```

- [ ] **Step 1: Write the failing tests** (`tests/region.test.ts`)

```ts
import { describe, expect, test } from "bun:test";
import {
  createGameState,
  simulateMove,
  applyMove,
} from "../src/core/game-state";
import {
  interactionRegion,
  proveRegion,
  validateLevel,
} from "../src/core/validation";
import { cellKey } from "../src/core/topology";
import type { Cell, LevelDefinition } from "../src/core/types";

function cell(x: number, y: number): Cell {
  return { face: "front", x, y };
}

function level(
  arrows: LevelDefinition["arrows"],
  spots: { x: number; y: number; heading: "north" | "south" | "east" | "west"; kind?: "flip" }[],
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
    expect(region?.arrowIds.sort()).toEqual(["guard", "reverser", "runner"]);
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
    const withStop = level(
      [
        { id: "reverser", path: [cell(1, 3), cell(1, 2)] },
        { id: "guard", path: [cell(0, 0), cell(1, 0)] },
        { id: "runner", path: [cell(3, 1), cell(2, 1)] },
      ],
      [{ x: 1, y: 1, heading: "south", kind: "flip" }],
      [cell(1, 1)],
    );
    // The stop sits on the spot cell, which validation forbids; use a lane cell.
    const legal = level(
      [
        { id: "reverser", path: [cell(1, 3), cell(1, 2)] },
        { id: "guard", path: [cell(0, 0), cell(1, 0)] },
        { id: "runner", path: [cell(3, 1), cell(2, 1)] },
      ],
      [{ x: 1, y: 1, heading: "south", kind: "flip" }],
      [cell(2, 1)],
    );
    expect(validateLevel(legal).valid).toBe(true);
    const region = interactionRegion(legal, ["reverser"]);
    const verdict = region && proveRegion(legal, createGameState(legal), region);
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
    const verdict = region && proveRegion(stranded, createGameState(stranded), region);
    // Whatever the verdict, it must be one of the named reasons or ok.
    if (!verdict?.ok) {
      expect(["stranded", "uninteresting", "unsolvable", "overflow"]).toContain(
        verdict?.reason,
      );
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
      [cell(2, 1)],
    );
    let state = createGameState(legal);
    for (const id of ["reverser", "guard", "runner"]) {
      state = applyMove(legal, state, simulateMove(legal, state, id));
    }
    expect(state.status).toBe("won");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun test tests/region.test.ts`
Expected: FAIL (`interactionRegion` not exported).

- [ ] **Step 3: Implement**

In `src/core/validation.ts`, below `flipInterest`:

```ts
export interface InteractionRegion {
  readonly arrowIds: readonly string[];
  readonly spotKeys: readonly string[];
  readonly stopKeys: readonly string[];
  readonly cells: ReadonlySet<string>;
}

/**
 * Cell keys an arrow occupies now or can ever occupy (authored body plus its
 * track) under the authored spot layout.
 */
function occupancyKeys(
  level: LevelDefinition,
  arrow: ArrowDefinition,
): ReadonlySet<string> {
  return new Set(arrowTrack(level, arrow).map(cellKey));
}

/**
 * Close seed arrows under reachability: any arrow whose track touches a cell
 * a region arrow can occupy joins the region. Undefined past `maxArrows`.
 */
export function interactionRegion(
  level: LevelDefinition,
  seedArrowIds: readonly string[],
  maxArrows = 6,
): InteractionRegion | undefined {
  const byId = new Map(level.arrows.map((arrow) => [arrow.id, arrow]));
  const stopKeys = new Set((level.stops ?? []).map(cellKey));
  const spotKeys = new Set(
    (level.directionals ?? []).map((spot) => cellKey(spot.cell)),
  );
  const members = new Set<string>();
  const cells = new Set<string>();
  const frontier = [...seedArrowIds];
  while (frontier.length > 0) {
    const id = frontier.pop() as string;
    if (members.has(id)) continue;
    const arrow = byId.get(id);
    if (!arrow) continue;
    if (members.size >= maxArrows) return undefined;
    members.add(id);
    const arrowCells = [...occupancyKeys(level, arrow)].map((key) => {
      cells.add(key);
      return key;
    });
    for (const key of arrowCells) {
      if (stopKeys.has(key) || spotKeys.has(key)) continue;
      for (const other of level.arrows) {
        if (members.has(other.id) || frontier.includes(other.id)) continue;
        if (occupancyKeys(level, other).has(key)) frontier.push(other.id);
      }
    }
  }
  return {
    arrowIds: [...members],
    spotKeys: [...spotKeys].filter((key) => cells.has(key)),
    stopKeys: [...stopKeys].filter((key) => cells.has(key)),
    cells,
  };
}

/**
 * Prove a region with outside arrows as static blockers: occupancy includes
 * their settled cells, but they are never tapped. A blocker only removes
 * options, so clearable-under-blockers implies clearable-in-game.
 */
export function proveRegion(
  level: LevelDefinition,
  state: GameState,
  region: InteractionRegion,
  limit = 5000,
): { ok: boolean; reason?: "stranded" | "uninteresting" | "unsolvable" | "overflow" } {
  const inside = new Set(region.arrowIds);
  const blocked = new Set<string>();
  for (const arrow of level.arrows) {
    if (inside.has(arrow.id) || !state.remainingIds.includes(arrow.id)) continue;
    for (const cell of settledPathOf(level, state, arrow)) {
      blocked.add(cellKey(cell));
    }
  }
  const stranded = enumerateStranding(level, state, limit, (id) => inside.has(id), blocked);
  if (stranded === undefined) return { ok: false, reason: "overflow" };
  if (stranded === true) return { ok: false, reason: "stranded" };
  if (!enumeratedFlipInterest(level, state, limit, (id) => inside.has(id), blocked)) {
    return { ok: false, reason: "uninteresting" };
  }
  if (!enumeratedSolvable(level, state, (id) => inside.has(id), blocked)) {
    return { ok: false, reason: "unsolvable" };
  }
  return { ok: true };
}
```

**Implementation note (binding):** `enumerateStranding`, `enumeratedFlipInterest` and `enumeratedSolvable` are private refactors of the existing `hasStrandingState`, `flipInterest` and greedy solve loop: same code, with two extra parameters — `tapFilter?: (arrowId: string) => boolean` (which arrows may be tapped; default all) and `blockedCells?: ReadonlySet<string>` (occupancy added to the moving arrow's collision map). The three public functions become thin wrappers with no filter and no blockers. One enumeration implementation, honest semantics, no fake-arrow modeling.

- [ ] **Step 4: Run the tests**

Run: `bun test tests/region.test.ts tests/flip.test.ts tests/core.test.ts tests/directional.test.ts tests/stop-content.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

Run: `make checkall` → exit 0.

```bash
git add src/core/validation.ts tests/region.test.ts
git commit -m "feat(core): extract and prove interaction regions"
```

---

### Task 2: Generator-side region acceptance and fallbacks

**Files:**
- Modify: `src/content/procedural.ts`
- Create: `tests/region-fallback.test.ts`

**Interfaces:**
- Consumes: Task 1 (`interactionRegion`, `proveRegion`), `flipCore` (procedural.ts:1341), `chooseStops` (:1991).
- Produces: `acceptFlipRegion(level, arrows, spot, stops) => { ok: boolean; cells: ReadonlySet<string> }` — builds the region from the flip seed arrows (the core's `r<id>-flip-*` ids), proves it with `proveRegion` on the in-progress board (outside arrows are whatever is already placed), and returns the region cells for the `occupied` set. On `overflow` or any failure it returns `{ ok: false }` and the caller falls back to the v7 isolated-core path.

- [ ] **Step 1: Write the failing tests** (`tests/region-fallback.test.ts`)

Hand-built levels, no generation, so the task is independently testable before Task 3 wires it in:

```ts
import { describe, expect, test } from "bun:test";
import { acceptFlipRegion } from "../src/content/procedural";
import type { Cell } from "../src/core/types";

function cell(x: number, y: number): Cell {
  return { face: "front", x, y };
}

const flipCore = (id: number) => [
  { id: `r${id}-flip-bounce-reverser`, path: [cell(1, 3), cell(1, 2)] },
  { id: `r${id}-flip-bounce-runner`, path: [cell(3, 1), cell(2, 1)] },
  { id: `r${id}-flip-bounce-cap`, path: [cell(1, 0), cell(2, 0)] },
];

describe("flip region acceptance", () => {
  test("accepts the bounce core with a stop inside the region", () => {
    const board = { id: 910, title: "t", gridSize: 6, lives: 3, arrows: flipCore(31) };
    const spot = { cell: cell(1, 1), heading: "south" as const, kind: "flip" as const };
    const verdict = acceptFlipRegion(board as never, board.arrows, spot, [cell(2, 1)]);
    expect(verdict.ok).toBe(true);
    expect(verdict.cells.has("front:1:1")).toBe(true);
  });

  test("rejects and reports when the region cannot prove", () => {
    // A cap arrow parked permanently across the runner's exit: unsolvable
    // region — acceptance must fail, letting the caller fall back.
    const blocked = [
      ...flipCore(32),
      { id: "r32-wall", path: [cell(2, 2), cell(2, 3)] },
    ];
    const board = { id: 911, title: "t", gridSize: 6, lives: 3, arrows: blocked };
    const spot = { cell: cell(1, 1), heading: "south" as const, kind: "flip" as const };
    const verdict = acceptFlipRegion(board as never, blocked, spot, []);
    expect(verdict.ok).toBe(false);
  });

  test("overflows past the arrow cap return not-ok", () => {
    const many = [...flipCore(33)];
    for (let index = 0; index < 6; index += 1) {
      many.push({ id: `r33-extra-${index}`, path: [cell(4 + (index % 2), index), cell(5, index)] });
    }
    const board = { id: 912, title: "t", gridSize: 6, lives: 3, arrows: many };
    const spot = { cell: cell(1, 1), heading: "south" as const, kind: "flip" as const };
    const verdict = acceptFlipRegion(board as never, many, spot, []);
    expect(verdict.ok).toBe(false);
  });
});
```

(`cell` is defined locally in this file — do not import it from `tests/region.test.ts`: importing a test module re-runs its `describe` blocks under `bun:test`.)

- [ ] **Step 2: Run to see it fail.** `bun test tests/region-fallback.test.ts` — FAIL (`acceptFlipRegion` not exported).

- [ ] **Step 3: Implement `acceptFlipRegion`** in `src/content/procedural.ts` next to `flipCore`:

```ts
/**
 * Accept a flip placement by proving its interaction region: seed arrows are
 * the flip core's, outside placed arrows block but are never tapped. Returns
 * the region cells for occupancy; ok:false means fall back to an isolated
 * core placement.
 */
export function acceptFlipRegion(
  board: Pick<LevelDefinition, "id" | "title" | "gridSize" | "lives" | "edgePolicies">,
  arrows: readonly ArrowDefinition[],
  spot: DirectionalSpotDefinition,
  stops: readonly Cell[],
): { ok: boolean; cells: ReadonlySet<string> } {
  const level: LevelDefinition = {
    ...board,
    arrows: [...arrows],
    directionals: [spot],
    ...(stops.length > 0 ? { stops } : {}),
  };
  const seeds = arrows.filter((arrow) => arrow.id.includes("-flip-")).map((arrow) => arrow.id);
  const region = interactionRegion(level, seeds);
  if (!region) return { ok: false, cells: new Set() };
  const verdict = proveRegion(level, createGameState(level), region);
  return { ok: verdict.ok, cells: region.cells };
}
```

- [ ] **Step 4: Run the tests.** `bun test tests/region-fallback.test.ts tests/region.test.ts` → PASS.

- [ ] **Step 5: Gate and commit.** `make checkall` → 0.

```bash
git add src/content/procedural.ts tests/region-fallback.test.ts
git commit -m "feat(generation): accept flip placements by proving interaction regions"
```

---

### Task 3: Generator v8 — version bump, region placement, new content

**Files:**
- Modify: `src/content/procedural.ts`
- Modify: `tests/procedural.test.ts`, `tests/flip-generation.test.ts`, `tests/generator-variety.test.ts`, `tests/stop-content.test.ts` (pins re-pinned to the v8 baseline)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `GENERATOR_VERSION = 8`; `flipCoreFrequency(id)` cap 0.65 by level 90; `FLIP_PATTERNS` gains `relay2` (two spots); `PARK_PATTERNS` gains a bounce entry; `overlapStarter` runs on spot cubes with member routes avoiding spot cells.

- [ ] **Step 1: Record the v8 baseline first** (after the code changes, before re-pinning):

```bash
mkdir -p tests/fixtures
cat > .superpowers/v8-baseline.ts <<'EOF'
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
const { generateLevel } = await import(`${process.cwd()}/src/content/procedural.ts`);
const out: Record<string, string> = {};
for (let id = 2; id <= 200; id += 1) {
  out[id] = createHash("sha1").update(JSON.stringify(generateLevel(id))).digest("hex").slice(0, 12);
}
writeFileSync("tests/fixtures/v8-layouts.json", `${JSON.stringify(out, null, 2)}\n`);
EOF
bun .superpowers/v8-baseline.ts
```

- [ ] **Step 2: Bump and free placement.** `GENERATOR_VERSION = 8`. In `generateLevel`: remove the tier-1-only flip restriction; region placement (the flip pass from v7, renamed) tries every tier. Region acceptance = `proveRegion` ok (replacing footprint isolation + `hasStrandingState(core)` + `flipInterest(core)` checks); on `overflow`/failure, shrink once (move the planned stop/spot), then fall back to the v7 isolated-core path, then to no flip content. Add region cells (Task 1's `cells`) to `occupied` exactly as the footprint was.
- [ ] **Step 3: New content.**
  - `FLIP_PATTERNS`: add `relay2` — two flip spots one lane apart, a traverser bending through both, plus the two arrows whose safety depends on each state (design in the pattern's `cells` tables; verify by the Task 1 prover before committing the pattern — the same way v7 patterns were verified in the rules model).
  - `PARK_PATTERNS`: add `bounce` — the parker's start sits head-on a static spot before its circle, so parking requires the reversal; certificate legs unchanged (`parkingCore` replays arbitrary routes).
  - Reversal blockers: after cores, place head-on static spots that bounce a non-core arrow back along its own body into another arrow's lane; accept only when the bounce lane crosses exactly one other arrow's track and the level stays solver-valid.
  - `overlapStarter` on spot cubes: drop the generator-side skip; keep validation's routes-avoid-spots rule (below).
- [ ] **Step 4: Frequency.** `flipCoreFrequency`: `0.25 + 0.40 * min(1, (id - 31) / 59)` (0.25 at 31, 0.65 at 90, holding).
- [ ] **Step 5: Run the sweeps and re-pin.** `bun test tests/procedural.test.ts tests/flip-generation.test.ts tests/generator-variety.test.ts tests/stop-content.test.ts tests/region-generation.test.ts` — replace every pinned hash with the v8 value plus `// Re-rolled for generator v8.` Update the flip-generation sweep to assert `>= 40` cores in 31-120 still and keep the core-track-equality property (it holds under regions: core tracks must still match the isolated probe, since only spot state differs and the probe holds the same spots).
- [ ] **Step 6: Gate and commit.** `make checkall` → 0.

```bash
git add src/content/procedural.ts tests/
git commit -m "feat(generation): generator v8 with interaction regions and reversal content"
```

---

### Task 4: Region acceptance sweep on generated levels

**Files:**
- Create: `tests/region-generation.test.ts`
- Modify: `tests/flip-generation.test.ts` (region assertions folded in)

**Interfaces:**
- Consumes: Tasks 1-3 (`interactionRegion`, `proveRegion`, the v8 generator).

- [ ] **Step 1: Write the sweep tests** (`tests/region-generation.test.ts`)

```ts
import { describe, expect, test } from "bun:test";
import { generateLevel } from "../src/content/procedural";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import { interactionRegion, proveRegion } from "../src/core/validation";
import { createGameState } from "../src/core/game-state";

const flipArrowIds = (level: ReturnType<typeof generateLevel>) =>
  level.arrows.filter((arrow) => arrow.id.includes("-flip-")).map((arrow) => arrow.id);

describe("generated interaction regions", () => {
  test("every flip level's region closes, proves, and composes", () => {
    let regions = 0;
    for (let id = 31; id <= 90; id += 1) {
      const level = generateLevel(id);
      const seeds = flipArrowIds(level);
      if (seeds.length === 0) continue;
      regions += 1;
      const region = interactionRegion(level, seeds);
      expect(region).toBeDefined();
      const verdict = region && proveRegion(level, createGameState(level), region);
      expect(verdict?.ok).toBe(true);
      for (const arrow of level.arrows) {
        if (region?.arrowIds.includes(arrow.id)) continue;
        for (const cell of arrowTrack(level, arrow)) {
          expect(region?.cells.has(cellKey(cell))).toBe(false);
        }
      }
    }
    expect(regions).toBeGreaterThanOrEqual(20);
  }, 240_000);

  test("stops appear inside some flip regions", () => {
    let withStops = 0;
    for (let id = 31; id <= 120; id += 1) {
      const level = generateLevel(id);
      if (flipArrowIds(level).length === 0) continue;
      const region = interactionRegion(level, flipArrowIds(level));
      if (region && region.stopKeys.length > 0) withStops += 1;
    }
    expect(withStops).toBeGreaterThan(0);
  }, 240_000);
});
```

- [ ] **Step 2: Add the engine-parity check** (Review Focus 2): for 5 sampled flip levels (ids recorded from the sweep), restrict `solveLevelTargets`'s region prefix to region arrows and replay it with the real engine (`simulateMove`/`applyMove` on the full level); assert the region's arrows all exit. If the greedy order interleaves region and outside arrows, replay the full solution instead and assert only the region arrows' fate.
- [ ] **Step 3: Fold region assertions into `tests/flip-generation.test.ts`** — keep the `>= 40` cores assertion and the core-track-equality property from the shipped test (they hold under regions; re-verify after Task 5's group change).
- [ ] **Step 4: Gate and commit.** `make checkall` → 0.

```bash
git add tests/region-generation.test.ts tests/flip-generation.test.ts
git commit -m "test(generation): pin region closure, proofs, and engine parity"
```

---

### Task 5: Groups on spot cubes

**Files:**
- Modify: `src/core/validation.ts` (group rule), `src/content/procedural.ts` (starter)
- Modify: `tests/overlap-content.test.ts`, `tests/overlap.test.ts`, `tests/region-generation.test.ts`

**Interfaces:** validation error changes from "A level with directional spots cannot contain shared-tail groups." to a routes rule: `Shared-tail group <key> has a member route through a directional spot.`

- [ ] **Step 1: Failing tests.** In `tests/overlap.test.ts`: a group on a spot cube whose members avoid spot cells validates; a group whose member route crosses a spot cell errors with the new message. In `tests/region-generation.test.ts` sweep: no group member's `arrowTrack` contains any spot cell key (Review Focus 4).
- [ ] **Step 2: Implement.** Replace the blanket rejection in `validateLevel` (validation.ts:349) with the route check: for each group, every member's `arrowTrack` must avoid `spotCells`; keep group-size/crossing checks. In `overlapStarter`, allow spot cubes; the existing route-crossing rejection inside `overlapStarter` already prevents bad placements against the assembled board — extend its board to include `directionals`.
- [ ] **Step 3: Run** `bun test tests/overlap.test.ts tests/overlap-content.test.ts tests/region-generation.test.ts tests/storage.test.ts`; re-record the v8 baseline from Task 3 Step 1 if any layout moved (groups now appear on spot cubes), re-pin with the same comment.
- [ ] **Step 4: Gate and commit.** `make checkall`.

```bash
git add src/core/validation.ts src/content/procedural.ts tests/
git commit -m "feat(core): shared-tail groups share spot cubes without routing through spots"
```

---

### Task 6: Delete the save migration ladder

**Files:**
- Modify: `src/storage.ts`
- Delete: `src/content-11-layouts.ts`
- Modify: `tests/storage.test.ts`, browser fixtures that seed content-11 saves

**Interfaces:** `loadCampaign` resumes iff `contentVersion === 12 && stored layout matches`. Everything else refreshes once keeping unlocks and tutorial completion.

- [ ] **Step 1: Failing tests.** A content-11 save on previously-unchanged id 22 refreshes (`recovered: true`, unlocks kept) — the exact inverse of today's test. A content-12 save with a matching fingerprint resumes; with a mismatched one refreshes. No test references `CONTENT_ELEVEN_LAYOUTS`.
- [ ] **Step 2: Implement.** Delete `isUnchangedLevel`, `isUnchangedSinceContentNine`, `isUnchangedSinceContentTen`, `REBUILT_IN_CONTENT_ELEVEN`, `hasMatchingGeneratorMetadata`'s version ladder (keep the seed check: `parsed.seed === seedForLevel(id)`), `CONTENT_ELEVEN_LAYOUTS`, and the file. The compatible predicate becomes `parsed.contentVersion === 12 && typeof storedLayout === "string" && storedLayout === layoutFingerprint(level) && parsed.seed === seedForLevel(currentLevelId)`.
- [ ] **Step 3: Run** `bun test tests/storage.test.ts`; update browser fixtures (`tests/wrapping-browser.ts` seeds a content-11 save — switch it to 12-with-fingerprint) and run the affected focused browser suites (`WRAP_INTRO`/runtime suites that touch saves).
- [ ] **Step 4: Gate and commit.** `make checkall`.

```bash
git add src/storage.ts tests/
git rm src/content-11-layouts.ts
git commit -m "feat(storage): resume by fingerprint only; delete the migration ladder"
```

---

### Task 7: Browser coverage and docs

**Files:**
- Modify: `tests/flip-browser.ts` (stop-inside-region headed check), `CLAUDE.md`, `README.md`, `PRD.md`, `docs/superpowers/specs/2026-09-23-flip-spot-design.md` (status note)

- [ ] **Step 1: Headed check.** Find a generated flip level with a stop inside its region (from the Task 4 sweep data; record the id in the test). In `assertFlipIntro`'s campaign context: `loadLevel(<id>)`, park the arrow whose circle sits in the region, assert `pendingFlips` names the spot, reload, move off, assert the flip fired (`current` reversed). Screenshot.
- [ ] **Step 2: Docs.** CLAUDE.md: generation section rewritten for v8 (regions replace footprint isolation; groups on spot cubes; frequency cap 0.65; v8 baseline pins; migration ladder deleted — Storage section shrinks to the fingerprint rule). README version sentence. PRD R-sections. Spec status note on the v7 file.
- [ ] **Step 3: Full gates.** `make checkall`, `make browser-test`, `FLIP_ONLY=1 make browser-test`, and once: `BROWSER_ENGINE=webkit FLIP_ONLY=1 make browser-test`.
- [ ] **Step 4: Commit.**

```bash
git add tests/flip-browser.ts CLAUDE.md README.md PRD.md docs/
git commit -m "docs+test: cover stop-in-region headed and document generator v8"
```

---

### Task 8: Delivery

- [ ] Rebase on `main`, fast-forward, push (deploys), watch both workflow runs to success with `gh run watch <id> --exit-status`, then remove the worktree/branch. Report per the finishing skill.
