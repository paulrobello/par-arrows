# Two-Headed Directional Arrows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship two-headed violet/lime arrows whose selected half determines movement, including bidirectional parking, required-use authored and generated content, persistence, tutorials, and verified browser behavior.

**Architecture:** Preserve one logical `ArrowDefinition` and carry a typed `MoveTarget { arrowId, endpoint }` from picking through simulation and animation. Single arrows retain numeric offsets; parked double arrows store complete settled paths so bends and reverse movement remain deterministic. Generation inserts optional, independently seeded double arrows only when its certificate proves a tail-endpoint action is required.

**Tech Stack:** TypeScript 7, Bun test runner, three.js r186, Vite, Biome, Playwright headed browser tests.

**Spec:** `docs/superpowers/specs/2026-09-22-double-arrow-design.md`

## Global Constraints

- Double arrows are one logical entity and never join overlapping-tail groups.
- A blocked selected half fails normally even when the opposite half is safe.
- A parked double arrow may resume toward either endpoint.
- Failure is paid once per arrow and exact settled position, shared by both endpoints.
- Failure preserves violet/lime materials and adds a whole-arrow red outline or glow.
- Light colors: violet `#6D28D9`, lime `#4D7C0F`; dark colors: violet `#C084FC`, lime `#A3E635`.
- Direction must remain legible without color through one arrowhead at each endpoint.
- Level 25 is authored; generated double arrows begin at level 26 and require a tail-endpoint action.
- Existing authored levels 1, 5, 11, 15, and 20 and protected generated levels stay unchanged.
- Every task touches no more than five files and ends with its own focused gate and commit.
- Do not publish a registry package. Final delivery is merge to `main`, push, GitHub Actions verification, and Pages deployment verification.

## Review Focus

1. A parked double arrow bent by a directional spot must reverse from its stored settled path, not from the authored path. Task 1 pins this with a bend-park-reverse unit test.
2. An exact midpoint press must never produce a dead zone or unstable endpoint. Tasks 3 and 4 pin deterministic target selection and midpoint geometry.
3. The paid-failure exemption must reset at a new parked position while remaining shared across endpoints at one position. Task 1 tests both transitions.
4. Corrupt stored double paths must refresh the attempt without losing campaign level or unlocks. Task 7 tests wrong length, duplicate cells, invalid adjacency, and unreachable paths.
5. Generator retries must not perturb unrelated streams or accept decorative double arrows. Task 6 pins protected hashes and replays a certificate containing a tail-endpoint action.

---

**Execution status:** Tasks 1–8 complete. Tasks 5, 6, and 8 were split into bounded subphases recorded in the SDD ledger; final verification, review, merge, push, CI, and deployment remain.


### Task 1: Settled Double-Arrow State and Bidirectional Movement

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/stops.ts`
- Modify: `src/core/movement.ts`
- Modify: `src/core/game-state.ts`
- Create: `tests/double.test.ts`

**Interfaces:**
- Produces: `MoveTarget`, `GameState.settledPaths`, `GameState.failedPositions`, `MoveResult.settledPath`, `settledPathOf()`, and `failurePositionKey()`.
- Preserves: `offsets` and `failedIds` behavior for single arrows and overlap groups.

- [x] **Step 1: Add failing state and movement tests**

Create fixtures for a straight double arrow, a stop in each direction, a blocker on one side, and a directional spot before a stop. Pin these cases:

```ts
const tailMove = simulateMove(level, state, "double", "tail");
expect(tailMove.endpoint).toBe("tail");
expect(tailMove.kind).toBe("paused");
const parked = applyMove(level, state, tailMove);
expect(parked.settledPaths.double).toEqual(tailMove.settledPath);

const reverse = simulateMove(level, parked, "double", "head");
expect(reverse.kind).toBe("exit");
expect(reverse.route[0]).toEqual(parked.settledPaths.double?.at(-1));
```

Also assert: wrong-end blocking despite a clear opposite end; collision leaves the starting settled path unchanged; first blocked head costs one life; blocked tail at the same position is free; parking at a new path makes its first failure paid; single-arrow offsets still advance unchanged.

- [x] **Step 2: Run the focused test and confirm red state**

Run: `bun test tests/double.test.ts`

Expected: FAIL because `settledPaths`, `failedPositions`, and `settledPath` do not exist and tailward parking from a parked path is rejected.

- [x] **Step 3: Add the core types**

Add:

```ts
export interface MoveTarget {
  readonly arrowId: string;
  readonly endpoint: Endpoint;
}

export interface GameState {
  // existing fields
  readonly settledPaths: Readonly<Record<string, readonly Cell[]>>;
  readonly failedPositions: readonly string[];
}

export interface MoveResult {
  // existing fields
  readonly settledPath?: readonly Cell[];
}
```

Initialize the new collections empty in `createGameState`.

- [x] **Step 4: Centralize settled-path and failure-key derivation**

In `stops.ts`, add:

```ts
export function settledPathOf(
  level: LevelDefinition,
  state: Pick<GameState, "offsets" | "settledPaths">,
  arrow: ArrowDefinition,
): readonly Cell[]

export function failurePositionKey(
  arrowId: string,
  path: readonly Cell[],
): string
```

`settledPathOf` returns the stored path for `kind: "double"`, otherwise the existing offset-derived `currentPath`. `failurePositionKey` joins exact `cellKey` values with the arrow ID.

- [x] **Step 5: Make simulation operate on the exact settled path**

Replace the current offset-only orientation in `simulateSingle` with `settledPathOf`. Reverse that path for `endpoint: "tail"`. Remove the rule forbidding tail movement after parking. For `paused`, construct `settledPath` from the moving body at the stopping step. Keep `offset` for compatibility and existing single-arrow animation.

For occupancy, call `settledPathOf` for every other arrow. Double arrows remain one-member moves.

- [x] **Step 6: Apply paused paths and position-scoped failures atomically**

In `applyMove`:

- install `result.settledPath` for paused double arrows;
- retain offset handling for single/group pauses;
- delete settled and failure state on exit;
- derive the attempt-start failure key for double arrows;
- charge only when that key is absent;
- retain `failedIds` behavior for non-double arrows and groups.

- [x] **Step 7: Run focused and adjacent core tests**

Run: `bun test tests/double.test.ts tests/stop.test.ts tests/directional.test.ts tests/core.test.ts`

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/stops.ts src/core/movement.ts src/core/game-state.ts tests/double.test.ts
git commit -m "feat(core): add bidirectional double-arrow state"
```

### Task 2: Validation, Overlap Exclusion, and Endpoint-Aware Solver

**Files:**
- Modify: `src/core/validation.ts`
- Modify: `src/core/overlap.ts`
- Modify: `tests/double.test.ts`
- Modify: `tests/overlap.test.ts`

**Interfaces:**
- Consumes: `MoveTarget`, `settledPathOf`, `GameState.settledPaths`, endpoint-aware `simulateMove`.
- Produces: solver certificates as `readonly MoveTarget[]`; double arrows always form one-member overlap units.

- [x] **Step 1: Write failing validation and solver tests**

Add tests that reject a double arrow with tail-end self-contact, reject any shared directed segment involving a double arrow, and solve a fixture only through `{ arrowId: "double", endpoint: "tail" }`.

```ts
const solution = solveLevel(level);
expect(solution).toContainEqual({ arrowId: "double", endpoint: "tail" });
```

Assert solver visited-state keys distinguish two parked settled paths containing the same arrow IDs.

- [x] **Step 2: Verify the tests fail**

Run: `bun test tests/double.test.ts tests/overlap.test.ts`

Expected: FAIL because `solveLevel` returns bare IDs and overlap derivation can connect double arrows.

- [x] **Step 3: Exclude doubles in overlap derivation and validation**

Make `overlappingArrowIds` return `[arrowId]` immediately for `kind: "double"`. Reject a level when `sharedDirectedSegment` connects any double arrow to another arrow. Preserve current pair/trio behavior for singles.

- [x] **Step 4: Make the solver action space endpoint-aware**

Generate one `MoveTarget` for a single arrow and two for a double arrow. Pass the endpoint through simulation, certificates, and replay. Extend the visited-state serialization with sorted settled-path entries and `failedPositions`.

- [x] **Step 5: Run core solver and overlap tests**

Run: `bun test tests/double.test.ts tests/overlap.test.ts tests/overlap-content.test.ts tests/stop-content.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/core/validation.ts src/core/overlap.ts tests/double.test.ts tests/overlap.test.ts
git commit -m "feat(core): solve double arrows by endpoint"
```

### Task 3: Endpoint-Aware Picking and Application Flow

**Files:**
- Modify: `src/pick.ts`
- Modify: `src/app.ts`
- Modify: `src/render/renderer.ts`
- Modify: `tests/pick.test.ts`
- Modify: `tests/core.test.ts`

**Interfaces:**
- Consumes: `MoveTarget` and endpoint-aware core simulation.
- Produces: `PickCandidate.target: MoveTarget`, `resolvePick(...): MoveTarget | undefined`, endpoint-aware app selection/safety/attempt calls, picker metadata carrying `endpoint`.

- [x] **Step 1: Add failing pure picking tests**

Test direct-vs-near filtering, safe-vs-unsafe endpoint preference on one arrow, distance ordering, and an exact equal-distance tie choosing a stable endpoint.

```ts
expect(resolvePick(candidates, ({ endpoint }) => endpoint === "tail")).toEqual({
  arrowId: "double",
  endpoint: "tail",
});
```

- [x] **Step 2: Run tests and confirm type/behavior failure**

Run: `bun test tests/pick.test.ts tests/core.test.ts`

Expected: FAIL because candidates and callbacks use bare arrow IDs.

- [x] **Step 3: Change the pure picker contract**

Use:

```ts
export interface PickCandidate {
  readonly target: MoveTarget;
  readonly distancePx: number;
}

export function resolvePick(
  candidates: readonly PickCandidate[],
  isSafe: (target: MoveTarget) => boolean,
): MoveTarget | undefined
```

Sort equal distances by arrow ID and then `head` before `tail` so nearby midpoint ties are deterministic. Preserve ray-hit order for direct hits by using a stable sort and candidate order before the fixed fallback.

- [x] **Step 4: Thread `MoveTarget` through the app**

Change selected state, `resolvePick`, `isSafeMove`, `attempt`, tutorial gating, and hint requests to preserve the endpoint. Existing callers create `{ arrowId, endpoint: "head" }` for singles.

- [x] **Step 5: Emit endpoint metadata from renderer candidates**

Initially mark every single-arrow picker as `head`. For double arrows, assign segments before the midpoint to `tail`, after the midpoint to `head`, and both exact-midpoint candidates in stable order. Full midpoint geometry arrives in Task 4.

- [x] **Step 6: Run focused tests and typecheck**

Run: `bun test tests/pick.test.ts tests/core.test.ts && bun run typecheck`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/pick.ts src/app.ts src/render/renderer.ts tests/pick.test.ts tests/core.test.ts
git commit -m "feat(input): preserve selected arrow endpoint"
```

### Task 4: Dual-Head Geometry, Materials, Selection, Hints, and Failure Styling

**Files:**
- Modify: `src/render/ribbon-geometry.ts`
- Modify: `src/render/renderer.ts`
- Modify: `tests/ribbon-geometry.test.ts`
- Modify: `tests/pick.test.ts`

**Interfaces:**
- Consumes: renderer endpoint metadata and `MoveTarget` selection/hint state.
- Produces: distance-split ribbon geometry, dual heads, endpoint-specific material updates, and whole-arrow failure outline/glow.

- [x] **Step 1: Add failing geometry tests**

Pin split positions for even, odd, short, and seam-spanning paths. Verify the two spans cover the full accumulated distance without gap or overlap, and an exact midpoint belongs to both picker boundaries.

```ts
const split = splitExpandedPath(expanded, 0.5);
expect(split.tail.endDistance).toBeCloseTo(split.totalDistance / 2);
expect(split.head.startDistance).toBeCloseTo(split.totalDistance / 2);
```

- [x] **Step 2: Verify red state**

Run: `bun test tests/ribbon-geometry.test.ts tests/pick.test.ts`

Expected: FAIL because `splitExpandedPath` and dual-head visuals do not exist.

- [x] **Step 3: Implement accumulated-distance splitting**

Add a pure `splitExpandedPath` helper that interpolates a point, face, and tangent when the midpoint falls inside a segment. Keep single-arrow output unchanged.

- [x] **Step 4: Render both heads and theme colors**

Extend `ThemePalette` with `doubleTail` and `doubleHead` using the approved values. Build two head meshes for doubles, orient each away from the midpoint, and color each ribbon span with its endpoint material. Set picker metadata from the exact split rather than segment index approximation.

- [x] **Step 5: Apply endpoint-specific selection and hints**

Change `applySelection`, `HintFocus`, tutorial highlighting, and hint pulsing to accept a `MoveTarget`. Only the chosen half brightens/pulses. Singles continue changing their whole material.

- [x] **Step 6: Add whole-arrow failure decoration**

Use a separate red outline/glow mesh or duplicated slightly expanded ribbon/head meshes. Visibility is based on the current settled-position failure key. Do not recolor violet/lime materials.

- [x] **Step 7: Run geometry tests, render typecheck, and build**

Run: `bun test tests/ribbon-geometry.test.ts tests/pick.test.ts && bun run typecheck && bun run build`

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/render/ribbon-geometry.ts src/render/renderer.ts tests/ribbon-geometry.test.ts tests/pick.test.ts
git commit -m "feat(render): draw selectable two-headed arrows"
```

### Task 5: Authored Level 25, Tutorial, Preview, and Loading

**Files:**
- Create: `src/content/double-intro.ts`
- Modify: `src/content/level-loader.ts`
- Modify: `src/content/level-preview.ts`
- Modify: `src/tutorial.ts`
- Create: `tests/double-content.test.ts`

**Interfaces:**
- Consumes: endpoint-aware solver and tutorial `MoveTarget` gating.
- Produces: `DOUBLE_INTRO_LEVEL`, `DOUBLE_INTRO_SCRIPT`, `?feature=double`, and pinned level-25 loading.

- [x] **Step 1: Write failing authored-content tests**

Assert level 25 validates, solves, contains at least one double arrow, requires a tail-endpoint action, cannot solve when every double action is forced to `head`, and has a deterministic six-face layout suitable for the walkthrough.

Also assert `parseLevelPreview("?feature=double")` and resolution select level 25 without campaign state.

- [x] **Step 2: Verify failure**

Run: `bun test tests/double-content.test.ts`

Expected: FAIL because level 25, the feature selector, and endpoint-aware script do not exist.

- [x] **Step 3: Author the introduction level**

Create `DOUBLE_INTRO_LEVEL` with a compact 4×4 teaching cube, five lives, no random policies, and a forced non-default tail move. Prove required use in the test by replaying all head-only alternatives.

- [x] **Step 4: Load and preview level 25**

Return the authored constant from `LevelLoader.load(25)`. Add `double` to preview parsing and resolve it directly to level 25. Add the pinned seed `par-arrows:runtime:7:level:25:double-intro:1` in the generator task, not here.

- [x] **Step 5: Add endpoint-aware tutorial steps**

Extend move advances and gates to include optional endpoint. Add copy explaining that each colored half selects its direction, rotate toward the expected target through existing app behavior, and gate the forced step to the tail half only.

- [x] **Step 6: Run content and tutorial unit tests**

Run: `bun test tests/double-content.test.ts tests/level-preview.test.ts tests/tutorial.test.ts`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/content/double-intro.ts src/content/level-loader.ts src/content/level-preview.ts src/tutorial.ts tests/double-content.test.ts
git commit -m "feat(content): add double-arrow introduction"
```

### Task 6: Seeded Required-Use Procedural Double Arrows

**Files:**
- Modify: `src/content/procedural.ts`
- Modify: `tests/procedural.test.ts`

**Interfaces:**
- Consumes: endpoint-aware certificate replay and validation.
- Produces: `GENERATOR_VERSION = 7`, level-25 pinned seed, dedicated `:double-plan` and `:double-core` streams, optional required-use doubles from level 26.

- [x] **Step 1: Add failing generator tests**

Pin:

- `seedForLevel(25)` to the authored seed;
- no double arrows before level 26;
- deterministic samples from level 26 onward;
- every sampled cube containing a double has a certificate with a tail target;
- replay succeeds and forcing all double endpoints to head fails;
- no double belongs to an overlap group;
- protected level hashes remain unchanged;
- arrow counts remain within the 264 cap.

- [x] **Step 2: Run the focused generator tests**

Run: `bun test tests/procedural.test.ts -t "double"`

Expected: FAIL because v7 planning and placement do not exist.

- [x] **Step 3: Add independently seeded planning**

Use `coreStream(seed, "double-plan")` to decide whether level 26+ attempts a double and `coreStream(seed, "double-core")` for placement. Keep the frequency helper pure and exported for tests. Start conservatively at 20% on level 26 and rise linearly to 45% by level 60, capped thereafter.

- [x] **Step 4: Insert a bounded double-arrow pass**

Run after core starters and before general fill. Convert or place one independent arrow only when both endpoint routes validate, neither route self-contacts or crosses reserved tracks, and the reverse certificate remains valid. Reserve its path from overlap placement.

If bounded attempts exhaust, omit doubles and continue generation.

- [x] **Step 5: Extend certificates and acceptance**

Represent replay entries as `MoveTarget`. Require at least one tail action whenever a double is present. Reject an assembled candidate if head-only replay can clear it. Preserve existing parking prefixes and reversed construction order.

- [x] **Step 6: Bump version and re-pin changed hashes**

Set `GENERATOR_VERSION = 7`, add the level-25 pinned seed, and update only hashes for levels whose v7 seeds intentionally change. Record generation duration for sample levels 26, 40, and 60 and keep the existing test budget.

- [x] **Step 7: Run procedural and content suites**

Run: `bun test tests/procedural.test.ts tests/double-content.test.ts tests/stop-content.test.ts tests/overlap-content.test.ts tests/directional-content.test.ts`

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/content/procedural.ts tests/procedural.test.ts
git commit -m "feat(generator): add required-use double arrows"
```

### Task 7: Persistence and Content Migration

**Files:**
- Modify: `src/storage.ts`
- Modify: `tests/storage.test.ts`

**Interfaces:**
- Consumes: `GameState.settledPaths`, `failedPositions`, v7 seed metadata, authored level 25.
- Produces: `CONTENT_VERSION = 9`, strict parked-path and failure-key validation, safe attempt refresh.

- [x] **Step 1: Add failing persistence tests**

Round-trip a parked bent double path and position failure. Reject saves with wrong path length, duplicate cells, out-of-bounds cells, non-adjacent cells, wrong arrow kind, removed arrow IDs, unreachable paths, and failure keys that do not correspond to current settled positions.

Assert rejection refreshes the attempt while preserving `levelId`, `unlockedLevelId`, settings, and tutorial completion. Assert unchanged protected saves still resume.

- [x] **Step 2: Verify failure**

Run: `bun test tests/storage.test.ts -t "double|content version"`

Expected: FAIL because content version 9 and new state validation do not exist.

- [x] **Step 3: Validate settled paths structurally and by replay**

Add a validator that checks exact arrow length, unique in-bounds cells, surface adjacency, remaining double-arrow ownership, and reachability from authored state through accepted paused moves. Validate failure keys against arrow ID plus authored or stored settled path.

- [x] **Step 4: Bump and migrate content metadata**

Set `CONTENT_VERSION = 9`. Preserve unchanged-level resume rules. Refresh level-25-and-later changed attempts under seed mismatch while retaining campaign progress metadata. No legacy double state migration is needed.

- [x] **Step 5: Run storage and core suites**

Run: `bun test tests/storage.test.ts tests/double.test.ts tests/core.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/storage.ts tests/storage.test.ts
git commit -m "feat(storage): persist parked double arrows"
```

### Task 8: Headed Browser Coverage and Focused Runner

**Files:**
- Create: `tests/double-browser.ts`
- Modify: `tests/browser-runner.ts`
- Modify: `tests/tutorial-browser.ts`
- Modify: `tests/preview-browser.ts`
- Modify: `Makefile`

**Interfaces:**
- Consumes: shipped level 25, endpoint-aware diagnostic state, renderer visuals, storage v9.
- Produces: `DOUBLE_ONLY=1 make browser-test` and full-suite integration.

- [x] **Step 1: Add the focused suite before wiring it**

Implement browser assertions for:

- head, body-half, and exact-midpoint taps;
- direct-hit preservation and widened safe-half preference;
- violet/lime rendering in light and dark themes;
- dual arrowheads as non-color direction cues;
- selected-half and hint-only pulsing;
- blocked wrong half, life loss, red outline, free opposite-end retry at the same position;
- stop, either-direction resume, directional bend, wrap, rewind, and exit;
- level-25 walkthrough and 24 → 25 → 26 progression;
- save/reload of a bent parked path;
- preview isolation for `?feature=double`.

Use logical diagnostic assertions for game rules and measured canvas/picker evidence for rendering and target geometry.

- [x] **Step 2: Wire the runner and verify initial failure**

Add `DOUBLE_ONLY` selection to `tests/browser-runner.ts` and `Makefile`, then run:

`DOUBLE_ONLY=1 make browser-test`

Expected before final fixes: at least one focused assertion fails, proving the new module executes.

- [x] **Step 3: Fix browser-only integration gaps**

Use the failures to correct diagnostic endpoint exposure, tutorial target gating, midpoint picker projection, or save timing. Keep fixes inside the five listed files only; if product code must change, amend the owning earlier task commit before continuing.

- [x] **Step 4: Expand shared tutorial and preview assertions**

Add level 25 to `MECHANIC_INTROS`. Verify `?feature=double` reports preview mode and never writes or clears campaign saves.

- [x] **Step 5: Run Chromium and WebKit focused suites**

Run:

```bash
DOUBLE_ONLY=1 make browser-test
BROWSER_ENGINE=webkit DOUBLE_ONLY=1 make browser-test
```

Expected: PASS in real headed browsers with valid WebGL evidence.

- [x] **Step 6: Run adjacent focused suites**

Run:

```bash
STOP_ONLY=1 make browser-test
DIRECTIONAL_ONLY=1 make browser-test
OVERLAP_ONLY=1 make browser-test
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add tests/double-browser.ts tests/browser-runner.ts tests/tutorial-browser.ts tests/preview-browser.ts Makefile
git commit -m "test(browser): verify two-headed arrows"
```

### Task 9: Documentation, Final Verification, Review, and Delivery

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-22-double-arrow-design.md`
- Modify: `docs/superpowers/plans/2026-09-22-double-arrow.md`

**Interfaces:**
- Consumes: final shipped constants, commands, level progression, and migration behavior.
- Produces: current project documentation and checked plan/spec status.

- [x] **Step 1: Update shipped documentation**

Document level 25, generated level-26 behavior, colors, position-scoped failure, bidirectional parking, overlap exclusion, preview selector, generator v7, content version 9, and `DOUBLE_ONLY=1 make browser-test`. Change spec status to implemented and mark completed plan checkboxes truthfully.

- [x] **Step 2: Run the full repository gate**

Run: `make checkall`

Expected: format-check, lint, typecheck, all Bun tests, build, and icon verification pass. Warnings may be reported only if pre-existing and non-failing.

- [x] **Step 3: Run the full headed browser suite**

Run: `make browser-test`

Expected: PASS with a real headed browser and working WebGL.

- [x] **Step 4: Verify graph dependents after implementation**

Run parsight `get_symbol_context` for `MoveTarget`, `simulateMove`, `resolvePick`, and `GameState`; run `get_impact` for `MoveTarget`. Confirm all callers use endpoints and no bare-arrow path bypasses endpoint selection.

- [x] **Step 5: Commit documentation**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-09-22-double-arrow-design.md docs/superpowers/plans/2026-09-22-double-arrow.md
git commit -m "docs(gameplay): document two-headed arrows"
```

- [x] **Step 6: Request whole-branch code review and fix findings**

Invoke `superpowers:requesting-code-review` against the complete branch. Apply confirmed findings with the owning focused tests, then rerun `make checkall` and the focused Chromium/WebKit suites. Commit each fix atomically.

- [ ] **Step 7: Rebase and squash-merge to main**

From the worktree, fetch and rebase onto current `origin/main`. From the main checkout, squash-merge the worktree branch and create one commit:

```bash
git fetch origin
git rebase origin/main
git -C /Users/probello/Repos/par-arrows merge --squash worktree-double-arrow-design
git -C /Users/probello/Repos/par-arrows commit -m "feat(gameplay): add two-headed directional arrows"
```

- [ ] **Step 8: Push and verify CI/deployment**

Push `main` to the repository's own remote. Find the new GitHub Actions runs for `ci.yml` and `deploy.yml`, watch both with `gh run watch <run-id> --exit-status`, and fix forward on failure. Verify `https://arrows.pardev.net` serves the deployed revision and `dist/version.json`/the live version diagnostic identifies the merged commit.

- [ ] **Step 9: Close the board card and clean the worktree**

Check each acceptance criterion with command evidence, mark card `01a0cbe0d7307e63a7fb2109cb558b0c` done, then remove the merged worktree and branch from the main checkout. Verify `git worktree list` no longer contains `double-arrow-design`.
