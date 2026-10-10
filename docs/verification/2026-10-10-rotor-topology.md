# Rotor topology audit and verification

Generated rotor parking circuits now synthesize surface paths and phased lane contacts. This follows the [standalone parking cleanup](2026-10-10-parking-topology.md); the authored stop lesson remains. The [flip follow-up](2026-10-10-flip-topology.md) removes the fixed flip regions.

## Contents

- [Audit and scope](#audit-and-scope)
- [Required interaction](#required-interaction)
- [Progression and reservations](#progression-and-reservations)
- [Verification](#verification)

## Audit and scope

`rotorCore → ROTOR_PATTERNS → acceptFlipRegion` selected and rigidly transformed two complete coordinate gadgets: `cycle-gate` and `lane-window`. Both kept the opener at offsets `[2, 0] → [1, 0]` and stop at `[5, 0]` relative to the rotor. The catalog and its placement code are removed. `constructRotor` uses the existing parking path search in a separate long-travel mode. The path search selects a compatible phased contact before constructing followers, then the rotor constructor proves the complete state transition. This early constraint avoids repeatedly building whole circuits that cannot use a rotor. Exhaustion returns no optional circuit; it never stamps a fallback.

Authored level 40 remains the rotor introduction with its guided tap order, help capture and browser assertions. It has no stop circle and was not a generated source. The level-5 stop lesson also remains; its fixed three-arrow layout requires coordinated walkthrough/help/browser work. `FLIP_PATTERNS` still generated fixed combined flip parking regions when this rotor batch shipped; the linked flip follow-up replaces them. Other mechanic catalogs are outside this batch.

## Required interaction

The parker's tail passes the chosen rotor before its head parks, so the quarter-turn settles while the parked body still obstructs a lane. A later arrow approaches the crossing along the new heading. Holding the initial heading bends it into the parked body; the new heading lets it leave and unwind the continuation blocker. Bodies, gaps, bends, faces, contact cells and three-/four-/five-arrow circuit size come from path search before a rotor is selected.

Later followers select contacts on earlier released bodies, allowing branches and independent exits rather than one repeated chain. Every candidate validates and replays the multi-leg certificate. Without its circle every initial move must be blocked. The frozen-rotor board must be unsolvable; the stateful board must enumerate without stranded choices. Independent tests additionally hold the original heading in a real intermediate state and require a blocked move against the parked body, then replay the actual state safely. A rotor can therefore not qualify merely by decorating a varied parking board. An exploratory 5,000-core short-travel graft found zero required rotors; the long-travel phase is necessary.

## Progression and reservations

The plan stream, frequency ramp, stop budget, one-rotor construction, caps, density and depth gates remain. The new `rotor-topology-v1` construction stream avoids re-rolling unrelated plans and boards. Changed fingerprints refresh affected attempts through the existing save check.

The catalog's exact three-/five-arrow dances are replaced by variable circuits with multiple settled quarter-turns. Generated puzzles no longer promise the fixed `lane-window` all-four-heading sequence. The authored introduction and core movement rules remain. The browser test derives the generated tap sequence from the solver, compares exact parked paths across reload, and checks every certified heading and glyph state.

All four possible heading reaches stay clear of earlier mechanics, shared groups and standalone parking tracks. The existing closed-region proof and fill fences remain; ordinary fill is outside that stateful region. This batch removes repeated region geometry, rather than claiming new ordinary-fill entanglement. Standalone parking still has the separately verified ordinary-blocker interaction.

## Verification

```bash
make checkall
bun scripts/stress-generate.ts 500
MECHANIC=rotor bun scripts/inspect-parking.ts 42 58 111 196
ROTOR_ONLY=1 make browser-test
```

Independent seeds 1–64 produced **64 distinct whole circuits**, with **51 spanning multiple faces**. The head/neck, rotor and circle layouts were also **64 distinct** with long tails omitted, and the actual post-park movement engine yielded **13 distinct blocking graphs** after removing IDs and coordinates. Arrow counts were 13 three-arrow, 19 four-arrow and 32 five-arrow circuits; all four initial headings appeared. The existing sampled timing and depth/density gates remain. An early search took 42 seconds on far ID 4179387469245184 despite eventually omitting the rotor; per-restart search is capped at 32 complete candidates, and a focused regression now requires that board within eight seconds. [Exact text layouts](rotor-topology-layouts.txt) show those boards and solver counts.

The final local `make checkall` completed with **644 tests passing, zero failures, and 1,944,708 assertions** in 835.23 seconds, followed by the production build and icon check. Format, lint and type checks passed. The final 500-level far-ID stress sweep completed with **zero failures** in 278.4 seconds; its slowest ID was 1805395438789503 at 7,879 ms. The 41–200 audit placed 22 rotor circuits across the unchanged 24 planned IDs. CPU replay of the generated browser target passed.

The independent 64-seed test checks at least 95% distinct whole circuits under translation and all 48 cube rotations/reflections. The same threshold applies to the relative head/neck, rotor and stop layout with long tails omitted, so tail wiggles cannot disguise one gadget. A separate canonical directed blocking-graph oracle requires at least six distinct graphs, independent of coordinates, IDs or tails. Tests also cover all three circuit sizes, multi-face bodies, frozen-rotor and stop required use, safe choices, the parked-body counterfactual and bounded fully occupied exhaustion. The 41–200 sweep checks region proofs, mechanic separation, full endpoint-aware solutions and structural diversity. Existing timing/determinism checks remain unchanged.

The cloud has no verified real-GPU browser acceptance. CPU selection and full-board replay can check the generated browser target; they do not validate rendering, picking, animation, reload behavior or pixels. Real-GPU browser acceptance remains outstanding; no rendering or UI acceptance is claimed for this publication. Publication is authorized per verified mechanic: merge locally to main, push origin/main normally, and verify Checks and the automatic Pages deployment. No manual deployment is requested.
