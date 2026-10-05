# Mechanic Blocker Entanglement, Phase 2+ — Design Spec

Date: 2026-10-05
Status: Implemented
Scope: Extend the shipped flip-core entanglement (commit `3a3b939`, spec `2026-10-04-flip-core-entanglement-design.md`) to the remaining six mechanics: rotor (phase 2), then wormhole, fragile, lock, mirror, leap (phase 3).

## Problem

The flip mechanic now participates in the dependency graph, but the other six still ship as isolated opening vignettes: fixed core patterns whose lanes are reserved clear, whose certificates replay before the fill graph, and whose arrows never touch the multi-step blocking. Same cause as flip's — core tracks reserved, cores emitted as leads, patterns small.

## Goal

Every generated level whose mechanic core places carries blockers on that core's lanes with the same share and feel as flip's: the solve opens with ordinary blocking moves before the mechanic's first tap, the dance order is enforced inside the merged fill graph, and every failure falls back to the exact current construction. Non-goals: the park core, directional core, and double core stay as they are (parking and directional spots already interleave with the fill; doubles are endpoint-picked by design); no new mechanics; no movement or solver changes; authored cubes untouched.

## Design

### Shared primitive (from flip, generalized)

The flip implementation's pieces are mechanic-agnostic already: blocker construction (two-cell arrow, tail on a late lane cell, head off the lane), per-placement re-proof with proven-prefix fallback, fill-graph node membership with precedence pairs, the merged certificate with per-mechanic lead sets (`emissionLeads` pattern), blockers spending the level's exact arrow count, and the lead-shape restart guard. Phase 2/3 parameterizes these by mechanic rather than copying them.

- **One marker for all new blockers**: `-xblock-`, with the mechanic encoded after it (`r<id>-xblock-rotor0`, `r<id>-xblock-lock1`, …). Flip keeps its `-flipb-` marker. Collision check: `-xblock-` contains none of the existing core markers (`-flip-`, `-rotor-`, `-fragile-`, `-lock-`, `-mirror-`, `-leap-`, and the wormhole marker), so `regionCoreIds` and every `*CoreIds` matcher stay correct.
- **One stream per mechanic** (`:rotor-block`, `:wormhole-block`, `:fragile-block`, `:lock-block`, `:mirror-block`, `:leap-block`), each on its own name so no existing draw shifts. Curves match flip's shape: 0.35 at the mechanic's first generated level rising linearly to 0.70 at first+59 and holding; a second blocker on a seeded 0.3 coin from first+29.
- **Reservations hold (the I1 errata)**: blocker routes stay reserved like the core's lanes — no fill-gating chain. The gating mechanism is the blocker-on-lane prerequisite plus the dance's merged-order position, exactly as flip shipped.

### Per-mechanic deltas

| Mechanic | First level | Blockable lanes (entangle cells) | Re-proof per blocker | Certificate source |
|---|---|---|---|---|
| rotor | 41 | Rotor core arrows' tracks (authored state, last four cells) | `acceptFlipRegion` (rotor is a region core) | `regionDanceOrder` (already covers rotor via `regionCoreIds`) |
| wormhole | 36 | Portal, gate, and far-side arrows' tracks | The mechanic's certificate replays on the core board with the blockers as members (`validateGenerated` on the core+blocker board) | the wormhole core's existing certificate array |
| fragile | 46 | Crosser's and double-endpoint tracks | Same, plus the zero-fall certificate invariant | the fragile core's existing certificate array |
| lock | 51 | Opener's and key arrow's tracks | Same, plus "opener's first tap is gated" | the lock core's existing certificate array |
| mirror | 56 | Either face-off arrow's track | Same | the mirror core's existing certificate array |
| leap | 61 | Leaper's and blocker's tracks | Same | the leap core's existing certificate array |

Universal bans for every blocker: all reserved cells, every mechanic cell (spots, portal ends, gate/key, fragile cell, mirror, pad), circles, park tracks, earlier cores' bodies, previously placed blockers. Flip's entangle-cell rules carry over: last four track cells before exit, never a body or mechanic cell.

### Wiring generalization

`generateLevel`'s entangled-flip wiring becomes a loop over entangled mechanics: each entangled core contributes its arrows and blockers as per-arrow `FillNode`s, its certificate array becomes precedence chain pairs (filtered to graph-node ids, the flip fix), its arrows leave the lead-emission set, and its certificate entries drop from the fixed lead prefix on entangled boards. The existing flip branch becomes the first user of this loop; non-entangled mechanics construct byte-identically to today.

### Fallback and budgets

Identical ladder: a failed blocker placement keeps the proven prefix; a failed merged replay or proof restarts the tier; exhausted restarts yield plan-zero for that mechanic. Blockers spend the arrow-count budget (the `prefilled` arithmetic already generalized in flip's fix wave). Cumulative restart pressure across mechanics is bounded by the same ladder; generation time re-measured per phase against the existing sampled budget.

## Phasing

- **Phase 2 — rotor.** Smallest delta: the region machinery (`acceptFlipRegion`, `regionDanceOrder`, `regionCoreIds`) already treats rotor as a region core, so the work is parameterizing flip's blocker seeding by core kind and adding the stream/curve/wiring. Proves the generalization on the second-hardest proofs.
- **Phase 3 — wormhole, fragile, lock, mirror, leap.** One parametrized per-lane implementation covering all five (they share the "core-board required-use solve + assembled validation" re-proof shape), applied per mechanic in level order. Each mechanic lands as its own task with its own pins and fixture churn.

## Testing and acceptance criteria

Per mechanic (X = rotor/wormhole/fragile/lock/mirror/leap):

A-X1. On every generated id whose X core places entangled, at least one X-core arrow carries a blocker prerequisite (a `-xblock-X` body on its track), and `solveLevelTargets` still solves the level.
A-X2. Entangled share tracks the curve within the standing 0.1 absolute margin (pin added to `tests/mechanic-counts.test.ts`).
A-X3. Required-use invariants survive: the mechanic's existing core-board proofs (stripped/frozen discriminators, first-tap gates, zero-fall certificates) pass unchanged on entangled ids.
A-X4. Fixture parity both directions: non-X ids byte-identical; X-carrying ids re-roll where their construction changed.
A-X5. Non-entangled ids of every mechanic construct byte-identically to today (plan-zero parity).
A-X6. Browser: one check that clears the first non-flip entangled cube in its proven order across a reload (`assertEntangledCore` generalized to scan beyond flip).

Campaign-wide (end of phase 3): `make checkall-ci` green; full headed browser sweep green; determinism probe over ids 2-200; CLAUDE.md reconciled per mechanic (the same isolated-vs-entangled qualifiers flip's docs received).

## Costs

Fixture churn on every id carrying an entangled core of each mechanic as it ships (established pattern; saves refresh once per affected id). Generation time re-measured after each phase. No storage, renderer, PWA, or content-version changes. Later-phase note carried from flip's review: blocker routes stay region/mechanic-reserved — do not chase the fill-gating chain.

## Errata

Rotor was investigated in phase 2 and found inexpressible in the removal-graph certificate: both rotor patterns park an arrow mid-dance and resume it after other arrows, which one-exit-per-arrow replay cannot express. Rotor therefore stays plan-zero, and no `:rotor-block` stream ships; the per-mechanic table and Phase 2 section above describe the original plan. Phase 3's five lane mechanics (wormhole, fragile, lock, mirror, leap) shipped as specified.
