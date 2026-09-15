Original prompt: Build a desktop/mobile web 3D arrow-removal puzzle with cube-based early levels, bent multi-face arrows, collision/rebound feedback, decreasing lives, future bidirectional arrows and yellow continuation edges. Preserve the three reference photos and plan first. The owner subsequently authorized implementation using Terra subagents and proper greenfield/Git setup.

# Implementation progress

## Reliable arrow press and release

The owner reported that about 20% of intended arrow taps highlighted on press but failed to activate. Root reproduced a missed release in the prior implementation at a 5-pixel left/down displacement, inside the 9 CSS-pixel drag threshold; the overall reported rate was not measured. Input now captures an unambiguous arrow on primary pointerdown and activates that same arrow on a matching release below the threshold, even if release lands on whitespace or an adjacent narrow hit target. Blank or ambiguous presses do nothing; crossing the drag threshold, zoom/pinch, cancellation, lost pointer capture, or blur cancels activation. Press highlighting appears only when movement can start; orbit and zoom remain available during an active move. Mouse and pen non-primary buttons are excluded on both press and release.

Root verified the full gate with 106 tests and 127,404 assertions. Headed Chrome passed eleven release offsets with mouse and native touch, plus drag, wheel, pinch, and busy-state feedback checks. WebKit passed the same mouse offset/feedback checks and its existing native-touch gameplay regressions. Both full browser suites passed. The headed web-game client repeated a drifting tap on the wrapping starter and confirmed activation with only one life charged across repeat failures. Final review found no remaining actionable issues.

## Solid arrow fills across cube folds

The reported hairlines were gaps between independently lifted arrow sections at cube folds. Adjacent sections now share vertices at the intersection of both lifted face planes. Very short moving segments retain their real direction instead of using an arbitrary fallback. The previous test that expected separated seam ends now requires a closed join, with all 24 edge directions covered at two grid sizes and multiple lanes, including near-zero moving fragments.

Root reproduced the issue in the previous renderer with a headed pixel check: 36 samples inside arrow fills showed blue or yellow edge colors. The corrected renderer passes the same pixel checks in Chrome and WebKit. Ordinary-edge and wrapping-edge close-ups were inspected, along with light/dark moving-arrow, rebound/retry/reload, and constant-speed checks and the headed web-game client. The full gate passed with 94 tests and 127,384 assertions.

## Edge colors beneath arrows

Ordinary cube lines and yellow wrapping markers now draw between the cube surface and the arrows. Both edge materials share the transparent render pass and disable depth writes, so they cannot hide ribbon bodies or arrowheads. Explicit cube/edge ordering keeps the yellow marker bright above the translucent cube surface. Root inspected light/dark close-ups with both adjoining faces exposed, including a moving arrow crossing the seam. The full gate passed with 93 tests and 123,347 assertions; headed Chrome/WebKit wrapping checks passed visibility, head folding, collision/rebound, retry, reload, and unwrapped-level cleanup. The headed web-game preview was also inspected.

## URL-driven level preview

Test URLs open any valid level directly or filter by wrapping seams. `feature=wrap` (also `wrapping` and `wraparound`, case-insensitive) finds the first level with at least one seam; `wraps=0|1|2|3` requests an exact seam count. Combining either filter with `level` searches at or after the starting level and checks no more than 1,000 candidates using edge-count metadata. Levels must be from 1 through `Number.MAX_SAFE_INTEGER - 1`; invalid numbers, duplicate parameters, conflicting selectors, and unknown features produce a clear error. These selectors start a preview that skips the demo and never writes or deletes campaign saves; Return to campaign exits it. Go and Next preserve the filter and update the URL to the resolved level. Bare `?test=1` remains automation-hooks-only.

Root verified the full gate with 93 tests and 123,347 assertions. Headed Chrome and WebKit passed public URLs without automation hooks, generated feature/count matches, filtered Next/Go, normalized URL reloads, preservation of unrelated query/hash state, exact campaign-save isolation during play/retry/reset/completion/errors, no-match handling at the maximum level, cold previews without a save, and Return to campaign. The test banner was inspected on desktop, portrait mobile, and landscape, where an overlap assertion keeps it clear of the cube. The headed web-game client opened a wrapping preview successfully. The initial dense completion smoke passed its feature assertions but timed out during browser cleanup; the bounded completion regression now uses the authored teaching cube, while generated wrapping filters are exercised through Go and reload. Final browser suites and cleanup pass, and diff review found no actionable issues.

## Consistent arrow movement speed

The owner reported faster movement when an arrow starts farther from an edge. Exits previously used the same 563.2 ms duration for different travel distances, including flight extensions proportional to the raw path cell count. Normal exits and both rebound legs now use five cube-space units per second. The renderer and attempt controller share the same geometric distance calculation, including yellow seam turns. Off-cube travel is the actual body length plus two units, preserving speed across grid sizes and allowing the full arrow to clear. Reduced-motion transitions remain 70.4 ms. Level geometry, saves, penalties, and demo pauses are unchanged.

Root verified `make checkall` with 86 tests and 123,301 assertions, plus headed Chrome and WebKit regression suites. The new browser check freezes the clock and measures the actual rendered head tip: near, distant, dense-grid, wrapped, outbound-blocked, and returning-blocked movement all measure five units per second within 0.000001. Near and far exit fixtures take 616.7 ms and 950.0 ms respectively. Existing browser timing checks now finish each move using its actual duration and accept an already-completed short rebound only when the intended arrow alone received the correct penalty. Completion, retry/reload, reduced motion, hints, input, and wrapping remain verified. Screenshots and the headed web-game client were inspected, and final diff review found no actionable issues.

## Runtime endless campaign

The fixed level-2–10 catalog is superseded in production. Level 1 remains the unchanged authored teaching puzzle; every logical level at or above 2 is generated at runtime. Levels 2–10 retain their literal generator-v1 seeds and unchanged geometry. Levels above 10 use generator version 2, with a separate seeded stream for edge selection so layout retries retain the same wrapping seams. From level 11, generated levels may contain zero to three reciprocal whole-physical-edge yellow seams. The no-seam share stays at 25%; the one/two/three-seam weights shift from 60/12/3 at level 11 to 15/30/30 at level 100 and remain capped after that. Each chosen seam receives a 5/6/7-cell wrapping starter, its full head-exit ray is protected during reverse construction, and random target body lengths scale to 90/80/70% for one/two/three physical wrapping seams. Generated puzzles must pass structural validation and the solver before presentation.

Generation runs through a Web Worker with a three-entry cache and a 12-second timeout. Request/retry/reset/restore revisions prevent stale or failed results from overwriting an accepted puzzle. Saves are v6 logical snapshots with generator metadata, not generated catalogs; reload regenerates through the worker. Valid v1–v5 level-one attempts remain exact. A v6 generator-v1 save resumes exactly through level 10 only when its seed matches; above level 10 the attempt refreshes at the same level while preserving unlocks and tutorial completion. New saves use generator version 2. The static campaign layouts and offline generator remain legacy test fixtures only and are not imported by production code.

Root verified the wrapping feature with `make checkall`: 81 tests, 123,284 assertions, formatting/lint/types/build/icon checks passed. Headed Chrome and WebKit passed yellow-edge counts, light/dark/mobile rendering, head-face changes during motion, collision penalties and free repeat failures, retry/reload, cleanup on unwrapped levels, generator-v1 migration, and existing campaign/input regressions. A live mouse click on level 11's wrapping starter crossed from front to right before rebounding and deducting exactly one life. Screenshots and the headed web-game client were inspected; the final diff review found no actionable issues.

The 500-level generation sweep passed, with edge-count totals of 121/97/146/136 for zero/one/two/three seams, a 63.6 ms average, and 248.9 ms worst desktop generation time. The 120-level generation/solvability sweep and thirty consecutive early wrapping levels also pass. A separate 10,000-level edge-selection sample matches the late 25/15/30/30 distribution within two percentage points. Generator-v1 geometry hashes guard unchanged early levels, and a version-2 hash includes the selected edges. A [live yellow-edge view](docs/verification/wrapping-edges.png) is preserved with the source.

The entries below preserve implementation history. Statements there about fixed levels 2–10, a final campaign state, content versions 2–5, or earlier deferred yellow edges describe the campaign at those dates and must not be read as current runtime behavior or as verification of the wrapping feature.

## Confetti speed tuning

The requested 25% speed increase divides confetti travel, stagger, and cleanup durations by 1.25: travel is now 1.96 seconds, stagger is 19.2 ms per group, and cleanup occurs at 2.08 seconds. The victory card retains its 440 ms entrance. Root verified computed animation timings and cleanup in headed Chrome/WebKit, inspected the rendered burst and web-game client, and passed the full gate (65 tests / 2,075 assertions). These timings supersede the initial celebration timings below.

## Safe-arrow hints

Added a free Hint button that checks the current puzzle for an unobstructed exit, rotates to the chosen arrow's actual head face over 600 ms, then highlights it with three slow pulses over 2.4 seconds. Reduced-motion preferences snap the view and use steady emphasis. Camera framing returns to a fitted distance; hints never move an arrow, spend lives, change failure history, or write progress. Canvas interaction, zoom, camera reset, retry, level changes, and disposal cancel the effect. Hint is disabled during the demo, arrow motion, another hint, and terminal states. Root verified the full gate (65 tests / 2,075 assertions), headed Chrome/WebKit desktop/mobile flows, all six head faces, hidden/extreme-zoom views, wrapped previously failed arrows, safe hinted-arrow activation, light/dark themes, native two-pointer pinch and cancellation events, and a 320-pixel-wide dock. Screenshots and the web-game client were inspected. Review findings about immediate disabled-state updates and unnecessary simulations were corrected. No content or save-version changes.

## System-aware light and dark themes

Settings now offers System (default), Light, and Dark, persisted alongside reduced motion. System mode follows live OS changes; manual choices override the OS until System is selected again. A guarded early HTML bootstrap applies the initial appearance before the app bundle loads. Existing renderer materials retint in place, preserving camera, selection, active motion, failed-arrow history, and progress. The dark palette uses a slate cube, ivory arrows, coral failures, cyan selection, and faint blue-gray far-side paths. HTML surfaces, controls, native selects, browser theme color, and victory cards follow the resolved theme. Settings overlays the gesture hint cleanly on mobile. Legacy/malformed/denied storage is safe. Root verified 65 tests / 2,075 assertions, full gate, headed Chrome/WebKit desktop/mobile theme and gameplay flows, startup before bundle execution, persistence, motion-preserving changes, and inspected dark dense/failed/selected/settings/victory views. The web-game skill client also passed. Campaign content and save versions are unchanged.

## Level-completion celebration (initial timing)

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

## Previous fixed-duration speed tuning

The owner requested another 25% arrow-speed increase after the ribbon refinement. At that stage, the multiplier was 1.25 × 1.25 = 1.5625 relative to the initial MVP. Exits took 563.2 ms, rebounds 473.6 ms, and reduced-motion transitions 70.4 ms. The constant-speed update above supersedes those normal-movement durations. Demo pauses remain unchanged.

## Completed ribbon refinement

The owner requested flat ribbon arrows and an initial 25% speed increase after the MVP. Terra implemented the ribbon geometry in an isolated `feat/flat-ribbons` worktree. That first speed increase changed exits from 880 ms to 704 ms, rebounds from 740 ms to 592 ms, and reduced-motion transitions from 110 ms to 88 ms. The later tuning above supersedes those durations. Demo pauses and core rules are unchanged.

Flat quads and triangular heads follow face planes and fold at seams. Moving body slices retain all turns/seams, begin at the original pose, and keep the head connected. Review corrected winding/culling, off-center seam coordinates, inactive picker filtering, and fractional-slice point/face alignment. Actual dark canvas pixels are now asserted in browser checks so invisible hit targets cannot mask missing visible arrows. Full gate: 31 tests / 492 assertions. Headed Chrome and WebKit production flows, the skill's headed browser client, and inspected desktop/mobile/motion screenshots pass.

## Confirmed behavior

- Level 1 is authored; levels 2 and above are deterministic, solver-validated runtime puzzles. Progression is endless, with an early 60–180 arrow ramp and later 240-arrow cap, 26 × 26 face grids, 40-cell paths, and a three-life floor.
- Head advances forward; body follows its existing path and unwraps ordinary seams. A new head crossing continues only on a marked reciprocal yellow seam; ordinary crossings exit.
- First failure per arrow costs one life and keeps it red until removed. Repeat failures of that arrow are free.
- Reject self-contact levels. One active arrow at a time; extra taps ignored while orbit/zoom remain available.
- Free orbit, wheel and pinch zoom, visible-face picking, faint unpickable far-side arrows, press highlight, ambiguous taps ignored.
- Retry restores the same layout/full lives and clears failed-arrow history. localStorage resumes exact logical progress, including interrupted move results.
- Installable PWA. Support target includes mobile devices up to two prior hardware generations; physical-device proof is still outstanding.
- Non-skippable small-cube demo shows a failed touch/red rebound followed by a successful touch/exit.

## Execution assumptions

- User request on 2026-09-14 supersedes planning-only instructions in the original documents.
- Implement current documented defaults for remaining MVP details. Yellow seams from level 11 use the documented whole-edge reciprocal rules and deterministic edge-count weights. Blue/green arrows, non-cube content, offline gameplay, accounts, undo, and sound assets remain deferred. Safe-arrow hints were separately approved on 2026-09-15.
- A vacated tail cell is allowed only without simultaneous swept contact. Self-contact validation checks each arrow without other blockers.
- Demo uses independent state, starts before first campaign play, saves completion only after both moves, and leaves level 1 untouched. Interrupted demo restarts if not completed.
- Sequential unlock/replay of unlocked levels, bounded numeric Go/Enter navigation, no final campaign completion, reduced-motion presentation, accessible HTML controls.

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
- Blue/green arrows and non-cube content remain deferred. No push/deployment without authorization.
