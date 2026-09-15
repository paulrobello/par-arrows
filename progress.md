Original prompt: Build a desktop/mobile web 3D arrow-removal puzzle with cube-based early levels, bent multi-face arrows, collision/rebound feedback, decreasing lives, future bidirectional arrows and yellow continuation edges. Preserve the three reference photos and plan first. The owner subsequently authorized implementation using Terra subagents and proper greenfield/Git setup.

# Implementation progress

## Safe-arrow hints

Added a free Hint button that checks the current puzzle for an unobstructed exit, rotates to the chosen arrow's actual head face over 600 ms, then highlights it with three slow pulses over 2.4 seconds. Reduced-motion preferences snap the view and use steady emphasis. Camera framing returns to a fitted distance; hints never move an arrow, spend lives, change failure history, or write progress. Canvas interaction, zoom, camera reset, retry, level changes, and disposal cancel the effect. Hint is disabled during the demo, arrow motion, another hint, and terminal states. Root verified the full gate (65 tests / 2,075 assertions), headed Chrome/WebKit desktop/mobile flows, all six head faces, hidden/extreme-zoom views, wrapped previously failed arrows, safe hinted-arrow activation, light/dark themes, native two-pointer pinch and cancellation events, and a 320-pixel-wide dock. Screenshots and the web-game client were inspected. Review findings about immediate disabled-state updates and unnecessary simulations were corrected. No content or save-version changes.

## System-aware light and dark themes

Settings now offers System (default), Light, and Dark, persisted alongside reduced motion. System mode follows live OS changes; manual choices override the OS until System is selected again. A guarded early HTML bootstrap applies the initial appearance before the app bundle loads. Existing renderer materials retint in place, preserving camera, selection, active motion, failed-arrow history, and progress. The dark palette uses a slate cube, ivory arrows, coral failures, cyan selection, and faint blue-gray far-side paths. HTML surfaces, controls, native selects, browser theme color, and victory cards follow the resolved theme. Settings overlays the gesture hint cleanly on mobile. Legacy/malformed/denied storage is safe. Root verified 65 tests / 2,075 assertions, full gate, headed Chrome/WebKit desktop/mobile theme and gameplay flows, startup before bundle execution, persistence, motion-preserving changes, and inspected dark dense/failed/selected/settings/victory views. The web-game skill client also passed. Campaign content and save versions are unchanged.

## Level-completion celebration

Campaign wins now celebrate after the final arrow settles with a 56-piece multicolor confetti burst, a gold star emblem, a brief card entrance/glow, and distinct cube/campaign completion messages. Effects expire after 2.6 seconds and never intercept controls. Next, Retry, level changes, reset, and disposal remove transient effects. In-game and system reduced-motion preferences suppress motion and stop an active burst; restored wins show only the static success card. Headed Chrome/WebKit tests cover final-arrow timing, Next during the burst, expiry, loss/demo exclusion, saved wins, final campaign, and both reduced-motion settings including live toggles. Root inspected desktop/mobile celebrations and corrected mobile particle layering. Full gate passes with 59 tests / 2,064 assertions; the web-game skill client also passes. No content or save-version changes.

## Device-specific zoom hint

The gesture hint shows only “Mouse wheel to zoom” for a mouse/trackpad primary pointer and only “Pinch to zoom” for a coarse touch primary pointer. CSS updates the hint when the pointer capability changes, independent of viewport width. Headed Chrome and WebKit checks passed for desktop, phone, tablet, and narrow desktop views, with inspected desktop/mobile screenshots and no page errors. The web-game skill client and full gate also passed (59 tests / 2,064 assertions).

## Arrowhead selection repair

The owner reported that clicks on arrowheads did not register. Body cylinders were the only raycast targets. Visible head triangles now retain their drawing layer and join the picking layer, with arrow identity, current face, and refreshed geometry bounds. A 1.5 CSS-pixel head-only fallback handles narrow tip/edge taps after normal ray hits miss; it rejects hidden, clipped, inactive, and ambiguous heads. Head opacity uses the transformed geometry center so grazing back-facing heads agree with their ghosted bodies. Root reproduced the missed `l2-straight-2` tip click before the fix, then verified tip/wing mouse and touch activation, hidden-head exclusion, and extra-head-tap rejection during motion in headed Chrome/WebKit. A live press highlighted the intended head and release launched its arrow. Full gate: 59 tests / 2,064 assertions, with browser and web-game skill checks also passing. Level data and save versions are unchanged.

## Thicker arrows and doubled counts

Content version 5 applies the requested 20% increase to shaft/head widths and exactly doubles counts from level 2: 60, 84, 108, 132, 156, 168, 180, 180, and 180. Grids range from 12 to 22 cells per face. Presentation-only `arrowScale` metadata preserves each level's prior physical pitch, so the finer grids do not cancel the visible thickness increase. Level 1 and the demo retain their layout hashes and receive the global width increase. Irregularity, wraps, blockers, and complete solutions remain validated. Legacy level-one saves from versions 1–4 resume exactly; later attempts refresh while preserving unlocks. Root verified 59 tests / 2,064 assertions, full gate, headed Chrome/WebKit mobile/desktop flows, actual v4-to-v5 save migration, an approximately 20.4% increase in rasterized dark-arrow coverage at a fixed pose, and byte-identical missing-output regeneration. See `docs/verification/thicker-double-arrows.md` for exact metrics and previews.

## Irregular route composition

Content version 4 replaces stamped bands with deterministic reverse-constructed paths grown through free surface space. Level 10 retains 90 arrows and 882 occupied cells, with 67 distinct geometries among 68 multi-bend arrows, a maximum of two copies, 55 interior heads, and 46 initially blocked arrows. Root compared the level-2/10 and mobile layouts with the supplied references. The independent offline generator reproduces identical frozen output even when the output file is absent. Shape tests normalize copies through rotation, reflection, reversal, and face unfolding. Versions 1–3 preserve compatible level-one state and refresh later attempts without losing unlocks. Full gate: 53 tests / 1,372 assertions; headed Chrome/WebKit and dense mobile interactions pass. An input trace also exposed unpressed hover movement entering drag calculations, now covered by a failing-then-passing regression and a primary-button guard. Details and previews: `docs/verification/irregular-routes.md`.

## Reference complexity study

The owner identified stamped S-curve repetition in version 3. The study found only eight distinct single-face footprints across 87 level-10 arrows, including 29 copies of the same S. The references vary run lengths within arrows, broad and compact footprints, endpoint locations, and paths fitted around neighboring routes. The earlier density/bend-count checks did not establish that visual variety. The study recorded corrected criteria in `docs/references/arrow-complexity-study.md`; the subsequent version-4 implementation is described above.

## Vertical drag direction correction

The owner reported reversed vertical rotation. Inverted only the vertical component of the camera-local drag axis, preserving horizontal direction, sensitivity, unrestricted turns, and reset/zoom behavior. Browser rotation checks now assert the signed local rotation for mouse and touch, so a direction reversal cannot pass merely because the amount of rotation is correct. Root verified the full gate, headed Chrome/WebKit and repeated Chrome checks, and the web-game skill client. A live downward drag moved the visible front arrow down from screen y=284 to y=310, confirming the rendered direction.

## Dense zigzag campaign revision

The owner requested substantially more density and zigzags immediately after level 1. Fixed routes now use 8–14-cell face grids and 30–90 arrows, with varied stepped/hooked/winding paths, 3–4 wrapped arrows per level, and meaningful removal dependencies. Level 2 has 18 multi-bend arrows and 10 initially blocked arrows; level 10 has 48 multi-bend arrows, up to 24 bends, and 22 initially blocked arrows. Level 1 and the demo retain their original definitions. Saved content advances to version 3: v1/v2 first-level attempts resume exactly, while older later-level attempts restart the revised layout with unlocks and onboarding preserved. Dense picking scales to grid spacing, invisible picker meshes are excluded from drawing, and flat ribbons use one rendering pass. Root verified 46 tests / 1,221 assertions, the full gate, headed Chrome/WebKit and repeated Chrome flows, real legacy-save migration, motion/desktop/mobile previews, and the web-game skill client. Review found no remaining issue in scope. Measurements and screenshots are in `docs/verification/dense-zigzags.md`.

## Additional arrow-variety and yellow-edge references

The owner supplied four more photos on 2026-09-14: three show dense mixtures of varied-length hooks, zigzags, and winding multi-bend arrows, and the fourth shows a yellow wrapping edge. They are stored as references 04–07 alongside the original three. The PRD and implementation plan now capture the visual direction and the owner's explicit movement explanation: a head reaching a yellow edge turns onto the adjoining face while its body follows. Existing bodies may unwrap ordinary seams; ordinary new head crossings still exit. This update preserves reference material and design intent. It does not change current campaign layouts or ship the deferred yellow-edge mechanic. Root verified all four copies byte-for-byte, 360 × 778 dimensions, recorded SHA-256 hashes, local documentation links, and the full project gate with 43 tests / 806 assertions.

## Continuous rotation

The owner requested rotation without axis stops. Replaced the camera's ±1.18-radian pitch clamp and fixed-up look-at calculation with cumulative normalized quaternion rotation. Mouse and touch drags now rotate around screen-relative axes through repeated full turns, including over the top and bottom. The original view, drag sensitivity, zoom bounds, and Reset View are preserved. Root verified the baseline camera mathematically, 43 unit tests / 806 assertions, the full gate, headed Chrome/WebKit regressions, and live desktop/mobile screenshots. Browser checks cover more than two full turns per direction, diagonal motion, unchanged lives/arrow state during dragging, selection after rotation, wheel/pinch zoom, and exact reset. See `docs/verification/continuous-rotation.png` for the live rotated view.

The Chrome touch regression waits for each native pointer event to affect camera diagnostics because the browser can acknowledge touch dispatch before delivering the event. A probe confirmed delayed event delivery, and both final browser suites passed. The web-game skill client also completed onboarding into playable level 1 without errors. Terra reviewed the actual rotation diff without findings.

## Favicon and installation icon suite

The owner requested a complete icon set. The suite now includes SVG and multi-frame ICO favicons, PNG favicons from 16 to 128 pixels, an opaque 180-pixel Apple touch icon, and separate standard/maskable PWA icons at 192 and 512 pixels. The artwork uses the game's cube and flat arrows, with a simplified browser mark. Original SVGs and a pinned Sharp generator are checked in, with regeneration through `make icons`. Root verified byte-identical regeneration, native-size and mask previews, 43 tests / 806 assertions, the full gate, and headed Chrome/WebKit asset and gameplay checks. See `docs/icons.md` and `docs/icon-preview.html` for the inventory and visual review.

## Arrow-length and wrapping revision

The owner requested varied straight-arrow lengths and wrapping after the first level. Terra revised levels 2–10 as frozen route recipes, with at least three straight-arrow lengths in every revised level. Level 2 has lengths 2/3/4/6 and two substantial wraps; levels 5–10 have 6/7/8/9/10/11 wraps, including three-face routes. Level 1 and the demo match their original data exactly. Saved content is version 2: legacy level 1 resumes exactly, while legacy later-level attempts restart on the revised layout with unlocks and tutorial completion preserved. Root verified 40 tests / 729 assertions, full project checks, headed Chrome/WebKit flows, visible early/late/mobile layouts, real-click wrapped-arrow motion, and an actual legacy save migration. Decoder traversal is bounded and reviewed.

## Miter join correction

The owner supplied a close-up showing a notch where independent flat ribbon segments met at a right-angle bend. Terra implemented a shared mitered endpoint cross-section for adjacent segments on the same face. Exact inner/outer vertex tests cover left/right turns on all faces and tiny fractional moving segments. Straight ends and cube-edge folds retain their existing behavior, with the 1.5625 speed multiplier. Root verified the repaired close-up, 34 tests / 626 assertions, full project gate, headed Chrome/WebKit flows, and the skill's headed browser client. The fix was re-reviewed without remaining findings.

## Latest speed tuning

The owner requested another 25% arrow-speed increase after the ribbon refinement. The multiplier is now 1.25 × 1.25 = 1.5625 relative to the initial MVP. Exits take 563.2 ms, rebounds 473.6 ms, and reduced-motion transitions 70.4 ms. Demo pauses are unchanged.

## Completed ribbon refinement

The owner requested flat ribbon arrows and an initial 25% speed increase after the MVP. Terra implemented the ribbon geometry in an isolated `feat/flat-ribbons` worktree. That first speed increase changed exits from 880 ms to 704 ms, rebounds from 740 ms to 592 ms, and reduced-motion transitions from 110 ms to 88 ms. The later tuning above supersedes those durations. Demo pauses and core rules are unchanged.

Flat quads and triangular heads follow face planes and fold at seams. Moving body slices retain all turns/seams, begin at the original pose, and keep the head connected. Review corrected winding/culling, off-center seam coordinates, inactive picker filtering, and fractional-slice point/face alignment. Actual dark canvas pixels are now asserted in browser checks so invisible hit targets cannot mask missing visible arrows. Full gate: 31 tests / 492 assertions. Headed Chrome and WebKit production flows, the skill's headed browser client, and inspected desktop/mobile/motion screenshots pass.

## Confirmed behavior

- Ten curated cube levels and a solvability checker. Levels 1–3 have five lives, 4–6 four, 7–10 three.
- Head advances forward; body follows its existing path and unwraps seams. Ordinary new head crossings exit.
- First failure per arrow costs one life and keeps it red until removed. Repeat failures of that arrow are free.
- Reject self-contact levels. One active arrow at a time; extra taps ignored while orbit/zoom remain available.
- Free orbit, wheel and pinch zoom, visible-face picking, faint unpickable far-side arrows, press highlight, ambiguous taps ignored.
- Retry restores the same layout/full lives and clears failed-arrow history. localStorage resumes exact logical progress, including interrupted move results.
- Installable PWA. Support target includes mobile devices up to two prior hardware generations; physical-device proof is still outstanding.
- Non-skippable small-cube demo shows a failed touch/red rebound followed by a successful touch/exit.

## Execution assumptions

- User request on 2026-09-14 supersedes planning-only instructions in the original documents.
- Implement current documented defaults for remaining MVP details. Offline gameplay, accounts, undo, sound assets, and later gameplay mechanics stay deferred. Safe-arrow hints were separately approved on 2026-09-15.
- A vacated tail cell is allowed only without simultaneous swept contact. Self-contact validation checks each arrow without other blockers.
- Demo uses independent state, starts before first campaign play, saves completion only after both moves, and leaves level 1 untouched. Interrupted demo restarts if not completed.
- Sequential unlock/replay of unlocked levels, explicit final campaign completion, reduced-motion presentation, accessible HTML controls.

## Work and ownership

| Work | Owner | State |
| --- | --- | --- |
| Greenfield Vite/TypeScript/Bun/Biome/Three configuration | Terra foundation agent | Implemented; combined gate passed |
| Topology, movement, state, ten levels, solver/tests | Terra core_engine agent | Implemented; combined gate passed |
| Renderer, input, UI, storage, demo | Terra foundation agent | Implemented; mobile and review corrections verified |
| Architecture/diff review | Terra review_plan agent | Accepted findings fixed and re-reviewed |
| Integration, repo hygiene, PWA assets, browser testing, documents/board | Root | Local verification complete; device qualification tracked separately |

Implementation was authored in the isolated `/Users/probello/Repos/par-arrows-mvp` worktree on `feat/mvp`, with initial implementation commit `7ca753d`. The delivery checkout is `/Users/probello/Repos/par-arrows` on `main`; use Git history for the squash-merge commit. No remote is configured.

Reserved ports: 8057 development and 8058 isolated browser verification. Registered in the shared port registry in config commit `fa8cf00`, preserving its pre-existing unrelated changes.

## Verification record

- Original three image copies are byte-identical, 360 × 778, with hashes in `docs/references/README.md`.
- Initial document checks passed before implementation.
- Parsight index created for the implementation worktree: repository `repo-de05f4ad2711fd21f3c9d65ac2b1bc4e` / `par-arrows`.
- Combined gate passed with 24 tests and 452 assertions. Three.js was split into two cacheable chunks; lint/build warnings cleared.
- Production-preview headed browser tests passed demo, real click collision/free retries, reload/red history, orbit/wheel, retry, interrupted final-exit unlock, PWA assets, and emulated two-touch pinch. Browser tests run from `tests/browser-runner.ts` and save screenshots under `test-results/browser/`.
- Screenshot inspection found portrait clipping despite initial behavior tests passing. Responsive FOV fitting and short-landscape layout changes were implemented and verified through bounds assertions and inspected images.
- Actual review corrected the drag threshold and face ownership after multiple seam-expanded points. Both fixes were re-reviewed. Root added life/failure-count save invariants.
- Development verification used a Herdr-managed server and headed agentchrome/Playwright browsers. Start the game from the delivery checkout using the README instructions.

### Final local verification

- `make checkall`: 27 tests, 459 assertions, formatting/lint/types/build passed without warnings.
- Headed Chrome and WebKit production suites passed. Added explicit failure/retry, three-face exit, cube screen-bound checks, and WebKit mobile touch.
- Mobile portrait/landscape, dense desktop, wrapped motion, and demo screenshots inspected. The clipping and overlay problems are fixed.
- Disabled-WebGL fallback checked in headed Chrome. Content-version changes reset the attempt while preserving unlocked levels; covered by regression test.
- Secret scans, pre-commit configuration, and CI workflow syntax passed.
- Full per-criterion status and preserved screenshots: `docs/verification/2026-09-14-mvp.md`.

## Remaining work

- Verify real mobile/installed behavior where hardware is available; leave unsupported evidence criteria open.
- Qualify physical two-generations-old devices, actual PWA install/relaunch and save transfer, context-loss recovery, performance, multi-tab saves, and broader accessibility separately.
- Keep this file and the PRD/plan current with actual shipped state, limitations, and review findings.
- No push/deployment without authorization. Later arrow/edge mechanics and non-cube content remain deferred.
