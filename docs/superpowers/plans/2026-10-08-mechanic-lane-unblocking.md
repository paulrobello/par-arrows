# Mechanic Lane Unblocking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generated mechanic cores stop getting reserved clear lanes — their arrows join `dependencyFill` as graph nodes, so fill bodies may rest on mechanic lanes and must leave first, exactly like normal arrows.

**Architecture:** `generateLevel` already has the target mechanism (entangled boards: core arrows + blockers as `FillNode`s, certificate chain as precedence, merged topological order). The change removes the lead privilege: the five lane cores always enter the node set, then the double and directional cores follow; lane-track `forbiddenBody` reservations are dropped by shrinking `leadIds`; seeded `-xblock-`/`-flipb-` blockers stay (owner ruling D2). One `GENERATOR_VERSION` bump re-rolls all generated ids.

**Tech Stack:** TypeScript, Bun (`bun test`), Biome, Vite; Playwright headed browser suite.

**Spec:** `docs/superpowers/specs/2026-10-08-mechanic-lane-unblocking-design.md`

## Global Constraints

- No `src/core` changes (movement, collision, solver untouched).
- Authored levels (1, 5, 11, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60) unchanged; the fixture script covers ids 2–200 only.
- `GENERATOR_VERSION` bumps exactly once, `10` → `11`, in Task 1 (`src/content/procedural.ts:73`). Task 2's layout churn rides the same v11 (no second bump).
- Seeded blocker curves and budgets unchanged (D2): `seedLaneBlockers`, `-flipb-`, block frequencies, restart-retry-with-seeding-off.
- Park tracks, flip/rotor region cells, portal ends, fragile/lock/mirror/leap mechanic cells keep every existing reservation (`forbiddenRay` untouched).
- Gate: `make checkall` green before every commit; safe shell form for test runs (redirect, capture `$?`, then sample the log — never trust a piped tail).
- Repo is trunk-based: work directly on `main`, commit per task, push per green batch (standing authorization; a push deploys Pages).
- Run every shell test command in this safe form: `bun test FILE > /tmp/t.log 2>&1; ec=$?; tail -30 /tmp/t.log; echo EXIT=$ec`

## Review Focus

1. **Replay corruption** — a fill body lands on a core lane but the merged certificate replays the core first. Pinned by: Task 1/2 tests assert `validateLevel(level).valid` on every sampled id (generation itself gates replay, so a level that exists has already replayed).
2. **Fill starvation** — spurious body-on-route edges (doubles traced from both ends) create cycles that reject candidates until `skip = "count"`. Pinned by: Task 3 re-runs `tests/depth-generation.test.ts` (exact arrow counts, coverage ≥ 0.78, nonempty routes).
3. **Cross-ordered chains** — two wormhole cores share one concatenated chain, fighting fill edges and causing `fill-cycle` give-ups. Pinned by: Task 3 re-measures give-up bands per mechanic and updates the CLAUDE.md bands; wormhole sweep stays green.
4. **Authored churn** — a stream rename or seed change re-rolls authored or early ids by accident. Pinned by: Task 1 regenerates the fixture with the unmodified script (ids 2–200 only) and the storage tests stay green.
5. **Generation-time regression** — every core now carries graph-node route sets. Pinned by: Task 3 re-measures the sampled timing assertions (mechanic sweep 8 s/id, depth sweep 1 s/id) and adjusts the budget constants only on measured evidence.

---

### Task 1: Lane cores always enter the fill graph

**Files:**
- Modify: `src/content/procedural.ts` (leadIds block ~5097, lane loop ~5279, `lanesSeeded` ~5286, `GENERATOR_VERSION` line 73)
- Test: `tests/lane-blocking.test.ts` (create)

**Interfaces:**
- Consumes: existing `entangled: { kind, arrows, blockers, chain }[]`, `entangledTargets: Map<string, MoveTarget>`, `graphNodes`, `certificate` assembly — all already handle entries keyed off `entangledKinds`, so adding entries is the whole change.
- Produces: lane cores (wormhole/fragile/lock/mirror/leap) as fill-graph nodes on every placement; `leadIds` reduced to park + directional + double + flip/rotor; `GENERATOR_VERSION = 11`.

- [ ] **Step 1: Write the failing test**

Create `tests/lane-blocking.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  FRAGILE_CORE_MARKER,
  generateLevel,
  LEAP_CORE_MARKER,
  LOCK_CORE_MARKER,
  MIRROR_CORE_MARKER,
} from "../src/content/procedural";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import { validateLevel } from "../src/core/validation";
import { cachedLevel } from "./generated-levels";

// Arrow ids that belong to a seeded structure rather than the fill: core
// markers, lane blockers, flip blockers, and the flip/rotor region.
const SEEDED = [
  FRAGILE_CORE_MARKER,
  LOCK_CORE_MARKER,
  MIRROR_CORE_MARKER,
  LEAP_CORE_MARKER,
  "-wormhole-",
  "-xblock-",
  "-flipb-",
  "-flip-",
  "-rotor-",
];

const LANE_MECHANICS = [
  { name: "wormhole", marker: "-wormhole-", ids: [36, 40, 52, 70] },
  { name: "fragile", marker: FRAGILE_CORE_MARKER, ids: [46, 49, 75] },
  { name: "lock", marker: LOCK_CORE_MARKER, ids: [51, 54, 80] },
  { name: "mirror", marker: MIRROR_CORE_MARKER, ids: [56, 58, 85] },
  { name: "leap", marker: LEAP_CORE_MARKER, ids: [61, 64, 90] },
] as const;

describe("mechanic lanes join the dependency fill", () => {
  for (const mechanic of LANE_MECHANICS) {
    test(`${mechanic.name} core lane carries a natural fill blocker`, () => {
      for (const id of mechanic.ids) {
        const level = cachedLevel(id);
        const coreArrows = level.arrows.filter((arrow) =>
          arrow.id.includes(mechanic.marker),
        );
        expect(coreArrows.length).toBeGreaterThan(0);
        const laneKeys = new Set(
          coreArrows.flatMap((arrow) =>
            arrowTrack(level, arrow)
              .slice(arrow.path.length)
              .map(cellKey),
          ),
        );
        const fill = level.arrows.filter(
          (arrow) => !SEEDED.some((marker) => arrow.id.includes(marker)),
        );
        const blockedLane = fill.some((arrow) =>
          arrow.path.some((cell) => laneKeys.has(cellKey(cell))),
        );
        expect(blockedLane).toBe(true);
        expect(validateLevel(level).valid).toBe(true);
      }
    });
  }
});
```

If a sampled id turns out to be a give-up id for its mechanic (core never places), swap in a neighboring id that places — verify with the mechanic-counts share data, not by loosening the assertion.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/lane-blocking.test.ts > /tmp/t.log 2>&1; ec=$?; tail -30 /tmp/t.log; echo EXIT=$ec`
Expected: FAIL — `blockedLane` is false on every mechanic (lanes are reserved today).

- [ ] **Step 3: Implement the node conversion**

Three edits in `src/content/procedural.ts`:

(a) `GENERATOR_VERSION` (line 73): `10` → `11`.

(b) The `leadIds` block (~5097) — delete the five lane-core spreads and update the comment above it:

```ts
        // Lead arrows clear first, in certificate order; they are not graph
        // nodes. Their bodies are never fill cells. Leads are the park core,
        // the directional and double cores (until they join the graph), and
        // the flip or rotor region. The five lane cores are graph nodes, so
        // their bodies block fill cells as owner cells and their lanes are
        // fill-blockable like any starter's.
        const leadIds = new Set<string>([
          ...(core?.arrows ?? []).map((arrow) => arrow.id),
          ...(directionalSpot?.arrows ?? []).map((arrow) => arrow.id),
          ...(double?.arrows ?? []).map((arrow) => arrow.id),
          ...(flip?.arrows ?? []).map((arrow) => arrow.id),
        ]);
```

(c) In the `for (const lane of lanesOff ? [] : laneCores)` loop (~5279): delete the line `if (blockers.length === 0) continue;` so every lane core pushes into `entangled` with whatever blockers seeded (possibly none). Keep the `priorBlockerKeys` loop (no-op when empty) and the `entangledTargets` registration unchanged. Update the `// Entangled cores:` comment above `laneCores` (~5213) to: lane cores are graph nodes whether or not blockers seeded; the region core still requires blockers.

(d) `lanesSeeded` (~5286) — it drives the restart-retry-with-seeding-off, so it must mean "blockers were seeded", not "a lane core placed":

```ts
        lanesSeeded = entangled.some(
          (entry) => entry.kind !== "region" && entry.blockers.length > 0,
        );
```

- [ ] **Step 4: Run the lane test to verify it passes**

Run: `bun test tests/lane-blocking.test.ts > /tmp/t.log 2>&1; ec=$?; tail -30 /tmp/t.log; echo EXIT=$ec`
Expected: PASS on all five mechanics.

- [ ] **Step 5: Regenerate fixtures and reconcile the suite**

```sh
bun scripts/write-layout-fixture.ts
```

Then run the full unit suite and reconcile, in this order:

Run: `make checkall > /tmp/check.log 2>&1; ec=$?; tail -40 /tmp/check.log; echo EXIT=$ec`

Reconcile per failing file (expected failures and their fixes):
- `tests/flip-generation.test.ts`, `tests/wormhole-generation.test.ts` fixture sweeps: pass once the fixture is regenerated (no edit).
- `tests/rotor-generation.test.ts`, `tests/fragile-generation.test.ts`, `tests/lock-generation.test.ts`, `tests/mirror-generation.test.ts`, `tests/leap-generation.test.ts`: each holds a `PRE_*` fingerprint map proving the mechanic's original rollout churned only its own ids. A version bump re-rolls every id by design, so the maps are void — delete the `PRE_*` constant and the test block(s) asserting against it, leaving a comment like `// PRE_* parity retired at v11: the version bump re-rolls every id; the fixture pins determinism.` Keep every other assertion (caps, validation, region proofs, required use).
- `tests/mechanic-entangle.test.ts`: asserts per-mechanic entangled structure and rotor's zero. The five lane mechanics are now always node-led; keep the blocker-structure checks (blockers still seeded), drop or invert any assertion that isolated (blocker-free) lane cores exist.
- `tests/mechanic-counts.test.ts`: placement ratios and blocker-share floors measure seeding, which is unchanged — expected to pass; if a ratio drifted past its band, re-measure and re-pin with the measured value and date in a comment.
- `tests/depth-generation.test.ts`, `tests/procedural.test.ts`, `tests/closure.test.ts`, `tests/dependency-fill.test.ts`: expected to pass unchanged; investigate any failure before touching the assertion (rule: understand what a failing test tests before changing it).

Expected end state: `make checkall` EXIT=0.

- [ ] **Step 6: Commit and push**

```sh
git add src/content/procedural.ts tests/lane-blocking.test.ts tests/fixtures/v8-layouts.json tests/*-generation.test.ts tests/mechanic-entangle.test.ts tests/mechanic-counts.test.ts
git commit -m "feat: lane cores join the dependency fill (generator v11)"
git push origin main
```

Confirm the pushed `Checks` run passes (`gh run watch` or poll `gh run list --branch main --limit 1`); fix forward if it fails.

---

### Task 2: Double and directional cores join the graph

**Files:**
- Modify: `src/content/procedural.ts` (leadIds ~5097, entangled pushes after the lane loop ~5286, `graphNodes` double trace ~5398, certificate assembly ~5705)
- Test: `tests/lane-blocking.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's always-node `entangled` structure and reduced `leadIds`.
- Produces: `entangled` entries `kind: "double"` (chain from `double.certificate`) and `kind: "directional"` (chain = arrow ids); `leadIds` reduced to park + flip/rotor; the double's `graphNodes` routeKeys traced from both endpoints.

- [ ] **Step 1: Extend the failing test**

Add `"-double-"` and `"-dir-"` to the `SEEDED` list — required, not optional: the double's own blockers a/b sit on its head-end lane by design (`r<id>-double-a/b`), so without the SEEDED entries they would masquerade as natural fill blockers and the test would pass vacuously. Then add to `LANE_MECHANICS`:

```ts
  { name: "double", marker: "-double-", ids: [26, 30, 45, 70] },
  { name: "directional", marker: "-dir-", ids: [21, 24, 33, 60] },
```

`-double-` matches `r<id>-double-double/a/b` (the whole core — correct). `-dir-` matches `r<id>-dir-a/b` only (verified by grep; no other id prefix contains `-dir-`).

- [ ] **Step 2: Run the test to verify the two new rows fail**

Run: `bun test tests/lane-blocking.test.ts > /tmp/t.log 2>&1; ec=$?; tail -30 /tmp/t.log; echo EXIT=$ec`
Expected: FAIL on double and directional (their lanes are still reserved), PASS on the five from Task 1.

- [ ] **Step 3: Implement**

(a) `leadIds` (~5097) — drop the directional and double spreads:

```ts
        const leadIds = new Set<string>([
          ...(core?.arrows ?? []).map((arrow) => arrow.id),
          ...(flip?.arrows ?? []).map((arrow) => arrow.id),
        ]);
```

(b) After the lane loop, immediately before `lanesSeeded = ...` (~5286), push the two cores and register the double's endpoint-aware entries:

```ts
        if (double)
          entangled.push({
            kind: "double",
            arrows: double.arrows,
            blockers: [],
            chain: certificateToChain(double.certificate),
          });
        if (directionalSpot)
          entangled.push({
            kind: "directional",
            arrows: directionalSpot.arrows,
            blockers: [],
            chain: directionalSpot.arrows.map((arrow) => arrow.id),
          });
        // A core tap may name an endpoint (a double leaving by its tail),
        // so the graph section replays the core's own entry, not its id.
        for (const entry of double ? double.certificate : []) {
          if (typeof entry !== "string")
            entangledTargets.set(entry.arrowId, entry);
        }
```

(c) `graphNodes` (~5398) — the generic `entry.arrows` mapper traces one orientation, which misses a double's tail route (the certified move). Trace doubles from both ends:

```ts
            ...entry.arrows.map((arrow) => ({
              id: arrow.id,
              arrows: [arrow],
              routeKeys: new Set(
                (arrow.kind === "double"
                  ? [arrow.path, [...arrow.path].reverse()]
                  : [arrow.path]
                ).flatMap((path) =>
                  flipHeadingProbes(entangledBoard).flatMap((probe) =>
                    arrowTrack(probe, { ...arrow, path })
                      .slice(path.length)
                      .map(cellKey),
                  ),
                ),
              ),
            })),
```

(Both-ends is deliberately conservative: a body on the head-end route orders before the double even though only the tail move is certified. The precise refinement — trace only the endpoint `entangledTargets` names — is a follow-up, not this plan.)

(d) Certificate assembly (~5705) — gate the two prefixes on entanglement:

```ts
          ...(double && !entangledKinds.has("double")
            ? double.certificate
            : []),
```

and

```ts
          ...(directionalSpot && !entangledKinds.has("directional")
            ? directionalSpot.arrows.map((arrow) => arrow.id)
            : []),
```

(e) Update the stale comments: the lead comment above `leadIds` (leads are now the park core and the flip or rotor region), the `generateLevel` doc comment at ~4394 ("leads the certificate" wording), and the restart-retry comment at ~4537 ("the exact unentangled construction" → "the exact no-seeded-blocker construction; cores stay graph nodes").

(f) Vet-call-site audit (promised by the spec): confirm no pre-fill vetting call site passes the seven cores' track keys. Verified during planning: `extraDirectionalSpots` receives `groupTracks` plus mechanic-cell sets; `reversalBlockers` receives park tracks, region cells, and mechanic cells — neither references core tracks, and both run before the fill places, so their board-state checks stay valid as advisory gates ahead of the authoritative merged-certificate replay. Re-confirm with:

```sh
grep -n "extraDirectionalSpots(\|reversalBlockers(" src/content/procedural.ts
```

and read each call site's reserved-set argument. Record the finding in the commit message; if a call site does reference core tracks, gate it on mechanic cells only (tracks are no longer reserved).

- [ ] **Step 4: Run the lane test, then regenerate fixtures and reconcile**

Run: `bun test tests/lane-blocking.test.ts > /tmp/t.log 2>&1; ec=$?; tail -30 /tmp/t.log; echo EXIT=$ec` → PASS on all seven rows.

```sh
bun scripts/write-layout-fixture.ts
make checkall > /tmp/check.log 2>&1; ec=$?; tail -40 /tmp/check.log; echo EXIT=$ec
```

Reconcile exactly as Task 1 Step 5 (same file set; `tests/double.test.ts` / `tests/procedural.test.ts` double assertions — bend share, median length — should hold since the core pattern is unchanged).

- [ ] **Step 5: Commit and push**

```sh
git add src/content/procedural.ts tests/lane-blocking.test.ts tests/fixtures/v8-layouts.json
git commit -m "feat: double and directional cores join the dependency fill"
git push origin main
```

Confirm the pushed `Checks` run passes.

---

### Task 3: Measurements and pins

**Files:**
- Test: `tests/lane-blocking.test.ts` (extend with the coverage sweep)
- Modify (only on measured evidence): timing budget constants in the sweep tests, pin values in `tests/mechanic-counts.test.ts`
- Read-only measurement: one-off bun script in the scratchpad (not committed)

**Interfaces:**
- Consumes: final generator from Task 2.
- Produces: pinned natural-block coverage floor; re-measured give-up bands and timing (numbers land in Task 5's CLAUDE.md rewrite).

- [ ] **Step 1: Write the coverage sweep test**

Append to `tests/lane-blocking.test.ts`:

```ts
describe("natural lane blocking coverage", () => {
  for (const mechanic of LANE_MECHANICS) {
    test(`${mechanic.name}: nearly every placed core lane carries a fill body`, () => {
      let placed = 0;
      let blocked = 0;
      for (let id = mechanic.ids[0]; id <= 200; id += 3) {
        const level = cachedLevel(id);
        const coreArrows = level.arrows.filter((arrow) =>
          arrow.id.includes(mechanic.marker),
        );
        if (coreArrows.length === 0) continue;
        placed += 1;
        const laneKeys = new Set(
          coreArrows.flatMap((arrow) =>
            arrowTrack(level, arrow)
              .slice(arrow.path.length)
              .map(cellKey),
          ),
        );
        const fill = level.arrows.filter(
          (arrow) => !SEEDED.some((marker) => arrow.id.includes(marker)),
        );
        if (
          fill.some((arrow) =>
            arrow.path.some((cell) => laneKeys.has(cellKey(cell))),
          )
        )
          blocked += 1;
      }
      expect(placed).toBeGreaterThan(20);
      // Floor pinned at measured minus 0.05; update with the measured value
      // and date when this first runs.
      expect(blocked / placed).toBeGreaterThanOrEqual(0.9);
    });
  }
});
```

Run it, read the measured share per mechanic from a temporary `console.log` (add, measure, remove), and set the floor to `measured - 0.05` with the measurement in a comment (house style: `// 0.97 measured 2026-10-NN; pin floor 0.92`). If any mechanic measures below 0.9, STOP and report — the spec's D3 says add a placement nudge only on evidence of gaps; do not silently lower the floor.

Note: `mechanic.ids[0]` is each mechanic's first level (36/46/51/56/61/26/21); the stride-3 sweep plus the shared `cachedLevel` cache keeps runtime in line with the existing sweeps.

- [ ] **Step 2: Re-measure timing and give-up bands**

Run the timing-bearing suites and record the numbers:

```sh
bun test tests/depth-generation.test.ts > /tmp/d.log 2>&1; ec=$?; tail -15 /tmp/d.log; echo EXIT=$ec
bun test tests/mechanic-entangle.test.ts tests/mechanic-counts.test.ts > /tmp/m.log 2>&1; ec=$?; tail -15 /tmp/m.log; echo EXIT=$ec
```

If a timing assertion fails on evidence, raise that budget constant (mechanic sweep 8 s, depth sweep 1 s) by the measured margin and note it in the commit message; do not raise speculatively.

Give-up bands: write a scratchpad script (not committed) that generates each mechanic's id range and counts ids where the core is planned but absent, using the same plan predicates the generation tests import (`flipCorePlanned`-style exports; wormhole/fragile/lock/mirror/leap each export theirs). Record per-mechanic placed/planned and give-up counts for Task 5's CLAUDE.md band update.

- [ ] **Step 3: Full gate, commit, push**

```sh
make checkall > /tmp/check.log 2>&1; ec=$?; tail -40 /tmp/check.log; echo EXIT=$ec
git add tests/lane-blocking.test.ts tests/mechanic-counts.test.ts
git commit -m "test: pin natural lane-blocking coverage and re-measured budgets"
git push origin main
```

Confirm the pushed `Checks` run passes.

---

### Task 4: Headed browser sweep

**Files:**
- Modify (only where pins broke): `tests/*-browser.ts` board picks, baselines

**Interfaces:**
- Consumes: shipped generator from Tasks 1–3.
- Produces: green full headed sweep + focused overlap suite.

- [ ] **Step 1: Run the full sweep**

```sh
make browser-test > /tmp/b.log 2>&1; ec=$?; tail -40 /tmp/b.log; echo EXIT=$ec
```

Expected: layout-dependent board picks break (the wrap/pick/motion/seam levels re-rolled). Standing lesson from the v9 release: generator re-rolls rot browser pins, so re-derive each broken pick from the new boards rather than loosening assertions. Mechanics suites (stop/flip/wormhole/rotor/fragile/lock) re-derive their scanned boards automatically where they scan (`assertRegionPark`, `assertEntangledCore`); hardcoded level numbers get updated to the new scan results.

- [ ] **Step 2: Run the focused overlap suite (never part of the full sweep)**

```sh
OVERLAP_ONLY=1 make browser-test > /tmp/o.log 2>&1; ec=$?; tail -30 /tmp/o.log; echo EXIT=$ec
```

- [ ] **Step 3: Commit and push**

```sh
git add tests/*-browser.ts
git commit -m "test: re-derive browser board picks for generator v11"
git push origin main
```

Confirm the pushed `Checks` run passes.

---

### Task 5: Docs and close-out

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-10-08-mechanic-lane-unblocking-design.md` (Status → Implemented), memory note `~/.claude/projects/-Users-probello-Repos-par-arrows/memory/`
- Board: kanban card `01a11d6ea94b716ba0375967018d60f1`

**Interfaces:**
- Consumes: measured numbers from Task 3.
- Produces: documentation matching the shipped generator; card closed against its criteria.

- [ ] **Step 1: Rewrite CLAUDE.md to the node model**

Sections to update (every "the core's lanes are reserved" sentence and the isolated/entangled framing):
- "Generation and seeds" → "Construction": cores place first unchanged; the five lane cores plus double and directional cores enter `dependencyFill` as per-arrow graph nodes on every placement; park core and flip/rotor region stay leads.
- "Reservations": lead tracks are no longer body-forbidden (only park tracks are); fill bodies may rest on mechanic lanes and order before the core via body-on-route edges; `forbiddenRay` unchanged.
- "Lane blockers": seeding stays as the guaranteed teach blocker (D2); the isolated-versus-entangled distinction is gone for the seven — every placed core is node-led; restart-retry drops seeding only.
- Each mechanic section's "The core's lanes are reserved" sentence → "the core's lanes are fill-blockable; the merged certificate orders blockers out first".
- Measured numbers from Task 3: give-up bands, coverage share, timing budgets.
- Tests section: add `tests/lane-blocking.test.ts` coverage.

- [ ] **Step 2: Flip the spec status and write the memory note**

Spec: `Status: Implemented`. Memory note (auto-memory dir, one file + MEMORY.md line): `par-arrows-lane-unblocking-shipped.md` — the D2 ruling, the node-core model, what stayed fenced and why (park/rotor multi-leg certificates), fixture fallout pattern.

- [ ] **Step 3: Close the kanban card against its criteria**

Check each criterion with evidence, per criterion (not blanket): `kanban item check --id 01a11d6ea94b716ba0375967018d60f1 --criterion N --note "<evidence>"` for the three criteria (node-core sweep, green gate with regenerated fixtures, browser sweep + docs), then `KANBAN_ACTOR=claude-par-arrows-laneunblock kanban item done --id 01a11d6ea94b716ba0375967018d60f1 --notes-file <evidence file>`.

- [ ] **Step 4: Commit and push, confirm CI**

```sh
git add CLAUDE.md docs/superpowers/specs/2026-10-08-mechanic-lane-unblocking-design.md
git commit -m "docs: mechanic lanes join the dependency fill (v11)"
git push origin main
```

Confirm the pushed `Checks` run passes; the push is the deploy.
