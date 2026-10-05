# Flip-Core Entanglement — Design Spec

Date: 2026-10-04
Status: Implemented
Scope: Phase 1 — flip cores in generated levels (31–200). Later phases extend the same primitive to rotor, lock, fragile, mirror, leap, and wormhole cores.

## Problem

Generated mechanic levels feel repetitive. Every flip level opens with the same self-contained vignette: 3–4 stubby (2-cell) arrows from a 4-entry catalog around the spot, with reserved lanes, resolving untouched before the real puzzle (the fill dependency graph) begins. Three generator invariants cause this:

1. **Core tracks are reserved** — no fill body may sit on a core track, so the core's certificate leads the replay and the vignette always fires first.
2. **The outside-reach ban fences regions** — `flipRegionLead` requires every non-region arrow's occupancy to stay off region cells, keeping the mechanic an island.
3. **Pattern arrows are tiny** — all `FLIP_PATTERNS` arrows are 2 cells, so the vignette is memorizable and visually separate from the blocking field.

The player experience: a fixed opening dance, then generic multi-step blocking. The mechanic never participates in the blocking.

## Goal

On generated flip levels, the mechanic's arrows participate in the dependency graph: fill-blocker arrows sit on core lanes, those blockers are themselves gated by other fill arrows, and the flip dance interleaves with — or is gated several moves behind — the board's opening moves. Acceptance bar: on entangled ids the player cannot fire the opener immediately; the solve opens with ordinary blocking moves before the mechanic's first tap.

Non-goals: authored intro cubes (level 30) unchanged; no new gameplay mechanics; no changes to movement, collision, or solver semantics in `src/core` beyond the region-cap default; mechanic-mediated fill lanes (routing fill lanes *through* the spot cell) deferred; later-mechanic phases out of scope for the implementation plan.

## Current architecture (verified)

- Cores place before fill on dedicated seeded streams; the certificate is the flip/rotor region lead, then fragile, lock, mirror, wormhole, double cores, park legs, park-core arrows, directional core, then the reversed fill-graph section (`generateLevel`).
- `dependencyFill(input: FillInput)` (`src/content/dependency-fill.ts`): `FillNode { id, arrows, routeKeys }`; `addNode` wires edges automatically — a new arrow's body on an existing node's routeKey makes that node wait ("must leave first"), and a new arrow's route through an existing body makes the new arrow wait. The group and starters enter as existing nodes today; leads do not.
- `interactionRegion(level, seedArrowIds, maxArrows = 6)` (`src/core/validation.ts:1282`): closure — any arrow whose occupancy (body plus track under every flip state) shares a cell with a region arrow's occupancy joins, up to the cap. `proveRegion` enumerates the region's removal-sets with outside arrows as static blockers and requires zero stranded states, flip interest, and solvability.
- `flipRegionLead` (`src/content/procedural.ts:2942`): re-derives the region on the finished level from `regionCoreIds` seeds, rejects groups inside, proves it, bans outside occupancy from region cells, then solves the region alone to produce the lead certificate.
- Failure handling: passes restart; exhausted restarts yield to later passes; assembled-level failures drop optional spots down a trim ladder to the exact plan-zero construction (`procedural.ts:5034`).
- Seeds: every stream is named (`:flip-plan`, `:flip-core`, …); new stream names never perturb existing ids. `GENERATOR_VERSION` is embedded in generated seeds; authored ids keep their own seeds.

## Design

### 1. Entangle model

After the flip core places and passes its current proofs, the flip pass draws on a new `:flip-block` stream:

- **Blocker count**: 1, plus a second on a seeded coin (0.3) from level 60. The whole entanglement is gated by `flipBlockFrequency`, rising linearly 0.35 at level 31 to 0.70 at level 90 and holding; a plan of zero draws nothing and leaves the id byte-identical to the current construction.
- **Entangle cells**: 1–2 cells on the core arrows' static tracks, not on the arrows' authored bodies, not the spot cell, chosen from the last four track cells before the track exits so the blocker and its chain have room.
- **Blocker arrows**: ordinary single arrows whose body covers the entangle cell, head pointing off the lane, route from `routeFrom` (2–4 cells; sees only wrap edges, so it stays off every ray-forbidden mechanic cell). Placed during the flip pass, before fill. They must not sit on any reserved cell, another core's body, or a shared-tail group's track, and must pass `validateLevel`.

Blockers and the flip core enter `dependencyFill` as `FillNode`s (the group and starters already do). The prerequisite edge "core arrow waits for blocker" falls out of `addNode`'s crossers logic, because the blocker's body cell is a routeKey of the core's node. Later fill arrows may land bodies on a blocker's route (its routeKeys are crossable, unlike today's reserved core tracks), so a blocker can itself be gated several moves deep.

Arrow-count budget: blockers come out of the level's `getLevelConfig` arrow count (fill target reduced by the blocker count). Stop-circle budget untouched.

### 2. Proof architecture

- **Region growth**: the closure already absorbs arrows whose bodies share cells with region arrows' tracks — the blocker joins, and any fill arrow whose body lands on the blocker's route joins at the assembly-time re-derivation. The default region cap rises from 6 to 10 (`interactionRegion`'s `maxArrows` default; `src/core` change is this constant only). The proof enumerates removal-sets (≤ 2¹⁰ × spot states) — trivial cost.
- **Dance order**: `flipRegionLead`'s region-alone solve remains the source of the dance order. That order becomes precedence constraints between region nodes in the merged graph rather than a pasted prefix. Region arrows emit their full lead entry sequences (park entries included) at their merged-order positions; `replayCertificate` must accept the interleaved result.
- **Certificate**: one merged topological order from `dependencyFill` (region nodes + fill), replacing the "flip lead first, then everything" split. The merged order must respect: region-internal dance order, every body-on-route edge, and existing lead-arrow replay requirements.
- **Outside-reach ban**: unchanged in kind, enforced around the saturated (assembly-time) region.
- **Required-use proofs**: unchanged — "stripped cube deadlocks" and `flipInterest` are evaluated on the core board alone, which has no blockers.

### 3. Fallback ladder

Any entanglement failure — no legal entangle cell or blocker route, placement-time region proof failure, merged-graph cycle, assembly-time region over the cap or any `flipRegionLead` failure — drops blockers one at a time, re-proving at each length, down to the isolated core: the exact current construction for that id (byte-identical plan-zero parity; `:flip-block` draws never touch other streams). This extends the existing spot-trim ladder shape.

### 4. Patterns

`FLIP_PATTERNS` gains 2–3 longer entries (arrows with 3–5 cell lanes, at least one crossing a seam through `stepSurface`) so entangle cells have room past the pattern bodies. Adding entries changes the `:flip-core` catalog draw, so **every flip-core id re-rolls**; every non-flip id keeps its exact current fingerprint.

### 5. Construction-order risk

The flip pass runs before the fragile/lock/mirror/leap passes. A blocker's reach can fence a later core's lane requirements (the id-137 coupling pattern), raising later-pass give-up rates. Mitigation: blocker routes are short; the later passes already retry. `tests/mechanic-counts.test.ts` ratios must stay within their existing 10% bands — a drop beyond that is a failed gate, not a tuning note.

## Testing and acceptance criteria

A1. On every generated id 31–200 whose flip core places entangled, at least one flip-core arrow carries ≥1 prerequisite in the merged graph (a blocker or blocker-chain arrow body on its track), so the dance cannot begin before at least one fill-arrow move in the certificate.
A2. Entangled share tracks `flipBlockFrequency` within the established 10% band (new pin in `tests/mechanic-counts.test.ts`).
A3. Every entangled level's saturated region passes the existing region bar — `proveRegion` with zero stranded states, `flipInterest`, and solvability — matching the requirements `tests/region-generation.test.ts` already enforces. (Flip spots are never required for solvability; the discriminator is flip interest, not a stripped-cube deadlock.)
A4. Fixture parity both directions: every non-flip-core id 2–200 keeps its exact current `layoutFingerprint`; every flip-core id re-rolls (`tests/fixtures/v8-layouts.json` regenerated via `scripts/write-layout-fixture.ts`; `tests/flip-generation.test.ts` pins both).
A5. Depth gate and 0.78 coverage floor still met on all ids 2–200; sampled generation time within the existing budget (≤1s local per sampled id).
A6. `tests/mechanic-counts.test.ts` existing ratio pins stay within their 10% bands (flip, rotor, fragile, lock, mirror, leap, wormhole, groups, doubles).
A7. New browser module: the first entangled cube cleared in its certificate order, demonstrating the opener gated behind at least one blocking move, and progress surviving a reload mid-level. Full headed sweep green.
A8. `make checkall-ci` green.

Saves on re-rolled ids refresh once via the existing layout-fingerprint rule. No storage, renderer, PWA, or content-version changes.

## Later phases (not in this plan)

- Phase 2: rotor cores inherit the machinery unchanged (same region proofs).
- Phase 3: lock, fragile, mirror, leap, wormhole cores take the same blocker primitive against their per-lane proofs; their "no outside arrow reaches the cell" checks are unchanged (blockers sit on lanes, never the mechanic cell).
- Phase 4 (separate design): mechanic-mediated fill lanes (O2) — fill routes deliberately crossing the mechanic cell itself.

## Errata (post-review)

The "blockers are themselves gated by fill arrows" mechanism in §1 and §2 does not exist as described: region closure absorbs every blocker route into the region's cells, and both `forbiddenBody` and `forbiddenRay` reserve those cells, so no fill body can land on a blocker route and no fill route can cross one. The shipped gating is the blocker-on-lane prerequisite plus the dance's merged-order position mid-board (entangled solves open with 12-17 ordinary moves before the first blocker tap), which satisfies A1 by its stated path: a blocker prerequisite on a core arrow's track.
