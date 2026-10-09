# Mechanic Lanes Join the Dependency Fill — Design Spec

Date: 2026-10-08
Status: Implemented
Scope: generated levels 2–200 for seven mechanics (directional, double, wormhole, fragile, lock, mirror, leap). Authored intro cubes unchanged. Flip/rotor regions and park cores keep their fences.

## Problem

Mechanic cores get privileged clear lanes. Every core arrow is a "lead": `generateLevel` adds its whole track to `forbiddenBody` (`src/content/procedural.ts:5340–5356`), so no fill arrow may ever rest on a mechanic lane, and the core's certificate replays before any fill arrow moves — lanes read as clean corridors and the mechanic fires without interruption. The only required unblocking today is the seeded blocker pass (`seedLaneBlockers`, `src/content/procedural.ts:2370`): 1–2 two-cell `-xblock-` arrows on 46–71% of planned wormhole/fragile/lock/mirror/leap cores (flip carries `-flipb-`; rotor, directional, double, and park corridors carry none). Starters and shared-tail groups, by contrast, are ordinary graph nodes whose lanes block and unblock normally.

Owner direction (2026-10-08): mechanic lanes should require unblocking just like normal arrow removal.

## Goal

On generated levels, a mechanic's core arrows participate in the dependency graph: ordinary fill arrows may rest on core lanes, and the core's certified moves wait for those blockers to leave. Acceptance bar: a placed core's lane is blockable the same way a starter's lane is — fill bodies land on it, must-leave-first edges order them out, and the merged certificate replays.

Non-goals: no `src/core` changes (movement, collision, solver untouched); authored levels unchanged; flip regions, rotor cores, and park tracks keep their fences; fill routes still never cross ray-forbidden mechanic cells (portal ends, fragile cell, gate/key, mirror, pad, circles, spots, region cells, park tracks).

## Current architecture (verified)

- `dependencyFill` (`src/content/dependency-fill.ts:90`): `FillNode { id, arrows, routeKeys }`. A body on another node's routeKey makes the route-owner wait; precedence pairs add explicit edges; cycle-closing candidates are rejected; emission is graph nodes in reverse removal order, then leads (`procedural.ts:5479–5486`).
- Entangled boards already implement the target shape: core arrows plus seeded blockers enter as `FillNode`s, routeKeys are traced on the mechanic-carrying `entangledBoard` (a mirror/pad bend moves a lane off its stripped line), the certificate chain enters as precedence pairs, the lead prefix is dropped, and validation replays the merged topological order.
- `forbiddenBody` today = reserved cells not held by placed bodies + park tracks + every lead's track keys (both endpoints of a double; every flip state for flip arrows via `occupancyKeys`). Seeded blocker routes are reserved in both body and ray.
- `forbiddenRay` (fill-route bans) = circles, spots placed before the fill, flip-region cells, portal ends, park tracks, fragile cell, gate/key, mirror cell, pad.

## Design

### 1. Node-cores

The seven mechanics' core arrows stop being leads and enter `dependencyFill` as `FillNode`s on every placement, regardless of blocker draws:

- routeKeys traced on the mechanic-carrying board (the existing `entangledBoard` composition), so a mirror, pad, or portal bend is reflected in the lane the fill can block. Doubles union both endpoints' tracks.
- The core's certificate chain becomes precedence pairs — the existing mechanism. All seven chains are single-pass (each arrow removed once); `seedLaneBlockers` already rejects repeated-id chains, and none of the seven produces them.
- Emission: core arrows join the reverse-removal-order graph section. `leadIds` keeps only the flip or rotor region lead and the park core (arrows plus park legs).
- Inter-core placement disjointness is untouched: cores still avoid each other's reserved cells at placement. Only the fill gains the new freedom.

### 2. Reservations

- Drop the lead-track `forbiddenBody` additions for the seven cores' tracks. Their bodies still block fill placement (owner cells), and mechanic cells stay body-forbidden (reserved cells).
- Keep unchanged: `forbiddenRay` in full, park tracks (body and ray), flip/rotor region fencing, portal-end protection, and seeded-blocker route reservation (shipped decision: no fill-gating chains on seeded blockers).

### 3. Seeded blockers stay (owner ruling, D2)

`seedLaneBlockers` and the `-flipb-` pass keep their current curves and budgets — a guaranteed teach blocker on entangled draws, with natural fill bodies adding ordinary blocking elsewhere on the lane. Blockers remain graph nodes and still come out of the exact arrow count. The isolated-versus-entangled distinction disappears for the seven (every placed core is node-led); blocker share pins keep measuring the seeding itself.

### 4. Validation and fallbacks

- Placement-time core-board proofs (required use, strand/soft-lock, stripped-board discriminators) unchanged — they never modeled fill bodies.
- Assembled-level checks unchanged: outside-reach bans on mechanic cells, depth gate, coverage floor, strand circles.
- Pre-fill spot vetting (`extraDirectionalSpots`, `reversalBlockers`) becomes advisory for node-core corridors: its "route clear of earlier-replaying arrows" checks run before the fill places and can no longer assume corridor emptiness. The merged-certificate replay is the authoritative gate; the existing trim ladder and restarts absorb failures. The implementation plan re-audits every vet call site that names core tracks.
- Tiers and restart flow unchanged (`fill-cycle`, `count`, `depth`, `coverage`, mechanic-cell skips), including the restart-retry with blocker seeding off.

### 5. Measurement (D3)

Measure per mechanic over its id range: the share of placed cores whose lane carries at least one fill body beyond seeded blockers. Expect near-total on dense boards. Add a fill placement nudge toward unblocked lane cells only if the measured share leaves gaps, and pin the measured share in tests either way.

### 6. Rollout

- `GENERATOR_VERSION` 10→11: every generated id re-rolls. Regenerate `tests/fixtures/v8-layouts.json`; re-derive the per-mechanic fingerprint-parity pins, mechanic-count placement-ratio pins, blocker-share floors, entangle tests, and the depth sweep baseline.
- Re-measure generation time against the 8 s sampled mechanic-sweep budget and the give-up bands; adjust only on evidence.
- Full headed browser sweep at release, and re-derive any board picks it pins (standing lesson: generator re-rolls rot browser pins).
- Storage: no save-format change; existing attempts refresh once through the layout-fingerprint mismatch (existing mechanism). `CONTENT_VERSION` stays 18.
- Docs: CLAUDE.md "Reservations", "Lane blockers", "Construction"/"Tiers", and each mechanic's "the core's lanes are reserved" sentence rewritten to the node model.

## Risks

- Restart and give-up rates may shift (more edges near cores); bands are re-measured, fallback ladders unchanged in kind.
- Closure rises (more prerequisites), making the depth gate easier; floors stay, measured bands re-pinned.
- Generation cost: node-cores add routeKey sets to the fill's edge checks. Entangled boards already pay this on roughly half of planned cores, so the budget should hold — verified by measurement in implementation, not assumed.

## Errata (implementation, 2026-10-08)

Two deviations from this spec were upheld in review:

1. Lane-release block. Dropping the lead-track `forbiddenBody` additions was not enough: `occupied` still holds each core's `.cells`, so an occupied lane stayed reserved through `leadIds` alone and the coverage test stayed red. Task 1 added an explicit pass after `forbiddenBody` is built that deletes the node cores' tracks (all flip-heading probes) from it, except mechanic cells, park tracks and static spot cells; Task 2 extended it to the double and directional cores.
2. Double route traced from one endpoint. Section 1 says a double's route keys union both endpoints. That made `dependencyFill` detect a cycle on every restart (the head route hits blocker b's body while b's route runs through the double), so no double placed at all. The double node traces only the certificate-named endpoint (the tail); the same 15 double ids placed as before. A fill body on the head-end route therefore creates no must-leave-first edge, which is harmless because only the tail end moves first.
