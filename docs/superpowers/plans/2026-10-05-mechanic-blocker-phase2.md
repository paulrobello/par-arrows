# Mechanic Blocker Entanglement Phase 2+ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend blocker entanglement from flip to the remaining six mechanics — rotor (phase 2), then wormhole, fragile, lock, mirror, leap (phase 3) — so every mechanic core participates in the dependency graph instead of firing as an isolated opening vignette.

**Architecture:** Parameterize the proven flip machinery by mechanic: the region blocker seeder gains a rotor kind, and a new per-lane seeder covers the five certificate-led cores, feeding a generalized entangled-mechanics loop in `generateLevel` (graph nodes, precedence from each mechanic's certificate array, per-mechanic lead-set exclusion, summed arrow-count budget). Blocker routes stay reserved (the I1 errata); the fallback ladder and plan-zero parity are unchanged.

**Tech Stack:** TypeScript, Bun, three.js (untouched), Playwright (headed browser suite).

**Spec:** `docs/superpowers/specs/2026-10-05-mechanic-blocker-phase2-design.md`

## Global Constraints

- Bun is the toolchain — never `node`/`npm`. Gate: `make checkall` iterating, `make checkall-ci` before any done/push claim.
- `GENERATOR_VERSION` stays v10; new draws ride per-mechanic stream names (`:rotor-block`, `:wormhole-block`, `:fragile-block`, `:lock-block`, `:mirror-block`, `:leap-block`), so ids without an entangled core of a shipped mechanic must stay byte-identical.
- One new marker `-xblock-` for all new blockers (ids `r<id>-xblock-<mech><n>`). Before finalizing, verify it is not a substring-collision risk with any `*CoreIds` matcher by grepping the marker constants in `procedural.ts` (`-flip-`, `-rotor-`, `-fragile-`, `-lock-`, `-mirror-`, `-leap-`, and the wormhole marker — grep `wormholeCore`'s id template).
- Authored ids untouched (every curve returns 0 below the mechanic's first level and on authored ids).
- Blocker routes stay reserved: every entangled blocker's track keys join both `forbiddenBody` and `forbiddenRay` (the I1 errata — no fill-gating chain).
- Blockers spend the level's exact arrow count: the `prefilled` arithmetic sums every entangled mechanic's blockers.
- Commit per task (atomic, descriptive, no co-author trailers). Fixture sweeps are intentionally red between a mechanic shipping and the fixture task — `SKIP=project-checks` commits are acceptable mid-plan (targeted tests + tsc must pass); the final task's gates run without skip. Push per batch after green (standing authorization).
- The full headed browser suite runs on a machine with a real display; focused runs use the per-mechanic `*_ONLY` env vars where they exist, else the full sweep.

## Review Focus

1. **Determinism under cumulative restarts** — six mechanics' fallback ladders interact on one board; a second `generateLevel(id)` must regenerate identically. Pinned by the determinism probe in the fixture task.
2. **Marker collisions** — `-xblock-` must not contain any `*CoreIds` matcher substring, or blockers become core seeds and every entangle assertion flips red. Pinned by each mechanic's entangle test.
3. **Arrow-count budget with multiple entangled mechanics** — `prefilled` must sum blockers across mechanics; an id entangling two mechanics must land exactly on `arrowCount`. Pinned by the wiring task's budget assertions (and the ceiling test in `tests/procedural.test.ts`).
4. **Stream isolation** — a mechanic's `-block` stream is drawn exactly once per generated id and only via its seeder; non-entangled ids stay byte-identical. Pinned by the fixture churn proofs.
5. **Play-time solvability per mechanic** — every entangled board solves (`solveLevelTargets` defined) and its proven order does not open with a core-arrow tap. Pinned per mechanic in the shared sweep test (Task 9).

---

### Task 1: Per-mechanic block curves

**Files:**
- Modify: `src/content/procedural.ts` (near `flipBlockFrequency`, `:316-329`)
- Test: `tests/mechanic-counts.test.ts`

**Interfaces:**
- Consumes: `assertLevelId`, `isAuthoredLevel`, `FIRST_ROTOR_LEVEL` (`:327`).
- Produces: `export const rotorBlockFrequency`, `wormholeBlockFrequency`, `fragileBlockFrequency`, `lockBlockFrequency`, `mirrorBlockFrequency`, `leapBlockFrequency` — each `(id: number) => number`, 0 below the mechanic's first level and on authored ids, 0.35 at first rising linearly to 0.70 at first+59 and holding. First levels: wormhole 36, rotor 41, fragile 46, lock 51, mirror 56, leap 61.

- [ ] **Step 1: Write the failing test**

Add to `tests/mechanic-counts.test.ts` (extend the procedural import):

```ts
test("block curves ramp from each mechanic's first level", () => {
  expect(rotorBlockFrequency(40)).toBe(0);
  expect(rotorBlockFrequency(41)).toBeCloseTo(0.35);
  expect(rotorBlockFrequency(100)).toBeCloseTo(0.7);
  expect(wormholeBlockFrequency(36)).toBeCloseTo(0.35);
  expect(wormholeBlockFrequency(95)).toBeCloseTo(0.7);
  expect(fragileBlockFrequency(46)).toBeCloseTo(0.35);
  expect(lockBlockFrequency(51)).toBeCloseTo(0.35);
  expect(mirrorBlockFrequency(56)).toBeCloseTo(0.35);
  expect(leapBlockFrequency(61)).toBeCloseTo(0.35);
  expect(leapBlockFrequency(60)).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/mechanic-counts.test.ts -t "block curves"`
Expected: FAIL — the functions are not exported.

- [ ] **Step 3: Implement**

Place near `flipBlockFrequency`:

```ts
const BLOCK_FREQUENCY: Record<
  "rotor" | "wormhole" | "fragile" | "lock" | "mirror" | "leap",
  (id: number) => number
> = {
  rotor: blockCurve(FIRST_ROTOR_LEVEL),
  wormhole: blockCurve(36),
  fragile: blockCurve(46),
  lock: blockCurve(51),
  mirror: blockCurve(56),
  leap: blockCurve(61),
};

const blockCurve =
  (first: number) =>
  (id: number): number => {
    assertLevelId(id);
    if (id < first || isAuthoredLevel(id)) return 0;
    const progress = Math.min(1, (id - first) / 59);
    return 0.35 + 0.35 * progress;
  };

export const rotorBlockFrequency = BLOCK_FREQUENCY.rotor;
export const wormholeBlockFrequency = BLOCK_FREQUENCY.wormhole;
export const fragileBlockFrequency = BLOCK_FREQUENCY.fragile;
export const lockBlockFrequency = BLOCK_FREQUENCY.lock;
export const mirrorBlockFrequency = BLOCK_FREQUENCY.mirror;
export const leapBlockFrequency = BLOCK_FREQUENCY.leap;
```

(`blockCurve` must be declared before `BLOCK_FREQUENCY` or hoisted via `function` — match the file's style.)

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/mechanic-counts.test.ts -t "block curves"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content/procedural.ts tests/mechanic-counts.test.ts
git commit -m "feat: per-mechanic blocker frequency curves"
```

### Task 2: Rotor entanglement

**Files:**
- Modify: `src/content/procedural.ts` — `flipBlockers` (`:2207`) parameterized; `rotorCore`'s acceptance tail (`:3006` region).
- Test: `tests/rotor-generation.test.ts`

**Interfaces:**
- Consumes: `regionDanceOrder`, `rotorCoreFrequency`/`rotorBlockFrequency`, the `:rotor-block` stream.
- Produces: `seedRegionBlockers(kind: "flip" | "rotor", id, restart, level, board, coreArrows, stops, regionCells, occupied, parkTracks, inBounds)` — the renamed `flipBlockers`, selecting stream (`:flip-block`/`:rotor-block`), frequency function, and marker (`-flipb-`/`-xblock-`) by kind. Rotor cores return populated `blockers`/`dance` in their FlipCore result, and the existing `flipEntangled` wiring entangles them with no wiring change (the `flip` variable at `:4574` holds both cores).

- [ ] **Step 1: Write the failing test**

Add to `tests/rotor-generation.test.ts` (imports per the file's existing helpers: `cachedLevel`, `isAuthoredLevel`, `rotorCoreIds`, `rotorBlockFrequency`, `cellKey`, `trackKeys`, and the file's plan-draw helper — replicate `mechanic-counts.test.ts`'s `fnv1a`/`Rng` pattern if absent):

```ts
test("entangled rotor cores carry well-formed blockers on their lanes", () => {
  let found = 0;
  for (let id = 41; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    const cores = rotorCoreIds(level.arrows);
    if (cores.length === 0) continue;
    const planned =
      new Rng(fnv1a(`${seedForLevel(id)}:rotor-block`)).next() <
      rotorBlockFrequency(id);
    if (!planned || found >= 3) continue;
    const blockers = level.arrows.filter((arrow) =>
      arrow.id.includes("-xblock-rotor"),
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
      expect(blocker.path.some((cell) => coreTrack.has(cellKey(cell)))).toBe(
        true,
      );
    }
  }
  expect(found).toBeGreaterThanOrEqual(3);
}, 600_000);
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/rotor-generation.test.ts -t "well-formed blockers"`
Expected: FAIL — no `-xblock-rotor` arrows exist.

- [ ] **Step 3: Implement**

1. Rename `flipBlockers` → `seedRegionBlockers` with a leading `kind: "flip" | "rotor"` parameter. Select by kind: stream name (`:flip-block` / `:rotor-block`), frequency (`flipBlockFrequency` / `rotorBlockFrequency`), marker (`-flipb-` / `-xblock-rotor` prefix in the id template, i.e. `r${id}-xblock-rotor${blockers.length}`). flipCore's existing tail call passes `"flip"` and keeps `-flipb-` output identical.
2. In `rotorCore`'s acceptance tail (the return site carrying `blockers: [], dance: []`), mirror flipCore's tail: after the successful region verdict, call `seedRegionBlockers("rotor", ...)` and `regionDanceOrder(level, board.directionals ?? [], stops, [...placed, ...seeded.blockers])`, returning `blockers: seeded.blockers` and the dance.
3. No wiring change — `flipEntangled`, `emissionLeads`, `graphNodes`, `precedence`, and the budget already act on `flip` regardless of kind.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/rotor-generation.test.ts -t "well-formed blockers"`
Expected: PASS

- [ ] **Step 5: Run the affected suites**

Run: `bun test tests/flip.test.ts tests/flip-generation.test.ts tests/rotor-generation.test.ts tests/region-generation.test.ts`
Expected: only fixture-comparison failures (rotor-entangled ids re-rolled); everything else green.

- [ ] **Step 6: Commit**

```bash
git add src/content/procedural.ts tests/rotor-generation.test.ts
git commit -m "feat: rotor cores seed lane blockers on the rotor-block stream"
```

### Task 3: Per-lane seeder and generalized entangled wiring (wormhole first)

**Files:**
- Modify: `src/content/procedural.ts` — `seedLaneBlockers` near `seedRegionBlockers`; wiring sites at `:4894` (emissionLeads), `:4997` (graphNodes), `:5020` (prefilled), `:5040` (precedence), `:5079` (emission filter), `:5293-5297` (certificate prefix), `:5314` (acceptance gate), `:5374` (trim ladder).
- Test: `tests/wormhole-generation.test.ts`

**Interfaces:**
- Consumes: `arrowTrack`, `stepSurface`, `validateGenerated`, `cellKey`, `coreStream`, the Task 1 curves, the wiring-scope key sets (`portalKeys`, `fragileKey`, `lockKeys`, `mirrorKeys`, `leapKeys`), `PARK_CERTIFICATE_PREFIX`.
- Produces:
  - `function seedLaneBlockers(input: LaneBlockerInput): readonly ArrowDefinition[]`.
  - `interface EntangledCore { kind: string; arrows: readonly ArrowDefinition[]; blockers: readonly ArrowDefinition[]; chain: readonly string[] }` and the generalized wiring loop consuming it.
  - `function certificateToChain(certificate: readonly CertificateEntry[]): readonly string[]`.

- [ ] **Step 1: Write the failing test**

Add to `tests/wormhole-generation.test.ts` (imports per the file's conventions: `cachedLevel`, `isAuthoredLevel`, `wormholePlan`, `wormholeBlockFrequency`, `cellKey`, `trackKeys`, `Rng`, `seedForLevel`, and `fnv1a` if the file has one, else replicate `mechanic-counts.test.ts`'s):

```ts
test("entangled wormhole cores carry well-formed blockers on their lanes", () => {
  let found = 0;
  for (let id = 36; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    if (wormholePlan(id) === 0) continue;
    const planned =
      new Rng(fnv1a(`${seedForLevel(id)}:wormhole-block`)).next() <
      wormholeBlockFrequency(id);
    if (!planned || found >= 3) continue;
    const blockers = level.arrows.filter((arrow) =>
      arrow.id.includes("-xblock-wormhole"),
    );
    if (blockers.length === 0) continue; // legitimate fallback ids
    found += 1;
    const coreTrack = new Set(
      level.arrows
        .filter((arrow) => arrow.id.includes("-wormhole-"))
        .flatMap((core) => [
          ...core.path.map(cellKey),
          ...trackKeys(level, core),
        ]),
    );
    for (const blocker of blockers) {
      expect(blocker.path.length).toBe(2);
      expect(blocker.path.some((cell) => coreTrack.has(cellKey(cell)))).toBe(
        true,
      );
    }
  }
  expect(found).toBeGreaterThanOrEqual(3);
}, 600_000);
```

If the wormhole core's id template does not contain `-wormhole-` (grep `wormholeCore`'s id at `:1513` region), replace the filter with the actual marker string.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/wormhole-generation.test.ts -t "well-formed blockers"`
Expected: FAIL — no `-xblock-wormhole` arrows exist.

- [ ] **Step 3: Implement**

All in `src/content/procedural.ts`.

1. The seeder (place near `seedRegionBlockers`):

```ts
const XBLOCK_MARKER = "-xblock-";
const LANE_KINDS = ["wormhole", "fragile", "lock", "mirror", "leap"] as const;
type LaneKind = (typeof LANE_KINDS)[number];

interface LaneBlockerInput {
  kind: LaneKind;
  id: number;
  restart: number;
  /** The spots board, for track derivation. */
  board: LevelDefinition;
  coreArrows: readonly ArrowDefinition[];
  certificate: readonly CertificateEntry[];
  /** The mechanic's core-board literal, for the replay proof. */
  coreBoard: LevelDefinition;
  occupied: ReadonlySet<string>;
  parkTracks: ReadonlySet<string>;
  /** Every reserved cell: mechanic cells, portal ends, region cells. */
  reservedCells: ReadonlySet<string>;
  inBounds: (cell: Cell) => boolean;
}

/**
 * Seed blocker arrows on a certificate-led core's lanes: the per-lane
 * sibling of `seedRegionBlockers`. Each blocker is a two-cell arrow whose
 * tail covers a late track cell of some core arrow and whose head points
 * off the lane; the mechanic's certificate must still replay on the core
 * board with the blockers as members. A failed replay keeps the proven
 * prefix. Blocker routes stay reserved like the core's lanes — the caller
 * must add their track keys to `forbiddenBody` and `forbiddenRay`.
 */
function seedLaneBlockers(input: LaneBlockerInput): readonly ArrowDefinition[] {
  const { kind, id, restart } = input;
  const rng = coreStream(id, `${kind}-block`, restart);
  const frequency = BLOCK_FREQUENCY[kind];
  if (frequency(id) === 0 || rng.next() >= frequency(id)) return [];
  const first = { wormhole: 36, fragile: 46, lock: 51, mirror: 56, leap: 61 }[
    kind
  ] as number;
  const maxBlockers = id >= first + 29 && rng.next() < 0.3 ? 2 : 1;
  const size = input.board.gridSize;
  const spotKeys = new Set(
    (input.board.directionals ?? []).map((spot) => cellKey(spot.cell)),
  );
  const stopKeys = new Set((input.coreBoard.stops ?? []).map(cellKey));
  const blockers: ArrowDefinition[] = [];
  const blockerKeys = new Set<string>();
  const bannedKey = (key: string): boolean =>
    input.occupied.has(key) ||
    input.parkTracks.has(key) ||
    spotKeys.has(key) ||
    stopKeys.has(key) ||
    input.reservedCells.has(key) ||
    blockerKeys.has(key);
  for (
    let attempt = 0;
    attempt < 6 && blockers.length < maxBlockers;
    attempt += 1
  ) {
    const owner = input.coreArrows[
      rng.int(input.coreArrows.length)
    ] as ArrowDefinition;
    const track = arrowTrack(input.board, owner).slice(owner.path.length);
    const candidates = track.slice(Math.max(0, track.length - 4));
    if (candidates.length === 0) continue;
    const entangle = candidates[rng.int(candidates.length)] as Cell;
    if (!input.inBounds(entangle) || bannedKey(cellKey(entangle))) continue;
    const trackKeySet = new Set(track.map(cellKey));
    const options = (["east", "west", "south", "north"] as const)
      .map((heading) => ({
        heading,
        cell: stepSurface(entangle, heading, size),
      }))
      .filter(
        ({ cell }) =>
          !trackKeySet.has(cellKey(cell)) &&
          input.inBounds(cell) &&
          !bannedKey(cellKey(cell)),
      );
    if (options.length === 0) continue;
    const choice = options[rng.int(options.length)] as {
      heading: Heading;
      cell: Cell;
    };
    const blocker: ArrowDefinition = {
      id: `r${id}-xblock-${kind}${blockers.length}`,
      path: [entangle, choice.cell],
    };
    const routeKeys = arrowTrack(input.board, blocker)
      .slice(blocker.path.length)
      .map(cellKey);
    if (routeKeys.some(bannedKey)) continue;
    const proofBoard: LevelDefinition = {
      ...input.coreBoard,
      arrows: [...input.coreBoard.arrows, ...blockers, blocker],
    };
    if (!validateGenerated(proofBoard, input.certificate)) break;
    blockers.push(blocker);
    for (const cell of blocker.path) blockerKeys.add(cellKey(cell));
  }
  return blockers;
}
```

2. The chain helper (near `PARK_CERTIFICATE_PREFIX`):

```ts
function certificateToChain(
  certificate: readonly CertificateEntry[],
): readonly string[] {
  const chain: string[] = [];
  for (const entry of certificate) {
    const arrowId =
      typeof entry === "string"
        ? entry.startsWith(PARK_CERTIFICATE_PREFIX)
          ? entry.slice(PARK_CERTIFICATE_PREFIX.length)
          : entry
        : entry.arrowId;
    if (chain[chain.length - 1] !== arrowId) chain.push(arrowId);
  }
  return chain;
}
```

3. The wiring generalization. Replace the flip-only conditionals with an entangled list. Right before `leadIds` is built (`:4894` region), seed the lane cores and collect — the region core joins first, then each lane core whose seeder placed blockers:

```ts
const laneCores: {
  kind: LaneKind;
  arrows: readonly ArrowDefinition[];
  certificate: readonly CertificateEntry[];
  coreBoard: LevelDefinition;
  cellKeys: ReadonlySet<string>;
}[] = [
  ...(wormholes.length > 0
    ? [
        {
          kind: "wormhole" as const,
          arrows: wormholes.flatMap((entry) => entry.arrows),
          certificate: wormholes.flatMap((entry) => entry.certificate),
          coreBoard: {
            ...candidateLevel,
            arrows: [] as ArrowDefinition[],
            wormholes: wormholes.map((entry) => entry.wormhole),
          },
          cellKeys: portalKeys,
        },
      ]
    : []),
  ...(fragile
    ? [
        {
          kind: "fragile" as const,
          arrows: fragile.arrows,
          certificate: fragile.certificate,
          coreBoard: {
            ...candidateLevel,
            arrows: [] as ArrowDefinition[],
            fragile: [fragile.cell],
          },
          cellKeys: new Set([fragileKey]),
        }
      ]
    : []),
  ...(lock
    ? [
        {
          kind: "lock" as const,
          arrows: lock.arrows,
          certificate: lock.certificate,
          coreBoard: {
            ...candidateLevel,
            arrows: [] as ArrowDefinition[],
            locks: [lock.lock],
          },
          cellKeys: lockKeys,
        }
      ]
    : []),
  ...(mirror
    ? [
        {
          kind: "mirror" as const,
          arrows: mirror.arrows,
          certificate: mirror.certificate,
          coreBoard: {
            ...candidateLevel,
            arrows: [] as ArrowDefinition[],
            mirrors: [mirror.mirror],
          },
          cellKeys: mirrorKeys,
        }
      ]
    : []),
  ...(leap
    ? [
        {
          kind: "leap" as const,
          arrows: leap.arrows,
          certificate: leap.certificate,
          coreBoard: {
            ...candidateLevel,
            arrows: [] as ArrowDefinition[],
            leaps: [leap.pad],
          },
          cellKeys: leapKeys,
        }
      ]
    : []),
];
const entangled: {
  kind: string;
  arrows: readonly ArrowDefinition[];
  blockers: readonly ArrowDefinition[];
  chain: readonly string[];
}[] = [];
if (flip && flip.blockers.length > 0)
  entangled.push({
    kind: "region",
    arrows: flip.arrows,
    blockers: flip.blockers,
    chain: flip.dance,
  });
for (const lane of laneCores) {
  const blockers = seedLaneBlockers({
    kind: lane.kind,
    id,
    restart,
    board: nodeBoard,
    coreArrows: lane.arrows,
    certificate: lane.certificate,
    coreBoard: { ...lane.coreBoard, arrows: lane.arrows },
    occupied,
    parkTracks,
    reservedCells: lane.cellKeys,
    inBounds,
  });
  if (blockers.length === 0) continue;
  entangled.push({
    kind: lane.kind,
    arrows: lane.arrows,
    blockers,
    chain: certificateToChain(lane.certificate),
  });
}
const entangledArrowIds = new Set(
  entangled.flatMap((core) => core.arrows.map((arrow) => arrow.id)),
);
const entangledBlockers = entangled.flatMap((core) => core.blockers);
const entangledKinds = new Set(entangled.map((core) => core.kind));
```

Then each flip-only site generalizes (keep `leadIds` unchanged — it still reserves every core's body and track):

```ts
// emission filter source (:4894):
const emissionExcluded = new Set(
  entangled.flatMap((core) => core.arrows.map((arrow) => arrow.id)),
);
const emissionLeads = new Set(
  [...leadIds].filter((arrowId) => !emissionExcluded.has(arrowId)),
);
// budget (:5020):
const prefilled = arrows.length + entangledBlockers.length;
// graph nodes (:4997): replace the flipEntangled spread with
...entangled.flatMap((core) => [
  ...core.arrows.map((arrow) => ({
    id: arrow.id,
    arrows: [arrow],
    routeKeys: new Set(
      flipHeadingProbes(leadBoard).flatMap((probe) =>
        arrowTrack(probe, arrow).slice(arrow.path.length).map(cellKey),
      ),
    ),
  })),
  ...core.blockers.map((arrow) => ({
    id: arrow.id,
    arrows: [arrow],
    routeKeys: new Set(nodeRoute(arrow)),
  })),
]),
// blocker route reservations — after the lead-track forbiddenBody loop:
for (const blocker of entangledBlockers) {
  for (const key of nodeRoute(blocker)) {
    forbiddenBody.add(key);
    forbiddenRay.add(key);
  }
}
// precedence (:5040): build after graphNodes, filtering chains to node ids
const nodeIds = new Set(graphNodes.map((node) => node.id));
precedence: entangled.flatMap((core) => {
  const chain = core.chain.filter((arrowId) => nodeIds.has(arrowId));
  return chain
    .slice(1)
    .map((afterId, index): [string, string] => [
      chain[index] as string,
      afterId,
    ]);
}),
// emission (:5079) and certificate graph section (:5306): use emissionLeads (unchanged semantics)
// certificate prefix (:5293-5297): drop each entangled per-lane mechanic's entries
...(fragile && !entangledKinds.has("fragile") ? fragile.certificate : []),
...(lock && !entangledKinds.has("lock") ? lock.certificate : []),
...(mirror && !entangledKinds.has("mirror") ? mirror.certificate : []),
...(leap && !entangledKinds.has("leap") ? leap.certificate : []),
...wormholes.flatMap((entry) => entry.certificate), // keep only when no wormhole entry entangled
// acceptance gate (:5314): region-lead prepend only on isolated region cores
flipEntangled ? certificate : [...flipLead, ...certificate],
// trim ladder (:5374): the same conditional shape the main gate uses
```

The wormhole prefix line generalizes to: build `wormholeCertificate` as `wormholes.flatMap((entry) => entry.certificate)` and include it only when `!entangledKinds.has("wormhole")`. The `flipEntangled` boolean becomes `entangledKinds.has("region")`.

Also: `wormholeCore`'s return entries must gain `blockers` (seeded in its own pass with the same per-entry re-proof) OR the entries are seeded at the loop above — the loop above is authoritative: `wormholeCore` itself is unchanged, and the wormhole blockers come from `seedLaneBlockers` in the loop (one call per id covering all entries, capped at 2 blockers across them; `maxBlockers` uses one coin — acceptable, matching flip's per-core cap).

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/wormhole-generation.test.ts -t "well-formed blockers"` then `bun test tests/flip.test.ts tests/wormhole-generation.test.ts tests/dependency-fill.test.ts`
Expected: the new test passes (≥3 entangled wormhole ids); only fixture-comparison failures elsewhere; flip tests stay green.

- [ ] **Step 5: Determinism probe**

Run: `bun -e` regenerating ids 36-100 twice and comparing `layoutFingerprint` (import from `src/storage`). Expected: identical.

- [ ] **Step 6: Commit**

```bash
git add src/content/procedural.ts tests/wormhole-generation.test.ts
git commit -m "feat: per-lane blocker seeding entangles wormhole cores"
```

### Task 4: Fragile entanglement

**Files:**
- Modify: `src/content/procedural.ts` (Task 3's wiring already loops — this task adds nothing structural; verify fragile flows) — NO new code beyond Task 3's loop, which already carries the fragile config.
- Test: `tests/fragile-generation.test.ts`

**Interfaces:**
- Consumes: the Task 3 loop (fragile config already present).
- Produces: fragile entanglement live; the fragile test.

- [ ] **Step 1: Write the test** in `tests/fragile-generation.test.ts`, mirroring Task 3 Step 1's structure with: ids 46-200, stream `:fragile-block`, `fragileBlockFrequency`, marker `-xblock-fragile`, plan check `fragileCorePlanned(id)` (import from procedural), and the core-arrow filter `arrow.id.includes("-fragile-")`.

- [ ] **Step 2: Run to verify it passes or fails** — Task 3's loop already covers fragile, so this should PASS immediately; if it fails, the fragile config in Task 3's loop is wrong — fix there.

- [ ] **Step 3: Commit**

```bash
git add tests/fragile-generation.test.ts
git commit -m "test: pin fragile blocker entanglement"
```

### Task 5: Lock entanglement

Same shape as Task 4, in `tests/lock-generation.test.ts`: ids 51-200, stream `:lock-block`, `lockBlockFrequency`, marker `-xblock-lock`, plan check `lockCorePlanned(id)`, core filter `-lock-`. Note: a lock blocker's id contains `-lock-`? No — `-xblock-lock0` does NOT contain `-lock-` (the hyphen before `lock` is preceded by `k`? verify: the string `-xblock-lock0` — the substring `-lock-` requires a trailing hyphen; `-lock0` has none, so it is safe; assert this in the test with a comment).

```bash
git add tests/lock-generation.test.ts
git commit -m "test: pin lock blocker entanglement"
```

### Task 6: Mirror entanglement

Same shape, in `tests/mirror-generation.test.ts`: ids 56-200, stream `:mirror-block`, `mirrorBlockFrequency`, marker `-xblock-mirror`, plan check `mirrorCorePlanned(id)`, core filter `-mirror-`.

```bash
git add tests/mirror-generation.test.ts
git commit -m "test: pin mirror blocker entanglement"
```

### Task 7: Leap entanglement

Same shape, in `tests/leap-generation.test.ts`: ids 61-200, stream `:leap-block`, `leapBlockFrequency`, marker `-xblock-leap`, plan check `leapCorePlanned(id)`, core filter `-leap-`.

```bash
git add tests/leap-generation.test.ts
git commit -m "test: pin leap blocker entanglement"
```

### Task 8: Fixture regeneration and parity

**Files:**
- Regenerate: `tests/fixtures/v8-layouts.json` via `bun scripts/write-layout-fixture.ts`
- Test: the generation sweeps

- [ ] **Step 1: Regenerate** — `bun scripts/write-layout-fixture.ts` (redirect output; check the real exit code).

- [ ] **Step 2: Churn proof** — compare against HEAD's fixture (save the old one first with `git show HEAD:tests/fixtures/v8-layouts.json > /tmp/fixture-old.json`): every changed id must carry at least one entangled core of a shipped mechanic (flip `-flipb-`, or `-xblock-` with a mechanic whose core the id also carries), and no changed id may be without any such core. A changed id that carries no entangled core means a leak — stop and diagnose. Note: ids whose mechanic core PLACES but whose block plan draws zero must NOT change; ids whose pass gives up (like id 32 did for flip) MAY change — record each such give-up id and verify it is isolated (count them; more than a handful per mechanic is a regression signal).

- [ ] **Step 3: Full unit gate** — `make checkall` must pass with no skips (the hook runs it). If a mechanic-counts ratio pin moved beyond its band, that is a gate — diagnose the coupling, do not loosen pins.

- [ ] **Step 4: Determinism probe** — regenerate ids 2-200 sampled (or all) twice; identical fingerprints.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/v8-layouts.json
git commit -m "test: refresh layout fixtures for six-mechanic blocker entanglement"
```

### Task 9: Share pins and the shared entangle sweep

**Files:**
- Test: `tests/mechanic-counts.test.ts` (share pins ×6), new `tests/mechanic-entangle.test.ts` (one sweep over ids 2-200 covering all seven mechanics).

- [ ] **Step 1: Share pins** — for each mechanic, mirror flip's share test: planned = ids whose core places AND whose block draw is under the curve; entangled = those with blockers present; assert `entangled / planned > floor` where floor = measured − 0.1, recorded with the measurement in a comment (calibrate exactly as flip's Task 8 did).

- [ ] **Step 2: Shared sweep** — `tests/mechanic-entangle.test.ts`, one test over ids 31-200 (cachedLevel): for each id, for each mechanic kind, assert structure on entangled ids: blockers exist only when the plan drew, blocker tails sit on their mechanic core's track, `solveLevelTargets(level)` is defined, and for flip/rotor the region absorbs the blockers (`interactionRegion`'s `arrowIds` contains them). Reuse the assertion shapes from `tests/flip-generation.test.ts`'s sweep and Task 2/3's tests.

- [ ] **Step 3: Run** — `make checkall` (the sweeps are long; redirect and check real exit codes). Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/mechanic-counts.test.ts tests/mechanic-entangle.test.ts
git commit -m "test: pin six-mechanic blocker shares and entangle structure"
```

### Task 10: Browser verification

**Files:**
- Modify: `tests/flip-browser.ts` — generalize `assertEntangledCore` to scan ids 31-200 for the first entangled core of ANY mechanic (flip, rotor via `-xblock-rotor`, or `-xblock-`), clear it in proven order across a mid-level reload.

- [ ] **Step 1: Generalize** — the scan filter becomes: any of `-flipb-` or `-xblock-` present. The proven-order source stays `solveLevelTargets`; the first-tap assertion generalizes to "the first tap is not an arrow of any core marker" (`-flip-`, `-rotor-`, `-fragile-`, `-lock-`, `-mirror-`, `-leap-`, `-wormhole-` ids filtered by their markers).
- [ ] **Step 2: Run** — `FLIP_ONLY=1 make browser-test` (the check rides the flip suite) — must exit 0.
- [ ] **Step 3: Commit**

```bash
git add tests/flip-browser.ts
git commit -m "test: browser entangle check covers every mechanic"
```

### Task 11: Docs and ship

**Files:**
- Modify: `CLAUDE.md` (per-mechanic sections + Generation and seeds + Tests), spec status line.

- [ ] **Step 1: Docs** — reconcile each mechanic's section with its entanglement (isolated-vs-entangled qualifiers, the mechanic's stream/curve, marker), the Generation-and-seeds blocker paragraph (six streams, curves, marker), and the Tests bullet (new pins + sweep + browser). Ground-truth from the shipped code, not from this plan, and apply the same isolated/entangled reconciliation the flip docs received in the phase-1 plan's Task 10. Update the spec's Status to `Implemented`.
- [ ] **Step 2: Gates** — `make checkall-ci` exit 0; full `make browser-test` exit 0 (a flake re-run is acceptable; a deterministic failure on an unchanged-layout id is a BLOCKED).
- [ ] **Step 3: Commit** `docs: six-mechanic blocker entanglement` — then `git push`, and confirm both CI workflows pass on the pushed head; fix forward if not.
