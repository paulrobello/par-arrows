# Generator v9 Depth Difficulty — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated levels demand ordering depth — a solver-derived chain-depth gate per level, steeper from level 6 — while halving arrow density for readability.

**Architecture:** New pure metric module `src/content/difficulty.ts` builds a blocking DAG from `simulateMove` results (`MoveResult.blockerId` names the contacted arrow). `generateLevel` gains a chain pass, modeled on the existing blocker pass, that extends the DAG until `depthTarget(id)` is met or its budget exhausts, plus a hard acceptance gate with tolerance. Config curves and the arrow ceiling change together with `GENERATOR_VERSION` 9; the layout fingerprint fixture is regenerated after each layout-affecting task so the suite is green at every commit.

**Tech Stack:** TypeScript, Bun, three.js untouched; tests via `bun test`; fixture JSON.

**Spec:** `docs/superpowers/specs/2026-09-26-depth-difficulty-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- Bun only: `bun install --frozen-lockfile`, `bun test tests/<file>`; never `npm`/`node`.
- Gate after every task: `make checkall` green before its commit.
- Layout-affecting tasks (2, 3) end by regenerating `tests/fixtures/v8-layouts.json` with `bun scripts/write-layout-fixture.ts` so the whole suite is green at the commit.
- `GENERATOR_VERSION` goes 8 → 9 in Task 2; do not touch it again.
- Authored levels (1, 5, 11, 15, 20, 25, 30, 35) keep their layouts and configs and bypass the depth gate (`depthTarget` returns zeros below id 6; authored ids never reach the gate).
- New hard arrow ceiling `MAX_GENERATED_ARROWS = 186` (fill target ≤ 120 plus blocker/chain reserve); every 264 reference disappears from `getLevelConfig`, `runBlockerPass`, tests, and README.
- Comments state constraints, not narration; match the file's existing comment style.
- No new mechanics; winnability rule, solver validation, seed/stream determinism, picking, and storage semantics unchanged.

## Review Focus

1. **Wormhole boards are scored on the stripped board** — with portals present, a ring-created exit shifts unit shares by one and would reject boards the plan accepts; every depth/share score in Task 3 runs against `statsBoard` (`wormholes: []`), never `level`. Pinned by the Task 4 sweep, which includes every wormhole level 36+.
2. **A double arrow with one safe half is a tappable unit** — probes cover both endpoints and call the unit free if either move escapes. Pinned by Task 1's double-arrow test.
3. **Generation must terminate on every id** — the depth gate tolerates one chain link and 0.05 share, and the chain pass is budget-bounded; the Task 4 sweep over 6–200 surfaces any id that would throw.
4. **Chain arrows lead the reversed certificate** — they are pushed after circles are chosen, so circles are re-chosen and stats recomputed exactly like the assembled-board blocker top-up does (`src/content/procedural.ts:3633-3640` is the precedent).
5. **Groups count as one unit** — unit enumeration dedupes via `overlappingArrowIds` exactly like `blockedStats`; a group is blocked or free as one unit, never per member.

---

### Task 1: Depth metric module

**Files:**
- Create: `src/content/difficulty.ts`
- Test: `tests/difficulty.test.ts`

**Interfaces:**
- Consumes: `simulateMove` (core/movement), `overlappingArrowIds` (core/overlap), types from core/types. No import from `procedural.ts` (avoids a cycle).
- Produces (used by Tasks 3–4):
  - `interface DepthStats { chain: number; forcedShare: number; blockedShare: number; peel: number }`
  - `chainStats(level: LevelDefinition): { chain: number; forcedShare: number; blockedShare: number }`
  - `depthStats(level: LevelDefinition): DepthStats`
  - `depthTarget(id: number): { minChain: number; minForced: number }`
  - `CHAIN_TOLERANCE = 1`, `SHARE_TOLERANCE = 0.05`

- [ ] **Step 1: Write the failing tests**

Create `tests/difficulty.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { ArrowDefinition, LevelDefinition } from "../src/core/types";
import {
  chainStats,
  depthStats,
  depthTarget,
  CHAIN_TOLERANCE,
  SHARE_TOLERANCE,
} from "../src/content/difficulty";

const cell = (x: number, y: number) => ({ face: "front" as const, x, y });
const board = (arrows: ArrowDefinition[]): LevelDefinition => ({
  id: 9999,
  title: "metric test",
  gridSize: 4,
  lives: 3,
  arrows,
});

test("a free cube has chain 1, zero shares, peel 1", () => {
  const level = board([
    { id: "f1", path: [cell(0, 0), cell(1, 0)] },
    { id: "f2", path: [cell(0, 3), cell(1, 3)] },
  ]);
  expect(chainStats(level)).toEqual({
    chain: 1,
    forcedShare: 0,
    blockedShare: 0,
  });
  expect(depthStats(level)).toEqual({
    chain: 1,
    forcedShare: 0,
    blockedShare: 0,
    peel: 1,
  });
});

test("a three-arrow transitive chain scores exactly its depth", () => {
  // a1 heads east into a2's body; a2 heads north into a3's body; a3 exits west, clear.
  const level = board([
    { id: "a1", path: [cell(0, 0), cell(1, 0), cell(2, 0)] }, // blocked by a2 at (3,0)
    { id: "a2", path: [cell(3, 0), cell(3, 1)] },             // blocked by a3 at (3,2)
    { id: "a3", path: [cell(3, 2), cell(2, 2)] },             // exits west, clear
  ]);
  expect(chainStats(level)).toEqual({
    chain: 3,
    forcedShare: 2 / 3,
    blockedShare: 2 / 3,
  });
  expect(depthStats(level).peel).toBe(3);
});

test("a double with both halves blocked is one unit with two edges", () => {
  const level = board([
    { id: "d1", path: [cell(1, 0), cell(2, 0)], kind: "double" },
    { id: "b1", path: [cell(3, 0), cell(3, 1)] },
    { id: "t1", path: [cell(0, 0), cell(0, 1)] },
  ]);
  expect(chainStats(level)).toEqual({
    chain: 2,
    forcedShare: 1 / 3,
    blockedShare: 1 / 3,
  });
});

test("depthTarget curve waypoints", () => {
  expect(depthTarget(4)).toEqual({ minChain: 0, minForced: 0 });
  expect(depthTarget(6)).toEqual({ minChain: 2, minForced: 0.2 });
  expect(depthTarget(12)).toEqual({ minChain: 4, minForced: 0.3 });
  expect(depthTarget(26)).toEqual({ minChain: 6, minForced: 0.4 });
  expect(depthTarget(40)).toEqual({ minChain: 8, minForced: 0.5 });
  expect(depthTarget(41)).toEqual({ minChain: 8, minForced: 0.5 });
  expect(depthTarget(70)).toEqual({ minChain: 10, minForced: 0.6 });
  expect(depthTarget(120)).toEqual({ minChain: 10, minForced: 0.6 });
});

test("tolerance constants", () => {
  expect(CHAIN_TOLERANCE).toBe(1);
  expect(SHARE_TOLERANCE).toBe(0.05);
});
```

(`kind: "double"` is how `solveLevel` already detects doubles — src/core/validation.ts:881.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/difficulty.test.ts`
Expected: FAIL — module `../src/content/difficulty` does not exist.

- [ ] **Step 3: Implement `src/content/difficulty.ts`**

```ts
import type {
  ArrowDefinition,
  Endpoint,
  LevelDefinition,
} from "../core/types";
import { simulateMove } from "../core/movement";
import { overlappingArrowIds } from "../core/overlap";

/** Acceptance slack: a level may fall one chain link or 0.05 share short. */
export const CHAIN_TOLERANCE = 1;
export const SHARE_TOLERANCE = 0.05;

export interface DepthStats {
  readonly chain: number;
  readonly forcedShare: number;
  readonly blockedShare: number;
  readonly peel: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Depth targets per generated id; authored ids bypass the gate entirely. */
export function depthTarget(
  id: number,
): { minChain: number; minForced: number } {
  if (id < 6) return { minChain: 0, minForced: 0 };
  if (id <= 10) return { minChain: 2, minForced: 0.2 };
  if (id <= 40) {
    const mid = clamp01((id - 12) / 28);
    return { minChain: Math.round(4 + 4 * mid), minForced: 0.3 + 0.2 * mid };
  }
  const late = clamp01((id - 42) / 28);
  return { minChain: Math.round(8 + 2 * late), minForced: 0.5 + 0.1 * late };
}

interface Unit {
  readonly memberIds: readonly string[];
}

function units(level: LevelDefinition): readonly Unit[] {
  const counted = new Set<string>();
  const list: Unit[] = [];
  for (const arrow of level.arrows) {
    if (counted.has(arrow.id)) continue;
    const memberIds = overlappingArrowIds(level, arrow.id);
    for (const id of memberIds) counted.add(id);
    list.push({ memberIds });
  }
  return list;
}

interface ProbeOutcome {
  readonly free: boolean;
  readonly blockers: readonly string[];
}

function probeUnit(
  level: LevelDefinition,
  remaining: readonly string[],
  byId: ReadonlyMap<string, ArrowDefinition>,
  unit: Unit,
): ProbeOutcome {
  const lead = byId.get(unit.memberIds[0] as string);
  if (!lead) return { free: true, blockers: [] };
  const endpoints: readonly Endpoint[] =
    unit.memberIds.length === 1 && lead.kind === "double"
      ? ["head", "tail"]
      : ["head"];
  const own = new Set(unit.memberIds);
  const blockers = new Set<string>();
  let free = false;
  for (const endpoint of endpoints) {
    const result = simulateMove(level, remaining, lead.id, endpoint);
    for (const trace of result.members ?? [result]) {
      if (trace.kind !== "blocked") free = true;
      const blockerId = trace.blockerId;
      if (trace.kind === "blocked" && blockerId && !own.has(blockerId)) {
        blockers.add(blockerId);
      }
    }
  }
  return { free, blockers: [...blockers] };
}

/**
 * Blocking DAG over tap units at the initial state. Chain is the longest
 * dependency path in units; forced share counts units with at least one
 * dependency edge (a double with one blocked half carries an edge but is
 * still tappable). Blocked share uses full player-view semantics — both
 * double endpoints — so it can differ from blockedStats on doubles.
 */
export function chainStats(level: LevelDefinition): {
  chain: number;
  forcedShare: number;
  blockedShare: number;
} {
  const remaining = level.arrows.map((arrow) => arrow.id);
  const byId = new Map(level.arrows.map((arrow) => [arrow.id, arrow]));
  const list = units(level);
  const unitOf = new Map<string, number>();
  list.forEach((unit, index) => {
    for (const id of unit.memberIds) unitOf.set(id, index);
  });
  const edges: Array<Set<number>> = list.map(() => new Set<number>());
  let blocked = 0;
  for (const [index, unit] of list.entries()) {
    const outcome = probeUnit(level, remaining, byId, unit);
    if (!outcome.free) blocked += 1;
    for (const blockerId of outcome.blockers) {
      const target = unitOf.get(blockerId);
      if (target !== undefined && target !== index) edges[index].add(target);
    }
  }
  // Longest path in unit count: depth[node] = 1 + max(depth of its blockers),
  // in Kahn order from dependency-free units. Cycle leftovers keep depth 1 —
  // mutual blocking is unreachable in a validated level.
  const n = list.length;
  const depth = new Array<number>(n).fill(1);
  const inDegree = new Array<number>(n).fill(0);
  const dependents: number[][] = list.map(() => []);
  for (let from = 0; from < n; from += 1) {
    inDegree[from] = edges[from]!.size;
    for (const to of edges[from]) dependents[to]!.push(from);
  }
  const queue: number[] = [];
  for (let i = 0; i < n; i += 1) if (inDegree[i] === 0) queue.push(i);
  while (queue.length > 0) {
    const node = queue.pop() as number;
    for (const dependent of dependents[node] as number[]) {
      depth[dependent] = Math.max(depth[dependent], depth[node] + 1);
      inDegree[dependent] -= 1;
      if (inDegree[dependent] === 0) queue.push(dependent);
    }
  }
  let chain = 0;
  for (const value of depth) chain = Math.max(chain, value);
  let forced = 0;
  for (const edgeSet of edges) if (edgeSet.size > 0) forced += 1;
  return {
    chain,
    forcedShare: n === 0 ? 0 : forced / n,
    blockedShare: n === 0 ? 0 : blocked / n,
  };
}

/** Greedy peel depth: rounds of "remove everything movable" until clear. */
export function peelLayers(level: LevelDefinition): number {
  const remaining = new Set(level.arrows.map((arrow) => arrow.id));
  let rounds = 0;
  while (remaining.size > 0) {
    const board = {
      ...level,
      arrows: level.arrows.filter((arrow) => remaining.has(arrow.id)),
    };
    const byId = new Map(board.arrows.map((arrow) => [arrow.id, arrow]));
    const freeIds = new Set<string>();
    for (const unit of units(board)) {
      const outcome = probeUnit(board, [...byId.keys()], byId, unit);
      if (outcome.free) {
        for (const id of unit.memberIds) freeIds.add(id);
      }
    }
    if (freeIds.size === 0) break;
    for (const id of freeIds) remaining.delete(id);
    rounds += 1;
  }
  return rounds;
}

export function depthStats(level: LevelDefinition): DepthStats {
  return { ...chainStats(level), peel: peelLayers(level) };
}
```

- [ ] **Step 4: Run the test file**

Run: `bun test tests/difficulty.test.ts`
Expected: PASS — all five tests.

- [ ] **Step 5: Gate and commit**

```bash
make checkall
git add src/content/difficulty.ts tests/difficulty.test.ts
git commit -m "feat(difficulty): blocking-DAG depth metric"
```

### Task 2: Config curves, arrow ceiling, seed bump, fixture

**Files:**
- Modify: `src/content/procedural.ts` — `getLevelConfig` (~lines 213-232), `GENERATOR_VERSION` (line 57), the `runBlockerPass` loop guard (~line 3421)
- Create: `scripts/write-layout-fixture.ts`
- Modify: `tests/fixtures/v8-layouts.json` (regenerated)
- Modify: `tests/procedural.test.ts` (264 assertions at ~lines 164, 227, 308, 340)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MAX_GENERATED_ARROWS = 186` export from procedural; the v9 `getLevelConfig` formulas (`arrowCount = min(120, 36 + 2·id)`, `gridSize = min(18, 10 + ⌊id/4⌋)`); regenerated v9 fingerprints in the fixture.

- [ ] **Step 1: Update `getLevelConfig`**

Replace the `early`/`earlyGrid` tables and both formulas with:

```ts
export function getLevelConfig(id: number): LevelConfig {
  assertLevelId(id);
  if (isAuthoredLevel(id)) {
    return { gridSize: 4, arrowCount: 6, lives: 5, arrowScale: 1 };
  }
  const gridSize = Math.min(18, 10 + Math.floor(id / 4));
  return {
    gridSize,
    arrowCount: Math.min(120, 36 + 2 * id),
    lives: id <= 3 ? 5 : id <= 6 ? 4 : 3,
    arrowScale: gridSize / (id <= 3 ? 8 : id <= 6 ? 10 : 14),
  };
}
```

- [ ] **Step 2: Version bump and hard ceiling**

`GENERATOR_VERSION = 9` (line 57). Add next to it:

```ts
/** Absolute arrow ceiling: a level's fill target plus its blocker reserve. */
export const MAX_GENERATED_ARROWS = 186;
```

In `runBlockerPass`'s loop condition (currently `placed < reserve && arrows.length < 264 && attempt < reserve * 60`), replace `arrows.length < 264` with `arrows.length < MAX_GENERATED_ARROWS`.

- [ ] **Step 3: Update procedural.test.ts**

- Lines ~164, ~227, ~340: `expect(level.arrows.length).toBeLessThanOrEqual(264)` → `toBeLessThanOrEqual(MAX_GENERATED_ARROWS)` (add it to the existing procedural import).
- Line ~308: `expect(getLevelConfig(1_000_000).arrowCount).toBe(264)` → `.toBe(120)`.
- Add:

```ts
test("v9 config curves", () => {
  expect(getLevelConfig(2)).toEqual({
    gridSize: 10,
    arrowCount: 40,
    lives: 5,
    arrowScale: 10 / 8,
  });
  expect(getLevelConfig(12)).toEqual({
    gridSize: 13,
    arrowCount: 60,
    lives: 3,
    arrowScale: 13 / 14,
  });
  expect(getLevelConfig(40)).toEqual({
    gridSize: 18,
    arrowCount: 116,
    lives: 3,
    arrowScale: 18 / 14,
  });
  expect(getLevelConfig(52).arrowCount).toBe(120);
  expect(getLevelConfig(32).gridSize).toBe(18);
});
```

- [ ] **Step 4: Fixture writer script**

Create `scripts/write-layout-fixture.ts`:

```ts
import { writeFileSync } from "node:fs";
import { generateLevel } from "../src/content/procedural";
import { layoutFingerprint } from "../src/storage";

const baseline: Record<string, string> = {};
for (let id = 2; id <= 200; id += 1) {
  baseline[String(id)] = layoutFingerprint(generateLevel(id));
}
writeFileSync(
  new URL("../tests/fixtures/v8-layouts.json", import.meta.url),
  `${JSON.stringify(baseline, null, 2)}\n`,
);
```

- [ ] **Step 5: Regenerate and gate**

```bash
bun scripts/write-layout-fixture.ts
bun test tests/procedural.test.ts tests/flip-generation.test.ts tests/wormhole-generation.test.ts
make checkall
```

Expected: PASS. Ids 2–200 with the smaller cubes generate quickly; if the script runs long, time it and narrow the cause before changing anything.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(generator): v9 config curves, 120-arrow fill, 186 ceiling, seed bump"
```

### Task 3: Chain pass and depth gate in generateLevel

**Files:**
- Modify: `src/content/procedural.ts` — `generateLevel`; the chain pass inserts between the assembled-board blocker top-up (ending at current line 3641) and the strand gate (line 3642); the depth gate inserts after the "blockers" gate (`skip = "blockers"`, ending line 3659) and before the certificate build.

**Interfaces:**
- Consumes: `chainStats`, `depthTarget`, `CHAIN_TOLERANCE`, `SHARE_TOLERANCE` from `./difficulty` (Task 1); existing locals `statsBoard`, `arrows`, `occupied`, `candidate`, `targetLength`, `edgePolicies`, `rayExemptCells`, `ensureBlockerScaffold()`, `countShape`, `placeStops`, `assemble`, `validateLevel`, `wormholes`, `assembledStats`, `level`, `skip`.
- Produces: assembled levels meeting `depthTarget(id)` within tolerance; construction otherwise skips with `skip = "depth"`.

- [ ] **Step 1: Add the import**

Add to procedural.ts's content imports:

```ts
import {
  chainStats,
  depthTarget,
  CHAIN_TOLERANCE,
  SHARE_TOLERANCE,
} from "./difficulty";
```

- [ ] **Step 2: Insert the chain pass**

Between the assembled-board top-up block (whose last line is `assembledStats = blockedStats(statsBoard);`) and the strand gate:

```ts
        // Depth pass: deepen the blocking DAG toward depthTarget(id), the
        // way the blocker pass reaches its share target. A chain arrow is
        // accepted only when it lengthens the longest dependency path; it
        // lands after the circles were chosen, so the circles are re-chosen
        // and every score recomputed on the final arrow set, exactly like
        // the blocker top-up above.
        const depthGate = depthTarget(id);
        let depth = chainStats(statsBoard);
        if (
          depth.chain < depthGate.minChain ||
          depth.forcedShare < depthGate.minForced
        ) {
          const { groupRouteCells } = ensureBlockerScaffold();
          let chainPlaced = 0;
          for (
            let attempt = 0;
            attempt < 200 && arrows.length < MAX_GENERATED_ARROWS;
            attempt += 1
          ) {
            const path = candidate(
              rng,
              candidateLevel,
              occupied,
              Math.max(
                2,
                Math.floor(
                  targetLength(rng, id, config) *
                    (1 - edgePolicies.length * 0.05),
                ),
              ),
              rayExemptCells,
            );
            if (!path || shapeFull(path)) continue;
            if (path.some((cell) => groupRouteCells.has(cellKey(cell))))
              continue;
            const chainArrow: ArrowDefinition = {
              id: `r${id}-chain-${chainPlaced}`,
              path,
            };
            if (
              !validateLevel({ ...candidateLevel, arrows: [chainArrow] }).valid
            )
              continue;
            const trial = { ...statsBoard, arrows: [...arrows, chainArrow] };
            const after = chainStats(trial);
            if (after.chain <= depth.chain) continue;
            for (const cell of path) occupied.add(cellKey(cell));
            countShape(path);
            arrows.push(chainArrow);
            depth = after;
            chainPlaced += 1;
          }
          if (chainPlaced > 0) {
            level = assemble(placeStops());
            statsBoard =
              wormholes.length > 0 ? { ...level, wormholes: [] } : level;
            depth = chainStats(statsBoard);
            assembledStats = blockedStats(statsBoard);
          }
        }
```

- [ ] **Step 3: Insert the depth gate**

After the "blockers" gate (ending `skip = "blockers"; continue;`), before the `doubleIds`/certificate build:

```ts
        if (
          depth.chain < depthGate.minChain - CHAIN_TOLERANCE ||
          depth.forcedShare < depthGate.minForced - SHARE_TOLERANCE
        ) {
          skip = "depth";
          continue;
        }
```

- [ ] **Step 4: Regenerate the fixture and gate**

```bash
bun scripts/write-layout-fixture.ts
bun test tests/procedural.test.ts tests/flip-generation.test.ts tests/wormhole-generation.test.ts
make checkall
```

Some ids now take different layouts (chain arrows changed the boards) — that is expected. If a generation time-out or a systematic "depth" skip appears, report it rather than loosening the gate silently.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(generator): chain pass and depth gate (v9 depth difficulty)"
```

### Task 4: Depth sweep test

**Files:**
- Create: `tests/depth-generation.test.ts`

**Interfaces:**
- Consumes: `cachedLevel` from `./generated-levels`, `depthStats`/`depthTarget`/tolerances from `../src/content/difficulty`, `generateLevel`/`isAuthoredLevel` from `../src/content/procedural`, `layoutFingerprint` from `../src/storage`.
- Produces: the campaign-wide depth-gate guarantee.

- [ ] **Step 1: Write the sweep**

```ts
import { expect, test } from "bun:test";
import { cachedLevel } from "./generated-levels";
import {
  depthStats,
  depthTarget,
  CHAIN_TOLERANCE,
  SHARE_TOLERANCE,
} from "../src/content/difficulty";
import { generateLevel, isAuthoredLevel } from "../src/content/procedural";
import { layoutFingerprint } from "../src/storage";

test("every generated id 6-200 meets its depth gate within tolerance", () => {
  for (let id = 6; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    const stats = depthStats(level);
    const target = depthTarget(id);
    expect(stats.chain).toBeGreaterThanOrEqual(
      target.minChain - CHAIN_TOLERANCE,
    );
    expect(stats.forcedShare).toBeGreaterThanOrEqual(
      target.minForced - SHARE_TOLERANCE,
    );
  }
});

test("generation is deterministic", () => {
  expect(layoutFingerprint(generateLevel(40))).toBe(
    layoutFingerprint(generateLevel(40)),
  );
  expect(layoutFingerprint(generateLevel(120))).toBe(
    layoutFingerprint(generateLevel(120)),
  );
});
```

- [ ] **Step 2: Run**

Run: `bun test tests/depth-generation.test.ts`
Expected: PASS. If ids reject systematically, report — the gate curves or chain-pass budget need review, not a silent loosening. Then `make checkall`.

- [ ] **Step 3: Commit**

```bash
git add tests/depth-generation.test.ts
git commit -m "test(difficulty): campaign depth-gate sweep 6-200"
```

### Task 5: Browser-test re-derivation (pending-flip park case)

**Files:**
- Modify: `tests/flip-browser.ts` — the pending-flip park case (~lines 747-885: `levelId = 76`, arrow ids `r76-flip-relay-*`, driving coordinates, screenshot names)

**Interfaces:**
- Consumes: `generateLevel` for the candidate scan; `flipCoreIds` (public, procedural.ts:1703) for locating the flip core; `parksOnFlipSpot` (procedural.ts:1935, private) as the reference criterion to replicate.
- Produces: the pending-flip park browser case re-derived on the first suitable v9 cube.

- [ ] **Step 1: Scan for the new level**

Write a scratchpad script (do not commit it): for each id 31–200, load `generateLevel(id)`, require a flip core (`flipCoreIds(level.arrows)` non-empty), then probe each core arrow's parking moves for a settled path that still covers a flip spot cell (replicate `parksOnFlipSpot`'s criterion; it lives in procedural and shows the exact probe shape). Print the first suitable id with its flip-core arrow ids and the involved cells.

- [ ] **Step 2: Update the test**

Update `tests/flip-browser.ts` constants (`levelId`, `r<id>-flip-*` arrow ids, driving cells, screenshot file names) to the found cube. Keep the case's structure: park → reload → flip still pending → resume fires it.

- [ ] **Step 3: Run the focused suite**

Run: `FLIP_ONLY=1 make browser-test`
Expected: PASS. If no id 31–200 qualifies, stop and report — that would mean the v9 curves starve the park-on-flip case and need review, not the test.

- [ ] **Step 4: Commit**

```bash
git add tests/flip-browser.ts
git commit -m "test(flip): re-derive the pending-flip park case on v9 layouts"
```

### Task 6: Release docs and full gates

**Files:**
- Modify: `README.md` (~line 60: cap and curve sentence)
- Modify: `CLAUDE.md` — Generation section (curve, ceiling, depth-gate paragraph, the "264-arrow cap" warning paragraph), Tests section (add the difficulty and depth suites; the level-76 mention becomes the new id from Task 5)
- Modify: `docs/superpowers/specs/2026-09-26-depth-difficulty-design.md` (§4.2: core coupling emerges from the shared DAG through the chain pass, not a separate placement mechanism)

**Interfaces:**
- Consumes: final v9 layouts; Task 5's new level id.

- [ ] **Step 1: Docs**

README sentence: "Runtime-generated levels are deterministic reverse-constructed puzzles, growing from 40 to 120 arrows on faces up to 18 × 18 cells, paths up to 40 cells, a three-life floor, and a chain-depth gate that steepens through level 70."

CLAUDE.md updates, surgical:
- Generation section: replace the 180/264-arrow sentence with the 120 fill target and `MAX_GENERATED_ARROWS` (186) ceiling; add one paragraph on `depthTarget`, the chain pass on the blocker-pass machinery, and the `skip = "depth"` fallback; note wormhole boards are scored on the stripped board.
- Tests section: add the difficulty and depth-generation suites; update the level-76 mention to the new id.
- The "raising blockedTarget's curve … 264-arrow cap" warning: cap is now `MAX_GENERATED_ARROWS`; re-check the ceiling and generation time on any future curve raise.

- [ ] **Step 2: Full gates**

```bash
make checkall
FLIP_ONLY=1 make browser-test
WORMHOLE_ONLY=1 make browser-test
STOP_ONLY=1 make browser-test
OVERLAP_ONLY=1 make browser-test
DIRECTIONAL_ONLY=1 make browser-test
DOUBLE_ONLY=1 make browser-test
PWA_ONLY=1 make browser-test
```

Then one full `make browser-test` sweep on the machine with a headed browser.

- [ ] **Step 3: Manual calibration (spec §Testing)**

Report `depthStats` for levels 12, 40, and 90 (chain, forcedShare, blockedShare, peel) against their targets, and load each in the dev server (`make dev`, then `http://localhost:8057/?level=N`) to confirm the board reads well at the new densities. If level 40's felt difficulty is clearly below target (chain met only via tolerance, peel far under chain), surface that rather than shipping silently.

- [ ] **Step 4: Commit and close**

```bash
git add -A
git commit -m "docs: v9 depth difficulty release notes"
```

Then: rebase onto latest `main`, squash-merge to `main`, push (standing authorization), delete the branch, and remove the worktree.
