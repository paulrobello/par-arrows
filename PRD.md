# Par Arrows — Product Requirements

Status: **Draft for owner review. Planning only.**

Owner: Paul Robello

Created: 2026-09-14

This document captures the requested game and makes unresolved choices explicit. Proposed defaults are recommendations, not owner-approved requirements. Creating or approving these documents does not authorize implementation in this session. No game code, build scaffold, or deployment is part of the current deliverable.

Companion: [implementation plan](IMPLEMENTATION_PLAN.md). Visual sources: [reference gallery and provenance](docs/references/README.md).

## 1. Product goal

A web-based, single-player 3D spatial puzzle for desktop and mobile. Players inspect and rotate a shape covered with arrows, then remove arrows by choosing ones with an unobstructed forward path. Incorrect choices visibly collide, rebound, and consume a life. Progression starts with small, readable cubes and later introduces denser layouts, new mechanics, and other shapes.

The core experience should reward understanding the shape and removal order. Camera manipulation and ambiguous touch input must not cause unintended life loss.

## 2. Requirement authority

| Label | Meaning |
| --- | --- |
| Confirmed | Explicitly requested by the owner. |
| Proposed | Recommended behavior awaiting an answer. |
| Open | A choice that changes the product or rules and must be resolved before dependent implementation. |
| Deferred | Future gameplay to accommodate in the design without shipping it in the MVP. |

The reference images are visual evidence only. Their level number, stars, hint button, advertisements, counters, and power-up icons do not establish requirements. The owner has separately confirmed faint far-side arrows, selectable only after rotating them to an exposed face.

## 3. Confirmed requirements

| ID | Requirement |
| --- | --- |
| R1 | Run in desktop and mobile web browsers with mouse and touch interaction. |
| R2 | Provide level progression, beginning with a basic small cube. |
| R3 | Place multiple black arrows across all six faces of early cubes. |
| R4 | Arrows may have different lengths and may wrap across multiple faces. No one-face or fixed-length assumption may be built into the level model. |
| R5 | Clicking or touching an arrow attempts movement in its forward direction. |
| R6 | An arrow that reaches an exit edge unobstructed flies off and is removed. |
| R7 | An arrow that hits another arrow bounces back to its original position. Its first failure costs one life and makes it red until removed. Further failures by that same red arrow cost no additional lives. |
| R8 | Level 1 starts with five lives. Later progression grants fewer lives according to the confirmed tiered schedule in R20. The life floor beyond the MVP remains open. |
| R9 | Later levels can be much denser and need not use perfect cubes. |
| R10 | Future double-ended arrows have blue and green halves. The half clicked determines travel direction. |
| R11 | Future special edges are marked yellow. A head reaching one continues onto the adjoining face instead of flying off. |
| R12 | The engine design must allow additional mechanics beyond R10 and R11. These two mechanics are introduced at later levels, after the basic gameplay MVP. |
| R13 | Movement follows the arrow's path: the tail follows the head. Existing wrapped bodies unwrap through ordinary seams; only a new head crossing determines exit versus continuation. |
| R14 | Allow free rotation, mouse-wheel zoom, and pinch zoom. Far-side arrows remain faintly visible and become selectable only when rotated onto exposed faces. |
| R15 | At zero lives, allow unlimited retries of the same puzzle, restoring its configured starting lives. |
| R16 | The MVP contains ten curated cube levels and a solvability checker. |
| R17 | Arrow paths use grid-aligned 90-degree turns, with no starting overlaps or overpasses. |
| R18 | Reject any level where an arrow could contact its own body. Do not turn self-contact into an ordinary life-costing gameplay event. |
| R19 | Only one arrow moves or rebounds at a time. Ignore additional arrow taps while rotation and zoom remain available. |
| R20 | Levels 1–3 start with five lives, levels 4–6 with four, and levels 7–10 with three. Retry resets lives and red-arrow history. |
| R21 | Refresh/reopen resumes the exact logical state, preserving removed arrows, lives, and failure history, including the result of an interrupted move. |
| R22 | Highlight the selected arrow on press before release. Ambiguous taps do nothing so the player can zoom closer. |
| R23 | Save player progress in browser `localStorage` so players can resume after refresh or reopening the game. |
| R24 | Support installation as a progressive web app (PWA) and launching from its installed icon. |
| R25 | Support mobile devices up to two hardware generations old, including the current generation and the previous two. Select concrete representative devices for verification. |
| R26 | Include an onboarding demo on a small cube with only a few arrows. Show a touch on an arrow that fails, then a touch on an arrow that succeeds. The demo is non-skippable, consistent with the owner's preceding instruction. |

## 4. MVP boundary

### 4.1 Proposed playable MVP

- M1: One-direction black arrows, including bent paths and paths crossing cube faces.
- M2: Rotatable cube, reliable selection, unobstructed exit animation, blocked rebound, red feedback, and life accounting.
- M3: Ten curated cube levels with increasing density and the confirmed five/four/three starting-life curve.
- M4: A small-cube onboarding demo showing a failed touch followed by a successful touch; level indicator, arrows-remaining count, lives display, restart, failure/retry, completion/next-level, and replay of unlocked levels.
- M5: Exact logical progress resume from browser `localStorage`, including failed-arrow history, in the browser and installed PWA. Settings and offline-play scope remain open.
- M6: Validated levels with a demonstrated full-clear solution and desktop/mobile verification.
- M7: PWA installation and standalone launch, with real-device checks covering mobile hardware up to two generations old.

The count, curated source, life curve, exact resume behavior, browser `localStorage`, solvability checker, PWA installation, and mobile hardware age target are confirmed. Other progression, interface, and platform details below remain proposals where labeled.

### 4.2 Deferred content and features

- X1: Playable blue/green double-ended arrows and yellow continuation edges. Reserve their rule contracts now. Introduce them through separate tutorial levels later.
- X2: Non-cube content. First extension candidate: rectangular cuboids, followed by grid-aligned compound solids. Arbitrary curved surfaces, holes, and concave shapes need a separate scope decision.
- X3: Further unspecified mechanics. Provide explicit rule boundaries, not a general plugin or scripting platform.
- X4: Accounts, cloud saves, leaderboards, monetization, advertisements, energy timers, purchases, and social features.
- X5: Undo, hints, rewards, stars, scoring, daily challenges, and a player-facing level editor unless separately approved.
- X6: Offline gameplay and custom audio assets until their scope is decided. PWA installation is included in the MVP.

## 5. Core rules requiring confirmation

### 5.1 Arrow geometry and motion — Q1, Q2, Q7, Q8

**Confirmed geometry:** Each arrow follows a continuous, grid-aligned path with right-angle turns and no starting overlaps or overpasses. Proposed representation: an ordered path from tail to head, rendered at consistent width with softened visual corners while logical paths remain exact.

**Confirmed movement:** On activation, the head moves straight forward in the local face plane. The body follows the head through the existing path, and the tail vacates it. Existing bends do not independently command new turns for the head. A static body may already span several faces, even when no yellow edges are present.

At an ordinary edge reached by the head, the head departs along its current tangent into space. The rest of the body feeds along its stored route and follows off the shape. Existing body segments can unwrap across their original seams. Proposed exterior-flight rule: once departure starts, that arrow does not land on or collide with another face. This becomes relevant to later concave shapes and remains open in Q8.

**Proposed boundary:** Unrestricted visual length does not mean an infinite path. Level validation will enforce finite, non-overlapping routes and explicit supported content budgets, without a fixed per-arrow length baked into the engine.

### 5.2 Collision — Q7, Q8, Q9

**Proposed:** Contact with any occupied portion of another arrow blocks movement, regardless of arrow direction or which face owns that portion. Arrows do not push, cut through, jump over, or merge with each other.

Collision uses logical surface occupancy and the swept movement path, not screen-space overlap. Two arrows projected on top of each other on different faces do not collide. Adjacent lanes remain passable even if thick rendering or touch targets overlap visually.

**Proposed occupancy contract:** Paths occupy ordered face-cell centers and the grid links connecting them. Distinct arrows cannot share a cell or a connecting link, including endpoints. Connections across a face seam have one canonical link identity, regardless of traversal direction. Neighboring face cells remain distinct cells. A seam is not an extra turn or duplicated cell. Routes pass through edge lanes away from physical cube vertices. A shared logical path endpoint counts as contact; merely adjacent lanes do not. Logical cell/link contact drives the simulation and validator, while visual stroke thickness and expanded touch regions do not alter it. Test swept link traversal so crossing or opposite-direction motion cannot skip contact between cells.

**Confirmed self-contact rule:** Reject levels where any arrow could contact its own body. Check the full motion, not just the initial layout. Validate each arrow with other arrows removed so an initial blocker cannot hide a later self-collision. Use simultaneous body/tail movement for geometric contact checks rather than treating the entire original path as permanently occupied. Proposed tie interpretation: a just-vacated tail location is not self-contact if there is no overlap during the continuous motion. This exact boundary remains to be confirmed.

Initial self-intersections and overlapping starting paths are invalid authoring data. A runtime self-contact detected despite validation is a content error, must restore a stable state, and must not charge a life. For future bidirectional arrows, validate both directions before accepting their level.

An attempt is simulated before its result is committed. If blocked, animate to first contact and back, then restore the exact original path. If successful, animate the complete exit and remove the whole arrow. Animation frame rate must not change the result.

### 5.3 Failure feedback and lives — Q3, Q5, Q10

**Confirmed:** An arrow-on-arrow collision returns the arrow to its original position. If the arrow has never failed during this level attempt, deduct one life and mark it red. It remains red until successfully removed. Subsequent failed moves by that red arrow still rebound but cost zero lives, including after its original blocker has been removed. Red arrows remain selectable while the level is active.

Record failure history as logical per-arrow state; red is its visual expression. Do not infer whether a penalty is owed from a material color. Proposed accessibility treatment: accompany red with a non-color marker or path treatment.

Life deduction occurs at the first logical impact for that arrow. Duplicate pointer events, rapid taps during movement, cancellation, camera drags, misses, and malformed input must not create extra deductions. An internal level-data or rendering failure must not charge a life. A level attempt's lives therefore measure distinct arrows failed, not total failed taps.

**Confirmed:** At zero lives, retry restores the same layout and full starting lives, with unlimited attempts. A new level attempt clears every arrow's failure history and returns ordinary arrows to black. Levels 1–3 start with five lives, levels 4–6 with four, and levels 7–10 with three. Lives do not carry over because each level starts at its configured budget. At zero, finish the rebound feedback and show failure rather than allow further free probes.

### 5.4 Completion, concurrency, and interruption — Q9, Q11

**Confirmed:** Only one arrow attempt can run at a time. Additional arrow activations are ignored, not queued. Camera rotation and zoom remain available. This makes the rule outcome independent of rapid input timing.

Completion happens after the last arrow has fully exited. Show a short completion state and an explicit Next button. There is no timer or move cap in the proposed MVP.

**Confirmed:** Reload/reopen resumes the exact logical state, including an interrupted move's result. Proposed implementation: save the complete logical result when the attempt is accepted, before presentation, and restore to a settled view of that result. Backgrounding pauses presentation; returning completes it once. An interrupted first collision still costs its one life; an interrupted collision by an already-red arrow costs none. Preserve failed-arrow history and never restore partially displaced geometry.

### 5.5 Onboarding demonstration — Q13

**Confirmed sequence:** Use a small cube with only a few arrows. Visibly demonstrate touching a blocked arrow first, then touching a different arrow that can leave successfully. The two actions occur in that order and do not overlap.

Proposed presentation: an animated hand or touch indicator makes each press and release clear. Use one fixed, readable camera view where both chosen arrows and the blocker can be seen. First, the blocked arrow advances to contact, rebounds to its exact starting path, and remains red. Then the second arrow advances unobstructed, flies off, and is fully removed. Keep the failed arrow red throughout the second action. Prefer making the second arrow the first arrow's blocker so the relationship is easy to understand. Do not add a third demonstration move to the requested sequence.

The preceding instruction rules out a skippable collision demo, and the owner has now specified its content: show the complete sequence without a Skip control. Proposed lifecycle: run before the first campaign attempt, offer Start after completion, record completion locally, and do not repeat it on every resume. Keep this practice board separate from the ten campaign levels, with no campaign life or progress changes. If the demo displays lives, demonstrate the first-failure deduction using a demo-only counter. Level 1 still starts untouched with five lives. Exact arrow count, demonstration timing, replay access, and reduced-motion presentation remain implementation/design details to resolve.

## 6. Camera, input, and readability — Q4, Q12

Free rotation, faint noninteractive far-side arrows, mouse-wheel/pinch zoom, press highlighting, and ignoring ambiguous taps are confirmed. Other details below are proposed:

- U1: Free orbit with a useful initial three-quarter view, mouse-wheel zoom on desktop, pinch zoom on touch devices, and a reset-view control. Proposed near/far zoom limits prevent clipping through the shape or losing it from view. Both portrait and landscape layouts must keep the cube and essential controls reachable.
- U2: A drag beginning over an arrow rotates the cube once it crosses a small screen-space threshold. Activation occurs on pointer release only if the gesture remained a tap. A pinch cancels any pending arrow tap. Pointer cancellation and loss of focus never activate an arrow.
- U3: Render faint, noninteractive far-side arrows through the shape. Only the nearest exposed surface can be selected. Ghost lines are never independent click targets. Exact opacity and colors remain a visual design choice.
- U4: Proposed implementation: enlarge arrow selection regions without changing collision geometry. Confirmed behavior: if there is no unambiguous visible arrow, do nothing and let the player zoom closer. Dense levels need zoom before shrinking targets beyond usability.
- U5: Keep directional arrowheads visible. Confirmed: highlight the selected arrow on press before release. Proposed: also show desktop hover feedback, without revealing whether removal will succeed.
- U6: Normal moves, success, collisions, and future direction choices must remain understandable without color alone. Support reduced motion and accessible HTML controls outside the 3D canvas.

Keyboard puzzle navigation and a nonvisual equivalent of the spatial puzzle need an explicit accessibility decision. Do not claim full keyboard or screen-reader gameplay from accessible menus alone.

## 7. Campaign, difficulty, and fairness

### 7.1 Confirmed content count and lives, proposed layout tuning — Q6, Q10

**Confirmed:** Ten curated cube levels with a solvability checker and the life schedule below. Grid sizes and arrow counts are proposed tuning targets. A logical face grid is independent of the displayed cube size.

| Group | Suggested grid per face | Suggested arrows per level | Starting lives | Teaching goal |
| --- | --- | --- | --- | --- |
| Level 1 | 4 × 4 | 6–10 total, with arrows on all six faces | 5, confirmed | Tap, rotate, identify a clear exit. |
| Levels 2–3 | 4 × 4 to 5 × 5 | 10–16 | 5, confirmed | Bent paths and blockers. |
| Levels 4–6 | 5 × 5 to 6 × 6 | 16–26 | 4, confirmed | Wrapping routes and removal dependencies. |
| Levels 7–10 | 6 × 6 to 8 × 8 | 26–42 | 3, confirmed | Denser combinations without new mechanics. |

These are authoring envelopes for playtesting, not generated layouts or promised achievable counts. Never fill a numeric quota with an invalid or unreadable arrangement. Later high-density stress fixtures should exceed the MVP campaign, with a provisional target of 150 arrows and 3,000 total path cells pending device measurements.

### 7.2 Solvability and authoring

- L1: Every shipped level must validate and have a complete, zero-mistake removal sequence under the exact runtime rules. No randomized placement may ship without validation.
- L2: Static arrow-removal puzzles should have at least one removable arrow at every reachable nonterminal state. A solver must verify the intended guarantee instead of assuming that a visually plausible board is solvable.
- L3: A successful removal should not create a dead end in the basic MVP rules. If simulation is purely removal-monotone, prove and test that property before using a simpler solver. Future mechanics may invalidate it and require state search.
- L4: Increase difficulty using dependency depth, number of initially available moves, wrapping, turn count, occlusion, and density. Lives alone do not define difficulty.
- L5: The onboarding demo shows a failed touch followed by a successful touch on a small cube with few arrows. Proposed isolation: demonstrate penalties in demo state while leaving campaign lives and progress untouched.
- L6: Reject any arrow with possible self-contact over its full motion, including after other arrows are removed. A complete solution alone does not waive this constraint.

Curated authoring and a checker are confirmed for the MVP. Generated progression and player-facing editor tooling are deferred. A development-only solver/validator is distinct from a player-facing hint feature.

## 8. Save and platform expectations — Q11, Q14, Q15

**Confirmed:** Save progress in browser `localStorage` and restore it when the player returns. Preserve unlocked levels, current level, remaining arrow IDs, failed-arrow IDs, and lives. Saving failed-arrow IDs preserves both permanent red feedback and exemption from repeat penalties. Accounts and cloud saves remain deferred.

Proposed storage format: one versioned save snapshot containing schema version, level content version, logical progress, and approved settings. Save after each accepted move's logical result, Retry/reset, and level completion/unlock; do not rely on page exit to save. Restore the interrupted move's settled result as confirmed in Q11. Save logical outcomes rather than animation transforms. If a level's data changes, preserve campaign unlocks and restart that level safely instead of applying incompatible occupancy data.

**Confirmed PWA scope:** Allow installation and standalone launch on supported platforms while retaining ordinary browser play. Installation is optional for the player. Verify save/resume in the installed app as well as the browser. Offline gameplay is not yet decided. Installation support and offline behavior are separate capabilities; see [MDN's PWA installation guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

Storage denial, quota errors, or corrupt data must not prevent a session from playing. Show a concise message when progress cannot be saved. Multiple tabs must not silently combine incompatible in-progress attempts. Proposed MVP policy: independent active attempts, monotonic unlock merging, and an explicit conflict decision before replacing an older attempt.

**Confirmed mobile hardware target:** Current-generation devices and the previous two hardware generations. Freeze representative iPhone, iPad/tablet, and Android models at MVP acceptance planning, and include the oldest supported generation in physical-device verification. This hardware-age target does not itself require obsolete operating systems.

**Proposed browser floor:** Current and previous major desktop Chrome, Edge, Firefox, and Safari; current and previous major iOS Safari and Android Chrome where the required graphics capabilities exist. Record the actual OS/browser versions used on the chosen hardware. Mobile emulation supplements real-device testing.

The proposed Three.js renderer requires WebGL 2. Show a clear unsupported-graphics message when unavailable. No WebGPU-only requirement is proposed. See [Three.js WebGLRenderer documentation](https://threejs.org/docs/pages/WebGLRenderer.html).

Provisional targets: responsive input feedback within 100 ms, 60 frames per second on agreed target devices for normal MVP levels, and no sustained drop below 30 frames per second on the later-density stress fixture. Measure rather than claim these goals from unit tests. Cap rendering resolution and visual effects as needed while retaining readable lines.

## 9. Future mechanic contracts

### 9.1 Double-ended blue/green arrows — Q16

One logical arrow has two selectable travel directions. A selection carries both arrow identity and chosen endpoint. Reversing traversal must reverse the ordered path consistently across face seams. The path is removed as a single entity after a successful attempt in either direction.

Define the two halves by distance along the full surface path, not by a screen-space bounding box. The halfway point, very short arrows, hidden halves, the middle selection dead zone, and persistent collision-red feedback overriding blue/green must be resolved before shipping this mechanic. Direction must also be conveyed by endpoint shape or another non-color cue. Q23 must decide whether first failure exempts both endpoints from further penalties or each direction has separate failure history.

### 9.2 Yellow continuation edges — Q17, Q18

An edge rule belongs to shape topology and maps a crossing position and direction onto the adjoining face. It is independent of camera orientation. Existing static path seams and future head-continuation rules must remain separate concepts.

Pending owner choices: whether yellow applies to a whole physical edge or a segment, whether it is shared in both crossing directions, and how corner ties behave. Proposed first version: whole physical edge, reciprocal in both directions, right-angle face transition, and paths aligned to cross edges away from vertices.

A path may encounter several yellow edges before an ordinary exit. Simulation must terminate if continuation creates a cycle or self-collision. Invalid content should be rejected before play. A defined runtime outcome is still needed for cycles introduced by later dynamic mechanics.

### 9.3 Other shapes and mechanics — Q19

Separate surface topology, arrow paths, edge behavior, movement outcomes, and level progression. A cube is the first topology, not a global six-face assumption. Prefer narrow typed data and rule functions to a universal mechanic framework.

For non-cube shapes, resolve surface grid alignment, exposed versus interior faces, concave corners, seam orientation, and exterior departure behavior before shipping their content. Reserve room for those decisions without promising every possible geometry.

## 10. Acceptance criteria for the future MVP

| ID | Observable acceptance criterion |
| --- | --- |
| AC1 | Level 1 presents a small cube with arrows on every face and exactly five starting lives. |
| AC2 | A visible arrow can be activated using mouse and touch. Free rotation, mouse-wheel zoom, and pinch zoom work. Rotation, zoom, cancellation, and blank taps never activate arrows or lose lives. |
| AC3 | Straight, bent, and multi-face arrows follow the approved movement model and leave completely when unobstructed. |
| AC4 | Contact with any blocking arrow segment causes first-contact feedback and exact path restoration. The arrow's first failure costs one life and stays red until removal. All later failures by that arrow cost zero lives. |
| AC5 | All six faces and seam orientations behave consistently. Camera rotation changes neither collision nor travel direction. |
| AC6 | Last-arrow removal, zero-life failure, same-level retry, unlocking, and replay follow the approved rules without duplicate transitions. |
| AC7 | Every campaign level passes structural validation and has a reproducible complete solution. Difficulty and life budgets follow the approved curve. |
| AC8 | Dense selection and rendering remain usable on agreed real desktop and mobile targets in portrait and landscape. Record devices and measurements. |
| AC9 | Progress is written to browser `localStorage` and resumes after refresh/reopen with the same level, removed arrows, lives, and red-arrow history. Reload during a move, background/resume, storage failure, changed level data, and rapid input follow the specified recovery policies without corrupting progression. |
| AC10 | Reduced motion, directional cues, non-color failure feedback, and accessible menus work as specified. Any gameplay accessibility gaps are stated. |
| AC11 | Engine fixtures demonstrate future endpoint selection and seam continuation boundaries without placing deferred mechanics in the MVP campaign. |
| AC12 | The project's actual formatting, lint, typecheck, tests, build, and relevant browser checks pass. Automated results and physical-device evidence are reported separately. |
| AC13 | The PWA installs and launches standalone on supported target platforms. Closing/reopening it resumes local progress. Real-device checks include hardware two generations old, and installation is not required for normal browser play. |
| AC14 | A small cube with few arrows demonstrates a visible touch on a blocked arrow, its contact/rebound/persistent red feedback, then a visible touch on another arrow that exits and disappears. The sequence cannot be skipped. Under the proposed demo-isolation policy, level 1 begins afterward with five lives and untouched arrows. |

## 11. Decision interview

Answer the blocking rules first. An unanswered proposal remains a proposal, even if it has a recommended default.

### 11.1 First-round questions already raised

| ID | Question | Owner answer | Status |
| --- | --- | --- | --- |
| Q1 | Does a bent arrow feed along its path, or move as a rigid bent shape? | Path-following movement; tail follows head. | Confirmed 2026-09-14. |
| Q2 | May an existing wrapped body unwrap through ordinary seams while only a new head crossing decides exit/continuation? | Yes. | Confirmed 2026-09-14. |
| Q3 | How long does collision red persist, and are repeat failures charged? | Red until removed; additional failures of that red arrow cost no extra lives. | Confirmed 2026-09-14. |
| Q4 | Free orbit or fixed face views? Should far-side arrows be visible and selectable? | Free orbit, faint far-side arrows, exposed surfaces only selectable. Mouse-wheel and pinch zoom also requested. | Confirmed 2026-09-14. |
| Q5 | What happens at zero lives? Does retry restore the same puzzle and full lives? | Unlimited retries of the same layout with full per-level lives. | Confirmed 2026-09-14. |
| Q6 | How many MVP levels, and authored, generated, or both? | Ten curated cubes with a solvability checker. | Confirmed 2026-09-14. |

### 11.2 Movement and fairness edge cases

- **Q7 — Confirmed 2026-09-14:** Grid-aligned 90-degree paths with no starting overlaps or overpasses. Adjacent lanes remain a proposed authoring convention.
- **Q8 — Confirmed 2026-09-14:** Reject any level where an arrow could contact itself. Follow-up boundary still open: does a head entering an exactly vacated tail location count as forbidden contact when there is no simultaneous overlap? Proposed: no. Exterior-flight collision against later concave shapes also remains open; proposed: no further surface collision after departure.
- **Q9 — Confirmed 2026-09-14:** One arrow attempt at a time; ignore further taps, with rotation and zoom still available.
- **Q10 — Confirmed 2026-09-14:** Five lives for levels 1–3, four for 4–6, three for 7–10. Retry restores lives and clears red-arrow history. Beyond-MVP life reductions remain open.
- **Q11 — Confirmed 2026-09-14:** Resume exact logical state, including removed arrows, lives, red-arrow history, and the result of an interrupted move.
- **Q12 — Confirmed 2026-09-14:** Highlight on press before release. Ambiguous taps do nothing; the player can zoom closer.
- **Q13 — Confirmed 2026-09-14:** Include a demo showing a touch on an arrow that fails, followed by a touch on an arrow that succeeds, on a small cube with only a few arrows. Combined with the preceding “no skipable collision demo” instruction, the demo is non-skippable. Practice-state isolation and first-run/replay details are proposed in section 5.5.

### 11.3 Scope and later-mechanic questions

- **Q14 — Partially confirmed 2026-09-14:** Save progress in browser `localStorage` and allow PWA installation. Offline gameplay remains unanswered.
- **Q15 — Hardware confirmed 2026-09-14:** Support mobile devices up to two generations old. Choose the exact representative models and OS/browser matrix before verification. Sound, haptics, keyboard gameplay, and nonvisual gameplay scope remain separate unanswered choices.
- **Q16:** For blue/green arrows, does each color cover exactly half the total path length? What should the exact midpoint do? Does either half remain selectable when the other is hidden? Recommendation: equal surface-path halves, neutral midpoint, only exposed portions selectable.
- **Q17:** Are yellow edges whole-edge or partial-edge rules? Do they work both ways? Can yellow markings be hidden behind the shape? Recommendation: whole-edge, reciprocal, visible using the same inspection rules as the shape.
- **Q18:** If yellow edges produce a loop with no exit, should the move fail with a life loss or should such boards be prohibited? Recommendation: prohibit in shipped static content and keep a bounded runtime safeguard.
- **Q19:** Which non-cube shapes come first: rectangular boxes, joined cubes, carved/concave blocks, or arbitrary meshes? Recommendation: boxes, then grid-aligned compound solids.
- **Q20:** Is progression strictly sequential? Can players skip, replay, or reset it? What happens after the final MVP level? Recommendation: sequential unlocks, replay unlocked levels, explicit campaign-complete screen.
- **Q21:** Do hints, undo, scoring, stars, time limits, or rewards belong in the MVP? Recommendation: none until the core rules are proven.
- **Q22:** Within the confirmed faint-far-side treatment, should the final art match the references' pale colors or use a different theme? Recommendation: preserve arrow readability and compare two palette/opacity treatments during implementation.
- **Q23:** For a blue/green arrow, is its first collision the only life penalty for the entire arrow, or can the other direction cost another life? Once red, how should the two selectable halves remain distinguishable? Recommendation: one penalty per whole arrow and persistent direction markers alongside red.

### 11.4 Approval boundaries

Q1–Q13 have owner answers; Q8 retains a tail-boundary clarification. Q13 confirms the demo sequence; its practice-state/lifecycle details are proposed. Q14 confirms `localStorage` and PWA installation. Q15 confirms mobile support through two prior hardware generations. Resolve the Q8 boundary before implementing movement. Resolve the remaining demo lifecycle details, Q14's offline scope, Q15's remaining platform/accessibility details, Q20, and Q21 before freezing the remaining MVP scope. Resolve Q16–Q19 and Q23 before implementing their deferred content. Q22 can be explored with rendered comparisons once implementation is separately authorized.

## 12. Current deliverable status

- S1: Planning documents and original reference copies are the only project deliverables in this session.
- S2: Gameplay, levels, renderer, tests, package configuration, and deployment have not been implemented.
- S3: No runtime quality or solvability claim is made from these documents. Future acceptance criteria describe work to verify later.
