# Mechanic stamp audit

This audit covers production `generateLevel`, campaign and preview resolution, authored introductions, and fallback construction. A changed body color, rotation, reflection, face or translation does not remove a repeated coordinate gadget. Tests therefore canonicalize complete mechanic geometry and head/neck/terrain geometry under all cube isometries, and compare actual engine blocker graphs with coordinates and IDs removed.

## Contents

- [Current production findings](#current-production-findings)
- [Already integrated passes](#already-integrated-passes)
- [Authored lessons and scope](#authored-lessons-and-scope)
- [Acceptance and follow-up](#acceptance-and-follow-up)

## Current production findings

| Mechanic or pass | Finding | Status |
| --- | --- | --- |
| Parking | Eight complete coordinate patterns and fallback bodies. | Replaced by grown required-use topology; published `cac2a6c` with evidence follow-up `a8a33a0`. |
| Rotor | `cycle-gate` and `lane-window` coordinate patterns. | Replaced by grown phased body circuits; published `40f442d`. |
| Flip | Six coordinate patterns (`gate`, `bounce`, `relay`, `relay2`, `lane`, `weave`) and fixed two-cell attached blockers. | Replaced by grown circuits and blockers; published `34c5997`. |
| Wormhole | `WORMHOLE_PATTERN` copied the level-35 portal/gate layout; fixed far blocker adjacent to B; two-cell lane blockers. | Replaced by grown required-use circuits and contact blockers; published `34cdef0`, canonical gate and 500-seed stress pass. |
| Overlap | `PAIR_PATTERNS` and `TRIO_PATTERNS` choose complete member leg plans: classic, staggered, lanes, seam, wrap, fork and related variants. | Replaced by grown shared spines, sampled peel trees and surface branches in this batch; 651-test canonical gate, 500-seed stress and all 176 shipping group proofs pass. |
| Fragile | `FRAGILE_PATTERN` fixes the crosser and double body around one crack, copying the introductory geometry. | Replaced by grown competing approaches, endpoint dependencies and attached blockers; 654-test canonical gate and 500-seed stress pass. |
| Lock | `LOCK_PATTERN` fixes opener/key geometry; the cross-face variant moves the same construction across a seam. | Replaced by independently grown keyed routes and dependencies; 657-test canonical gate, 35-test integration and 500-seed stress pass. |
| Mirror | `MIRROR_PATTERN` fixes two opposite two-cell approaches around the mirror. | Published `7bdec7b`: grown four-to-six-arrow body cycles and proved reflected ordering; canonical 660 tests and 500-seed stress pass. |
| Leap | `LEAP_PATTERN` fixes the two-cell leaper and bent blocker around the pad. | Replaced by grown required skip-contact cycles; canonical 663 tests and 500-seed stress pass. |
| Double | The double body grows, but `doubleCore` attaches fixed two-cell A/B blockers at the body and immediately beyond the head. | Replaced by grown required-use endpoint circuits in this batch; canonical gate, all 80 assembled endpoint proofs and 500-seed stress pass. |
| Static directional core | `directionalCore` varies short tail lengths, one-/two-cell gaps and optional single bends in an opposed-flanker construction. | Replaced by grown required reversal body cycles; independent whole/head geometry and actual blocker graphs vary, with reciprocal head-pair stamps rejected after every safe prefix. Final canonical gate and 500-seed stress pass. |
| Other seeded lane blockers | The final two-cell lane-blocker fallback served Leap. | Removed; every lane family grows contact bodies, with no two-cell fallback. |

## Already integrated passes

`reversalBlockers` is a misleading name for a spot-placement pass: it adds chevrons on sampled routes of existing fill arrows, checks their actual reversed reaches and crossings, and creates no new blocker body. It is not a separate two-cell gadget catalog. `extraDirectionalSpots` likewise places glyphs against route/proof constraints. These passes need to retain meaningful engine-verified interactions, rather than receive cosmetic rewrites merely because their names mention blockers or spots.

Ordinary fill grows surface walks and uses body-on-route dependencies, cycle rejection, path/shape caps and assembled certificates. Short straight paths can recur, but they are not complete stamped mechanic subassemblies. The grown-blocker shape-accounting omission found during flip integration is fixed; every seeded blocker enters the counter before fill.

The former fixed campaign catalog in generation/quality scripts is historical reference and test data, excluded from production imports. Campaign, previews and worker generation use the runtime generator, including its authored-level dispatch. Bounded optional-mechanic failure must return omission, never a stamped fallback.

## Authored lessons and scope

All thirteen authored levels (1, 5, 11, 15, 20, 25, 30, 35, 40, 45, 50, 55 and 60) were audited jointly. Exact body/head duplication between 5/20 and head duplication plus reciprocal head-only deadlocks in 40/55 survived the runtime cleanup. The separate authored batch replaces 20, 40 and 55 with distinct body-contact lessons, updates scripted sequences, resume behavior, help text and thumbnails, and advances only their own seed revisions. The other ten lessons remain after explicit structural and teaching review. No authored lesson supplies generated geometry.

The authored regression checks uniqueness under cube symmetries and rejects head-only pairs after every safe prefix across all thirteen lessons. Against the published prior lessons, both oracles fail as expected. CPU engine and software-browser diagnostics support the coordinated changes; draft thumbnails are from SwiftShader. Real-GPU picking, animation and headed help-capture acceptance remain outstanding, so no full visual acceptance is claimed. See [the authored audit](2026-10-10-authored-topology.md).

## Acceptance and follow-up

Finish one mechanic at a time, including its attached blockers. Keep solvability, required use, safe-choice proofs, difficulty/density progression, placement and blocker-share floors, caps and timing checks. Independent seeds and shipped levels must show actual structural variation, not transformed gadgets. Preserve unrelated plans and fingerprints where possible, and explain necessary ordering changes with measured results.

Each production batch runs `make checkall`, representative far-ID stress generation and supported layout inspection, then commits, merges into local main and pushes normally under the user's explicit authorization. Verify the exact origin SHA, Checks, automatic Pages and served version. Real-GPU browser acceptance remains separately outstanding. The audited runtime catalogs, opposed-flanker gadgets and fixed short blocker fallbacks are removed. The authored duplicate motifs are also removed in the separate tested lesson batch; real-GPU acceptance remains outstanding.
