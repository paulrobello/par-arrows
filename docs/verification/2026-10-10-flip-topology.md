# Flip topology audit and verification

Generated flip regions now grow paths and contacts instead of selecting coordinate gadgets. This follows the [parking](2026-10-10-parking-topology.md) and [rotor](2026-10-10-rotor-topology.md) cleanups. Other mechanic catalogs and the authored introductory lessons remain under review.

## Contents

- [Audit and scope](#audit-and-scope)
- [Construction and interaction](#construction-and-interaction)
- [Preserved constraints](#preserved-constraints)
- [Verification](#verification)

## Audit and scope

`flipCore → FLIP_PATTERNS` selected six complete coordinate layouts: `gate`, `bounce`, `relay`, `relay2`, `lane` and `weave`. Rotation and translation disguised the same head/contact relationships, including the combined flip/parking layouts. The catalog and its placement code are removed. The attached `flipBlockers` also emitted fixed two-cell arrows; their contact stems and bodies now grow from seeded surface walks.

Authored level 30 remains the single guided reversal/guard/runner lesson, with its IDs, tap order, help image and browser contract. Its former bounce-shaped copies are removed from generation. This is a deliberate scope boundary requiring coordinated tutorial/help/real-GPU review; it is not a blanket exemption for authored levels. Levels 5 and 40 remain similarly documented introductory work.

## Construction and interaction

`constructFlip` grows approaches to a chosen spot, then samples contacts on phased exits and earlier arrows' lanes. Each new contact arrow has an initially clear route, so dependencies can branch and join while remaining clearable. Body bends, gaps, contact positions, faces and three-to-five-arrow region size vary before acceptance. Optional second spots lie on a shared traversal, with another sampled body contact on their alternate exit. They are not copies of a finished single-spot gadget.

The movement engine validates every heading combination, solves each circuit, proves no safe choice strands it, and checks flip interest. Each spot also has an individual safety proof. Independent tests enumerate actual reachable states and change only one heading at a time: every spot must change a safe choice, and two-spot circuits must have a shared arrow whose safety depends on both spots independently. Tests cover actual head-on reversals rather than relying on pattern names.

Existing circle selection runs over the grown paths, preferring safe parks with a flip pending. The region proof still governs those parks and continuation. Exhaustion omits an optional circuit or blocker; it never returns a stamped fallback. Construction is bounded to 32 candidates per existing generation restart. Flip blockers sample all actual lane cells within 48 attempts. Other mechanic blocker searches retain their original six-attempt prefix, then use a bounded full-lane search only on changed flip boards with no blocker. That search prefers shorter clear exits within 24 total attempts; unrelated boards keep their original behavior. A rejected candidate preserves the proven prefix and continues the bounded search. Larger exploratory circuits failed blocker-share floors, so body growth is bounded to eight cells and circuits to five arrows; all proof and difficulty gates remain.

## Preserved constraints

The flip-plan stream, frequency curve, one-/two-spot cap, circle budget, intro, movement rules, density and difficulty gates remain. The independent `flip-topology-v1` construction stream avoids rerolling unrelated plans. Changed layouts refresh saves through the existing fingerprint check; there is no generator-version bump.

Tracing found that larger circuits caused construction restarts which also rerolled other mechanics' blocker-presence draws. On changed flip boards, that presence now uses the original plan draw while placement geometry retries independently. A failed fill first retries with one proven blocker per mechanic before the existing all-off retry. The complete placement/blocker-share suite passes all nine tests with its original floors unchanged.

The region's full heading reach stays separate from earlier mechanics and groups. Existing region closure and fill fences remain. Grown seeded blockers gate core lanes and participate in the proven region; ordinary fill remains outside it. This batch makes no claim of ordinary fill inside the stateful region.

## Verification

```bash
make checkall
bun scripts/stress-generate.ts 500
MECHANIC=flip bun scripts/inspect-parking.ts 41 70 96 151
FLIP_ONLY=1 make browser-test
```

Independent seeded samples produced 64 distinct whole layouts and 63 distinct head/neck/spot layouts after translation and all 48 cube rotations/reflections. The actual initial movement engine produced 11 distinct blocking graphs with coordinates and IDs removed. Of 64 circuits, 46 spanned multiple faces and 14 had two spots; all two-spot samples had a shared-arrow witness. Sizes ranged from three to five arrows. The independent test passed with 2,206 assertions before broad integration checks.

The refreshed campaign audit records 85 placed circuits over 91 planned levels, including 17 two-spot circuits. All 91 changed fingerprints are on planned flip levels; no unrelated fingerprint changes. The nine placement/blocker-share tests pass with 354 assertions and their original floors unchanged.

The first complete integration gate found four representative/inventory assertions tied to the former layouts, and a real shape-accounting omission: grown flip blockers were added after the shape counter, allowing seven copies against a cap of six on level 106. Blockers now enter the counter before fill, and the unchanged all-level shape-cap sweep passes. Mirror/leap sample selections and one lock timing sample move to placed cores, retaining their case counts and assertions; the lock sweep verifies both cross-face and same-face variants instead of a former placement-ID inventory.

The final-source 500-ID stress sweep passes with zero failures in 440.9 seconds. Its slowest far ID, `1805395438789503`, took 11,315 ms while other CPU checks were running. The preceding sweep took 398.2 seconds with the same ID at 9,935 ms. A same-run comparison on that ID measured the published rotor source at 6,203 ms with no flip core and the new source at 8,521 ms with a retained flip core; this is a real performance tradeoff on a rare difficult placement. The strict sampled mechanic-generation budgets remain unchanged.

The final `make checkall` passes format, lint, types, 642 tests with zero failures and 1,924,268 assertions (988.52 seconds), the production build and icon checks. Bun 1.4.2 is the verified runtime. Exact face-grid layouts and solver evidence for levels 41, 70, 96 and 151 are retained in [the supported text output](flip-topology-layouts.txt); the campaign fingerprint/placement audit is in [the audit JSON](flip-topology-audit.json).

The cloud has no verified real-GPU browser acceptance, so no rendering, picking, animation or UI acceptance is claimed. Publication is authorized per tested mechanic: local main merge, normal origin/main push, exact-SHA Checks and automatic Pages verification.
