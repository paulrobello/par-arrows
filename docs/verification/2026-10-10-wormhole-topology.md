# Wormhole topology audit and verification

Generated wormholes now grow body dependency cycles and sampled exit contacts. This follows the [parking](2026-10-10-parking-topology.md), [rotor](2026-10-10-rotor-topology.md) and [flip](2026-10-10-flip-topology.md) cleanups. Other mechanic catalogs remain under review.

## Contents

- [Audit and scope](#audit-and-scope)
- [Construction and integration](#construction-and-integration)
- [Verification](#verification)

## Audit and scope

`wormholeCore` copied the level-35 portal/gate coordinate layout, rotated it around end A, and placed a fixed two-cell blocker immediately beside end B. The coordinate catalog and placer are removed. Wormhole `seedLaneBlockers` also used fixed two-cell bodies; those now grow contact stems and tails rather than keeping that stamp.

Authored level 35 remains the single guided portal/gate/far-blocker lesson. It is no longer a source for generated geometry. Changing its IDs, tap sequence and layout requires coordinated tutorial, help-image and real-GPU review. This is a stated scope boundary, not a blanket exemption for authored lessons.

## Construction and integration

The shared surface-walk utility grows self-avoiding bodies. The dependency-cycle constructor's portal mode samples body contacts and branches, releases the whole opener body and installs no circle. It grows four- or five-arrow circuits including a far-side contact blocker. The selected native contact becomes end A; a sampled end B on another face changes the opener's route. The far blocker may contact anywhere on that exit corridor and grows a three-to-eight-cell body.

The actual movement engine proves the far blocker exits first, the opener initially hits it, the opener then exits through exactly one portal, the complete circuit clears, the stripped circuit cannot clear, and no safe choices strand it. Every body and route respects previous reservations, and prior arrows' reaches avoid both ends. Exhaustion omits a circuit; no coordinate or short-blocker fallback exists.

Early integration found two reservation problems. The old caller rejected an entire completed candidate if it crossed group tracks; reserving those tracks before construction let the search find a compatible topology. Growing portals before the stateful region still reduced rotor placement and flip blocker coverage. Reserving the proved stateful region first, then growing portals around it, passed all nine existing placement/blocker-share tests without relaxing their floors. The production ordering uses that result.

The first full gate found a flip-blocker share of 0.456 against the unchanged 0.46 floor. A far seed also took 15 seconds and lost its flip, compared with roughly 0.5 seconds and a retained flip on the published source. Tracing identified 57 false cycles inside the phased region: the removal graph combined internal edges from mutually exclusive spot headings. New wormhole boards now represent the proved closed region as one atomic node and replay its actual multi-leg certificate at that node's removal position. The movement engine, internal spot interactions and all proof gates stay intact; unplanned wormhole boards retain their preceding construction. The slow seed now retains its flip and both portal pairs, measured at 545 ms against a 444 ms same-run baseline. A regression test enforces the existing eight-second budget, retained mechanics and complete zero-life replay. All nine placement/blocker-share tests then pass with their original floors.

Wormhole lane blockers sample whole actual lanes, choose clear exit headings, grow variable contact stems and tails, and replay the full core certificate before acceptance. Their original presence plan stays fixed while geometry retries. Other mechanics' placement, frequency curves, two-ring ceiling, difficulty gates and movement rules remain. Cores still enter dependency fill as nodes; ordinary fill can block their post-portal lanes and joins the assembled certificate. No generator-version bump is needed; changed saves refresh through the existing fingerprint check.

## Verification

```bash
make checkall
bun scripts/stress-generate.ts 500
MECHANIC=wormhole bun scripts/inspect-parking.ts 44 58 118 199
WORMHOLE_ONLY=1 make browser-test
```

Independent seeded samples produce 64 distinct full layouts and 64 distinct head/neck/ring layouts after translation and all 48 cube rotations/reflections. Actual initial blocker graphs, with coordinates and IDs removed, have six distinct structures. Forty of 64 samples span at least three body faces; circuit sizes vary between four and five arrows. The structural, bounded-omission and performance regression tests pass with 1,327 assertions, including required use, actual far contact, safe-choice enumeration, complete zero-life certificates, determinism and bounded omission.

Production placement/blocker-share tests pass all nine cases with 354 assertions and their existing floors. The campaign audit records 88 placed levels over 88 planned levels, with 113 portal pairs. All 88 changed fingerprints are on planned wormhole levels; authored lessons and every unplanned level match the preceding flip commit exactly. Supported face grids and solver certificates for levels 44, 58, 118 and 199 are retained in `wormhole-topology-layouts.txt`, with full placement metadata in `wormhole-topology-audit.json`.

The rotor browser's level-58 case was checked in the CPU engine against the changed full board: its dynamically derived core order parks the opener, exits five more times without a life loss, and settles north/east/south/west headings. Its existing expected-state derivation still applies; this is a CPU preflight only.

The final-source stress sweep passes 500/500 far IDs with zero failures in 361.7 seconds, versus 457.5 seconds before the phase-node correction. Its slowest sample is the previously known `1805395438789503` at 10,087 ms while CPU checks ran concurrently. The blocking 15-second seed now retains its flip and both portals; it is covered by the new generation-budget and zero-life replay regression. The latest nine placement/blocker-share tests pass with 354 assertions in 197.22 seconds and unchanged floors.

`make checkall` exits successfully: 645 tests pass, zero fail, with 2,149,749 assertions across 66 files in 897.14 seconds. Format, lint, typecheck, production build and icon verification also pass. Publication follows the authorized local-main merge and normal origin push; exact remote SHA and automatic Checks/Pages results are tracked separately.

No verified real-GPU browser acceptance is available in this cloud; rendering, picking, animation and UI acceptance are not claimed.
