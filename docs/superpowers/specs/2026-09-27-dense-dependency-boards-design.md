# Dense Dependency Boards — Generator v10

Date: 2026-09-27
Status: implemented
Board card: `01a0e56e0f887ea0a7929a680ba4291f`

## Problem

Levels 44 and 45 play no harder than earlier cubes. The reference game's
"super hard" cubes have almost no empty space, and many arrows there need 15 or
more removals before they can leave. Measured at `7fcdefc` over levels 43–70
plus every tenth level to 200, one board per level:

| Code | Finding | Today |
|---|---|---|
| F1 | Cells covered by arrow bodies | 0.58–0.78, median 0.70 |
| F2 | Heads with zero cells to their exit | 22–36%, median 30% |
| F2 | Heads within two cells of their exit | median 57% |
| F2 | Arrows free at the start | 42–49% |
| F3 | Arrows that must leave before a given arrow (median) | 1 |
| F3 | Share of arrows needing 15 or more removals first | median 2%, max 6% |
| F4 | Shared-tail groups whose heads all sit on one face and heading | 29 of 41 |

F1–F3 share one cause. `generateLevel` builds by reverse construction: a
fill arrow is placed only when its exit ray is clear of every arrow placed
before it. As the cube fills, only arrows with very short rays still fit, so
heads pile up at edges, fill stalls near two thirds, and dependency stays
shallow. The v9 relay pass and blocker top-up work around the rule without
changing it, which is why deeper v9 targets fell to the fallback tier.

F4 is separate: every group pattern starts all members on one cell heading
one way, and most members end parallel to that heading.

## Goals

1. Boards cover at least 0.78 of the cube on every grid of 13 or more, a
   floor the certificate tiers' coverage restart holds (measured minimum
   0.782 over levels 2–200), with no fill head on its exit edge.
2. Difficulty is the number of arrows that must leave before an arrow can
   exit. From level 60 the median arrow needs about 30, and more than half
   need 15 or more.
3. One smooth curve from level 2 to 60, then hold. Early levels get denser
   but stay easy.
4. Shared-tail group heads diverge.
5. Preserve every mechanic core, the winnability rule, solver-validated
   certificates, seed and stream determinism, storage semantics, and the
   authored teaching levels 1, 5, 11, 15, 20, 25, 30 and 35.
6. Generation stays at or under one second per level.

## Non-goals

- No rule changes: collisions, lives, hints, parking, spots, portals and
  groups behave exactly as today.
- No new mechanics, no renderer changes, no grid-size changes.
- Authored levels keep their layouts and seeds.

## Measured basis

A throwaway prototype (scratchpad, not in the repo) placed plain boards with
the construction below on real grid sizes and wrap edges, three seeds per
setting:

| Level | Grid | Arrows | Dial `clearShare` | Coverage | Free at start | Median prerequisites | Share ≥15 |
|---|---|---|---|---|---|---|---|
| 2 | 10 | 40 | 1.00 | 0.81 | 0.31 | 2 | 0.05 |
| 10 | 12 | 56 | 0.85 | 0.79 | 0.22 | 3 | 0.11 |
| 12 | 13 | 60 | 0.85 | 0.82 | 0.17 | 4 | 0.17 |
| 24 | 16 | 84 | 0.60 | 0.81 | 0.15 | 7 | 0.38 |
| 44 | 18 | 152 | 0.30 | 0.84 | 0.11 | 32 | 0.66 |
| 100 | 18 | 170 | 0 | 0.87 | 0.09 | 37 | 0.69 |
| 100 | 18 | 200 | 0 | 0.90 | 0.08 | 46 | 0.73 |

Fill plus tail growth took under 10 ms per board. Every dense board kept 26–52
cells where a circle cannot strand an arrow, against a need of at most three.

## 1. Construction

Applies to every generated level: 2–4, 6–10, 12–14 and 16 up. Authored levels
return their fixed definitions as today.

### 1.1 Cores first, unchanged

The shared-tail group, parking core, directional core, double core, wormhole
cores, flip core, straight starters and wrap starters are placed exactly as
today, in the same order, with the same reservations and proofs. Their
certificates lead the replay as today.

One reservation is added: the parking core's tracks (`parkTrackKeys`) join the
set fill bodies may not occupy. A park-core arrow must leave before any fill
arrow, so a fill body on its track would block it for good.

### 1.2 Dependency graph

Construction keeps a directed graph over **units**. A unit is one arrow, or one
shared-tail group (every member together). An edge `A → B` means A must leave
before B can exit.

- Every core arrow placed in 1.1 except the group and the straight and wrap
  starters is a **lead** arrow: parking, directional, double, wormhole and
  flip core arrows. Lead arrows leave first, in the order of 1.5, so they are
  not graph nodes. Every lead arrow's tracks are reserved against fill bodies,
  since a fill body on a lead track would block it for good. The existing
  reservations cover the double, wormhole and flip cores and the directional
  corridor. The parking core's tracks are the one addition. A fill ray may
  cross a double, directional or wormhole lead body, and the directional
  corridor, because they are gone before the fill moves. Park and flip lead
  bodies are the exception: they stay ray-forbidden through the park tracks
  and the flip-region cells (see 1.3).
- The group, the straight starters and the wrap starters are ordinary graph
  nodes. The group's node carries the union of its members' bodies and
  routes.

### 1.3 Fill by insertion

Each fill attempt draws a head, heading and body with the existing
`candidate` walk (same length curve, turn and seam probabilities), except the
exit ray is not required to be clear. A candidate X is accepted when all of
these hold:

1. Its body avoids every occupied cell and every reserved cell.
2. Its exit route has at least one cell before it leaves the cube, so no fill
   head sits on its edge.
3. Its exit route crosses no **forbidden ray cell**. These are exactly the
   stop circles, the spot cells placed before the fill, the flip-region
   cells, the wormhole ends, and the parking core's tracks. Double-core,
   directional-corridor and wormhole-core tracks may be crossed, because their
   arrows are gone before any fill arrow moves.
4. **Before-set**: the units owning bodies on X's route. **After-set**: the
   units whose routes cross X's body. The two sets are disjoint, and no unit
   in the after-set reaches a unit in the before-set in the graph, so adding X
   keeps the graph acyclic.
5. With probability `clearShare(id)` the attempt additionally requires an
   empty before-set. This is today's rule and it drives the curve (see 2.1).
6. The shape cap still applies.

On acceptance, X becomes a node with edges from its before-set and to its
after-set. Attempts stop at the level's arrow count or at the existing attempt
bound.

Routes use `arrowTrack` on the board as known at fill time: wrap edges and
the cores' spots and portals are already placed. Spots added later are
covered in 3.2.

### 1.4 Tail growth

After the fill, a pass repeatedly extends each fill arrow's tail by one cell
into an empty neighbour, while all of these hold:

- the arrow stays at 40 cells or fewer;
- the cell is neither reserved nor on the arrow's own route;
- the cell does not push the arrow's canonical shape past the level's cap;
- every unit whose route crosses the cell is not an ancestor of the arrow, so
  the new edges keep the graph acyclic.

Growth stops when a full sweep extends nothing.

### 1.5 Certificate

```
flip region lead → wormhole cores → double core → park legs
  → parking core arrows (reverse placement order, as they unwind today)
  → directional core arrows
  → any topological order of the graph (ties broken by insertion order)
```

Today the parking core's arrows unwind inside the reversed fill section, after
every fill arrow. Under v10 they unwind right after their park legs, which the
core's own proof already guarantees. Any lead arrow whose track is not yet
reserved against fill bodies must be reserved, so every lead leg replays on a
board where the fill is still present.

`replayCertificate` stays the acceptance proof, followed by `validateLevel`,
exactly as today. The final non-certificate tier keeps its
`solveLevelTargets` check.

The v9 blocker pass (`runBlockerPass`, `blockerReserve`), relay chain pass
(`aimedCandidate`, `chainLaneKeys`, `chainIds`) and the doubled chain append
are deleted.

## 2. Difficulty curve and gate

### 2.1 Curve

Every function is piecewise linear between the waypoints below and holds its
last value past level 60.

- `clearShare(id)`: 1.0 on levels 2–4, then 0.95 at level 6 falling to 0 at
  level 60. It is the dial, not a gate.
- `medianTarget(id)`: 0 through level 11, then 2 at levels 12–20, 6 at 40 and
  12 from 60, rounded to an integer.
- `deepShareTarget(id)`: 0 through level 12, then 0.06 at 20, 0.36 at 40 and
  0.48 from 60.
- `freeCap(id)`: 0.40 through level 10, then 0.26 at 20, 0.21 at 40 and 0.16
  from 60.

The targets are floors (and `freeCap` a ceiling) set from measured
percentiles, not goals: construction delivers the depth, and the gate only
rejects outliers. Each band's last level sits at or below the band's 10th
percentile of `median` and `deepShare`, and at or above its 90th percentile
of `freeShare`, measured with `scripts/measure-boards.ts` on fully assembled
boards over levels 2–200:

| Band | `median` P10 | `deepShare` P10 | `freeShare` P90 |
|---|---|---|---|
| 2–10 | 1.00 | 0.01 | 0.32 |
| 12–20 | 2.60 | 0.07 | 0.23 |
| 21–40 | 6.40 | 0.36 | 0.19 |
| 41–60 | 13.70 | 0.49 | 0.15 |
| 61–200 | 12.00 | 0.48 | 0.13 |

On that sweep 6 of 192 boards (3%) fall short on first construction and
restart. Construction delivers far more than the floors: from level 61 the
typical board's median closure is around 31 (the 61–200 P50 is 31.5).

### 2.2 Arrow count

`getLevelConfig` keeps its current curve through level 57 (178 at 57), then
rises by 2 per level to a cap of 200 at level 68. Through level 42 the count
is also held at no less than `round(0.075 × 6 × gridSize²)`, 0.075 arrows per
cell, which raises coverage where the older curve fell short (for example 45
at level 2 and 146 at levels 32–42). The density alone does not guarantee the
0.78 floor: the certificate tiers' coverage restart (see 2.3) is what holds
it.
`MAX_GENERATED_ARROWS`
becomes 200, since the blocker top-up that needed headroom is gone. Grid size
and `arrowScale` are unchanged, so arrows keep their on-screen size.

### 2.3 Gate metric — `src/content/difficulty.ts`

`closureStats(level)` works on the fully assembled board with wormholes
stripped, as the current gate does. For every tap unit it lists the units
whose bodies sit on its route: each double endpoint's route taken separately,
spots and wraps included, groups as one unit. It then takes the transitive
closure and reports:

- `median`: median closure size over units;
- `deepShare`: share of units whose closure is 15 or more;
- `freeShare`: share of units with an empty closure.

Certificate tiers skip a board (`skip = "depth"`) whose `median` or
`deepShare` falls below target, or whose `freeShare` exceeds `freeCap`, each
beyond a tolerance of 10% of its target. The final tier accepts it. The level
sweep flags any shipped board below target.

A board whose bodies cover less than 0.78 of a cube of grid 13 or larger also
restarts on the certificate tiers (`skip = "coverage"`).

`chainStats`, `deepestUnit`, `depthTarget`, `blockedStats`, `blockedTarget`
and `peelLayers` are deleted with their callers and tests.

## 3. Mechanics

### 3.1 Cores

Section 1.1 covers placement. Every core's proof (park-core stranding
enumeration, directional required-use, double required-use, wormhole
required-use, flip region proof) runs exactly as today, before the fill.

### 3.2 Spots and circles placed after the fill

`extraDirectionalSpots` and `reversalBlockers` place after the fill, as
today. They currently vet a bent route against `cellsBefore`, the bodies of
arrows pushed earlier. Under v10 that check means "bodies still on the board
when this arrow moves": the bodies of units that come after it in the
certificate order. Both functions take the certificate order as input and
build their check sets from it. A kept spot must also leave every
before-set/after-set relation of every traverser intact. Because the replay
remains the final judge, a spot that breaks the order is dropped by the
existing prefix trimming.

`chooseStops` and `strandSafeCircle` are unchanged. `decorativeWormhole`
already takes the certificate and replays it.

### 3.3 Shared-tail groups (F4)

The catalog gains fork patterns whose final legs diverge:

- **fork**: a pair splits north and south after a shared tail;
- **trident**: a trio splits north, south and forward;
- **seam fork**: one member crosses a cube seam and turns, the other turns
  on the starting face.

They use the existing walk, prefix, route-disjointness and exit-ray checks.
The group is placed first, as today. The v9 rule keeping blocker bodies off
group routes goes away. It was only a scoring choice in the blocker pass,
while `validateLevel` checks members against each other only.

Target: over levels 16–200, at most 30% of groups have every head on one face
and heading.

## 4. Seeds, storage, compatibility

- `GENERATOR_VERSION` becomes 10. Every generated level, including 2–4 and
  6–10, takes the seed `par-arrows:runtime:10:level:<id>`. Authored levels
  keep their seed strings.
- `CONTENT_VERSION` is unchanged. Saves refresh through the layout
  fingerprint check once per re-rolled level, as in v8 and v9.
- Stream names (`:park-core`, `:dir-plan`, `:flip-plan`, `:wormhole-plan` and
  so on) are unchanged. They hash the new seed, so every plan re-rolls.

## 5. Testing

### 5.1 New unit tests

- Graph construction on small cubes: every accepted board is acyclic, its
  topological order replays, and `validateLevel` passes.
- `closureStats` on hand-built boards: a straight chain, a diamond, a
  shared-tail group as one unit, and a double arrow whose endpoints have
  different prerequisites.
- Curve functions at their waypoints.
- Group divergence over levels 16–200.

### 5.2 Updated sweeps over levels 2–200

- Depth sweep (`tests/depth-generation.test.ts`): switches to the closure
  gate. It adds a coverage floor of 0.78 on grids of 13 and up, and no fill
  head on its exit edge.
- Procedural, flip, wormhole, region, shape-variety and double sweeps: keep
  their mechanic assertions, and drop blocked-share and chain-depth
  assertions.
- Generation time: at most 1 s per level, asserted in
  `tests/depth-generation.test.ts`.
- Mechanic counts: over levels 2–200, placed static spots, flip spots, stop
  circles, wormholes and double arrows stay within 10% of the v9 totals. v9
  at `7fcdefc` over 192 generated levels: 707 static spots, 112 flip spots,
  279 of 279 budgeted stop circles, 98 wormholes, 72 double arrows, and a
  group on 181 levels. Stop circles must stay at the full budget.

### 5.3 Fixtures and pins

`tests/fixtures/v8-layouts.json` is regenerated with
`scripts/write-layout-fixture.ts`. Every layout-coupled pin is re-derived with
a scratchpad probe, never by loosening its assertion:

- the pending-flip park (level 44 today);
- the strand-trap cube (13 today);
- the generated U-turn scan;
- the pick, seam-fill and wrap fixture levels;
- the wrap-intro level-10 count;
- the two-wormhole browser level.

### 5.4 Gates

1. `make checkall` after every phase.
2. Full headed `make browser-test`.
3. Focused runs: `STOP_ONLY`, `FLIP_ONLY`, `WORMHOLE_ONLY`, `OVERLAP_ONLY`,
   `DIRECTIONAL_ONLY`, `DOUBLE_ONLY`, and a `PWA_ONLY` smoke run.
4. A playtest of levels 12, 44 and 100 by the owner before merge.

## 6. Documentation

README and CLAUDE.md: rewrite the Generation and seeds and Depth gate
sections and the density line to describe v10. Memory notes for v9 and the
density bump are superseded by a v10 note.

## 7. Rollout

Work happens in the `dense-dependency-boards` worktree, in phases of at most
five files, each committed after a green `make checkall`. The series is
squash-merged to `main` and pushed after the full browser sweep and the owner
playtest pass. The push deploys.

## Risks

| Code | Risk | Mitigation |
|---|---|---|
| R1 | Post-fill spots bend routes and add dependencies the graph did not plan for | Order-aware vetting in 3.2, replay as judge, existing prefix trimming |
| R2 | Denser boards leave fewer strand-safe circle cells | Prototype measured 26–52 per board against a need of 3; the mechanic-count sweep catches regressions |
| R3 | Dense boards starve extra-spot and decorative-wormhole candidates | Mechanic-count sweep; reserve cells before the fill if counts drop more than 10% |
| R4 | Tuned targets reject too many boards and push levels to the final tier | Targets are floors at each band's measured P10 (the free cap at its P90), tolerance 10%, sweep reports tier usage |
| R5 | The numbers pass but the levels still do not feel harder | Owner playtest of levels 12, 44 and 100 gates the merge |
