# Par Arrows — Product Requirements

Status: **Initial MVP implemented; device/release qualification remains open.**

Owner: Paul Robello

Created: 2026-09-14

This document captures the requested game and distinguishes confirmed choices from implementation defaults. On 2026-09-14 the owner requested implementation using Terra subagents and a proper greenfield/Git setup, superseding the original planning-only scope. Current execution defaults and verification status are recorded in [progress.md](progress.md). Deployment and remote publication are separate from this authorization.

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

The four additional photos supplied on 2026-09-14 are preserved as references 04–07. The owner highlighted arrow-path variety in the first three and explicitly described moving arrowheads turning onto the adjacent face at the yellow edge in the fourth. That movement rule comes from the owner's explanation; a still image alone does not demonstrate animation behavior.

## 3. Confirmed requirements

| ID | Requirement |
| --- | --- |
| R1 | Run in desktop and mobile web browsers with mouse and touch interaction. |
| R2 | Provide level progression, beginning with a basic small cube. |
| R3 | Place multiple black arrows across all six faces of early cubes. |
| R4 | Arrows may have different lengths, turn counts, and sequences of right-angle bends, and may wrap across multiple faces. Include short hooks, long runs, zigzags, and winding multi-bend paths as content complexity grows. No one-face or fixed-length assumption may be built into the level model. |
| R5 | Clicking or touching an arrow attempts movement in its forward direction. |
| R6 | An arrow that reaches an exit edge unobstructed flies off and is removed. |
| R7 | An arrow that hits another arrow bounces back to its original position. Its first failure costs one life and makes it red until removed. Further failures by that same red arrow cost no additional lives. |
| R8 | Level 1 starts with five lives. Runtime levels have a deterministic per-level life budget that falls to three lives and never goes below that floor. |
| R9 | Later levels can be much denser and need not use perfect cubes. |
| R10 | Future double-ended arrows have blue and green halves. The half clicked determines travel direction. |
| R11 | Special physical cube edges are marked yellow. A head reaching one continues onto the adjoining face instead of flying off. |
| R12 | The engine design must allow additional mechanics beyond R10 and R11. Level 11 is an authored, low-density introduction to yellow continuation edges; level 15 introduces overlapping tails and overlapping groups enter generated layouts at level 16. Blue/green two-ended arrows remain deferred. |
| R13 | Movement follows the arrow's path: the tail follows the head. Existing wrapped bodies unwrap through ordinary seams; only a new head crossing determines exit versus continuation. |
| R14 | Allow continuous rotation in every drag direction with no axis stops, including repeated turns over the top and bottom, plus mouse-wheel and pinch zoom. Far-side arrows remain faintly visible and become selectable only when rotated onto exposed faces. |
| R15 | At zero lives, allow unlimited retries of the same puzzle, restoring its configured starting lives. |
| R16 | Level 1 is the unchanged authored teaching cube. Levels 2–10, 12–14, and 16 onward are generated at runtime from their level number and validated for solvability; level 11 introduces yellow wrapping and level 15 introduces overlapping tails. A given generated level is the same seeded puzzle for every player. |
| R17 | Arrow paths use grid-aligned 90-degree turns, with no crossings or overpasses, except the shared tail segments defined in R33. |
| R18 | Reject any level where an arrow could contact its own body. Do not turn self-contact into an ordinary life-costing gameplay event. |
| R19 | Only one arrow or connected tail group moves or rebounds at a time. Ignore additional arrow taps while rotation and zoom remain available. |
| R20 | Runtime progression is endless. Difficulty grows from 60 to 180 arrows early, then caps at 264 arrows; grids grow to 26 × 26 cells per face and path length is bounded at 40. Lives never fall below three. Retry resets lives and red-arrow history. |
| R21 | Refresh/reopen resumes the exact logical state, preserving removed arrows, lives, and failure history, including the result of an interrupted move. |
| R22 | Highlight an unambiguous arrow on press only when a move can start. A valid tap activates the arrow captured on press; blank or ambiguous presses and drag/zoom/cancel gestures do nothing. |
| R23 | Save player progress in browser `localStorage` so players can resume after refresh or reopening the game. |
| R24 | Support installation as a progressive web app (PWA) and launching from its installed icon. |
| R25 | Support mobile devices up to two hardware generations old, including the current generation and the previous two. Select concrete representative devices for verification. |
| R26 | Include an onboarding demo on a small cube with only a few arrows. Show a touch on an arrow that fails, then a touch on an arrow that succeeds. The demo is non-skippable, consistent with the owner's preceding instruction. |
| R27 | Render arrows as flat ribbons with flat arrowheads, following the surface and folding across face seams. |
| R28 | Normal arrows move at a constant five cube-space units per second, independent of distance to an edge, arrow length, grid size, or yellow-edge crossings. A cube face is two units wide. Longer routes take proportionally longer, and both rebound legs use the same speed. Reduced-motion transitions remain 70.4 ms. This supersedes the earlier fixed durations; demo pauses are unchanged. |
| R29 | Keep level 1 simple. From level 2 onward, substantially increase arrow density and multi-bend zigzag complexity, mix different path shapes and straight-arrow lengths, and include multiple arrows spanning cube edges. |
| R30 | Superseded catalog detail: make arrow shafts and heads 20% wider and double the version-4 counts on fixed levels 2–10. Keep it only as historical reference; current production difficulty is governed by R20. |
| R31 | Support dark mode with system-preference detection and a persistent manual appearance control. |
| R32 | Add a Hint button that finds a safely removable arrow, rotates the cube to expose it, and then flashes that arrow. |
| R33 | Two or three arrows may overlap along tail segments, with separate heads and no crossings. Touching any portion of any member activates the whole connected group. Members never collide with each other or cross each other's travel paths. If any member hits an outside arrow, all members rewind and remain red. |

## 4. MVP boundary

### 4.1 Proposed playable MVP

- M1: One-direction arrows, black in light mode and ivory in dark mode, including bent paths and paths crossing cube faces.
- M2: Rotatable cube, reliable selection, unobstructed exit animation, blocked rebound, red feedback, and life accounting.
- M3: The unchanged authored level 1, followed by endless deterministic runtime cube levels. A given level number always produces the same validated puzzle for every player.
- M4: A small-cube onboarding demo showing a failed touch followed by a successful touch; level indicator, arrows-remaining count, lives display, restart, failure/retry, completion/next-level, and bounded numeric navigation to any unlocked level.
- M5: Exact logical progress resume from browser `localStorage`, including failed-arrow history, in the browser and installed PWA. Saves store generator metadata and the logical state, not generated catalogs. Persist reduced-motion and System/Light/Dark appearance settings separately. Offline-play scope remains open.
- M6: Runtime generation is deterministic, bounded, structurally validated, and solver-validated before a generated puzzle is presented. Desktop/mobile verification remains required.
- M7: PWA installation and standalone launch, with real-device checks covering mobile hardware up to two generations old.
- M8: A safe-arrow hint that reveals the arrow's head face before highlighting it, without making a move or spending a life.

The count, curated source, life curve, exact resume behavior, browser `localStorage`, solvability checker, PWA installation, and mobile hardware age target are confirmed. Other progression, interface, and platform details below remain proposals where labeled.

### 4.2 Deferred content and features

- X1: Playable blue/green double-ended arrows remain deferred. Level 11 introduces yellow continuation edges in an authored teaching layout; generated layouts from level 12 onward, except authored level 15, use the rule contract recorded in section 9.2.
- X2: Non-cube content. First extension candidate: rectangular cuboids, followed by grid-aligned compound solids. Arbitrary curved surfaces, holes, and concave shapes need a separate scope decision.
- X3: Further unspecified mechanics. Provide explicit rule boundaries, not a general plugin or scripting platform.
- X4: Accounts, cloud saves, leaderboards, monetization, advertisements, energy timers, purchases, and social features.
- X5: Undo, paid/limited hint economies, rewards, stars, scoring, daily challenges, and a player-facing level editor unless separately approved.
- X6: Offline gameplay and custom audio assets until their scope is decided. PWA installation is included in the MVP.

## 5. Core rules requiring confirmation

### 5.1 Arrow geometry and motion — Q1, Q2, Q7, Q8

**Confirmed geometry:** Each arrow follows a continuous, grid-aligned path with right-angle turns and no crossings or overpasses, except the shared tail segments defined in R33. Proposed representation: an ordered path from tail to head, rendered at consistent width with softened visual corners while logical paths remain exact.

**Confirmed movement:** On activation, the head moves straight forward in the local face plane. The body follows the head through the existing path, and the tail vacates it. Existing bends do not independently command new turns for the head. A static body may already span several faces, even when no yellow edges are present.

At an ordinary edge reached by the head, the head departs along its current tangent into space. The rest of the body feeds along its stored route and follows off the shape. Existing body segments can unwrap across their original seams. Proposed exterior-flight rule: once departure starts, that arrow does not land on or collide with another face. This becomes relevant to later concave shapes and remains open in Q8.

**Proposed boundary:** Unrestricted visual length does not mean an infinite path. Level validation will enforce finite routes with only validated tail-group overlaps and explicit supported content budgets, without a fixed per-arrow length baked into the engine.

### 5.2 Collision — Q7, Q8, Q9

**Proposed:** Contact with any occupied portion of an arrow outside the active tail group blocks movement, regardless of arrow direction or which face owns that portion. Arrows do not push, cut through, jump over, or merge with each other.

Collision uses logical surface occupancy and the swept movement path, not screen-space overlap. Two arrows projected on top of each other on different faces do not collide. Adjacent lanes remain passable even if thick rendering or touch targets overlap visually.

**Proposed occupancy contract:** Paths occupy ordered face-cell centers and the grid links connecting them. Distinct arrows cannot share a cell or connecting link except for a validated same-direction tail segment in a group of two or three. Heads remain separate, and point crossings are invalid. Connections across a face seam have one canonical link identity, regardless of traversal direction. Neighboring face cells remain distinct cells. A seam is not an extra turn or duplicated cell. Routes pass through edge lanes away from physical cube vertices. A shared logical path endpoint counts as contact; merely adjacent lanes do not. Logical cell/link contact drives the simulation and validator, while visual stroke thickness and expanded touch regions do not alter it. Test swept link traversal so crossing or opposite-direction motion cannot skip contact between cells.

**Confirmed self-contact rule:** Reject levels where any arrow could contact its own body. Check the full motion, not just the initial layout. Validate each arrow with other arrows removed so an initial blocker cannot hide a later self-collision. Use simultaneous body/tail movement for geometric contact checks rather than treating the entire original path as permanently occupied. Proposed tie interpretation: a just-vacated tail location is not self-contact if there is no overlap during the continuous motion. This exact boundary remains to be confirmed.

Initial self-intersections and starting overlaps outside the validated tail-group rule are invalid authoring data. A runtime self-contact detected despite validation is a content error, must restore a stable state, and must not charge a life. For future bidirectional arrows, validate both directions before accepting their level.

An attempt is simulated before its result is committed. If blocked, animate to first contact and back, then restore the exact original path. If successful, animate the complete exit and remove the whole arrow. Animation frame rate must not change the result.

### 5.3 Failure feedback and lives — Q3, Q5, Q10

**Confirmed:** An arrow-on-arrow collision returns the arrow to its original position. If the arrow has never failed during this level attempt, deduct one life and mark it red. It remains red until successfully removed. Subsequent failed moves by that red arrow still rebound but cost zero lives, including after its original blocker has been removed. Red arrows remain selectable while the level is active.

Record failure history as logical per-arrow state; red is its visual expression. Do not infer whether a penalty is owed from a material color. Proposed accessibility treatment: accompany red with a non-color marker or path treatment.

Life deduction occurs at the first logical impact for that arrow or connected group. Duplicate pointer events, rapid taps during movement, cancellation, camera drags, misses, and malformed input must not create extra deductions. An internal level-data or rendering failure must not charge a life. A level attempt's lives therefore measure distinct failed singleton arrows or connected groups, not total failed taps.

**Confirmed:** At zero lives, retry restores the same layout and full starting lives, with unlimited attempts. A new level attempt clears every arrow's failure history and returns ordinary arrows to black. Runtime level budgets reduce from the early game and floor at three lives. Lives do not carry over because each level starts at its configured budget. At zero, finish the rebound feedback and show failure rather than allow further free probes.

### 5.4 Completion, concurrency, and interruption — Q9, Q11

**Confirmed:** Only one arrow or connected tail-group attempt can run at a time. Additional arrow activations are ignored, not queued. Camera rotation and zoom remain available. This makes the rule outcome independent of rapid input timing.

Completion happens after the last arrow has fully exited. Show a short completion state and an explicit Next button. Next continues to the next logical level; there is no final level or campaign-complete terminal state.

**Confirmed:** Reload/reopen resumes the exact logical state, including an interrupted move's result. Proposed implementation: save the complete logical result when the attempt is accepted, before presentation, and restore to a settled view of that result. Backgrounding pauses presentation; returning completes it once. An interrupted first collision still costs its one life; an interrupted collision by an already-red arrow costs none. Preserve failed-arrow history and never restore partially displaced geometry.

### 5.4.1 Overlapping tails

**Confirmed 2026-09-15:** Two or three arrows share a continuous tail segment in the same direction. Heads never overlap. Touching a shared tail, an individual body segment, or any member's head activates the entire connected group. Simple point crossings do not create a group. Validate the members' full future routes without outside blockers so no member can ever collide with another member or cross its path.

Implementation defaults: group members travel at the same constant speed. At the earliest outside collision, all reverse together and restore their exact starting paths, including members with a clear exit. One life is charged on the group's first failure, all members become red, and further failures of that group are free. Successful attempts remove every member atomically. Selection and hints highlight the whole group. Saves must never restore only part of a group's removal or failure history.

Cube 15 is a small authored introduction. Generated cubes from 16 onward include validated pairs and trios. `?feature=overlap` opens the first introduction without affecting campaign progress.

### 5.5 Onboarding demonstration — Q13

**Confirmed sequence:** Use a small cube with only a few arrows. Visibly demonstrate touching a blocked arrow first, then touching a different arrow that can leave successfully. The two actions occur in that order and do not overlap.

Proposed presentation: an animated hand or touch indicator makes each press and release clear. Use one fixed, readable camera view where both chosen arrows and the blocker can be seen. First, the blocked arrow advances to contact, rebounds to its exact starting path, and remains red. Then the second arrow advances unobstructed, flies off, and is fully removed. Keep the failed arrow red throughout the second action. Prefer making the second arrow the first arrow's blocker so the relationship is easy to understand. Do not add a third demonstration move to the requested sequence.

The preceding instruction rules out a skippable collision demo, and the owner has now specified its content: show the complete sequence without a Skip control. Proposed lifecycle: run before the first campaign attempt, offer Start after completion, record completion locally, and do not repeat it on every resume. Keep this practice board separate from campaign levels, with no campaign life or progress changes. If the demo displays lives, demonstrate the first-failure deduction using a demo-only counter. Level 1 still starts untouched with five lives. Exact arrow count, demonstration timing, replay access, and reduced-motion presentation remain implementation/design details to resolve.

### 5.6 Safe-arrow hints

**Confirmed 2026-09-15:** A Hint button finds an arrow that can safely exit, turns the cube to make it visible, and only then flashes it. The chosen arrow or entire connected group is checked against the current remaining arrows; a hinted group highlights all its members. For a wrapped arrow, focus on its actual head face.

Implementation defaults: hints are free and unlimited, with no progress, life, or failure-history changes. Focus takes 600 ms and returns to a fitted viewing distance; three slow highlight pulses follow over 2.4 seconds. Reduced-motion settings snap to the target view and use steady emphasis. Disable Hint during the demo, arrow movement, another hint, and won/lost states. Pressing the canvas, dragging, zooming, moving an arrow, resetting the view, retrying, or changing levels cancels the hint and restores normal/red arrow colors.

## 6. Camera, input, and readability — Q4, Q12

Free rotation, faint noninteractive far-side arrows, mouse-wheel/pinch zoom, press highlighting, and ignoring ambiguous taps are confirmed. Other details below are proposed:

- U1: Continuous orbit in every drag direction with no angle stops or abrupt flips over the poles. The owner confirmed unrestricted rotation on 2026-09-14. Keep a useful initial three-quarter view, mouse-wheel zoom on desktop, pinch zoom on touch devices, and a reset-view control. Near/far zoom limits prevent clipping through the shape or losing it from view. Both portrait and landscape layouts must keep the cube and essential controls reachable.
- U2: Capture the unambiguous arrow under the primary pointer on pointerdown. A matching primary pointerup activates that original arrow if displacement remains below the 9 CSS-pixel drag threshold and no drag, zoom, pinch, cancellation, lost capture, or blur occurred, even when release lands on whitespace or a neighboring narrow target. Blank or ambiguous pointerdowns capture nothing. Reaching the threshold classifies the gesture as a drag and never activates an arrow, including when it returns to its start or intermediate move events were absent. Wheel, pinch, pointer cancellation, lost capture, and blur cancel a pending tap. The 9-pixel value is an implementation default, not an owner-set threshold.
- U3: Render faint, noninteractive far-side arrows through the shape. Only the nearest exposed surface can be selected. Ghost lines are never independent click targets. Exact opacity and colors remain a visual design choice.
- U4: Proposed implementation: enlarge arrow selection regions without changing collision geometry. Confirmed behavior: if there is no unambiguous visible arrow, do nothing and let the player zoom closer. Dense levels need zoom before shrinking targets beyond usability.
- U5: Keep directional arrowheads visible. Confirmed: highlight the selected arrow on press before release, but only when a move can start. Do not highlight or activate arrows while level loading/error, the onboarding demo, or another arrow's motion disables attempts. Orbit and zoom remain available while an arrow is in motion. Desktop hover feedback, without revealing whether removal will succeed, remains proposed.
- U6: Normal moves, success, collisions, and future direction choices must remain understandable without color alone. Support reduced motion and accessible HTML controls outside the 3D canvas.
- U7: Default appearance follows the system, including live changes. Settings offers System, Light, and Dark; explicit choices persist and override the system until System is selected again. Apply appearance before the first app paint and update both HTML controls and the 3D view without resetting the puzzle, camera, or motion. Use contrasting normal, failed, selected, and faint far-side arrow colors in each theme.

Keyboard puzzle navigation and a nonvisual equivalent of the spatial puzzle need an explicit accessibility decision. Do not claim full keyboard or screen-reader gameplay from accessible menus alone.

## 7. Campaign, difficulty, and fairness

### 7.1 Current campaign content and lives — Q6, Q10

**Superseded historical policy:** the fixed ten-level, content-version-5 catalog described in earlier reports is retained only as historical reference and test fixtures. It is not a production import.

**Current policy:** level 1 remains the unchanged authored teaching cube. Levels 2–4 keep their version-1 seeds and geometry, levels 6–10 keep their version-4 runtime seeds, and generated cubes 12–14 took new version-5 layouts in the v5 density bump. Level 11 is an authored 4 × 4 cube with six short arrows, one per face, five lives, and a guaranteed reciprocal front-west/left-east yellow edge. Two safe moves wrap across that edge; the other four arrows exit through ordinary edges. This teaching layout is exempt from random edge-count selection and generated density. Level 15 is an authored 4 × 4 introduction with a pair, a trio, and one outside blocker, with five lives. Generated layouts with overlapping groups begin at level 16 using generator version 5 and validated tail groups. The yellow-edge weighting curve remains in place. Seeds through level 11 stay unchanged; affected older attempts from level 12 onward refresh while unlocks and tutorial completion remain preserved. Each generated puzzle is reverse-constructed and validated as solvable before use. A player retry and every player on the same generated level number receive the same puzzle.

| Range | Generation bounds | Starting lives | Purpose |
| --- | --- | --- | --- |
| Level 1 | Authored 4 × 4 cube, 6 arrows | 5 | Teach tapping, rotation, and clear exits. |
| Level 11 | Authored 4 × 4 cube, 6 short arrows, reciprocal front-west/left-east yellow edge | 5 | Introduce two safe head-wrap moves and four ordinary exits at low density. |
| Level 15 | Authored 4 × 4 cube, linked pair and trio plus a blocker | 5 | Teach group activation and whole-group rewind. |
| Early runtime levels | 60–180 arrows with increasing grid/detail | Decreases toward 3 | Build density, wrapping, and removal dependencies. |
| Later runtime levels | At most 264 arrows, 26 × 26 cells per face, and 40 cells per path | 3 floor | Continue endlessly within validated desktop bounds. |

Generation uses a worker, caches the three most recent results, and times out after 12 seconds. A stale request, reset, or failed restore must never replace a newer accepted state. Never present an unvalidated puzzle merely to meet a count target.

References [04](docs/references/reference-04.jpeg), [05](docs/references/reference-05.jpeg), and [06](docs/references/reference-06.jpeg) establish the later visual direction: mix short and long arrows, single and multiple bends, hooked returns, stepped zigzags, and winding paths, with close spacing across multiple faces. Preserve each arrow's readable identity and validate self-contact and solvability. The pictured late-game density is a progression reference; level 1 and the level 11 mechanic introduction keep their simple teaching layouts. Screenshot counters do not set campaign arrow quotas.

The owner identified stamped S-curve repetition in content version 3. Version 4 addresses the [reference complexity criteria](docs/references/arrow-complexity-study.md) with paths grown around neighboring routes, varied footprints and run lengths, and distributed heads. Automated checks count rotated, mirrored, reversed, and seam-crossing copies together; whole-board visual review remains required. Higher arrow counts or bend totals alone do not satisfy the requirement. See the [comparison and verification report](docs/verification/irregular-routes.md).

### 7.2 Solvability and authoring

- L1: Every shipped level must validate and have a complete, zero-mistake removal sequence under the exact runtime rules. No randomized placement may ship without validation.
- L2: Static arrow-removal puzzles should have at least one removable arrow at every reachable nonterminal state. A solver must verify the intended guarantee instead of assuming that a visually plausible board is solvable.
- L3: A successful removal should not create a dead end in the basic MVP rules. If simulation is purely removal-monotone, prove and test that property before using a simpler solver. Future mechanics may invalidate it and require state search.
- L4: Increase difficulty using dependency depth, number of initially available moves, wrapping, turn count, occlusion, and density. Lives alone do not define difficulty.
- L5: The onboarding demo shows a failed touch followed by a successful touch on a small cube with few arrows. Proposed isolation: demonstrate penalties in demo state while leaving campaign lives and progress untouched.
- L6: Reject any arrow with possible self-contact over its full motion, including after other arrows are removed. A complete solution alone does not waive this constraint.

Levels 1, 11, and 15 are authored; other levels are generated and checked at runtime. Player-facing editor tooling remains deferred. The solver/validator checks content independently of the approved player-facing Hint feature.

## 8. Save and platform expectations — Q11, Q14, Q15

**Confirmed:** Save progress in browser `localStorage` and restore it when the player returns. Preserve unlocked levels, current level, remaining arrow IDs, failed-arrow IDs, and lives. Saving failed-arrow IDs preserves both permanent red feedback and exemption from repeat penalties. Accounts and cloud saves remain deferred.

The implementation stores versioned campaign progress and player settings in separate localStorage entries. Appearance changes preserve reduced-motion settings and do not change campaign content versions or progress. Save after each accepted move's logical result, Retry/reset, and level completion/unlock; do not rely on page exit to save. Restore the interrupted move's settled result as confirmed in Q11. Save logical outcomes rather than animation transforms. If a level's data changes, preserve campaign unlocks and restart that level safely instead of applying incompatible occupancy data.

**Confirmed PWA scope:** Allow installation and standalone launch on supported platforms while retaining ordinary browser play. Installation is optional for the player. Verify save/resume in the installed app as well as the browser. Offline gameplay is not yet decided. Installation support and offline behavior are separate capabilities; see [MDN's PWA installation guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

Storage denial, quota errors, or corrupt data must not prevent a session from playing. Show a concise message when progress cannot be saved. Multiple tabs must not silently combine incompatible in-progress attempts. Proposed MVP policy: independent active attempts, monotonic unlock merging, and an explicit conflict decision before replacing an older attempt.

**Confirmed mobile hardware target:** Current-generation devices and the previous two hardware generations. Freeze representative iPhone, iPad/tablet, and Android models at MVP acceptance planning, and include the oldest supported generation in physical-device verification. This hardware-age target does not itself require obsolete operating systems.

**Proposed browser floor:** Current and previous major desktop Chrome, Edge, Firefox, and Safari; current and previous major iOS Safari and Android Chrome where the required graphics capabilities exist. Record the actual OS/browser versions used on the chosen hardware. Mobile emulation supplements real-device testing.

The proposed Three.js renderer requires WebGL 2. Show a clear unsupported-graphics message when unavailable. No WebGPU-only requirement is proposed. See [Three.js WebGLRenderer documentation](https://threejs.org/docs/pages/WebGLRenderer.html).

Provisional targets: responsive input feedback within 100 ms, 60 frames per second on agreed target devices for normal MVP levels, and no sustained drop below 30 frames per second on the later-density stress fixture. Measure rather than claim these goals from unit tests. Cap rendering resolution and visual effects as needed while retaining readable lines.

## 9. Future mechanic contracts

### 9.1 Two-headed violet/lime arrows — Q16

One logical arrow has two selectable travel directions. A selection carries both arrow identity and chosen endpoint. Violet and lime halves split at the midpoint by distance along the full rendered surface path, and each endpoint has its own arrowhead so direction does not depend on color alone. Selecting either half moves toward that half's head; reversing traversal reverses the settled ordered path consistently across face seams. The path is removed as a single entity after a successful attempt in either direction.

A stop may park the selected head, after which either endpoint may resume. Directional spots bend the selected moving head, and parked double arrows store their complete settled path because a signed offset cannot reconstruct branched routes. A collision preserves both colors, adds a whole-arrow red outline or glow, rewinds to the attempt's starting path, and charges only the first failure for that arrow at that settled position; both endpoints share the exemption. Double arrows never join overlapping-tail groups. Level 25 introduces the mechanic, generated required-use cases begin at level 26, and `?feature=double` opens the introduction without changing campaign saves. The complete approved contract is in `docs/superpowers/specs/2026-09-22-double-arrow-design.md`.

### 9.2 Yellow continuation edges — Q17, Q18

An edge rule belongs to shape topology and maps a crossing position and direction onto the adjoining face. It is independent of camera orientation. Existing static path seams and head-continuation rules remain separate concepts.

In [reference 07](docs/references/reference-07.jpeg), yellow highlights the special boundary. The owner confirms that a moving head reaching this boundary turns around the corner and keeps traveling along the next face; the body feeds behind it. At an ordinary boundary the advancing head exits. An arrow whose body already spans an ordinary seam can still unwrap without that seam being yellow. Level 11 introduces the mechanic in a fixed authored six-arrow layout; level 1 and levels 2–10 retain their existing layouts and ordinary exits. Generated layouts with weighted yellow continuation edges begin at level 12, with the authored overlap introduction at 15 as an exception.

Implemented defaults: yellow marks a whole physical cube edge and applies reciprocally in both crossing directions. The transition is a right-angle face change with paths aligned away from vertices. Level 11 has one guaranteed reciprocal front-west/left-east edge, with two safe arrows wrapping across it and four arrows exiting ordinarily. Generated edge selection uses a separate deterministic stream from layout construction, so retries do not change the edge choices. Generated layouts from level 12 (except authored level 15) retain the existing curve: zero edges remain at 25%, while the other edge-count weights shift toward 15% for one, 30% for two, and 30% for three edges by level 100, then stay capped. Authored levels 11 and 15 are excluded from random edge-count and density selection. Each generated layout must pass validation and the solver before presentation.

A path may encounter several yellow edges before an ordinary exit. Simulation terminates on a continuation cycle or self-collision, and invalid content is rejected before play. Dynamic mechanics that could introduce new cycles remain outside the current campaign.

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
| AC11 | Engine fixtures demonstrate future endpoint selection. Level 11 introduces reciprocal yellow continuation in its authored six-arrow teaching layout, and generated layouts from level 12 onward, except authored level 15, retain solver-validated weighted yellow seams. |
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
| Q6 | How many MVP levels, and authored, generated, or both? | Superseded: the prior ten-curated-cube policy. Current: authored levels 1, 11, and 15 plus endless deterministic, solver-validated runtime generation for levels 2–10, 12–14, and 16 onward. | Superseded and replaced 2026-09-15. |

### 11.2 Movement and fairness edge cases

- **Q7 — Confirmed 2026-09-14:** Grid-aligned 90-degree paths with no crossings or overpasses, except the shared tail segments defined in R33. Adjacent lanes remain a proposed authoring convention.
- **Q8 — Confirmed 2026-09-14:** Reject any level where an arrow could contact itself. Follow-up boundary still open: does a head entering an exactly vacated tail location count as forbidden contact when there is no simultaneous overlap? Proposed: no. Exterior-flight collision against later concave shapes also remains open; proposed: no further surface collision after departure.
- **Q9 — Confirmed 2026-09-14:** One arrow or connected tail-group attempt at a time; ignore further taps, with rotation and zoom still available.
- **Q10 — Superseded 2026-09-15:** The former 1–10 tier curve is replaced by runtime level budgets that decline to a three-life floor. Retry restores lives and clears red-arrow history.
- **Q11 — Confirmed 2026-09-14:** Resume exact logical state, including removed arrows, lives, red-arrow history, and the result of an interrupted move.
- **Q12 — Confirmed 2026-09-14:** Highlight on press before release. Ambiguous taps do nothing; the player can zoom closer.
- **Q13 — Confirmed 2026-09-14:** Include a demo showing a touch on an arrow that fails, followed by a touch on an arrow that succeeds, on a small cube with only a few arrows. Combined with the preceding “no skipable collision demo” instruction, the demo is non-skippable. Practice-state isolation and first-run/replay details are proposed in section 5.5.

### 11.3 Scope and later-mechanic questions

- **Q14 — Partially confirmed 2026-09-14:** Save progress in browser `localStorage` and allow PWA installation. Offline gameplay remains unanswered.
- **Q15 — Hardware confirmed 2026-09-14:** Support mobile devices up to two generations old. Choose the exact representative models and OS/browser matrix before verification. Sound, haptics, keyboard gameplay, and nonvisual gameplay scope remain separate unanswered choices.
- **Q16:** For blue/green arrows, does each color cover exactly half the total path length? What should the exact midpoint do? Does either half remain selectable when the other is hidden? Recommendation: equal surface-path halves, neutral midpoint, only exposed portions selectable.
- **Q17 — Implemented defaults 2026-09-15:** Yellow marks a whole physical edge and is reciprocal. The marking follows the cube edge and is inspected by rotating the cube; edge-lane paths do not use corner ties.
- **Q18 — Implemented defaults 2026-09-15:** Reject continuation cycles during validation and report any runtime cycle as invalid content without charging a life.
- **Q19:** Which non-cube shapes come first: rectangular boxes, joined cubes, carved/concave blocks, or arbitrary meshes? Recommendation: boxes, then grid-aligned compound solids.
- **Q20 — Resolved 2026-09-15:** Progression is endless. Next always advances to the next logical level. A numeric level cube accepts Go or Enter for any unlocked safe-integer ID; there is no final campaign-complete screen.
- **Q21 — Partially confirmed 2026-09-15:** Safe-arrow hints are approved as specified in section 5.6. Undo, scoring, stars, time limits, and rewards remain separate scope decisions.
- **Q22 — Confirmed 2026-09-15:** Preserve the pale light theme and add a dark theme with system detection and persistent manual selection. Both themes retain faint far-side arrows and readable arrow states.
- **Q23:** For a blue/green arrow, is its first collision the only life penalty for the entire arrow, or can the other direction cost another life? Once red, how should the two selectable halves remain distinguishable? Recommendation: one penalty per whole arrow and persistent direction markers alongside red.

### 11.4 Approval boundaries

Q1–Q13 have owner answers; Q8 retains a tail-boundary clarification. Q13 confirms the demo sequence; its practice-state/lifecycle details are proposed. Q14 confirms `localStorage` and PWA installation. Q15 confirms mobile support through two prior hardware generations. Q20 is resolved by endless runtime progression. Q17/Q18 are implemented using the defaults documented in section 9.2, not owner answers. Resolve the Q8 boundary and remaining demo, offline, platform/accessibility, Q16, Q19, Q21, and Q23 details before freezing broader release scope. Q22 is resolved by the system-aware light/dark appearance feature described in U7.

## 12. Current deliverable status

- S1: Planning documents and original reference copies are preserved. The former fixed ten-level catalog is superseded by runtime endless progression; level 1 remains authored.
- S2: Project setup, core rules, content, rendering/input, local saves, and PWA installation support have passed the local checks described in the [verification report](docs/verification/2026-09-14-mvp.md).
- S3: Physical-device performance, installed-app behavior, multi-tab save handling, and broader accessibility qualification remain open. Remote publication and deployment have not been requested.

Development preview defaults: `?level=` opens any valid level without requiring an unlock; `?feature=overlap` (alias `overlapping`) opens the overlapping-tail introduction from cube 15; `?feature=wrap` (aliases `wrapping` and `wraparound`, case-insensitive) finds the first level with a yellow physical edge; `?wraps=0|1|2|3` selects an exact edge count. Combining a filter with `level` searches at or after that level, with a bounded 1,000-candidate search using edge-count metadata. These selectors start save-isolated preview, skip the demo, and preserve campaign storage through play, Retry, Next, Reset, and errors. Invalid, duplicate, conflicting, or unsupported selectors show a clear error. Bare `?test=1` remains automation-hooks-only. Verification is recorded in progress.md.
