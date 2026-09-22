# Generator Variety: Spot Chains, Park Patterns, Blocked Density

Date: 2026-09-22
Status: Approved design, pending implementation plan

## Problem

Generated directional cubes all build the same head-on core (one bend, two facing
arrows), park cubes draw from only four deadlock patterns, and nothing targets
how many arrows start blocked — so after level 10 the puzzles feel repetitive
and under-constrained. The user asked for more mechanical variety in the
directional and parked mechanics, multi-bend chains at later levels, and a
higher blocked-arrow share past level 10.

## Goals and non-goals

Goals:

1. A single arrow can bend through two or three directional spots in one move
   at later levels (progressive ramp).
2. Park cubes draw from a larger, mechanically distinct pattern catalog.
3. A targeted, rising share of arrows start blocked from level 12 onward
   (steep ramp: 30% → 55%).

Non-goals:

- Renderer or visual changes (explicitly declined).
- Authored campaign levels 1–20 change anything: they stay byte-identical.
- New mechanics beyond spots and stops (no new fixture types).

## Ground truth from the code

- The core already supports arbitrary bends: `arrowTrack`
  (src/core/stops.ts:41) and `simulateMove` (src/core/movement.ts:235) apply
  `spotHeadingAt` at every step. No core changes are needed for chains.
- `validateLevel` does not forbid chains; it forbids overlapping static paths
  and self-contact along the full route including bends
  (src/core/validation.ts).
- `extraDirectionalSpots` (src/content/procedural.ts) already re-walks tracks
  after the core's bend and simulates every traverser solo with each candidate
  spot; chains are possible today by accident but never deliberate.
- `PARK_PATTERNS` holds exactly four patterns: classic, long, cascade, double.
- Reverse construction: each arrow's exit ray must be clear of earlier-placed
  arrows, and the certificate drives last-placed-first. Blocked-ness at level
  start is emergent, not targeted.

## Design

### 1. Deliberate spot chains (multi-bend)

Keep the required head-on core unchanged. Change `extraDirectionalSpots`:

- After placing a spot, re-walk the affected traversers' tracks. The cells on
  their newly bent corridors join the candidate pool for that face as
  first-choice candidates, ahead of straight-lane cells.
- A chain-depth budget gates how many of a single traverser's bends may chain:
  depth 1 (single bend) through level 20; **depth 2 from level 21; depth 3
  from level 40**. The gate derives from the level id deterministically (pure
  function of the id, no new seeded stream needed for the gate itself; chain
  candidate ordering uses the existing `:dir-cells` stream so selection stays
  deterministic).
- Every candidate keeps the existing vetting: each traverser simulated alone
  with the trial spot must exit cleanly, and its bent route must avoid
  earlier-replaying arrows and the parking core's tracks. The existing
  fallback to core-only when a replay breaks still applies.

Chains therefore appear wherever the cube's geometry and spot budget allow,
commonly rather than exceptionally, with depth growing by level band.

### 2. Extended park pattern catalog

Grow `PARK_PATTERNS` from four to seven. The three additions are mechanically
distinct from the existing straight-lane shapes:

- **twist** — one circle, three arrows; the freed arrow's lane is L-shaped, so
  the unwind turns a corner instead of running straight.
- **twin** — two circles, four arrows; two independent one-park deadlocks on
  one face, so two *different* arrows each need a park (contrast `double`,
  which parks one arrow twice). The eligibility filter (`stops.length <=
  stopCount`) naturally restricts it to 2–3-circle levels. The certificate
  gains an ordered second park leg; `replayCertificate` already advances
  per-id offsets, so the replay machinery needs a pattern-declared park-leg
  list rather than the current implicit "all stops belong to one parker".
- **crossfire** — one circle, five arrows; an interleaved unwind where two
  followers free each other in turn before the third leaves.

Constraints preserved for every pattern:

- Same-face delta authorship, rotation via `patternCell`.
- Every core arrow's first route cell hits another core arrow with circles
  stripped (parking provably required).
- Placement replays the core-only certificate through real movement; failure
  rejects the placement, and the decorative-circles fallback stands.
- **Byte-identity guard:** levels with id ≤ 10 pick from the original four
  patterns only (catalog slice using the same `id <= 10` bound the seed
  strings use). Extended-catalog selection applies only to v6 cubes, so the
  pattern-pick roll cannot disturb protected layouts.

### 3. Targeted blocked-arrow density

New pure helper `blockedStats(level)`: collapses arrows into tap units via
`overlappingArrowIds` (a shared-tail group counts once) and returns `{ blocked,
total }` — the count of units whose immediate `simulateMove` at the initial
state returns `blocked`, and the total unit count. Exported for tests; no I/O.

Target curve, also a pure exported function:

- `blockedTarget(id)` = 0 for id ≤ 10 and the authored intros (5, 11, 15, 20);
  0.30 at id 12; linear rise to 0.55 at id 60; 0.55 thereafter.

Generator change — a deliberate blocker pass, run after the main fill loop and
before extra spots and decorative stops:

- Attempts to place enough additional arrows so that `blockedUnits / units ≥
  target − 0.06`. Each blocker candidate must (a) keep the standard clear own
  exit ray, (b) actually increase the blocked count when added (its body lands
  across some earlier arrow's head-route cell — static paths may never
  overlap, and validation enforces that), and (c) pass `validateLevel` solo.
- Blockers place last, so they lead the reversed certificate and replay
  infallibly. On spot cubes the blocker pass runs before extra-spot vetting,
  so spots are chosen against the final occupancy.
- If the pass exhausts its attempts below target, the restart loop retries;
  the final accept-any-valid tier accepts an under-target level rather than
  throwing, preserving the total-degradation guarantee
  (commit d94e53f).

Order of construction becomes: overlap starter / park core / directional core /
straight and wrap starters / main fill / **blocker pass** / extra spots /
decorative stops / acceptance.

### 4. Versioning, migration, docs

- `GENERATOR_VERSION` bumps 5 → 6. `seedForLevel` already embeds the version
  for generated ids ≥ 12, so those cubes rebuild under new seeds and existing
  saves refresh through the established attempt-refresh path (level, unlocks,
  and tutorial state preserved). Levels ≤ 10 and the authored intros keep
  their pinned seed strings and layouts.
- CLAUDE.md's generator section and the README storage/migration note are
  corrected in the same change: version lineage, chain gating bands, extended
  park catalog, blocked-target rule.

## Testing

Unit (Bun, `tests/*.test.ts`):

- `blockedUnits`: hand-built levels with known blocked/free mixes, including a
  shared-tail group counting once and a parked-offset edge case.
- `blockedTarget`: curve values at band edges (10, 12, 40, 60, far levels).
- New park patterns: each replays through `parkingCore` placement on a
  synthetic budget; eligibility by stop budget; legacy slice keeps ids ≤ 10 on
  the original four.
- Chains: depth gate at band edges; a generated sample across 21–39 contains
  chain cubes and respects depth 2; a 40+ sample respects depth 3; required-use
  property (spot-stripped cube unsolvable) holds for chain cubes.
- Blocked push: a deterministic sample of ids ≥ 12 meets target − tolerance
  or lands in the documented degradation case; ids ≤ 10 layouts byte-identical
  to current output (pin a hash or structural snapshot).

Browser (headed suites, existing infrastructure):

- Existing directional, stop, overlap, and campaign suites must stay green;
  `DIRECTIONAL_ONLY=1` and `STOP_ONLY=1` runs are the focused verification for
  the touched mechanics.

## Risks

- Restart pressure: chains plus blockers tighten construction. Mitigation:
  bounded attempts per pass, existing tier ladder, final valid-accept tier.
- Solver cost in the non-certificate tier: higher blocked share could push
  more levels into backtracking. Certificate tiers cover nearly all
  constructions; the budget is unchanged.
- Determinism: all new choices ride seeded streams (`:dir-cells`, core
  streams) or pure functions of the id; no wall-clock or Math.random.
