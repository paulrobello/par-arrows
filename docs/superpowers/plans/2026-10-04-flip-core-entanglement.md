# Flip-Core Entanglement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated flip cores (levels 31–200) participate in the dependency graph: blocker arrows sit on core lanes, blockers are themselves gated by fill arrows, and the flip dance interleaves with the board's opening moves instead of always firing first.

**Architecture:** The flip pass seeds 1–2 blocker arrows on designated core-lane cells (a new `:flip-block` stream), re-proving the interaction region per blocker. Entangled cores and blockers become `dependencyFill` graph nodes (per-arrow), the dance order becomes graph precedence edges, and the certificate drops the flip-lead prefix for entangled boards. Any failure falls back to the exact current isolated-core construction via the existing restart machinery.

**Tech Stack:** TypeScript, Bun, three.js (untouched), Playwright (headed browser suite).

**Spec:** `docs/superpowers/specs/2026-10-04-flip-core-entanglement-design.md`

## Global Constraints

- Bun is the toolchain — never `node`/`npm` (`bun test tests/<file>.test.ts`, `bun scripts/write-layout-fixture.ts`).
- Gate: `make checkall` while iterating, `make checkall-ci` before any done/push claim.
- `GENERATOR_VERSION` stays v10; new draws ride the new `:flip-block` stream name only, so non-flip ids must stay byte-identical.
- Authored ids (1, 5, 11, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60) are untouched; `flipBlockFrequency` returns 0 for them and below 31.
- Stop-circle budget, `getLevelConfig` arrow counts, depth-gate curves, and storage rules are unchanged.
- Commit after every task (atomic, descriptive, no co-author trailers). Push per batch after green — a push to `main` is the deploy (standing authorization in project CLAUDE.md).
- The full headed browser suite runs on a machine with a real display and WebGL; focused runs use `FLIP_ONLY=1 make browser-test`.

## Review Focus

1. **Restart determinism** — a level whose flip pass fell back to zero blockers must regenerate identically on a second `generateLevel(id)`; expect identical `layoutFingerprint`. Pinned in Task 6, Step 5.
2. **Mutual blocker cycles** — two blockers whose routes cross each other's bodies (or a blocker route crossing a core body) make a graph cycle; expect the existing `"Dependency fill input nodes contain a cycle."` throw → `skip = "fill-cycle"` restart, never a hang or an invalid level. Pinned in Task 3, Step 2, and structurally prevented by the ban rules in Task 4 (route cells avoid region cells and core bodies).
3. **Region overflow cascades** — fill bodies on blocker routes grow the region; at the cap of 10 the placement fails and the tier restarts into the isolated-core board. Generation time and later-core placement ratios must stay inside their budgets. Pinned in Task 8, Steps 2–4.
4. **Non-flip id drift** — any accidental shared-stream consumption re-rolls every level; expect the fixture diff to touch only flip-core ids. Pinned in Task 7, Step 2.
5. **Play-time solvability of entangled boards** — the merged certificate proves construction, but a player must still clear the level; expect `solveLevelTargets(level)` defined on every entangled id and the proven order to open with a non-core arrow. Pinned in Task 6, Step 1 and Task 9.

---

### Task 1: Region cap default 6 → 10

**Files:**
- Modify: `src/core/validation.ts:1285` (the `maxArrows = 6` default in `interactionRegion`)
- Test: `tests/flip.test.ts`

**Interfaces:**
- Consumes: `interactionRegion(level, seedArrowIds, maxArrows = 6)` — signature unchanged.
- Produces: default-closure regions up to 10 arrows; `interactionRegion(level, seeds, 6)` still overflows at 7+.

- [ ] **Step 1: Write the failing test**

Add to `tests/flip.test.ts` as a top-level `test` (the file imports `interactionRegion` from `../src/core/validation` and types from `../src/core/types`; extend imports if missing):

```ts
test("region closure absorbs a 7-arrow chain under the raised default cap", () => {
  // Arrow i occupies (2i, 0) and (2i + 1, 0) heading east, so its track
  // covers (2i + 2, 0) onward: arrow i + 1's whole body sits on arrow i's
  // track and closure joins all seven.
  const arrows: ArrowDefinition[] = Array.from({ length: 7 }, (_, i) => ({
    id: `chain-${i}`,
    path: [
      { face: "front", x: 2 * i, y: 0 },
      { face: "front", x: 2 * i + 1, y: 0 },
    ],
  }));
  const level = {
    id: "cap-probe",
    title: "cap probe",
    gridSize: 18,
    lives: 3,
    edgePolicies: [],
    arrows,
  } as LevelDefinition;
  const region = interactionRegion(level, ["chain-0"]);
  expect(region).toBeDefined();
  expect(region ? region.arrowIds.length : 0).toBe(7);
  // The explicit small cap still overflows.
  expect(interactionRegion(level, ["chain-0"], 6)).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/flip.test.ts -t "7-arrow chain"`
Expected: FAIL — the default-cap call returns `undefined` (7-arrow closure overflows 6).

- [ ] **Step 3: Raise the default**

In `src/core/validation.ts`, change the `interactionRegion` signature default (`:1285`):

```ts
export function interactionRegion(
  level: LevelDefinition,
  seedArrowIds: readonly string[],
  maxArrows = 10,
): InteractionRegion | undefined {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/flip.test.ts -t "7-arrow chain"`
Expected: PASS

- [ ] **Step 5: Run the affected suites**

Run: `bun test tests/flip.test.ts tests/region-generation.test.ts tests/rotor.test.ts`
Expected: PASS (regions of six or fewer arrows behave identically; the default only widens acceptance).

- [ ] **Step 6: Commit**

```bash
git add src/core/validation.ts tests/flip.test.ts
git commit -m "feat: interaction regions close up to ten arrows"
```

### Task 2: `flipBlockFrequency` curve

**Files:**
- Modify: `src/content/procedural.ts` (after `flipCorePlanned` at `:313`)
- Test: `tests/flip-generation.test.ts`

**Interfaces:**
- Consumes: `assertLevelId`, `isAuthoredLevel`, `FIRST_FLIP_LEVEL` — all in `procedural.ts`.
- Produces: `export function flipBlockFrequency(id: number): number` — 0 below 31 and on authored ids; 0.35 at 31 rising linearly to 0.70 at 90, holding after.

- [ ] **Step 1: Write the failing test**

In `tests/flip-generation.test.ts`, add to the existing `describe` and extend the `../src/content/procedural` import with `flipBlockFrequency`:

```ts
test("flip blocker frequency ramps from level 31 to 90", () => {
  expect(flipBlockFrequency(30)).toBe(0);
  expect(flipBlockFrequency(31)).toBeCloseTo(0.35);
  expect(flipBlockFrequency(60)).toBeCloseTo(0.522);
  expect(flipBlockFrequency(90)).toBeCloseTo(0.7);
  expect(flipBlockFrequency(120)).toBeCloseTo(0.7);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/flip-generation.test.ts -t "blocker frequency"`
Expected: FAIL — `flipBlockFrequency` is not exported.

- [ ] **Step 3: Implement the curve**

In `src/content/procedural.ts`, after `flipCorePlanned` (`:313`):

```ts
/** Probability that a placed flip core carries blocker arrows on its lanes. */
export function flipBlockFrequency(id: number): number {
  assertLevelId(id);
  if (id < FIRST_FLIP_LEVEL || isAuthoredLevel(id)) return 0;
  const progress = Math.min(
    1,
    (id - FIRST_FLIP_LEVEL) / (90 - FIRST_FLIP_LEVEL),
  );
  return 0.35 + 0.35 * progress;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/flip-generation.test.ts -t "blocker frequency"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content/procedural.ts tests/flip-generation.test.ts
git commit -m "feat: flip blocker frequency curve"
```

### Task 3: Precedence edges in `dependencyFill`

**Files:**
- Modify: `src/content/dependency-fill.ts` (`FillInput` at `:32`; edge wiring after the pre-existing-node loop at `:112-117`)
- Test: `tests/dependency-fill.test.ts`

**Interfaces:**
- Consumes: `FillInput`, `dependencyFill`, the internal `topological` throw.
- Produces: `FillInput.precedence?: readonly (readonly [string, string])[]` — `[beforeId, afterId]` pairs enforced as graph edges; unknown node ids throw `"Dependency fill precedence names an unknown node."`; cycles throw the existing `"Dependency fill input nodes contain a cycle."`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/dependency-fill.test.ts` (self-contained builder so the tests don't depend on the file's existing helpers; `Rng` imports from `../src/content/procedural` as `tests/mechanic-counts.test.ts` does):

```ts
function precedenceInput(
  nodes: readonly FillNode[],
  precedence: readonly (readonly [string, string])[],
): FillInput {
  return {
    level: { gridSize: 9, edgePolicies: [] },
    rng: new Rng(1234),
    idPrefix: "t-",
    firstIndex: 100,
    target: 0,
    attempts: 0,
    clearShare: 0,
    length: () => 3,
    nodes,
    precedence,
    leadBodies: new Set(),
    forbiddenBody: new Set(),
    forbiddenRay: new Set(),
    maxPathLength: 40,
    shapeFull: () => false,
    countShape: () => {},
    uncountShape: () => {},
  };
}

const stub = (id: string, x: number): FillNode => ({
  id,
  arrows: [{ id, path: [{ face: "front", x, y: 0 }] }],
  routeKeys: new Set<string>(),
});

test("precedence orders independent nodes", () => {
  const ids = dependencyFill(
    precedenceInput([stub("a", 0), stub("b", 3), stub("c", 6)], [
      ["c", "a"],
      ["a", "b"],
    ]),
  ).order.map((node) => node.id);
  expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("a"));
  expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
});

test("precedence cycle throws the fill-cycle error", () => {
  expect(() =>
    dependencyFill(
      precedenceInput([stub("a", 0), stub("b", 3)], [
        ["a", "b"],
        ["b", "a"],
      ]),
    ),
  ).toThrow("Dependency fill input nodes contain a cycle.");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/dependency-fill.test.ts -t "precedence"`
Expected: FAIL — TypeScript rejects `precedence` as an unknown `FillInput` field.

- [ ] **Step 3: Implement precedence**

In `src/content/dependency-fill.ts`:

1. `FillInput` gains one field after `nodes`:

```ts
readonly precedence?: readonly (readonly [string, string])[];
```

2. Track node indices and apply the pairs after the `input.nodes.forEach(...)` loop (`:112-117`):

```ts
const indices = new Map<string, number>();
```

Inside `addNode` (at `:96`), after `index` is computed:

```ts
if (!indices.has(node.id)) indices.set(node.id, index);
```

After the `forEach` loop:

```ts
for (const [beforeId, afterId] of input.precedence ?? []) {
  const before = indices.get(beforeId);
  const after = indices.get(afterId);
  if (before === undefined || after === undefined)
    throw new Error("Dependency fill precedence names an unknown node.");
  if (before !== after) succ[before]!.add(after);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/dependency-fill.test.ts`
Expected: PASS, including the file's existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/content/dependency-fill.ts tests/dependency-fill.test.ts
git commit -m "feat: dependency fill honors precedence pairs"
```

### Task 4: Blocker placement and dance capture in `flipCore`

**Files:**
- Modify: `src/content/procedural.ts` — marker constant near `FLIP_CORE_MARKER` (`:1815`), `FlipCore` interface (`:1942`), `flipCore` tail (`:2075-2091`), two new helpers after `flipCore`.
- Test: `tests/flip-generation.test.ts`

**Interfaces:**
- Consumes: `coreStream(id, name, restart)`, `arrowTrack`, `stepSurface`, `acceptFlipRegion`, `interactionRegion`, `regionCoreIds`, `solveLevelTargets`, `cellKey`, `inBounds` — all present in `procedural.ts`/`validation.ts`.
- Produces:
  - `const FLIP_BLOCK_MARKER = "-flipb-"` — deliberately not a substring match for `"-flip-"`, so `regionCoreIds` never seeds a blocker.
  - `FlipCore` gains `blockers: readonly ArrowDefinition[]` and `dance: readonly string[]`.
  - `function flipBlockers(id, restart, level, board, coreArrows, stops, regionCells, occupied, parkTracks, inBounds): { blockers, cells }`.
  - `function regionDanceOrder(level, spots, stops, placed): readonly string[]`.

- [ ] **Step 1: Write the failing integration test**

Add to `tests/flip-generation.test.ts` (the file already imports `flipCoreIds`, `cellKey`, `trackKeys`, `cachedLevel`, `isAuthoredLevel`, `planDraw`-equivalent via `fnv1a`; extend the procedural import with `flipBlockFrequency`):

```ts
test("entangled flip cores carry well-formed blockers on their lanes", () => {
  let found = 0;
  for (let id = 31; id <= 120; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    const cores = flipCoreIds(level.arrows);
    if (cores.length === 0) continue;
    if (planDraw(id, "flip-block") >= flipBlockFrequency(id)) continue;
    if (found >= 3) continue;
    const blockers = level.arrows.filter((arrow) =>
      arrow.id.includes("-flipb-"),
    );
    if (blockers.length === 0) continue; // legitimate fallback ids
    found += 1;
    expect(blockers.length).toBeLessThanOrEqual(2);
    const coreTrack = new Set(
      cores.flatMap((core) => [
        ...core.path.map(cellKey),
        ...trackKeys(level, core),
      ]),
    );
    for (const blocker of blockers) {
      expect(blocker.path.length).toBe(2);
      const onTrack = blocker.path.some((cell) => coreTrack.has(cellKey(cell)));
      expect(onTrack).toBe(true);
    }
  }
  expect(found).toBeGreaterThanOrEqual(3);
}, 300_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/flip-generation.test.ts -t "well-formed blockers"`
Expected: FAIL — no `-flipb-` arrows exist, so `found` stays 0.

- [ ] **Step 3: Implement**

All in `src/content/procedural.ts`.

Marker, next to `FLIP_CORE_MARKER` (`:1815`):

```ts
const FLIP_BLOCK_MARKER = "-flipb-";
```

`FlipCore` interface (`:1942`) gains:

```ts
/** Blockers seeded on core lanes; empty on an isolated core. */
readonly blockers: readonly ArrowDefinition[];
/** The region's proven dance order as consecutive arrow ids. */
readonly dance: readonly string[];
```

New helpers, placed after `flipCore` (`:2091`):

```ts
/**
 * Seed blocker arrows on the core's lanes. Each blocker is a two-cell arrow
 * whose tail covers a late track cell of some core arrow and whose head
 * points off the lane, so that core arrow cannot move until the blocker
 * leaves. Fill arrows may later land bodies on the blocker's own route,
 * gating it the same way. Every placement re-proves the interaction region
 * with the blockers as members — closure absorbs them — and a failed
 * re-proof keeps the proven prefix. The returned cells are the last
 * accepted region's cells.
 */
function flipBlockers(
  id: number,
  restart: number,
  level: LevelDefinition,
  board: LevelDefinition,
  coreArrows: readonly ArrowDefinition[],
  stops: readonly Cell[],
  regionCells: ReadonlySet<string>,
  occupied: ReadonlySet<string>,
  parkTracks: ReadonlySet<string>,
  inBounds: (cell: Cell) => boolean,
): { blockers: readonly ArrowDefinition[]; cells: ReadonlySet<string> } {
  const rng = coreStream(id, "flip-block", restart);
  if (flipBlockFrequency(id) === 0 || rng.next() >= flipBlockFrequency(id))
    return { blockers: [], cells: regionCells };
  const maxBlockers = id >= 60 && rng.next() < 0.3 ? 2 : 1;
  const size = level.gridSize;
  const spotKeys = new Set(
    (board.directionals ?? []).map((spot) => cellKey(spot.cell)),
  );
  const stopKeys = new Set([...(level.stops ?? []), ...stops].map(cellKey));
  const placed = [...level.arrows, ...coreArrows];
  const blockers: ArrowDefinition[] = [];
  let cells = regionCells;
  for (
    let attempt = 0;
    attempt < 6 && blockers.length < maxBlockers;
    attempt += 1
  ) {
    const owner = coreArrows[rng.int(coreArrows.length)] as ArrowDefinition;
    const track = arrowTrack(board, owner).slice(owner.path.length);
    const candidates = track.slice(Math.max(0, track.length - 4));
    if (candidates.length === 0) continue;
    const entangle = candidates[rng.int(candidates.length)] as Cell;
    const entangleKey = cellKey(entangle);
    // The entangle cell sits inside the region by definition; the blocker's
    // head and route cells must not, or a blocker route would cross a core
    // body and cycle the graph.
    const offLane = (cell: Cell): boolean => {
      const key = cellKey(cell);
      return (
        !inBounds(cell) ||
        occupied.has(key) ||
        parkTracks.has(key) ||
        spotKeys.has(key) ||
        stopKeys.has(key) ||
        regionCells.has(key)
      );
    };
    if (
      !inBounds(entangle) ||
      occupied.has(entangleKey) ||
      parkTracks.has(entangleKey) ||
      spotKeys.has(entangleKey) ||
      stopKeys.has(entangleKey)
    )
      continue;
    const trackKeysSet = new Set(track.map(cellKey));
    const options = (["east", "west", "south", "north"] as const)
      .map((heading) => ({
        heading,
        cell: stepSurface(entangle, heading, size),
      }))
      .filter(
        ({ cell }) =>
          !trackKeysSet.has(cellKey(cell)) && !offLane(cell),
      );
    if (options.length === 0) continue;
    const choice = options[rng.int(options.length)] as {
      heading: Heading;
      cell: Cell;
    };
    const blocker: ArrowDefinition = {
      id: `r${id}${FLIP_BLOCK_MARKER}${blockers.length}`,
      path: [entangle, choice.cell],
    };
    const bodyKeys = new Set(blocker.path.map(cellKey));
    const routeKeys = arrowTrack(board, blocker)
      .slice(blocker.path.length)
      .map(cellKey);
    if (
      routeKeys.some(
        (key) =>
          occupied.has(key) ||
          parkTracks.has(key) ||
          stopKeys.has(key) ||
          spotKeys.has(key) ||
          regionCells.has(key),
      )
    )
      continue;
    const verdict = acceptFlipRegion(
      level,
      [...placed, ...blockers, blocker],
      board.directionals,
      [...(level.stops ?? []), ...stops],
    );
    if (!verdict.ok) break;
    blockers.push(blocker);
    cells = verdict.cells;
  }
  return { blockers, cells };
}

/**
 * The proven dance order: solve the region on a board holding only its own
 * arrows and circles, exactly as `flipRegionLead` does, and keep the
 * consecutive arrow ids as fill-graph precedence constraints. Empty on a
 * failed derivation — the graph then falls back to body-blocker edges only.
 */
function regionDanceOrder(
  level: LevelDefinition,
  spots: readonly DirectionalSpotDefinition[],
  stops: readonly Cell[],
  placed: readonly ArrowDefinition[],
): readonly string[] {
  const seeds = regionCoreIds(placed);
  const probe: LevelDefinition = {
    ...level,
    arrows: [...placed],
    directionals: [...spots],
    ...(stops.length > 0 ? { stops } : {}),
  };
  const region = interactionRegion(probe, seeds);
  if (!region) return [];
  const regionStops = new Set(region.stopKeys);
  const regionStopsList = (probe.stops ?? []).filter((stop) =>
    regionStops.has(cellKey(stop)),
  );
  const sub: LevelDefinition = {
    ...probe,
    arrows: probe.arrows.filter((arrow) => region.arrowIds.includes(arrow.id)),
    ...(regionStopsList.length > 0 ? { stops: regionStopsList } : {}),
  };
  const targets = solveLevelTargets(sub);
  if (!targets) return [];
  const dance: string[] = [];
  for (const target of targets) {
    if (dance[dance.length - 1] !== target.arrowId) dance.push(target.arrowId);
  }
  return dance;
}
```

Rewire the `flipCore` tail (`:2080-2091`). The current block:

```ts
    const placed = [...level.arrows, ...arrows];
    for (const stops of planned) {
      const verdict = acceptFlipRegion(level, placed, board.directionals, [
        ...(level.stops ?? []),
        ...stops,
      ]);
      if (!verdict.ok) continue;
      return { arrows, spots, stops, cells: verdict.cells };
    }
  }
  return undefined;
}
```

becomes:

```ts
    const placed = [...level.arrows, ...arrows];
    for (const stops of planned) {
      const verdict = acceptFlipRegion(level, placed, board.directionals, [
        ...(level.stops ?? []),
        ...stops,
      ]);
      if (!verdict.ok) continue;
      const seeded = flipBlockers(
        id,
        restart,
        level,
        board,
        arrows,
        stops,
        verdict.cells,
        occupied,
        parkTracks,
        inBounds,
      );
      const dance = regionDanceOrder(level, board.directionals, stops, [
        ...placed,
        ...seeded.blockers,
      ]);
      return {
        arrows,
        spots,
        stops,
        cells: seeded.cells,
        blockers: seeded.blockers,
        dance,
      };
    }
  }
  return undefined;
}
```

If `board.directionals` is typed optional at this site, pass `board.directionals ?? []` in both new calls to match `acceptFlipRegion`'s array parameter.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/flip-generation.test.ts -t "well-formed blockers"`
Expected: PASS — at least three ids in 31–120 carry well-formed blockers.

- [ ] **Step 5: Run the flip suites**

Run: `bun test tests/flip.test.ts tests/flip-generation.test.ts tests/region-generation.test.ts`
Expected: the sweep test at `tests/flip-generation.test.ts:176` FAILS on the fixture comparison (flip-core fingerprints changed) — that is expected until Task 7 regenerates the fixture. Every other assertion must pass. If any non-fixture assertion fails, fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/content/procedural.ts tests/flip-generation.test.ts
git commit -m "feat: flip cores seed lane blockers with per-blocker region proofs"
```

### Task 5: Longer flip patterns

**Files:**
- Modify: `src/content/procedural.ts` (`FLIP_PATTERNS` at `:1676-1688` — the `name` union and the catalog array)
- Test: `tests/flip-generation.test.ts`

**Interfaces:**
- Consumes: the pattern frame conventions — 5×5 coordinates, spot at `(2, 2)`, arrows as ordered cell paths with the head last, rotation about the first spot handled by `flipCore`'s existing placement code.
- Produces: two new catalog entries `lane` and `weave` with 3–4 cell lanes; `FLIP_PATTERNS`' `name` union extended to `"gate" | "bounce" | "relay" | "relay2" | "lane" | "weave"`.

- [ ] **Step 1: Write the failing placement test**

Add to `tests/flip-generation.test.ts` (the file already imports `FLIP_PATTERNS` for the rotation test at `:42`; extend the import if missing):

```ts
test("every flip pattern places at least once over 31-200", () => {
  const placed = new Set<string>();
  for (let id = 31; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    for (const arrow of flipCoreIds(level.arrows)) {
      const match = /-flip-([a-z0-9]+)-/.exec(arrow.id);
      if (match?.[1]) placed.add(match[1] as string);
    }
  }
  for (const pattern of FLIP_PATTERNS)
    expect(placed.has(pattern.name)).toBe(true);
}, 600_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/flip-generation.test.ts -t "places at least once"`
Expected: FAIL — `lane` and `weave` do not exist yet, so the final loop throws on the first missing name.

- [ ] **Step 3: Add the entries**

Extend the `name` union at `:1677` and append two entries to the catalog array:

```ts
  {
    // A four-cell lane down the west edge gives the blocker seeding room;
    // the waiter frees the packer's exit, then everything unwinds.
    name: "lane",
    heading: "west",
    arrows: [
      {
        name: "packer",
        cells: [
          [0, 4],
          [0, 3],
          [0, 2],
          [0, 1],
        ],
      },
      {
        name: "waiter",
        cells: [
          [4, 3],
          [4, 2],
        ],
      },
      {
        name: "lid",
        cells: [
          [1, 4],
          [2, 4],
        ],
      },
    ],
  },
  {
    // The traverser bends through the spot; a four-cell runner must clear
    // before the bender's corridor is free.
    name: "weave",
    heading: "east",
    arrows: [
      {
        name: "traverser",
        cells: [
          [0, 2],
          [1, 2],
        ],
      },
      {
        name: "runner",
        cells: [
          [4, 0],
          [3, 0],
          [2, 0],
          [1, 0],
        ],
      },
      {
        name: "cap",
        cells: [
          [1, 4],
          [2, 4],
        ],
      },
    ],
  },
```

The rotation test at `:42` and the placement proofs are the oracle: if either new entry never places or fails a rotation property, adjust its cells until both pass — the geometry must satisfy the same single-pass and reach invariants as the existing entries.

- [ ] **Step 4: Run the pattern tests**

Run: `bun test tests/flip-generation.test.ts -t "pattern"`
Expected: PASS — the rotation test covers the new entries automatically, and each places at least once over 31–200.

- [ ] **Step 5: Commit**

```bash
git add src/content/procedural.ts tests/flip-generation.test.ts
git commit -m "feat: longer flip patterns with room for lane blockers"
```

### Task 6: `generateLevel` wiring — nodes, precedence, merged certificate

**Files:**
- Modify: `src/content/procedural.ts` — lead-set bookkeeping (`:4610-4627`), graph nodes (`:4704-4719`), fill call (`:4723-4747`), emission (`:4765-4769`), certificate (`:4978-5000`).
- Test: `tests/flip-generation.test.ts`

**Interfaces:**
- Consumes: `FlipCore.blockers`, `FlipCore.dance`, `FillInput.precedence` (Tasks 2–4).
- Produces: entangled ids emit flip arrows and blockers inside the fill's topological section, with the certificate replaying the merged order; non-entangled ids construct exactly as before. `solveLevelTargets` is already imported by the test file (the `:176` sweep uses it at `:235`).

- [ ] **Step 1: Write the failing test**

Add to `tests/flip-generation.test.ts`:

```ts
test("entangled boards open with the blocker chain, not the dance", () => {
  let checked = 0;
  for (let id = 31; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    const blockers = level.arrows.filter((arrow) =>
      arrow.id.includes("-flipb-"),
    );
    if (blockers.length === 0) continue;
    checked += 1;
    // A1: some core arrow carries a blocker prerequisite — the dance cannot
    // begin before a blocker move.
    const cores = flipCoreIds(level.arrows);
    const coreTrack = new Set(
      cores.flatMap((core) => [
        ...core.path.map(cellKey),
        ...trackKeys(level, core),
      ]),
    );
    expect(
      blockers.some((blocker) =>
        blocker.path.some((cell) => coreTrack.has(cellKey(cell))),
      ),
    ).toBe(true);
    // Review Focus 5: the board is clearable at play time.
    expect(solveLevelTargets(level)).toBeDefined();
  }
  expect(checked).toBeGreaterThanOrEqual(3);
}, 600_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/flip-generation.test.ts -t "blocker chain"`
Expected: FAIL on `solveLevelTargets` — the generator currently validates entangled boards with the flip lead prepended, which cannot replay while a chain arrow's body still blocks a blocker. (Task 4's test may also start failing on the fixture comparison — expected; Task 7 fixes the fixture.)

- [ ] **Step 3: Implement the wiring**

In `src/content/procedural.ts`:

1. Before the `leadIds` set (`:4610`):

```ts
const flipEntangled = (flip?.blockers.length ?? 0) > 0;
const flipIdSet = new Set((flip?.arrows ?? []).map((arrow) => arrow.id));
```

2. `leadIds` itself is **unchanged** — it still contains flip arrows, because `leadBodies` (`:4623`) and the lead-track `forbiddenBody` loop (`:4684`) must keep treating flip bodies and tracks as reserved (the entangle cell is occupied by the blocker, so the duplicate reservation is harmless). Define the reduced set for emission and certificate:

```ts
const emissionLeads = flipEntangled
  ? new Set([...leadIds].filter((arrowId) => !flipIdSet.has(arrowId)))
  : leadIds;
```

3. `graphNodes` (`:4704-4719`) gains flip and blocker nodes after the starter entries:

```ts
          ...(flipEntangled && flip
            ? [
                ...flip.arrows.map((arrow) => ({
                  id: arrow.id,
                  arrows: [arrow],
                  routeKeys: new Set(
                    flipHeadingProbes(leadBoard).flatMap((probe) =>
                      arrowTrack(probe, arrow)
                        .slice(arrow.path.length)
                        .map(cellKey),
                    ),
                  ),
                })),
                ...flip.blockers.map((arrow) => ({
                  id: arrow.id,
                  arrows: [arrow],
                  routeKeys: new Set(nodeRoute(arrow)),
                })),
              ]
            : []),
```

`flipHeadingProbes` is the validation helper the flip pass and sweep already use for under-every-flip-state tracks.

4. The `dependencyFill` call (`:4723-4747`) gains one field:

```ts
            precedence:
              flipEntangled && flip
                ? flip.dance
                    .slice(1)
                    .map(
                      (afterId, index): [string, string] =>
                        [flip.dance[index] as string, afterId],
                    )
                : undefined,
```

5. The emission (`:4765-4769`) uses the reduced lead set:

```ts
        const leads = arrows.filter((arrow) => emissionLeads.has(arrow.id));
```

(The `arrows.length = 0` rebuild and node push are unchanged; flip arrows and blockers arrive inside `fill.order` nodes exactly once.)

6. The certificate graph section (`:4990-4993`) uses the same reduced set:

```ts
          ...[...arrows]
            .reverse()
            .filter((arrow) => !emissionLeads.has(arrow.id))
            .map((arrow) => arrow.id),
```

7. The acceptance gate (`:4995-5000`) prepends the flip lead only on isolated-core boards:

```ts
        const accepted =
          flipLead !== undefined &&
          (tier.certificate
            ? validateGenerated(
                level,
                flipEntangled ? certificate : [...flipLead, ...certificate],
              )
            : validateLevel(level).valid &&
              solveLevelTargets(level) !== undefined);
```

`flipRegionLead(level)` at `:4972` remains the unconditional proof gate for both branches.

- [ ] **Step 4: Run the flip and fill suites**

Run: `bun test tests/flip.test.ts tests/flip-generation.test.ts tests/region-generation.test.ts tests/dependency-fill.test.ts`
Expected: the new test passes; the fixture-comparison sweep still fails (Task 7 fixes it); everything else green.

- [ ] **Step 5: Verify determinism of the entangled construction**

Run: `bun -e 'const { generateLevel } = await import("./src/content/procedural"); const { layoutFingerprint } = await import("./src/content/procedural"); let n = 0; for (let id = 31; id <= 90; id += 1) { const a = layoutFingerprint(generateLevel(id)); const b = layoutFingerprint(generateLevel(id)); if (a !== b) { console.log("NONDETERMINISTIC", id); process.exit(1); } n += 1; } console.log("deterministic over", n, "ids");'`
Expected: `deterministic over 60 ids` (Review Focus 1).

- [ ] **Step 6: Commit**

```bash
git add src/content/procedural.ts tests/flip-generation.test.ts
git commit -m "feat: entangled flip cores join the dependency graph"
```

### Task 7: Fixture regeneration and parity

**Files:**
- Regenerate: `tests/fixtures/v8-layouts.json` via `bun scripts/write-layout-fixture.ts`
- Test: `tests/flip-generation.test.ts` (the sweep at `:176` — assertions only, no pin changes needed: it compares against the fixture file, which this task refreshes)

**Interfaces:**
- Consumes: the finished generator (Tasks 1–6).
- Produces: committed fixture whose flip-core ids carry the new fingerprints and whose every other id is byte-identical to HEAD's fixture.

- [ ] **Step 1: Regenerate the fixture**

Run: `bun scripts/write-layout-fixture.ts`
Expected: completes without throwing (a throw means some id fails to construct — fix forward before continuing).

- [ ] **Step 2: Verify the churn shape**

Run: `git diff --stat tests/fixtures/v8-layouts.json` and then compare id keys:

```bash
git show HEAD:tests/fixtures/v8-layouts.json > /tmp/fixture-old.json
bun -e '
  const old = JSON.parse(await Bun.file("/tmp/fixture-old.json").text());
  const next = JSON.parse(await Bun.file("tests/fixtures/v8-layouts.json").text());
  const flipped = Object.keys(next).filter((id) => next[id] !== old[id]);
  console.log("changed ids:", flipped.length);
  await Bun.write("/tmp/fixture-changed.json", JSON.stringify(flipped));
'
```

Then, for each changed id, confirm a flip core is present:

```bash
bun -e '
  const changed = JSON.parse(await Bun.file("/tmp/fixture-changed.json").text());
  const { generateLevel, flipCoreIds } = await import("./src/content/procedural");
  const unexplained = [];
  for (const id of changed.map(Number)) {
    if (!flipCoreIds(generateLevel(id).arrows).length) unexplained.push(id);
  }
  console.log("changed ids without a flip core:", unexplained.join(",") || "none");
'
```

Expected: `changed ids without a flip core: none` (Review Focus 4 — no non-flip id drifted). If any unexplained id appears, stop and diagnose before committing.

- [ ] **Step 3: Run the full fixture sweep**

Run: `bun test tests/flip-generation.test.ts tests/region-generation.test.ts tests/wormhole-generation.test.ts tests/depth-generation.test.ts`
Expected: PASS — every level matches the refreshed fixture; region proofs hold on the enlarged (entangled) regions.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/v8-layouts.json
git commit -m "test: refresh layout fixtures for entangled flip cores"
```

### Task 8: Sweep pins — entangle share and structure

**Files:**
- Test: `tests/mechanic-counts.test.ts`, `tests/flip-generation.test.ts`

**Interfaces:**
- Consumes: `planDraw` (`fnv1a` + `Rng`, already in `mechanic-counts.test.ts`), `flipBlockFrequency` (Task 2), `cachedLevel`.
- Produces: the A2 share pin and the completion of the A1/A3 sweep assertions.

- [ ] **Step 1: Add the share pin**

In `tests/mechanic-counts.test.ts` (imports: `flipBlockFrequency`, `flipCoreIds`, `cachedLevel`, `isAuthoredLevel`, and the file's existing `planDraw`):

```ts
// The blocker plan places on its own stream; a planned core falls back to
// zero blockers only on a failed re-proof. Measured share over 31-200 must
// stay within the standing 10% band of the shipped value.
test("flip blocker share tracks its plan curve", () => {
  let planned = 0;
  let entangled = 0;
  for (let id = 31; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    if (flipCoreIds(level.arrows).length === 0) continue;
    if (planDraw(id, "flip-block") >= flipBlockFrequency(id)) continue;
    planned += 1;
    if (level.arrows.some((arrow) => arrow.id.includes("-flipb-")))
      entangled += 1;
  }
  expect(planned).toBeGreaterThan(30);
  expect(entangled / planned).toBeGreaterThan(0.7);
});
```

- [ ] **Step 2: Run the share pin and calibrate the floor**

Run: `bun test tests/mechanic-counts.test.ts -t "blocker share"`
Expected: PASS. If the measured share is at or below 0.7, print it (`bun -e` loop mirroring the test) and either fix the fallback rate or lower the floor to `measured − 0.1` — recording the measured number in the test comment like the existing shipped-ratio pins.

- [ ] **Step 3: Extend the fixture sweep with entangle assertions**

In `tests/flip-generation.test.ts`, inside the `:176` sweep after the existing `solveLevelTargets` assertion (`:235`), add:

```ts
      const blockers = level.arrows.filter((arrow) =>
        arrow.id.includes("-flipb-"),
      );
      if (blockers.length > 0) {
        // Closure must have absorbed the blockers and their chain.
        expect(region.arrowIds).toEqual(
          expect.arrayContaining(blockers.map((b) => b.id)),
        );
        // A1: the dance is gated behind a blocker on some core lane.
        const coreTrack = new Set(
          core.flatMap((arrow) => [
            ...arrow.path.map(cellKey),
            ...trackKeys(level, arrow),
          ]),
        );
        expect(
          blockers.some((blocker) =>
            blocker.path.some((cell) => coreTrack.has(cellKey(cell))),
          ),
        ).toBe(true);
      }
```

- [ ] **Step 4: Run the full unit gate**

Run: `make checkall`
Expected: PASS. If a mechanic-counts ratio moved beyond its 10% band (Review Focus 3 — blocker reach fencing later cores), diagnose the coupling before touching pins: the failing ratio is a gate, not a tuning note.

- [ ] **Step 5: Commit**

```bash
git add tests/mechanic-counts.test.ts tests/flip-generation.test.ts
git commit -m "test: pin flip blocker share and entangled-region structure"
```

### Task 9: Browser verification

**Files:**
- Modify: `tests/flip-browser.ts` (new exported function next to `assertRegionPark` at `:753`) and its call site in the flip section of `tests/browser-runner.ts` (where the other generated-level flip checks run, in both the full sweep and the `FLIP_ONLY` block at `:1128-1139`).

**Interfaces:**
- Consumes: `openCampaignLevel`, `state`, `activate`, `changedPixels`-free helpers already in `flip-browser.ts`; `cachedLevel`, `flipCoreIds`, `solveLevelTargets` imports.
- Produces: `assertEntangledCore(page: Page): Promise<void>` — A6/A7 evidence in the real engine.

- [ ] **Step 1: Add the browser check**

In `tests/flip-browser.ts`, after `assertRegionPark`, add (the runner invokes it like the other generated-level checks; mirror `assertRegionPark`'s completion assertion — celebration or zero remaining arrows via `state(page)`):

```ts
export async function assertEntangledCore(page: Page): Promise<void> {
  let target = 0;
  for (let id = 31; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    if (
      flipCoreIds(level.arrows).length > 0 &&
      level.arrows.some((arrow) => arrow.id.includes("-flipb-"))
    ) {
      target = id;
      break;
    }
  }
  expect(target).toBeGreaterThan(0);
  const level = cachedLevel(target);
  const targets = solveLevelTargets(level) ?? [];
  expect(targets.length).toBeGreaterThan(0);
  // The proven order opens with a blocker-chain move, never a core arrow.
  expect(flipCoreIds(level.arrows)).not.toContain(targets[0]?.arrowId);
  await openCampaignLevel(page, target);
  // Clear half, reload, confirm progress survived, then finish.
  const half = Math.ceil(targets.length / 2);
  for (let index = 0; index < half; index += 1) {
    await activate(page, (targets[index] as MoveTarget).arrowId);
  }
  await page.reload();
  await openCampaignLevel(page, target);
  const mid = await state(page);
  expect(mid.cleared ?? mid.remaining).toBeDefined(); // mirror assertRegionPark's persistence check
  for (let index = half; index < targets.length; index += 1) {
    await activate(page, (targets[index] as MoveTarget).arrowId);
  }
  const done = await state(page);
  expect(done.remaining ?? 0).toBe(0); // mirror assertRegionPark's completion assertion
}
```

Before finalizing, replace the three commented assertions with exactly the field names `assertRegionPark` uses for progress persistence and completion (`state(page)` shape), so the check matches the suite's conventions.

- [ ] **Step 2: Wire the runner**

In `tests/browser-runner.ts`, call `assertEntangledCore(page)` in the flip section alongside `assertRegionPark`'s call, in both the full sweep and the `FLIP_ONLY` block (`:1128-1139`). Import it with the existing `assertFlipIntro` import (`:33`).

- [ ] **Step 3: Run the focused suite**

Run: `FLIP_ONLY=1 make browser-test`
Expected: PASS — builds, serves on 8058, and clears the first entangled cube in its proven order, including the mid-level reload.

- [ ] **Step 4: Commit**

```bash
git add tests/flip-browser.ts tests/browser-runner.ts
git commit -m "test: clear an entangled flip cube in the browser suite"
```

### Task 10: Docs and ship

**Files:**
- Modify: `CLAUDE.md` (flip sections), `docs/superpowers/specs/2026-10-04-flip-core-entanglement-design.md` (status line)

- [ ] **Step 1: Update CLAUDE.md**

Surgically update the flip-mechanic documentation to describe: the `:flip-block` stream and `flipBlockFrequency` curve (0.35 at 31 → 0.70 at 90 holding, second blocker coin 0.3 from level 60); blockers as two-cell `-flipb-` arrows whose tails sit on late core-lane cells with heads off the lane; per-blocker region re-proofs and the proven-prefix fallback; entangled cores as per-arrow fill nodes with `dance` precedence pairs and the merged certificate (no flip-lead prepend); the region cap at 10; and the new test pins (share floor in `mechanic-counts`, entangle assertions in `flip-generation`, `assertEntangledCore` in the browser suite). Add the changelog line to the Tests section listing the new coverage.

- [ ] **Step 2: Update the spec status**

In the spec header, change `Status: Approved design (A1), pending implementation plan` to `Status: Implemented` and commit with the docs.

- [ ] **Step 3: Full gate**

Run: `make checkall-ci`
Expected: PASS.

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-04-flip-core-entanglement-design.md
git commit -m "docs: flip-core entanglement"
```

- [ ] **Step 5: Full headed browser sweep**

Run: `make browser-test`
Expected: PASS (the full sweep; the generator re-roll rot check — any stale pin names the level it moved on).

- [ ] **Step 6: Push**

```bash
git push
```

Then confirm CI: `gh run watch` or `gh run list --repo paulrobello/par-arrows --limit 2` shows Checks and Pages green for the pushed commits; fix forward if not.
