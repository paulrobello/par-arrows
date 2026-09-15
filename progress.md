Original prompt: Build a desktop/mobile web 3D arrow-removal puzzle with cube-based early levels, bent multi-face arrows, collision/rebound feedback, decreasing lives, future bidirectional arrows and yellow continuation edges. Preserve the three reference photos and plan first. The owner subsequently authorized implementation using Terra subagents and proper greenfield/Git setup.

# Implementation progress

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
- Implement current documented defaults for remaining MVP details. Offline gameplay, accounts, hints, undo, sound assets, and later gameplay mechanics stay deferred.
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
