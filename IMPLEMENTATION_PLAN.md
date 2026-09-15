# Par Arrows — Implementation Plan

Status: **Initial MVP implemented; final device/release qualification remains open.**

Created: 2026-09-14

Requirements source: [PRD.md](PRD.md)

References: [gallery](docs/references/README.md)

References 04–06 guide future content toward densely packed mixtures of straight, hooked, zigzag, and winding multi-bend paths with varied lengths and face spans. During later content work, compare turn variety, spacing, readability, and wrapping with these photos while preserving the simple opening level and validating every route. Reference 07 documents the owner's yellow-edge head-continuation rule: animate the head turning onto the adjacent face with its body following. Keep that future rule distinct from an existing body's ordinary-seam unwrapping. The new photos are reference material; yellow-edge runtime behavior remains outside the current campaign.

The owner has requested implementation using Terra subagents and proper greenfield/Git setup. This supersedes the initial planning-only instruction. Remaining Q identifiers distinguish confirmed choices from the documented execution defaults in [progress.md](progress.md). No remote publication or deployment is included.

## 1. Delivery strategy

Prove the surface movement rules with small deterministic cases before investing in dense art or a large campaign. Keep those rules independent of browser input, animation, and rendering. Build one complete playable cube, then add progression, content, and mobile hardening.

The owner confirmed path-following movement, body unwrapping across ordinary seams, permanent red failure history with only one life penalty per arrow, free rotation with wheel/pinch zoom, same-layout unlimited retry, ten curated cube levels with a solvability checker, right-angle non-overlapping paths, and rejection of levels permitting self-contact. One arrow moves at a time, extra taps are ignored, rotation/zoom remain available, lives follow a five/four/three curve, Retry clears failure history, and reload restores the complete logical result. Press highlights selection; ambiguous taps do nothing. Q8's exact vacated-tail boundary remains open.

### Decision gates

| Gate | Required decisions | Blocks |
| --- | --- | --- |
| G1: Rule agreement | Q1–Q3 and Q7–Q9 answered. Resolve the exact vacated-tail boundary in Q8. | Movement implementation and authoritative level format. |
| G2: MVP scope | Q4–Q6 and Q10–Q13 confirmed. Q14 confirms `localStorage` and PWA installation; Q15 confirms mobile hardware up to two generations old. Resolve demo lifecycle details, offline scope, remaining platform/accessibility details, and Q20–Q21. | Onboarding lifecycle, offline/platform details, final progression scope. |
| G3: Visual direction | Q22. | Final visual acceptance, not neutral prototype geometry. |
| G4: Deferred mechanics | Q16–Q19 and Q23, mechanic introduction order and level numbers. | Shipping bidirectional arrows, yellow edges, or non-cube content. |

Record owner answers and implementation defaults distinctly. Implementation authorization is present. Resolve technical details using the documented MVP defaults and preserve deferred gameplay scope.

## 2. Proposed technology and constraints

| Area | Proposal | Reason |
| --- | --- | --- |
| Language | Strict TypeScript. | Typed level data and identical rules in browser, tests, and content tools. |
| Build | Vite, with Bun package management/task running. | A client-only game can be delivered as static assets without a server framework. |
| 3D | Three.js with its WebGL 2 renderer. | Surface meshes, path rendering, ray picking, and the agreed browser targets. |
| Interface | Accessible HTML/CSS overlay with a small typed state layer. | Menus and HUD do not require a large application framework initially. |
| Core tests | Deterministic unit and property tests. Choose one compatible runner during setup. | Rules must work without rendering and be replayable. |
| Browser tests | Playwright with real Chrome; real Safari and physical mobile checks. | Input, visibility, touch, resize, and rendering need actual browser evidence. |
| Persistence | Browser `localStorage`, confirmed; versioned save adapter proposed. | Preserve progress for returning players without an account/backend dependency. |
| Installation | PWA installation, confirmed; manifest, app icons, and standalone display configuration planned. | Launch from an installed icon while keeping browser play available. |
| Content | Versioned level files plus validator and solution certificates. | Share one rules engine across authoring and play. |

Browser `localStorage` and PWA installation are owner-confirmed requirements. The remaining technology choices are architecture recommendations, not installed dependencies or pinned versions. Verify supported browser baselines and exact package versions against official documentation at P1. The generic frontend guide prefers Next.js when appropriate; this plan proposes Vite because the requested MVP has no server-rendered pages or backend requirements.

Do not add a physics engine for discrete path occupancy, a general entity-component framework, network services, or a mechanic plugin registry without evidence that the approved scope needs them.

Official references checked during planning: [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) requires WebGL 2 and exposes rendering/resource diagnostics; [Raycaster](https://threejs.org/docs/pages/Raycaster.html) supports scene intersection queries; [MDN Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) describes pointer capture, cancellation, and touch-action; [Vite's guide](https://vite.dev/guide/) documents the client build setup. Package versions remain to be selected at implementation time.

PWA work follows [MDN's installation guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable): provide a manifest with app identity, icons, start URL, and standalone display behavior; verify under HTTPS or a supported local development context. Use platform-appropriate installation guidance and keep browser play available. Service-worker caching/offline gameplay remains a separate scope decision rather than an assumed installation requirement.

## 3. Logical architecture

### A1: Surface topology

Represent surfaces as identified planar faces with integer grids and explicit local coordinate bases. Each boundary can describe its neighboring face, coordinate mapping, orientation, and head-crossing policy. The model must not derive game directions from camera orientation or mesh triangle numbering.

Keep **static path adjacency** separate from **head edge behavior**. A body can already span an ordinary seam. That does not automatically make a newly arriving head wrap there. This distinction is essential to the requested combination of wrapped arrows and later yellow edges.

Proposed canonical occupancy: a cell is an identified face-cell center; a link connects adjacent centers. A route is an ordered sequence of cells plus those links. Two different arrows may share neither cells nor links, including endpoints. Within-face links join cardinal neighbors. A cross-face link joins the two distinct boundary cells through the seam, with a canonical identity independent of direction. Do not duplicate a crossing as two unrelated links or merge neighboring face cells into one cell. Edge lanes avoid physical cube vertices, so no three-face corner choice arises in MVP content.

Use this same cell/link contract in authoring, simulation, solver, diagnostics, and geometry construction. During motion, inspect swept link traversal and simultaneous occupancy, including opposite-direction traversal, rather than sampling animated meshes. The vacated-tail boundary still needs the explicit Q8 answer. Rendered stroke width and touch expansion cannot change logical occupancy. Validate reciprocal seam mappings and lane alignment. Cubes are the only production topology in the MVP, while a non-cubic box can serve as a contract fixture later.

### A2: Arrow and level data

An arrow definition contains a stable ID, an ordered tail-to-head surface path, and a kind. A movement command contains the arrow ID and active endpoint. The MVP exposes one endpoint. A future two-ended kind can select either endpoint without inventing a second movement system.

A level definition contains schema/content versions, ID/order, topology, arrows, life budget, enabled mechanics, tutorial metadata, and optional provenance such as a generation seed. Progression does not infer lives from arrow count.

Keep runtime state separate: remaining arrows, failed-arrow IDs, lives, level status, and an attempt revision/token. Persistent failure history determines whether an arrow owes its first life penalty and drives red rendering. Never infer it from material color. Store edge rules explicitly, even when every MVP edge exits. Reject unsupported mechanic versions with a useful error rather than silently downgrading them.

### A3: Deterministic movement and collision

Under the confirmed path-following rule, simulate a bounded head advance along the surface. Shift the body through its ordered path and vacate the tail in a defined order. Check continuous path contact or all traversed discrete locations so an arrow cannot skip a blocker between animation frames.

Outcomes distinguish successful exit, blocked contact, and invalid/unsupported content. Produce a motion description that the renderer can animate, with first-contact position, traveled route, exit tangent, and original path needed for a rebound. Game logic consumes the result once. The renderer does not independently decide hits or deduct lives.

For successful ordinary-edge exit, retain enough path history to feed the entire body away correctly. For failure, restore the exact pre-attempt state, without accumulated floating-point drift. A reverse-direction command must reverse both path traversal and seam orientation consistently.

Reject content where an arrow can self-contact over its full movement even with every other arrow absent. This check must cover swept geometry and the approved vacated-tail boundary, not only starting cells. A self-contact discovered in play is a content error and never an ordinary life penalty.

Future continuation must have a finite simulation budget derived from validated content bounds and cycle detection that accounts for relevant moving-body state. A repeated head face/position alone is not always a repeated full state. Surface loops and self-contact need separate tests. An exhausted internal safeguard produces a diagnosable content error, not an arbitrary player penalty.

### A4: Attempt and level controller

Use explicit states for ready, animating exit, animating rebound, failed, and complete. Each accepted attempt owns a unique token and one immutable result. On collision, check the arrow's failure history: charge one life and record its ID only on its first failure, otherwise charge zero. Both cases still animate contact and rebound. Red stays until removal. Derive the final logical snapshot before presentation and persist according to Q11. Reveal any life loss at impact and completion after the last exit, without allowing duplicate callbacks to repeat either.

The controller rejects additional arrow activations during an active attempt while allowing camera rotation and zoom. Retry creates a new level revision, clears failed-arrow history, and resets the life budget so stale animation completions cannot mutate the restarted puzzle. Backgrounding, reduced motion, renderer loss, and reload must settle or restore the same logical outcome.

### A5: Renderer and camera

Use a cumulative normalized camera quaternion for continuous screen-relative drag rotation. Derive both camera position and orientation from it so repeated vertical turns pass through the poles without a world-up flip. Keep zoom distance separately bounded and reset to the original orientation and fitted distance.

Generate shape surfaces and flat arrow ribbons from authoritative definitions. Paths and triangular heads lie on the face planes with only a small offset to prevent depth flicker, and ribbons fold at face seams. Keep widths, joins, seam continuity, face offsets, and depth behavior consistent. Use a picking representation separate from thin visible ribbons so touch can remain usable without changing the puzzle's collision widths.

Render the confirmed faint far-side arrows in a controlled pass and exclude them from picking. Avoid relying on translucent-object draw order for correctness. Mobile verification must inspect back-face leakage, z-fighting, line flicker, and misleading overlaps at grazing angles.

Dispose scene resources when levels change, reuse materials where appropriate, and bound pixel density and effects. Measure draw calls and frame time before deciding whether batching or instancing is needed. Do not optimize away per-arrow identity needed for picking and feedback.

### A6: Pointer and interface controller

Use one pointer gesture state machine: pending tap, orbit drag, pinch/zoom, and cancelled. Support mouse-wheel zoom, normalize wheel deltas, clamp near/far zoom, and keep zoom gestures from activating arrows. Convert pointer coordinates using the canvas's actual rectangle after device rotation, zoom, and safe-area layout changes. Activate only on a valid release. Suppress the synthetic click that can follow a touch activation.

Keep settings, lives, retry, level selection, and completion controls in HTML. Scope browser gesture suppression to the game surface. Never disable the whole page's accessibility zoom without a demonstrated requirement.

### A7: Content tooling and persistence

Validate paths, occupancy, seams, arrow endpoints, mechanic versions, life budgets, absence of any possible self-contact, and solution reachability. Use the same movement implementation as runtime. Run self-contact checks independently of current blockers. Save complete successful removal sequences as reproducible evidence. Exhaustive state enumeration is appropriate for small fixtures, while larger levels need a validated solver strategy and search bounds.

Persist progress through browser `localStorage`. Use one versioned logical snapshot containing unlocked levels, current level, remaining arrows, failed-arrow IDs, lives, and approved settings. Write each accepted move's final logical result before its animation, and write Retry/reset and completion/unlock changes when they occur. Do not defer saving until the page closes.

Restore the saved settled state on refresh/reopen in both browser and installed-PWA sessions. Reload must not turn red arrows black or charge their repeated collisions again. On content-version mismatch, restart the affected attempt while preserving compatible progression. Storage failures allow continued play with honest feedback. Decide multi-tab policy before enabling automatic attempt restoration. Verify save behavior when moving from browser play to installed launch on each target rather than assuming shared storage between contexts. Resolve any platform-specific transfer limitation before closing installation acceptance. Offline loading remains a separate open decision.

### A8: Onboarding demo

Author a tiny, deterministic cube fixture with only a few arrows, including one blocked move and a different clear exit. Drive the same simulation and presentation used by gameplay, with visible touch/press/release cues. Show the blocked move first, wait for contact and rebound to finish, leave its arrow red, then show the second arrow departing completely. No Skip control is part of this sequence.

Proposed isolation: use a separate demo state so scripted moves cannot consume campaign lives, unlock levels, or overwrite an in-progress puzzle. A demo-only life display can illustrate the first-failure deduction. On first-run completion, store a tutorial-completed flag and transition to a fresh level 1 with five lives. Decide replay, interruption, and reduced-motion behavior before closing demo acceptance. Do not force a third move or an interactive practice step beyond the requested two-action demonstration.

## 4. Dependency-ordered phases

Track phase execution in [progress.md](progress.md). Split phases into small, coherent verified commits. Use no more than five changed files per execution batch unless the approved independent-subagent workflow applies. Run the actual project gate after each completed batch and relevant runtime checks at each visible milestone. Keep the board's acceptance criteria open until individually demonstrated.

### P0 — Resolve rules and freeze the MVP

Depends on: owner answers and separate implementation authorization.

Deliverables: updated PRD decision statuses and movement examples; record the confirmed ten curated cube levels, five/four/three life curve, `localStorage` save/retry policy, and PWA installation. Select a concrete desktop/mobile test matrix including mobile hardware two generations old. Resolve remaining onboarding, offline, accessibility, and visual details.

Acceptance:

- P0.1: Every G1 and G2 decision has an explicit answer or a clearly approved default.
- P0.2: Walk through one clear exit, one blocked bent arrow, one existing multi-face body crossing an ordinary seam, and one arrow approaching its own body. Expected outcomes are unambiguous.
- P0.3: Deferred mechanics are listed separately with their unresolved questions. The owner has requested implementation before P1 begins.

### P1 — Project foundation and test harness

Depends on: P0.

Deliverables: minimal client project, strict typing, formatter/linter, unit runner, browser test harness, documented setup, and a stable fixture-loading/diagnostic interface for development. Reserve a free port according to the local port registry before starting a server. Pin dependencies and commit a lockfile.

Create standard Make targets: build, test, lint, fmt, typecheck, checkall, pre-commit, dev, dev-stop, and dev-restart. Verify that stop waits for the port to be released. Install repository-appropriate checks and secret scanning before any future push. Do not add production debug controls to normal game menus.

Acceptance:

- P1.1: Fresh-checkout setup produces all dependencies and the complete gate passes.
- P1.2: A real browser loads the empty game shell without errors at desktop and mobile sizes.
- P1.3: Development fixtures support stable IDs, deterministic state inspection, and bounded screenshot/test runs.

### P2 — Surface model and movement rules

Depends on: P1 and G1.

Deliverables: cube topology, validated path model, occupancy, head-exit rules, deterministic simulation outcomes, and first-contact/rebound traces. No decorative rendering is required for this phase.

Acceptance:

- P2.1: Every physical cube edge and both mapping directions round-trip correctly. Parameterize across all face orientations.
- P2.2: Straight, bent, and multi-face paths exit or block exactly as approved, including collisions with a blocker body rather than its head.
- P2.3: Reject possible self-contact, including contact initially hidden by another blocker. The approved just-vacated-tail boundary, seam occupancy, malformed data, and large travel distances have explicit tests.
- P2.4: Result and restored state are independent of animation timing and camera state.
- P2.5: Contract fixtures show endpoint reversal and a continuation-edge mapping can use the same rule boundaries. Production content still accepts only approved MVP mechanics.

### P3 — Interactive 3D cube

Depends on: P2 and G2 camera/input choices.

Deliverables: readable cube, arrows and seam joins, camera orbit/wheel zoom/pinch zoom/reset, faint far-side rendering, visible-surface picking, tap/drag/pinch arbitration, and selected-path feedback. Compare palette/opacity treatments within the confirmed ghosted direction if Q22 remains open and obtain the owner's selection before final polish.

Acceptance:

- P3.1: All six faces can be inspected on mouse and touch without gesture-induced arrow activation.
- P3.2: Bent and wrapped arrows are visually continuous at seams, including near-edge camera angles.
- P3.3: Hidden arrows cannot be selected through front faces. Expanded hit regions do not alter logical collision.
- P3.4: Desktop mouse-wheel zoom and real mobile pinch zoom work without arrow activation or unwanted page movement over the game surface. Picking remains correct after zoom, resize, scrolling, and orientation change.

### P4 — Complete single-level gameplay

Depends on: P2, P3, and life/retry decisions.

Deliverables: attempt controller, successful departure animation, collision/return/red feedback, five-life level 1, remaining count, failure/retry, completion, and reduced-motion behavior. The owner subsequently requested two successive 25% speed increases: divide original movement durations by 1.5625, keeping demo pauses unchanged.

Acceptance:

- P4.1: An arrow's first blocked attempt loses exactly one life and marks it red until removed. Multiple subsequent blocked attempts cost zero lives. A different arrow's first failure still costs one life. Duplicate events and stale callbacks cannot change those counts.
- P4.2: Rebound restores the original path and occupancy exactly. Successful movement removes the whole arrow after its approved exit sequence.
- P4.3: The final arrow completes the level once. Zero lives produces failure once. Retry clears stale animation work and restores the same level, full lives, and no failed-arrow history, with ordinary arrows black again.
- P4.4: Losing focus, backgrounding, and changing motion preferences do not leave the level stuck or mutate the result twice.

This is the first playable milestone. Verify the full loop in a headed browser and show the playable result for owner feedback. Continue the authorized implementation phases while incorporating any owner corrections.

### P5 — Campaign, validation, and saves

Depends on: P4 and the approved content strategy.

Deliverables: level validator/solver, solution evidence, a small-cube demo showing a failed touch followed by a successful touch, configured life curve, sequential unlocks, replay, campaign completion, versioned `localStorage` saves with automatic resume, and PWA manifest/icons/install guidance. Author the agreed number of levels in small batches.

Q6 confirms ten curated cube levels. Procedural generation is outside this phase. If requested later, plan deterministic seeds, bounded generation attempts, solvability validation, fallback curated content, and difficulty calibration as separate work.

Acceptance:

- P5.1: Every shipped level passes validation and its stored solution replays to an empty board under production rules.
- P5.2: The progression curve is observable in actual levels, with arrows on all faces and growing density. Every level after level 1 includes varied straight-arrow lengths and several meaningful edge-spanning paths. Level 1 and the onboarding demo retain their simple layouts. Content updates preserve unlocked levels and restart only incompatible active attempts.
- P5.3: Replay and retry do not relock progress. Final campaign completion does not point to a nonexistent next level.
- P5.4: Verify `localStorage` contains the updated logical snapshot after successful removal, first collision, repeated red-arrow collision, Retry, and completion/unlock. Refresh/reopen restores the same progress, lives, and red-arrow history. Reload during success and failure, corrupt saves, denied storage, old schema/content, and multiple tabs follow the approved policy.
- P5.5: On a small cube with few arrows, visible touch cues first activate a blocked arrow that contacts, rebounds, and stays red, then activate another arrow that exits completely. The demo cannot be skipped. Verify the approved demo-state/lifecycle policy, including no unintended campaign penalties or overwritten saves. Hints and rewards remain excluded unless approved.
- P5.6: The manifest and icons validate, installation works on supported targets, standalone launch reaches the game, and closing/reopening the installed app resumes saved progress. Browser play still works without installation.

### P6 — Device hardening and MVP acceptance

Depends on: P5.

Deliverables: refined visual treatment, input tuning, accessibility checks, measured performance, resource-lifecycle checks, and a concise release-readiness report. Hosting work remains subject to an explicit deployment request.

Acceptance:

- P6.1: All PRD AC1–AC14 have individual evidence or are explicitly left unmet.
- P6.2: Agreed real desktop/mobile browsers and installed PWAs pass representative playthroughs in portrait and landscape. Include mobile hardware two generations old and record actual models, OS versions, and browser versions. Emulation alone does not close physical-device criteria.
- P6.3: Normal levels and the later-density stress fixture meet the agreed frame-time and input targets. Inspect scene resource counts across repeated restart/level transitions.
- P6.4: Unsupported graphics, context loss, background/resume, reduced motion, and narrow safe-area layouts recover or explain the limitation without corrupting play.
- P6.5: All repository gates pass. Record remaining known limitations and any outstanding owner creative approval separately from technical completion.

## 5. Deferred phases

| Phase | Depends on | Future work and proof |
| --- | --- | --- |
| P7 | MVP acceptance, Q16 and Q23 | Blue/green two-ended arrows, distance-based half selection, reversed paths, midpoint policy, persistent red and direction cues, first-failure scope, solver updates, and introductory levels. |
| P8 | MVP acceptance, Q17–Q18 | Yellow continuation edges, visible markings, seam direction changes, repeated crossings, cycle handling, hidden-edge readability, solver updates, and introductory levels. |
| P9 | Stable seam model, Q19 | Cuboids first if approved, then compound solids. Verify concave/convex seams, exposed faces, flight behavior, dense selection, and solver correctness for each new topology. |

P7 and P8 can be developed independently only where file ownership does not overlap. Their release order and introduction level numbers are owner decisions. Each further mechanic needs a short rule spec, simulation tests, authoring/solver support, and tutorial content before release.

## 6. Verification matrix

| ID | Scenario | Expected proof |
| --- | --- | --- |
| T1 | Clear straight arrow on every face and heading. | Equivalent local direction, correct exit, complete removal. |
| T2 | Bent and multi-face arrow; ordinary seam under its body. | Body follows the approved path and does not exit prematurely at old seams. |
| T3 | Blocker on head path, body path, seam, or immediately before exit; repeated red-arrow failures. | First-contact outcome and exact restoration on every failure; one penalty only for that arrow's first failure; persistent red until removal. |
| T4 | Arrow overlaps another only in the camera projection. | No logical collision and no hidden-surface selection. |
| T5 | Self-contact, contact hidden behind another arrow, and tail vacating. | Invalid levels rejected before play; no runtime life charge for invalid content; vacated-tail boundary tested in logical update order and continuous motion. |
| T6 | Tap, double tap, drag from an arrow, pinch, pointer cancel, and synthetic click. | Exactly one or zero attempts as appropriate, no accidental life loss. |
| T7 | Retry/next while an old animation callback is pending. | Old attempt token cannot mutate a new level. |
| T8 | Final exit, last-life collision, and reduced-motion instant completion. | One terminal transition with consistent saved state. |
| T9 | Inspect `localStorage` after progress changes; refresh/reopen and reload/background during impact and exit; denied or corrupt storage. | Exact saved progress resumes under the approved settlement policy, without duplicate deductions or partial routes. |
| T10 | Mouse wheel, pinch zoom, rotated screens, browser zoom, safe areas, dense adjacent arrows. | Controlled zoom without activation, correct canvas coordinate mapping, and usable selection. |
| T11 | Future reversed endpoint and yellow-edge chains/cycles. | Correct seam transforms, bounded simulation, separate invalid-content outcome. |
| T12 | Full campaign and repeated scene lifecycle. | Replayed solutions, progressive difficulty, stable resource use, real-device measurements. |
| T13 | PWA install, standalone launch, close/reopen, and transition from browser play; devices two generations old. | Installation works where supported, saved progress resumes, controls fit standalone safe areas, and oldest-target hardware meets the approved performance criteria. |
| T14 | Small-cube demo: visible failed touch, completed red rebound, then visible successful touch and exit. | Correct order and real rule outcomes; no Skip control; failed arrow remains red; approved lifecycle preserves campaign state and handles interruption/reduced motion. |

Use focused unit tests for logical behavior, small exhaustive/property fixtures for invariants, and real browser/device tests for visual and input behavior. Do not substitute screenshots for a logical solver or unit tests for touch usability.

## 7. Risks and decisions that could change the estimate

- **K1 — Remaining movement details:** Path following and rejection of self-contact are confirmed. The exact tail-vacating boundary still constrains valid content and the solver.
- **K2 — Transparency and picking:** Faint rear arrows may improve inspection but create false depth cues. Compare rendered treatments and verify occlusion on mobile.
- **K3 — Dense usability:** Rendering more arrows is easier than making them individually tappable. Zoom, spacing, and camera angles are acceptance concerns.
- **K4 — Procedural content:** A solvable puzzle can still be trivial, repetitive, or unreadable. Generation needs difficulty metrics and human playtesting beyond solver success.
- **K5 — Future surface rules:** Yellow-edge cycles, endpoint reversal, and concave shapes can invalidate simplifying assumptions in the MVP solver.
- **K6 — Platform breadth:** Exact device/browser commitments and accessibility scope materially affect verification work.

No calendar estimate is committed while G1/G2 remain open. After those decisions, estimate the phases from the agreed content quantity and physical-device matrix.

## 8. Session and repository procedure

The planning session began in an empty directory with no existing code or checks. The initial documentation commit may be created on the default branch under the greenfield exception. Future implementation uses isolated worktrees, setup in each worktree, scoped formatting, verified atomic commits, and the project board. Do not push or deploy without the owner's authorization.

The initial planning package had no build, linter, typechecker, test suite, or Makefile. P1 establishes those checks; use the resulting `make checkall` gate and browser checks for implementation, retaining image-integrity and document-consistency verification. Record actual results in [progress.md](progress.md).

## 9. Planning checklist

- [x] Original images preserved and source mapping recorded; all three byte comparisons and manifest hashes verified.
- [x] PRD and implementation plan checked for working relative links and consistent planning-only scope.
- [x] Owner's unanswered questions clearly separated from confirmed requirements; Q1–Q13 answers, Q14's `localStorage`/PWA choices, and Q15's mobile hardware age target incorporated. Demo isolation/lifecycle details remain proposed.
- [x] Planning-only files verified for the local documentation commit; Git history and the project board record the commit evidence.
- [x] Owner answers incorporated and remaining MVP execution defaults recorded in progress.md; deferred product decisions remain distinct.
- [x] Separate implementation request received before starting P1: owner requested Terra subagents, greenfield setup, and Git repository on 2026-09-14.
