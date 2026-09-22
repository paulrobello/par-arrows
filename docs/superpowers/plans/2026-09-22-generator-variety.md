# Generator Variety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give generated par-arrows cubes deliberate multi-bend spot chains, a seven-pattern park catalog, and a targeted rising blocked-arrow share past level 10.

**Architecture:** All changes live in the deterministic generator (`src/content/procedural.ts`). Chains extend `extraDirectionalSpots` to re-walk post-bend tracks and prefer corridor cells, gated by a pure depth function. The park catalog gains three patterns whose placements stay proven by the core-only certificate replay. A blocker pass adds arrows whose bodies cross earlier arrows' head routes (safe by reverse-construction: blockers lead the certificate), and an acceptance gate enforces a share target per level id. `GENERATOR_VERSION` bumps 5 → 6 so levels ≥ 12 rebuild under new seeds and existing saves refresh through the existing attempt-refresh path.

**Tech Stack:** TypeScript, Bun (`bun test`), three-tier tiered construction with seeded RNG streams (`Rng`, `hashSeed`, `coreStream`).

**Spec:** `docs/superpowers/specs/2026-09-22-generator-variety-design.md`

## Global Constraints

- Bun only: `bun test tests/<file>.test.ts` to run one file; `make checkall` is the full gate (format-check, lint, typecheck, test, build, icons-check). Never `node`.
- Byte-identity guarantee: levels 1–10 and the authored ids 5, 11, 15, 20 must stay byte-identical across every task. The pinned geometry hashes for ids 2, 3, 4, 10 in `tests/procedural.test.ts` must stay green at every commit.
- All new choices ride existing seeded streams (`:dir-cells`, `park-core` with restart salting) or pure functions of the level id. No `Math.random`, no wall clock.
- Commits: atomic per task, imperative subject, no co-author trailer. Work on a worktree (`EnterWorktree`); run `bun install --frozen-lockfile` after creating it (fresh worktrees omit `node_modules/`).
- If `make checkall` fails on `.impeccable/hook.cache.json` formatting, reformat that cache file — do not touch source.

## Review Focus

- Chain depth boundary (ids 20/21/39/40): a traverser must never take more bends than `chainDepthLimit(id)` allows, including as an incidental traverser of a spot placed for another arrow. Pinned by the `spot chains respect the depth gate` test (Task 3).
- First blocked-target levels (12–14): generation must still total-degrade (never throw) while meeting share ≥ target − 0.06 in certificate tiers. Pinned by the `blocked share rises` test (Task 4).
- Overlap cubes (16–19) with blockers: `validateLevel` must stay valid — a blocker body must never cross a shared-tail member's travel route. Pinned by the `blockers never cross shared-tail routes` test (Task 4).
- Authored and early ids (≤ 10, 5/11/15/20): byte-identical geometry. Pinned by the existing hash assertions plus the restored 12/13/14 pins (Tasks 2 and 5).
- Heavily blocked circle levels vs. the solver: `solveLevel` must still finish via the greedy park-prefixed replay inside `SOLVER_NODE_BUDGET`. Pinned by the existing `every generated circle level requires parking` test re-run on the v6 sample (Task 4).

---

### Task 1: Pure helpers — `chainDepthLimit`, `blockedTarget`, `blockerReserve`, `blockedStats`

**Files:**
- Modify: `src/content/procedural.ts` (add four exported pure functions; no call sites yet)
- Test: `tests/generator-variety.test.ts` (create)

**Interfaces:**
- Consumes: `assertLevelId`, `getLevelConfig`, `overlappingArrowIds`, `simulateMove` (all already in `procedural.ts`'s scope).
- Produces (later tasks rely on these exact signatures):
  - `chainDepthLimit(id: number): 1 | 2 | 3`
  - `blockedTarget(id: number): number`
  - `blockerReserve(id: number): number`
  - `blockedStats(level: LevelDefinition): { blocked: number; total: number }`

- [ ] **Step 1: Write the failing tests**

Create `tests/generator-variety.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  blockedStats,
  blockedTarget,
  blockerReserve,
  chainDepthLimit,
} from "../src/content/procedural";
import type { ArrowDefinition, LevelDefinition } from "../src/core/types";

function frontArrow(
  id: string,
  cells: readonly (readonly [number, number])[],
): ArrowDefinition {
  return {
    id,
    path: cells.map(([x, y]) => ({ face: "front" as const, x, y })),
  };
}

function plainLevel(arrows: readonly ArrowDefinition[]): LevelDefinition {
  return { id: 100, title: "test", gridSize: 12, lives: 3, arrows };
}

describe("generator variety helpers", () => {
  test("chain depth gate is 1 before 21, 2 through 39, and 3 from 40", () => {
    for (const id of [1, 5, 11, 15, 19, 20]) expect(chainDepthLimit(id)).toBe(1);
    for (const id of [21, 22, 30, 39]) expect(chainDepthLimit(id)).toBe(2);
    for (const id of [40, 41, 60, 1_000_000]) expect(chainDepthLimit(id)).toBe(3);
  });

  test("blocked target is zero through authored levels and ramps 0.30 to 0.55", () => {
    for (const id of [1, 2, 9, 10, 11, 15, 20]) expect(blockedTarget(id)).toBe(0);
    expect(blockedTarget(12)).toBeCloseTo(0.3);
    expect(blockedTarget(24)).toBeCloseTo(0.3625);
    expect(blockedTarget(36)).toBeCloseTo(0.425);
    expect(blockedTarget(60)).toBeCloseTo(0.55);
    expect(blockedTarget(1_000)).toBeCloseTo(0.55);
  });

  test("blocker reserve scales the target over the level's arrow budget", () => {
    expect(blockerReserve(10)).toBe(0);
    for (const id of [11, 15, 20]) expect(blockerReserve(id)).toBe(0);
    expect(blockerReserve(12)).toBe(56); // ceil(0.30 * 186)
    expect(blockerReserve(60)).toBe(146); // ceil(0.55 * 264)
  });

  test("blockedStats counts tap units once and groups as one unit", () => {
    // straight's southward body runs into pair's head cell from above, so
    // straight is blocked while pair exits east unimpeded.
    const pair = frontArrow("pair-a", [
      [0, 0],
      [1, 0],
    ]);
    const straight = frontArrow("straight", [
      [1, 3],
      [1, 2],
    ]);
    const solo = plainLevel([pair, straight]);
    expect(blockedStats(solo)).toEqual({ blocked: 1, total: 2 });

    // pair-b shares pair-a's directed prefix, so both become one tap unit;
    // the group exits east (siblings ignore each other) and only straight
    // is blocked — two units, one blocked, proves the group counted once.
    const pairB = frontArrow("pair-b", [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const grouped = plainLevel([pairB, pair, straight]);
    expect(blockedStats(grouped)).toEqual({ blocked: 1, total: 2 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/generator-variety.test.ts`
Expected: FAIL — the four imports do not exist yet.

- [ ] **Step 3: Implement the helpers in `src/content/procedural.ts`**

Add after `getLevelConfig` (around line 189):

```ts
export interface BlockedStats {
  readonly blocked: number;
  readonly total: number;
}

/**
 * Tap units (a single arrow or one shared-tail group) whose immediate move at
 * the level's initial state is blocked. The denominator counts every unit.
 */
export function blockedStats(level: LevelDefinition): BlockedStats {
  const remaining = level.arrows.map((arrow) => arrow.id);
  const counted = new Set<string>();
  let blocked = 0;
  let total = 0;
  for (const arrow of level.arrows) {
    if (counted.has(arrow.id)) continue;
    for (const memberId of overlappingArrowIds(level, arrow.id)) {
      counted.add(memberId);
    }
    total += 1;
    if (simulateMove(level, remaining, arrow.id).kind === "blocked") {
      blocked += 1;
    }
  }
  return { blocked, total };
}

/**
 * Share of tap units that start blocked: 0 through the authored teaching ids,
 * then 0.30 at level 12 rising linearly to 0.55 at level 60 and holding.
 */
export function blockedTarget(id: number): number {
  assertLevelId(id);
  if (id <= 10 || id === 11 || id === 15 || id === 20) return 0;
  const progress = Math.min(1, (id - 12) / 48);
  return Math.min(0.55, 0.3 + 0.25 * progress);
}

/** Extra arrows the blocker pass may spend toward the blocked target. */
export function blockerReserve(id: number): number {
  assertLevelId(id);
  return Math.ceil(blockedTarget(id) * getLevelConfig(id).arrowCount);
}
```

Add near `FIRST_DIRECTIONAL_LEVEL` (around line 1060):

```ts
/**
 * How many directional spots one traverser may bend through: single-bend
 * cubes before the chain ramp opens a second bend at level 21 and a third at
 * level 40.
 */
export function chainDepthLimit(id: number): 1 | 2 | 3 {
  assertLevelId(id);
  if (id < FIRST_DIRECTIONAL_LEVEL) return 1;
  if (id < 40) return 2;
  return 3;
}
```

Note: `chainDepthLimit` must appear *after* the `FIRST_DIRECTIONAL_LEVEL` constant declaration in the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/generator-variety.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Gate and commit**

Run: `make checkall` — expected green (pure additions, no call sites, so all existing pins hold).

```bash
git add src/content/procedural.ts tests/generator-variety.test.ts
git commit -m "Add blocked-target, blocker-reserve, and chain-depth helpers"
```

---

### Task 2: Park catalog to seven patterns, `GENERATOR_VERSION` 6, pin updates

**Files:**
- Modify: `src/content/procedural.ts` — `GENERATOR_VERSION`, `PARK_PATTERNS`, `PARK_FOLLOWER_IDS`, `ParkingCore`, `parkingCore`, `generateLevel` certificate build
- Modify: `tests/procedural.test.ts:102` (version), `tests/procedural.test.ts:123-131` (12/13/14 hashes), `tests/procedural.test.ts:241` (seed template), `tests/procedural.test.ts:487-488` (shape set)
- Modify: `tests/directional-content.test.ts:141` (carrier count)
- Test: `tests/generator-variety.test.ts` (append pattern unit tests)

**Interfaces:**
- Consumes: existing `ParkDelta`, `PARK_CERTIFICATE_PREFIX`, `patternCell`, `replayCertificate`, `exitRay`, `headingForPath`.
- Produces:
  - `PARK_PATTERNS` exported (read-only data) with optional `second` unit.
  - `ParkingCore` becomes `{ arrows; stops; parkLegs: readonly string[] }` (drops `parkerId`). Task 4's `generateLevel` edits rely on `core.parkLegs`.

- [ ] **Step 1: Write the failing pattern tests**

Append to `tests/generator-variety.test.ts`:

```ts
import { PARK_PATTERNS } from "../src/content/procedural";
import { solveLevel, validateLevel } from "../src/core/validation";
import type { Cell } from "../src/core/types";

function patternLevel(pattern: (typeof PARK_PATTERNS)[number]): LevelDefinition {
  const build = (
    deltas: readonly { readonly dx: number; readonly dy: number }[],
    id: string,
  ): ArrowDefinition => ({
    id,
    path: deltas.map(({ dx, dy }) => ({ face: "front" as const, x: 2 + dx, y: 2 + dy })),
  });
  const arrows = [
    build(pattern.parker, "p"),
    ...pattern.others.map((deltas, index) => build(deltas, `f${index}`)),
    ...(pattern.second
      ? [
          build(pattern.second.parker, "q"),
          ...pattern.second.others.map((deltas, index) => build(deltas, `g${index}`)),
        ]
      : []),
  ];
  const stops = [...pattern.stops, ...(pattern.second?.stops ?? [])].map(
    ({ dx, dy }): Cell => ({ face: "front", x: 2 + dx, y: 2 + dy }),
  );
  return { id: 100, title: "pattern", gridSize: 14, lives: 3, arrows, stops };
}

describe("park pattern catalog", () => {
  test("carries the four legacy shapes plus twist, crossfire, and twin", () => {
    expect(PARK_PATTERNS.map((pattern) => pattern.name).sort()).toEqual([
      "cascade",
      "classic",
      "crossfire",
      "double",
      "long",
      "twin",
      "twist",
    ]);
    for (const pattern of PARK_PATTERNS) {
      const circles = pattern.stops.length + (pattern.second?.stops.length ?? 0);
      expect(circles).toBeLessThanOrEqual(3);
    }
  });

  test("every pattern solves by parking and is deadlocked without circles", () => {
    for (const pattern of PARK_PATTERNS) {
      const level = patternLevel(pattern);
      expect(validateLevel(level).valid, pattern.name).toBe(true);
      expect(solveLevel(level), pattern.name).toBeDefined();
      expect(solveLevel({ ...level, stops: [] }), pattern.name).toBeUndefined();
    }
  });
});
```

Add the imports the snippet needs at the top of the file (merge with Task 1 imports).

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/generator-variety.test.ts`
Expected: FAIL — `PARK_PATTERNS` is not exported / has four entries.

- [ ] **Step 3: Extend the catalog and generalize `parkingCore`**

In `src/content/procedural.ts`:

a) Set `export const GENERATOR_VERSION = 6;` (line 27).

b) Add after the `PARK_PATTERNS` type's existing declaration base — change the type to allow an optional second unit and append three patterns. Replace the array literal's closing `];` (after the `double` entry, line 907) so the full declaration becomes:

```ts
const PARK_PATTERNS: readonly {
  readonly name: string;
  readonly parker: readonly ParkDelta[];
  readonly stops: readonly ParkDelta[];
  readonly others: readonly (readonly ParkDelta[])[];
  /** Optional second independent deadlock: another parker with its own circle and followers. */
  readonly second?: {
    readonly parker: readonly ParkDelta[];
    readonly stops: readonly ParkDelta[];
    readonly others: readonly (readonly ParkDelta[])[];
  };
}[] = [
  // ...the existing four entries (classic, long, cascade, double) UNCHANGED...
  {
    name: "twist",
    parker: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    stops: [{ dx: 2, dy: 0 }],
    others: [
      [
        { dx: 3, dy: 0 },
        { dx: 3, dy: 1 },
        { dx: 2, dy: 1 },
        { dx: 1, dy: 1 },
      ],
      [
        { dx: 2, dy: 2 },
        { dx: 1, dy: 2 },
        { dx: 0, dy: 2 },
        { dx: 0, dy: 1 },
      ],
    ],
  },
  {
    name: "crossfire",
    parker: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    stops: [{ dx: 2, dy: 0 }],
    others: [
      [
        { dx: 6, dy: 0 },
        { dx: 6, dy: 1 },
        { dx: 5, dy: 1 },
      ],
      [
        { dx: 4, dy: 1 },
        { dx: 3, dy: 1 },
        { dx: 2, dy: 1 },
      ],
      [
        { dx: 1, dy: 2 },
        { dx: 1, dy: 1 },
        { dx: 0, dy: 1 },
      ],
    ],
  },
  {
    name: "twin",
    parker: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    stops: [{ dx: 2, dy: 0 }],
    others: [
      [
        { dx: 3, dy: 0 },
        { dx: 3, dy: 1 },
        { dx: 2, dy: 1 },
        { dx: 1, dy: 1 },
      ],
      [
        { dx: 0, dy: 2 },
        { dx: 0, dy: 1 },
      ],
    ],
    second: {
      parker: [
        { dx: 0, dy: 4 },
        { dx: 1, dy: 4 },
      ],
      stops: [{ dx: 2, dy: 4 }],
      others: [
        [
          { dx: 3, dy: 4 },
          { dx: 3, dy: 5 },
          { dx: 2, dy: 5 },
          { dx: 1, dy: 5 },
        ],
        [
          { dx: 0, dy: 6 },
          { dx: 0, dy: 5 },
        ],
      ],
    },
  },
];

/** Ids for the non-parker core arrows, in pattern order. */
const PARK_FOLLOWER_IDS = ["park-b", "park-f", "park-g", "park-h"] as const;

/** Patterns ids <= 10 draw from, so their layouts stay byte-identical. */
const LEGACY_PARK_PATTERN_COUNT = 4;
```

Export the catalog for tests: change the declaration to `export const PARK_PATTERNS: ...`. Keep the existing doc comment above the array and extend its pattern list with twist (L-shaped freed lane), crossfire (five arrows, interleaved unwind), twin (two one-circle deadlocks, two different parkers).

c) Rewrite `ParkingCore` and `parkingCore` (replacing lines 914-1040):

```ts
interface ParkingCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly stops: readonly Cell[];
  /** Certificate park entries, one per circle, naming each circle's parker. */
  readonly parkLegs: readonly string[];
}
```

Inside `parkingCore`, keep the signature and the attempt loop; change only the setup and the certificate:

```ts
  const size = level.gridSize;
  const rng = coreStream(id, "park-core", restart);
  const catalog =
    id <= 10
      ? PARK_PATTERNS.slice(0, LEGACY_PARK_PATTERN_COUNT)
      : PARK_PATTERNS;
  const patternCost = (pattern: (typeof PARK_PATTERNS)[number]): number =>
    pattern.stops.length + (pattern.second?.stops.length ?? 0);
  const eligible = catalog.filter((pattern) => patternCost(pattern) <= stopCount);
  const pattern = eligible[
    rng.int(eligible.length)
  ] as (typeof PARK_PATTERNS)[number];
  const faces = shuffledFaces(rng);
  const units = [
    { parker: pattern.parker, stops: pattern.stops, others: pattern.others },
    ...(pattern.second
      ? [
          {
            parker: pattern.second.parker,
            stops: pattern.second.stops,
            others: pattern.second.others,
          },
        ]
      : []),
  ];
  const parkerIds = units.map((_, index) =>
    index === 0 ? `r${id}-park-p` : `r${id}-park-q`,
  );
```

In the attempt loop replace the path building with:

```ts
    const parkerPaths = units.map((unit) =>
      unit.parker.map(({ dx, dy }) => patternCell(base, dx, dy, rotation)),
    );
    const followerPaths = units.flatMap((unit) =>
      unit.others.map((deltas) =>
        deltas.map(({ dx, dy }) => patternCell(base, dx, dy, rotation)),
      ),
    );
    const stops = units.flatMap((unit) =>
      unit.stops.map(({ dx, dy }) => patternCell(base, dx, dy, rotation)),
    );
```

and the arrows/certificate with:

```ts
    const arrows: ArrowDefinition[] = [
      ...parkerPaths.map((path, index) => ({
        id: parkerIds[index] as string,
        path,
      })),
      ...followerPaths.map((path, index) => ({
        id: `r${id}-${PARK_FOLLOWER_IDS[index]}`,
        path,
      })),
    ];
    if (!arrows.every((arrow) => rayClear(arrow.path))) continue;
    const coreLevel: LevelDefinition = { ...level, arrows, stops };
    const parkLegs = units.flatMap((unit, index) =>
      Array.from(
        { length: unit.stops.length },
        () => `${PARK_CERTIFICATE_PREFIX}${parkerIds[index]}`,
      ),
    );
    const certificate = [
      ...parkLegs,
      ...[...arrows].reverse().map((arrow) => arrow.id),
    ];
    if (!replayCertificate(coreLevel, certificate)) continue;
    return { arrows, stops, parkLegs };
  }
  return undefined;
}
```

Delete the old `parkerId` constant line (`const parkerId = \`r${id}-park-p\`;`) — the id now lives in `parkerIds`.

d) In `generateLevel`, replace the certificate's park-leg build (lines 1717-1720):

```ts
        const certificate = [
          ...(core ? core.parkLegs : []),
          ...(directionalSpot
            ? directionalSpot.arrows.map((arrow) => arrow.id)
            : []),
          ...[...arrows].reverse().map((arrow) => arrow.id),
        ];
```

The RNG draw sequence inside `parkingCore` is unchanged for ids ≤ 10 (same catalog slice length, same draw order), so their layouts stay byte-identical.

- [ ] **Step 4: Run the variety tests**

Run: `bun test tests/generator-variety.test.ts`
Expected: PASS — all seven patterns validate, solve with parking, and are deadlocked without circles.

- [ ] **Step 5: Update the version-shifted pins in `tests/procedural.test.ts`**

a) Line 102: `expect(GENERATOR_VERSION).toBe(6);`

b) Delete the three hash expectations for ids 12, 13, 14 (lines 123-131). Keep ids 2, 3, 4, 10 pinned exactly as they are. (Task 5 restores 12/13/14 with final v6 hashes.)

c) Line 241: change the seed template to

```ts
      expect(seedForLevel(id)).toBe(
        `par-arrows:runtime:${id <= 4 ? 1 : id <= 10 ? 4 : 6}:level:${id}`,
      );
```

d) Line 488 (shape set): print the new deterministic set, then pin it.

Run:
```bash
bun -e 'import { generateLevel } from "./src/content/procedural";
const shapes = new Set();
for (let id = 6; id <= 40; id++) {
  const level = generateLevel(id);
  if (!(level.stops ?? []).length) continue;
  const parkArrows = level.arrows.filter((a) => a.id.includes("-park-"));
  shapes.add(`${parkArrows.length}:${parkArrows.reduce((n, a) => n + a.path.length, 0)}`);
}
console.log([...shapes].sort());'
```
Replace the expected array at line 488 with the printed sorted list (it must contain the legacy `["3:10", "3:11", "3:8", "4:9"]` plus the new crossfire `4:11` and twin `6:16` shapes when eligible cubes appear in 12-40). Update the comment above it listing which shape belongs to which pattern.

e) `tests/directional-content.test.ts:141` — the carrier count over ids 21-60 shifts with the v6 `:dir-plan` rolls. Print and pin:

```bash
bun -e 'import { hasDirectionalCore } from "./src/content/procedural";
let carriers = 0;
for (let id = 21; id <= 60; id++) if (hasDirectionalCore(id)) carriers++;
console.log(carriers);'
```
Replace `expect(carriers).toBe(31);` with the printed number.

- [ ] **Step 6: Run the full unit suite**

Run: `bun test`
Expected: PASS. Levels 2/3/4/10 hashes unchanged proves the ≤ 10 byte-identity. If any *other* test asserts a stale ≥ 12 layout detail (e.g., exact spot counts on a specific id), update that assertion to the v6 value the same way — print via a `bun -e` script, pin the printed value, and note the update in the commit body.

- [ ] **Step 7: Gate and commit**

Run: `make checkall` — expected green.

```bash
git add src/content/procedural.ts tests/procedural.test.ts tests/directional-content.test.ts tests/generator-variety.test.ts
git commit -m "Grow the park catalog to seven patterns and bump the generator to v6"
```

---

### Task 3: Chain-aware extra spot placement (multi-bend)

**Files:**
- Modify: `src/content/procedural.ts` — rewrite `extraDirectionalSpots` (lines 1204-1301)
- Test: `tests/generator-variety.test.ts` (append)

**Interfaces:**
- Consumes: `chainDepthLimit` (Task 1), `arrowTrack`, `spotHeadingAt` (via `arrowTrack`'s level), `headingForPath`, `PERPENDICULAR`, `simulateMove`, `parkTrackKeys`/`cellsBefore` logic already in the function.
- Produces: same signature `extraDirectionalSpots(id, level, arrows, occupied, plan, coreFace): readonly DirectionalSpotDefinition[]`. No caller changes.

- [ ] **Step 1: Write the failing chain tests**

Append to `tests/generator-variety.test.ts`:

```ts
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import { generateLevel } from "../src/content/procedural";

function maximumBends(level: LevelDefinition): number {
  const spotCells = new Set(
    (level.directionals ?? []).map((spot) => cellKey(spot.cell)),
  );
  let maximum = 0;
  for (const arrow of level.arrows) {
    let bends = 0;
    for (const cell of arrowTrack(level, arrow)) {
      if (spotCells.has(cellKey(cell))) bends += 1;
    }
    maximum = Math.max(maximum, bends);
  }
  return maximum;
}

describe("spot chains", () => {
  test("bends respect the depth gate and chains appear on both ramp bands", () => {
    let depthTwo = 0;
    for (let id = 21; id <= 39; id += 1) {
      const level = generateLevel(id);
      if ((level.directionals ?? []).length === 0) continue;
      const bends = maximumBends(level);
      expect(bends).toBeLessThanOrEqual(2);
      if (bends >= 2) depthTwo += 1;
    }
    expect(depthTwo).toBeGreaterThan(0);
    let depthThree = 0;
    for (let id = 40; id <= 58; id += 1) {
      const level = generateLevel(id);
      if ((level.directionals ?? []).length === 0) continue;
      const bends = maximumBends(level);
      expect(bends).toBeLessThanOrEqual(3);
      if (bends >= 3) depthThree += 1;
    }
    expect(depthThree).toBeGreaterThan(0);
  }, 180_000);

  test("chain cubes still require their spots to clear", () => {
    for (const id of [21, 22, 23, 24, 25]) {
      const level = generateLevel(id);
      if ((level.directionals ?? []).length === 0) continue;
      expect(solveLevel({ ...level, directionals: [] })).toBeUndefined();
    }
  }, 60_000);
});
```

(Reuses `solveLevel` imported in Task 2's step.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/generator-variety.test.ts`
Expected: the depth-band test FAILS — every spot cube today bends at most once (`maximumBends` ≤ 1), so `depthTwo` stays 0.

- [ ] **Step 3: Rewrite `extraDirectionalSpots`**

Replace the whole function body (keeping the signature and the doc comment, extended to mention chains) with:

```ts
function extraDirectionalSpots(
  id: number,
  level: LevelDefinition,
  arrows: readonly ArrowDefinition[],
  occupied: Set<string>,
  plan: readonly ExtraSpotPlanEntry[],
  coreFace: FaceId | undefined,
): readonly DirectionalSpotDefinition[] {
  const limit = chainDepthLimit(id);
  const parkTrackKeys = new Set<string>();
  for (const arrow of arrows) {
    if (!arrow.id.startsWith(`r${id}-park-`)) continue;
    for (const cell of arrowTrack(level, arrow)) {
      parkTrackKeys.add(cellKey(cell));
    }
  }
  const cellsBefore: Set<string>[] = [];
  let running = new Set<string>();
  for (const arrow of arrows) {
    cellsBefore.push(running);
    running = new Set([...running, ...arrow.path.map(cellKey)]);
  }
  const spots: DirectionalSpotDefinition[] = [];
  const rng = new Rng(hashSeed(`${seedForLevel(id)}:dir-cells`));
  for (const { face, count } of plan) {
    const room = count - (coreFace === face ? 1 : 0);
    for (let placed = 0; placed < room; placed += 1) {
      const spotLevel: LevelDefinition = {
        ...level,
        ...(spots.length > 0
          ? { directionals: [...(level.directionals ?? []), ...spots] }
          : {}),
      };
      // Candidates from the post-spot tracks, each tagged with how many bends
      // its first traverser has already taken before the cell.
      const pool = new Map<
        string,
        {
          cell: Cell;
          heading: Heading;
          traversers: number[];
          depths: number[];
        }
      >();
      const spotCells = new Set(
        (spotLevel.directionals ?? []).map((spot) => cellKey(spot.cell)),
      );
      for (let index = 0; index < arrows.length; index += 1) {
        const arrow = arrows[index] as ArrowDefinition;
        if (arrow.id.startsWith(`r${id}-park-`)) continue;
        const track = arrowTrack(spotLevel, arrow);
        let bends = 0;
        for (let step = 1; step < track.length; step += 1) {
          const cell = track[step] as Cell;
          if (spotCells.has(cellKey(cell))) bends += 1;
          if (cell.face !== face) continue;
          const key = cellKey(cell);
          if (occupied.has(key) || parkTrackKeys.has(key)) continue;
          const heading = headingForPath(
            [track[step - 1] as Cell, cell],
            level.gridSize,
          );
          if (!heading) continue;
          const entry = pool.get(key) ?? {
            cell,
            heading,
            traversers: [],
            depths: [],
          };
          entry.traversers.push(index);
          entry.depths.push(bends);
          pool.set(key, entry);
        }
      }
      if (pool.size === 0) break;
      const entries = [...pool.values()];
      const shuffle = (list: typeof entries): typeof entries => {
        for (let index = list.length - 1; index > 0; index -= 1) {
          const replacement = rng.int(index + 1);
          const current = list[index] as (typeof entries)[number];
          list[index] = list[replacement] as typeof current;
          list[replacement] = current;
        }
        return list;
      };
      // Chain candidates first: corridor cells past an already-placed bend,
      // and only while every traverser stays inside the depth budget.
      const chained = entries.filter(
        (entry) =>
          entry.depths.some((depth) => depth >= 1) &&
          Math.max(...entry.depths) + 1 <= limit,
      );
      const plain = entries.filter((entry) => entry.depths.every((depth) => depth === 0));
      let accepted = false;
      for (const { cell, heading, traversers } of [...shuffle(chained), ...shuffle(plain)]) {
        const key = cellKey(cell);
        if (occupied.has(key)) continue;
        const turn = PERPENDICULAR[heading][rng.int(2)] as Heading;
        const trial: LevelDefinition = {
          ...spotLevel,
          directionals: [...(spotLevel.directionals ?? []), { cell, heading: turn }],
        };
        let fits = true;
        for (const traverser of traversers) {
          const alone = simulateMove(
            trial,
            [arrows[traverser]!!.id],
            arrows[traverser]!!.id,
          );
          if (alone.kind !== "exit") {
            fits = false;
            break;
          }
          const blocked = alone.route.some(
            (routeCell) =>
              parkTrackKeys.has(cellKey(routeCell)) ||
              cellsBefore[traverser]!!.has(cellKey(routeCell)),
          );
          if (blocked) {
            fits = false;
            break;
          }
        }
        if (!fits) continue;
        occupied.add(key);
        spots.push({ cell, heading: turn });
        accepted = true;
        break;
      }
      if (!accepted) break;
    }
  }
  return spots;
}
```

The `:dir-cells` rng draw sequence changes for spot cubes — expected, because those ids rebuild under v6 seeds anyway.

- [ ] **Step 4: Run the chain tests**

Run: `bun test tests/generator-variety.test.ts`
Expected: PASS. If `depthTwo`/`depthThree` is still 0 on the sampled windows (geometrically starved), widen the window (21-39 → 21-45, 40-58 → 40-70) after confirming with:

```bash
bun -e 'import { generateLevel } from "./src/content/procedural";
import { arrowTrack } from "./src/core/stops";
import { cellKey } from "./src/core/topology";
const bends = (level) => {
  const spots = new Set((level.directionals ?? []).map((s) => cellKey(s.cell)));
  let m = 0;
  for (const a of level.arrows) {
    let b = 0;
    for (const c of arrowTrack(level, a)) if (spots.has(cellKey(c))) b++;
    m = Math.max(m, b);
  }
  return m;
};
for (const [lo, hi] of [[21, 39], [40, 58]]) {
  let deep = 0, seen = 0;
  for (let id = lo; id <= hi; id++) {
    const l = generateLevel(id);
    if (!(l.directionals ?? []).length) continue;
    seen++;
    if (bends(l) >= (lo === 21 ? 2 : 3)) deep++;
  }
  console.log(lo, hi, "cubes", seen, "deep", deep);
}'
```

- [ ] **Step 5: Run the full unit suite and gate**

Run: `bun test` then `make checkall` — expected green (the existing directional content tests already assert required-use on ids 21-30, which the chain rewrite must not break).

- [ ] **Step 6: Commit**

```bash
git add src/content/procedural.ts tests/generator-variety.test.ts
git commit -m "Let generated spots chain into deliberate multi-bend routes"
```

---

### Task 4: Blocker pass and the blocked-share acceptance gate

**Files:**
- Modify: `src/content/procedural.ts` — `generateLevel` (tier list, fill-loop bound, blocker pass, gate)
- Modify: `tests/procedural.test.ts:259` (exact-count expectation)
- Test: `tests/generator-variety.test.ts` (append)

**Interfaces:**
- Consumes: `blockedStats`, `blockedTarget`, `blockerReserve` (Task 1), `candidate`, `targetLength`, `overlappingArrowIds`, `arrowTrack`.
- Produces: no new exports. `generateLevel` output for ids ≥ 12 gains `r<id>-block-<n>` arrows.

- [ ] **Step 1: Write the failing tests**

Append to `tests/generator-variety.test.ts` (`validateLevel` is already imported from Task 2):

```ts
describe("blocked push", () => {
  test("share meets the target curve from level twelve onward", () => {
    for (const id of [12, 18, 30, 45, 80]) {
      const level = generateLevel(id);
      const stats = blockedStats(level);
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.blocked / stats.total).toBeGreaterThanOrEqual(
        blockedTarget(id) - 0.06,
      );
    }
  }, 180_000);

  test("blockers keep overlap cubes structurally valid", () => {
    for (const id of [16, 17, 18, 19]) {
      const level = generateLevel(id);
      expect(validateLevel(level).valid).toBe(true);
      expect(level.arrows.some((arrow) => arrow.id.includes("-block-"))).toBe(
        true,
      );
    }
  }, 120_000);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/generator-variety.test.ts`
Expected: FAIL — no blockers exist yet, so shares sit at today's emergent level and `-block-` ids are absent.

- [ ] **Step 3: Wire the pass into `generateLevel`**

In `src/content/procedural.ts`'s `generateLevel`:

a) Compute the reserve before the tier list and lower the tier floors (replacing lines 1449-1453):

```ts
  const reserve = blockerReserve(id);
  const tiers = [
    { minArrows: config.arrowCount - reserve, certificate: true },
    { minArrows: config.arrowCount - reserve - 12, certificate: true },
    { minArrows: config.arrowCount - reserve - 12, certificate: false },
  ];
```

b) Change the main fill loop's count bound (line 1640):

```ts
        for (
          let attempt = 0;
          arrows.length < config.arrowCount - reserve &&
          attempt < config.arrowCount * 900;
          attempt += 1
        ) {
```

c) Insert the blocker pass immediately after the fill loop's closing brace and before the `if (arrows.length < tier.minArrows)` check:

```ts
        let blockedUnits = 0;
        let totalUnits = 0;
        if (reserve > 0) {
          // Shared-tail members may never have another arrow on their travel
          // route, so blockers avoid every group member's solo route.
          const groupRouteCells = new Set<string>();
          for (const arrow of arrows) {
            const group = overlappingArrowIds(candidateLevel, arrow.id);
            if (group.length < 2) continue;
            for (const memberId of group) {
              const route = simulateMove(
                { ...candidateLevel, arrows },
                [memberId],
                memberId,
              );
              for (const cell of route.route) {
                groupRouteCells.add(cellKey(cell));
              }
            }
          }
          const aheadKeys = arrows.map((arrow) =>
            arrowTrack(candidateLevel, arrow)
              .slice(arrow.path.length)
              .map(cellKey),
          );
          const initial = blockedStats({ ...candidateLevel, arrows });
          blockedUnits = initial.blocked;
          totalUnits = initial.total;
          let placed = 0;
          for (
            let attempt = 0;
            placed < reserve && attempt < reserve * 60;
            attempt += 1
          ) {
            if (
              totalUnits > 0 &&
              blockedUnits / totalUnits >= blockedTarget(id) - 0.06
            )
              break;
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
              directional ? dirCells : undefined,
            );
            if (!path) continue;
            if (
              path.some((cell) => groupRouteCells.has(cellKey(cell)))
            )
              continue;
            const blocker: ArrowDefinition = {
              id: `r${id}-block-${placed}`,
              path,
            };
            if (
              !validateLevel({ ...candidateLevel, arrows: [blocker] }).valid
            )
              continue;
            const pathKeys = new Set(path.map(cellKey));
            const affected: number[] = [];
            aheadKeys.forEach((keys, index) => {
              if (keys.some((key) => pathKeys.has(key))) affected.push(index);
            });
            if (affected.length === 0) continue;
            const blockedAmong = (board: readonly ArrowDefinition[]): number =>
              affected.filter((index) =>
                simulateMove(
                  { ...candidateLevel, arrows: board },
                  board.map((entry) => entry.id),
                  arrows[index]!!.id,
                ).kind === "blocked",
              ).length;
            const before = blockedAmong(arrows);
            const after = blockedAmong([...arrows, blocker]);
            if (after <= before) continue;
            for (const cell of path) occupied.add(cellKey(cell));
            arrows.push(blocker);
            aheadKeys.push(
              arrowTrack(candidateLevel, blocker)
                .slice(blocker.path.length)
                .map(cellKey),
            );
            blockedUnits += after - before;
            totalUnits += 1;
            placed += 1;
          }
        }
```

d) Replace the count/acceptance check (lines 1667-1670) with:

```ts
        if (arrows.length < tier.minArrows) {
          skip = "count";
          continue;
        }
        const share = totalUnits > 0 ? blockedUnits / totalUnits : 0;
        if (tier.certificate && share < blockedTarget(id) - 0.06) {
          skip = "blockers";
          continue;
        }
```

(The final tier has `certificate: false`, so it accepts an under-target level — generation stays total.)

Safety argument for the certificate: blockers place last, `candidate()` guarantees each blocker's own exit ray avoids everything placed before it, and reverse construction drives last-placed-first — so blockers always lead the replay while their rays are clear. Adding occupancy can only ever turn an exiting arrow blocked, never the reverse, so the incremental `blockedUnits` accounting is exact.

- [ ] **Step 4: Update the exact-count expectation**

`tests/procedural.test.ts` line 259 — replace

```ts
      expect(level.arrows.length).toBe(getLevelConfig(id).arrowCount);
```

with

```ts
      expect(level.arrows.length).toBeGreaterThanOrEqual(
        getLevelConfig(id).arrowCount - blockerReserve(id),
      );
```

and import `blockerReserve` in that file's import list. Adjust the comment above it: tier-one floors drop by the blocker reserve, so a count below the floor still means a relaxed tier fired.

- [ ] **Step 5: Run the tests**

Run: `bun test tests/generator-variety.test.ts` then `bun test`
Expected: PASS. If the share test fails for a sampled id (its deterministic construction cannot reach target − 0.06 in the certificate tiers and degraded), print the achieved share:

```bash
bun -e 'import { generateLevel, blockedStats, blockedTarget } from "./src/content/procedural";
for (const id of [12, 18, 30, 45, 80]) {
  const s = blockedStats(generateLevel(id));
  console.log(id, s.blocked / s.total, "target", blockedTarget(id));
}'
```

If a share landed below target − 0.06 only because the final no-certificate tier accepted it after every strict restart failed, that is the documented degradation: raise `SOLVER_NODE_BUDGET` is NOT the fix — instead inspect the skip reason distribution by adding a temporary `console.log(skip)` in the tier loop, widen the pass's attempt budget (`reserve * 60` → `reserve * 120`), and re-run. Only relax the tolerance if strict construction provably cannot reach it across ids 12-80; note any relaxation in the commit body.

- [ ] **Step 6: Gate and commit**

Run: `make checkall` — expected green.

```bash
git add src/content/procedural.ts tests/procedural.test.ts tests/generator-variety.test.ts
git commit -m "Target a rising blocked-arrow share past level ten"
```

---

### Task 5: Final pins, docs, browser suites

**Files:**
- Modify: `tests/procedural.test.ts` (restore 12/13/14 hash pins)
- Modify: `CLAUDE.md` (generator, stop, and directional sections)
- Modify: `README.md` (storage/migration note)

**Interfaces:**
- Consumes: the finished generator from Tasks 2-4.
- Produces: documentation consistent with shipped behavior; final v6 hash pins.

- [ ] **Step 1: Restore the 12/13/14 hash pins**

Print the final v6 hashes:

```bash
bun -e 'import { createHash } from "node:crypto";
import { generateLevel } from "./src/content/procedural";
const h = (level) => createHash("sha256").update(JSON.stringify({
  id: level.id, gridSize: level.gridSize, lives: level.lives,
  arrowScale: level.arrowScale, arrows: level.arrows,
  ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
})).digest("hex");
for (const id of [12, 13, 14]) console.log(id, h(generateLevel(id)));'
```

Re-add three expectations in `preserves geometry through level four...` after the id-10 hash, using the printed values.

- [ ] **Step 2: Update CLAUDE.md**

In `### Generation and seeds` and the directional/stop implementation paragraphs, correct these claims to match shipped behavior:

- "generated cubes from level 12 up use generator v5 seeds (`GENERATOR_VERSION`, `seedForLevel`, `MAX_LEVEL_ID`)" → v6, and note that v6 adds the blocked-share target (30% at level 12 rising linearly to 55% at level 60), enforced by a blocker pass whose arrows place last and lead the reverse certificate; final-tier degradation accepts under-target cubes rather than throwing.
- The park-catalog sentence "a dedicated `:park-core` seeded stream, and the core geometry proves the requirement" section: the catalog is now seven patterns — the level-5 classic, a long-lane stretch, a four-arrow cascade, and a two-circle double park, plus twist (L-shaped freed lane), crossfire (five arrows, interleaved unwind), and twin (two one-circle deadlocks needing two different parkers); ids ≤ 10 keep drawing from the original four so their layouts stay byte-identical.
- The directional paragraph: from level 21 one traverser may bend through two spots and from level 40 through three (`chainDepthLimit`), with chains emerging from chain-first candidate ordering in `extraDirectionalSpots`.
- The seed-lineage list: "generated cubes from level 12 up use generator v6 seeds".

- [ ] **Step 3: Update README.md**

Find the storage/migration section (grep `CONTENT_VERSION` / "migration") and extend the existing note: generator v6 seeds mean attempts from level 12 onward refresh to the new layouts while preserving level, unlocks, and tutorial completion; no `CONTENT_VERSION` bump is needed (the seed match drives the refresh).

- [ ] **Step 4: Full gate and focused browser suites**

Run: `make checkall` — expected green.
Run: `STOP_ONLY=1 make browser-test` — expected green (headed browser; needs a real display and WebGL).
Run: `DIRECTIONAL_ONLY=1 make browser-test` — expected green.
Run: `OVERLAP_ONLY=1 make browser-test` — expected green.

- [ ] **Step 5: Commit**

```bash
git add tests/procedural.test.ts CLAUDE.md README.md
git commit -m "Pin v6 layouts and document chains, park patterns, and blocked targets"
```

Then merge the worktree back: rebase onto latest `main`, squash-merge per the Git Workflow, delete the branch, remove the worktree, and push to `main` (the standing deploy trigger). Confirm the pushed Actions run passes `make checkall`.
