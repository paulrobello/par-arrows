# Difficulty Depth Redesign — Generator v9

Date: 2026-09-26
Status: draft for review

## Problem

Level 40 carries 264 arrows — the hard cap — yet plays easy. About 250 of those
arrows are filler that peels in an obvious one-at-a-time order; the real
difficulty lives in the embedded cores (park, directional, double, flip,
wormhole), each a 2–6-arrow island solved pocket by pocket. The player never
has to hold more than one small pocket in their head at a time.

Three structural causes:

1. **Blocked share measures the wrong thing.** `blockedTarget` (0.30 at level 12
   rising to 0.55 at 60, then flat) counts tap units that cannot move at the
   initial state. An arrow blocked by one trivially removable blocker scores the
   same as one deep in an interlock. The pass that produces it
   (`runBlockerPass`) places isolated blocker pairs; it never pursues
   transitive chains.
2. **The ramp is slow and low.** Levels 1–11 have zero initially-blocked
   arrows (`blockedTarget` returns 0 through id 11). Everything plateaus by
   level 90 while the campaign runs to 200.
3. **Density hurts readability.** Generated levels fill to 156–264 arrows on
   22–26-cell faces. Most taps are load-bearing for nothing; the board reads as
   noise.

## Goals

1. Difficulty means **ordering depth**: how much of the cube the player must
   reason about as one interlocked problem. Measured by a solver-derived
   metric and gated at generation time per level.
2. Steeper ramp: depth pressure starts at level 6, not 12.
3. Roughly half the arrows and smaller grids, so each arrow matters and the
   board reads on mobile.
4. Preserve: all mechanic cores, the winnability rule, solver validation,
   seed/stream determinism, picking, storage semantics, and the authored
   teaching levels 1/5/11/15/20/25/30/35.

## Non-goals

- Leniency changes: first failure costs one life, repeated failures free —
  unchanged.
- No new mechanics.
- No changes to authored level layouts.

## 1. The depth metric — `src/content/difficulty.ts`

New pure module over `LevelDefinition`, importing only from `src/core`
(`simulateMove`, cell keys). Tap units follow the existing `blockedStats`
definition: a single arrow or one shared-tail group.

- **Blocking DAG.** For each unit U whose move at the initial state is
  `blocked`, the contacted occupancy belongs to some unit V; add edge U→V.
- **`chainDepth(level)`** — longest path in the blocking DAG. This is the
  headline number: a chain of depth N means the player must trace N arrows deep
  to know which head is actually free.
- **`forcedShare(level)`** — units with in-degree ≥ 1, over all units.
- **`peelLayers(level)`** — repeatedly remove all movable units (simulate their
  removal by dropping ids from the remaining set) and count rounds until the
  board clears or nothing moves. Greedy solve depth; reported, not gated.
- **`depthStats(level)`** returns all of the above plus the existing blocked
  share (absorbing or delegating to `blockedStats`).

Cost is bounded: each peel round scans remaining units with `simulateMove`
(~120 units × ~10 rounds worst case), memoized per round. This runs once per
assembled candidate, not per placement attempt.

## 2. The depth gate — `depthTarget(id)`

A generated level must meet, on the fully assembled board (stops, spots,
groups, and cores applied — the same basis `blockedStats` measures today, with
wormholes stripped):

| ids | chainDepth ≥ | forcedShare ≥ |
|---|---|---|
| 6–10 | 2 | 0.20 |
| 12–40 | 4 → 5 linear | 0.30 → 0.48 |
| 42+ | 5 | 0.48 |

Authored levels bypass the gate (they do not run through `generateLevel`).
Tolerance mirrors the existing blocked-share behavior: accept within −1 chain
or −0.05 share after the fallback ladder is exhausted, so construction always
terminates. The ceiling is what construction delivers inside the restart
budgets — deeper targets fell to the tier-3 escape on a third of late boards
(measured over ids 6–200); revisit when placement gets cheaper. The gate binds
the two certificate tiers; the final tier accepts a short board rather than
throwing, and the depth-generation sweep is the net for shipped boards.

`blockedTarget` stays as a secondary gate with its current curve; the depth
gate is the new primary signal. If the 2–200 sweep shows the two gates fight
each other, `blockedTarget` is rebased in the same release rather than left to
drift.

## 3. Arrow count and grid — `getLevelConfig`

One unified curve for every generated id (2+); authored levels keep their
config. The `early`/`earlyGrid` tables retire.

- `arrowCount = min(120, 36 + 2 * id)` — id 2: 40, id 12: 60, id 40: 116,
  id 52+: 120. Today: 60 → 264.
- `gridSize = min(18, 10 + floor(id / 4))` — id 2: 10, id 12: 13, id 20: 15,
  id 32+: 18. Today: 12 → 26.- The 264 cap disappears everywhere: `getLevelConfig`, the `runBlockerPass`
  guard, README, and the `procedural.test.ts` assertions (now 120).
- `arrowScale` keeps its `gridSize`-derived formula; `lives` unchanged.

## 4. Generator changes

1. **Chain pass (as built).** After the assembled-board blocker top-up,
   `aimedCandidate` places a straight lane whose exit ray runs into the
   deepest unit's body; each accepted link blocks on the current deepest unit
   (verified with one `simulateMove` — a full `chainStats` probe per candidate
   made the sweeps too slow). The accepted arrow's actual route (spots bend
   straight lanes) is reserved against later relay placements, lanes stay out
   of the flip region and off the portal ends, and the aim refreshes so the
   next link targets the new deepest unit. The relay closes the
   reverse-construction certificate: chain ids are excluded from the reversed
   section and appended last in push order, doubled (a parked leg takes its
   second entry; an exited leg is skipped). A shortfall beyond tolerance
   skips with `skip = "depth"` on the certificate tiers; the final tier
   accepts short rather than throwing.
2. **Core coupling (emergent, as amended during review).** There is no
   separate core-filler placement: core arrows live in the same blocking DAG
   as everything else, so relay links block on them whenever they are
   deepest, and core clearance is exactly what unlocks the link.
3. **Depth gate.** `chainStats` runs on the assembled level; shortfalls on
   the certificate tiers trigger the existing fallback ladder exactly like a
   blocked-share shortfall. The final tier accepts short boards; the
   depth-generation sweep is the net.

## 5. Release mechanics

- `GENERATOR_VERSION` 8 → 9. Seed strings change for ids ≥ 11; ids 2–10 keep
  their legacy seed strings but their layouts change via the new config.
- `tests/fixtures/v8-layouts.json` regenerated in place (path name kept;
  CLAUDE.md references updated to note it carries v9 fingerprints).
- Saves: fingerprint mismatch refreshes each attempt once, preserving level,
  unlocks, and tutorial completion. `CONTENT_VERSION` stays 13.
- Docs updated: README numbers, CLAUDE.md Generation section.
- Browser suites re-derived where they pin generated examples: the level-76
  pending-flip park case, the first U-turn cube scan, and the first
  two-wormhole cube. Where the suites already scan dynamically they stay as
  written.

## Testing

- `tests/difficulty.test.ts` — metric units on synthetic cubes: a known
  transitive chain scores its exact depth; a free cube scores depth 1;
  groups count as single units; parked/stop interactions reflected.
- `tests/depth-generation.test.ts` — sweep 2–200: every generated id meets its
  gate within tolerance, construction stays deterministic, sweep runtime
  budgeted (today's sweeps are the reference).
- `tests/procedural.test.ts` — new arrow/grid formulas and the 120 cap.
- Fixture refresh plus all existing suites; full `make checkall`; headed
  browser suites for every mechanic focus mode plus the full sweep.
- Manual calibration in the plan: play levels 12, 40, and 90 after
  regeneration and confirm the felt difficulty matches the targets.

## Risks

- **Feasibility.** Chain-10 on an 18-grid could over-reject; the tolerance and
  fallback ladder keep construction terminating, and the sweep test exposes
  systematic misses early.
- **Generation time.** Depth analysis per candidate adds cost; memoized peels
  and attempt budgets bound it, measured against today's sweep baselines.
- **Proxy risk.** Chain depth correlates with, but is not identical to, felt
  difficulty; the manual calibration step is the check.
