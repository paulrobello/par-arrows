# Parking topology audit and verification

Generated standalone parking puzzles now grow from cube-surface paths and blocking relationships instead of repeated coordinate gadgets. This note records the first parking batch, structural evidence, and release limits. The subsequent [rotor cleanup](2026-10-10-rotor-topology.md) removes the combined rotor catalogs listed in this initial audit.

## Contents

- [Audit and scope](#audit-and-scope)
- [Construction and safety](#construction-and-safety)
- [Remaining parking gadgets](#remaining-parking-gadgets)
- [Evidence](#evidence)

## Audit and scope

| Path | Finding and disposition |
| --- | --- |
| `procedural.ts`: `PARK_PATTERNS` / `parkingCore` | Eight fixed relative-coordinate layouts, including the stop introduction, rotated and transplanted into generated boards. Removed entirely. |
| Parking reservation / certificate | Parking was an isolated lead with all tracks fenced against fill bodies. Replaced by an atomic dependency node; ordinary lane blockers leave before its parking certificate. |
| `stop-intro.ts`, level 5 | One authored lesson, not a generated source anymore. Preserved after inspecting its forced tap order, IDs, help capture and browser assertions. A redesign needs coordinated tutorial/help/browser work. |
| `PAIR_PATTERNS`, `TRIO_PATTERNS`, `FLIP_PATTERNS`, `ROTOR_PATTERNS` | Catalogs remain. Flip/rotor regions can carry additional stop circles; this change does **not** remove those stateful gadgets. |
| `WORMHOLE_PATTERN`, `FRAGILE_PATTERN`, `LOCK_PATTERN`, `MIRROR_PATTERN`, `LEAP_PATTERN` | Fixed core geometry remains. Their fill integration and required-use rules remain; no unrelated geometry redesign. |
| Directional / double cores and lane blockers | Algorithmic paths or simple fixed blocking relationships; audited, not replaced. |
| `campaign-layouts.ts` / `generate-campaign.ts` | Historical catalog and fixture generator. Production campaign and previews use `generateLevel` through the worker; they do not import the historical catalog. |

## Construction and safety

`parking.ts` draws a self-avoiding parker path, chooses a body contact vacated by parking, builds one to three followers, and connects the continuation blocker through surface adjacency with seeded route choices. Body lengths, contacts, gaps, bends, faces and dependency-chain size vary before placement. There is no rigid-transform catalog or stamped fallback. A failed bounded search omits the optional structure.

The movement engine must replay the park and unwind. Without the circle every member must be blocked; bounded stranding enumeration must prove all legal choices remain solvable. Each standalone construction uses one required circle; the existing stop budget remains a ceiling, and extra circles belong to proven stateful regions. The former double-circle catalog gadget is deliberately gone.

The entire cycle enters the fill graph as one atomic node, with its real lanes as route keys. Park legs expand at that node's removal position. Fill bodies can block approach and continuation lanes; parked windows and circles stay reserved, and outside routes stay off parking tracks to preserve safe early parking. The assembled certificate, depth and density gates remain authoritative.

Integration exposed a seeded lock blocker reaching a wormhole endpoint at level 114. Blocker reservations now include every mechanic cell, with a focused regression. A bounded search for the existing cross-face lock geometry on parking boards preserves that variant before the same-face fallback; it introduces no new lock gadget.

Seed/planning streams remain version 11 so unrelated plans and zero-parking boards avoid a global re-roll. Parking uses its own `park-topology-v1` stream. Changed fingerprints safely refresh current attempts through the existing save check. Layout fixtures and affected early geometry/cross-face pins are regenerated. Seeded blocker-share pins are remeasured for the new reservation footprints; mechanic placement-ratio, natural lane-blocking, depth, density, count and path bounds stay unchanged.

## Remaining parking gadgets

The [initial generated audit](parking-combined-audit.json), captured before rotor cleanup, lists region arrow IDs, template names and stop-cell coordinates for each remaining combined parking layout in levels 6–200.

- `flipCore → FLIP_PATTERNS → pendingLanes / lanes → acceptFlipRegion`: variable circle placement inside a fixed six-pattern flip gadget. Affected levels: 41, 54, 59, 62, 65, 70, 84, 85, 87, 88, 89, 90, 92, 96, 100, 107, 108, 114, 115, 117, 119, 121, 124, 126, 127, 131, 142, 148, 151, 152, 157, 162, 163, 170, 176, 190, 191.
- `rotorCore → ROTOR_PATTERNS → acceptFlipRegion`: the rotated/transplanted `cycle-gate` and `lane-window` parking gadgets. Both keep the opener at offsets `[2, 0] → [1, 0]` and the stop at `[5, 0]` relative to the rotor. Affected levels: 42, 46, 47, 58, 61, 68, 75, 78, 79, 82, 83, 99, 101, 102, 111, 137, 139, 156, 167, 169, 179, 196.
- `authoredLevel(5) → STOP_INTRO_LEVEL → STOP_INTRO_SCRIPT`: the fixed three-arrow front-face teaching layout, circle `front:2:1`. This is the only authored intro with a stop; rotor intro 40 has none.

These remain parking stamps in combined mechanics. This batch does not fulfill the complete no-stamped-parking requirement. A scoped followup should synthesize stateful regions from paths and phased lane contacts, then prove closed-region solvability, frozen-rotor required use, safe choices, and generation bounds. Perturbing catalog bodies or merely moving their circles would not remove the repeated interaction geometry. Dropping flip circles would sacrifice pending-flip parking, and removing the rotor circle would destroy the required quarter-turn sequence. The teaching cube also needs a coordinated walkthrough/help capture and real-GPU acceptance if redesigned.

## Evidence

- Independent construction seeds 1–64: **64 distinct whole structures** after canonicalizing translation and all 48 cube rotations/reflections; **52 span multiple faces**. Arrow counts: 22 three-arrow, 22 four-arrow, 20 five-arrow structures. Mean body coverage per structure: 34.625 cells.
- Tests prove the freed arrow is blocked before parking and exits after parking; an early continuation still blocks; stripping the circle deadlocks the core. Occupied cells, deterministic replay, zero budgets and fully occupied exhaustion are checked.
- The representative campaign/far-ID test requires at least 95% unique structures and natural fill blockers on at least 95% of placed parking lanes, and uses endpoint-aware full solutions. A retained ordinary blocker must actually block a certified parking action; removing it must make that same action safe, after which the sequence clears without losing a life.
- `scripts/inspect-parking.ts` prints exact generated face grids, arrow lengths/faces/head headings, ordinary lane blockers and solver tap counts. [Text layouts](parking-topology-layouts.txt) inspect levels 6, 17, 58 and 150. These are logical layout evidence, not rendered screenshots.

Run the supported checks and inspections:

```bash
make checkall
bun scripts/stress-generate.ts 500
bun scripts/measure-boards.ts 6 17 58 100 150 200
bun scripts/inspect-parking.ts 6 17 58 150
```

Validation: `make checkall` passed with **643 tests, zero failures**, production build and icon checks. The latest full parking file passed four tests including the ordinary-blocker counterfactual witness. A final 100 far-ID stress samples passed with zero failures (slowest 2,070 ms); earlier 500, 500 and 250 sample iteration sweeps also had no construction failures.

A CPU preflight of current browser selections passed: rotor level 58 replays its park and all four headings; fragile level 46 remains solver-solvable; the first cross-face lock is now level 200; pending-flip parking is found at level 70. This preflight checks selection and engine replay only.

The cloud has no verified real-GPU browser acceptance. The stop tutorial, generated parking picking/animation/save/reload, and moved generated browser selections still need the repository's real-GPU browser suite before release. No UI or canvas-pixel validation is claimed. Publication was subsequently authorized per verified mechanic: merge locally to main and push origin/main normally, then verify Checks and automatic Pages deployment. No manual deployment is requested.
