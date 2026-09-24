# Par Arrows

A desktop and mobile 3D arrow-removal puzzle with flat ribbon arrows. Rotate a cube, find an unobstructed arrow, and send it off the surface. A first collision costs one life and marks that arrow red; further collisions by the same red arrow are free. An arrow whose head reaches a green stop circle parks there until it is touched again, which lets it move forward to clear a lane without running into anything; if it is then blocked, it rebounds to the circle rather than to its starting place. Two or three arrows can share tail segments: touching any member moves the whole group, and an outside collision sends all members back red for one life. Their heads and travel paths stay separate. A cyan chevron spot bends any arrow that reaches it onto the chevron's heading for the rest of its run, and a cube carrying spots needs that turn to be cleared. Violet/lime two-headed arrows move toward whichever colored half the player selects; parked doubles can resume either way, keep their colors after a collision, and gain a whole-arrow red failure outline for that settled position.

Play at [arrows.pardev.net](https://arrows.pardev.net).

Level 1 is the authored teaching cube. Level 5 introduces green stop circles, level 11 introduces reciprocal yellow-edge wrapping, level 15 teaches overlapping tails, level 20 introduces cyan chevron spots, and level 25 introduces two-headed arrows; other levels are generated at runtime from their logical level numbers. Generated cubes from level 6 carry zero to three stop circles, and a level that carries any embeds a parking deadlock: parking the parker is required to clear it. From level 21, every generated cube draws zero to four spot-bearing faces with one to four chevron spots per bearing face; a cube that carries any spot embeds a head-on directional deadlock — the spots are required to clear it — and such cubes never carry overlap groups. From level 26, an independently seeded 20%–45% of generated cubes attempt a required-use double-arrow core whose certificate includes a tail-endpoint move; placement exhaustion omits the optional mechanic rather than rejecting the level. The campaign continues indefinitely, and generated layouts are validated before play. See [PRD.md](PRD.md) for product rules and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the runtime design.

The former fixed ten-level catalog and its reports remain historical reference and test fixtures only. They are excluded from production imports.

## Develop

Install Bun, then run from the repository root:

```sh
bun install --frozen-lockfile
make dev
```

Open [the local game](http://localhost:8057). The development server binds to loopback and uses a reserved port. Use `make dev-stop` to stop it or `make dev-restart` to restart it after the port is released.

### Test levels

Open these links to preview campaign content without unlocking it:

- [Level 25](http://localhost:8057/?level=25) loads that level directly, regardless of campaign unlocks.
- [Stop circle introduction](http://localhost:8057/?feature=stop) opens cube 5, whose three front-face arrows deadlock until one parks on the circle.
- [Overlapping tails introduction](http://localhost:8057/?feature=overlap) opens cube 15, with a pair, a trio, and an outside blocker.
- [Directional spot introduction](http://localhost:8057/?feature=directional) opens cube 20, whose front-face arrows deadlock until the chevron bends one off the lane.
- [Two-headed arrow introduction](http://localhost:8057/?feature=double) opens cube 25, whose violet tail direction is the only safe opening move.
- [First level with wrapping](http://localhost:8057/?feature=wrap) finds the first level containing a yellow physical edge.
- [Level with exactly three wrapping edges](http://localhost:8057/?wraps=3) searches for an exact edge count.
- [Three wrapping edges at or after level 50](http://localhost:8057/?level=50&wraps=3) searches from level 50 for an exact count.

`feature` accepts `overlap` or `overlapping` for linked tails, `stop`, `stops`, or `stopcircle` for green circles, `directional` or `directionals` for chevron spots, `double`, `twoheaded`, or `two-headed` for two-headed arrows, and `wrap`, `wrapping`, or `wraparound` for yellow edges, case-insensitively. `wraps` accepts `0`, `1`, `2`, or `3`. A filter searches from level 1 unless `level` sets the starting point; Go and Next keep the filter active, and the resolved level is written into the URL for reloads. Searches inspect at most 1,000 candidates using edge-count metadata rather than generating and rendering every level. Levels must be safe integers from 1 through `Number.MAX_SAFE_INTEGER - 1`; malformed values, duplicate parameters, conflicting selectors, unknown features, and searches with no match show a clear error.

Using `level`, `feature`, or `wraps` opens a separate preview session — the interactive walkthroughs run only in campaign play — and never writes or deletes campaign saves during play, Retry, Next, Reset, or error handling. Use **Return to campaign** to leave preview. The existing `?test=1` flag only enables automation hooks; by itself it does not start preview mode.

## Verify

```sh
make checkall
make browser-install
make browser-test
```

`checkall` runs format verification, lint, TypeScript checks, unit tests, and a production build. Browser checks use Playwright and are separate from physical-device and installed-PWA acceptance. The isolated browser test port is 8058. `make fmt` formats the project; during ongoing work, format only the files being changed.

For the WebKit compatibility run, install its browser with `bunx playwright install webkit`, then run `BROWSER_ENGINE=webkit make browser-test`. Browser tests build and serve production assets, use a headed browser, and clean up their temporary server. Run them on a machine with a real graphical session and working WebGL; virtual X and headless CI are insufficient for the canvas-pixel assertions. Use `DOUBLE_ONLY=1 make browser-test` for the focused two-headed-arrow suite and add `BROWSER_ENGINE=webkit` for its WebKit run.

Install pre-commit and run `pre-commit install` to enable the pinned secret-scanning and project checks. `make pre-commit` runs them over tracked files. Dependencies are pinned in `package.json` and `bun.lock`.

## Controls and progress

- Click or touch an arrow to attempt a move. Drag to rotate continuously in any direction, including over the top and bottom. Use the mouse wheel or pinch to zoom, and View to restore the starting angle.
- A press highlights its arrow or connected tail group. Ambiguous touches do nothing. Dragging and pinching do not activate arrows.
- The first run plays cube 1 as an interactive walkthrough: it states the rules, has the player tap a blocked arrow — the collision costs one life and marks the arrow red — then guides clearing its blocker and the rest of the cube. Cubes 5, 11, 15, 20, 25, and 30 open with their own one-time walkthroughs for parking, wrapping, shared-tail groups, chevron spots, two-headed direction choice, and flip spots. While a walkthrough step expects an arrow, only that arrow (or its group) responds to taps; once its interactions finish, the remaining arrows clear in any order.
- The authored introductions at levels 1, 5, 11, 15, 20, 25, and 30 have five lives. Runtime-generated levels are deterministic reverse-constructed puzzles, growing from 60 to 180 arrows early and then capped at 264 arrows, 26 × 26 cells per face, 40 cells per path, and a three-life floor.
- Retry restores the same layout and full life budget. Next continues to the next level; there is no final campaign screen. The numeric level control accepts Go or Enter for any unlocked safe-integer level.
- Show grid lines defaults to on; grid lines, reduced motion, and the theme persist per browser.
- Progress, lives, failed-arrow history, parked positions, and generator metadata are stored as a v11 logical save in browser `localStorage`. Single arrows and groups retain numeric stop offsets; parked double arrows persist their complete settled paths so bends and reverse moves restore exactly. A double's first paid failure is keyed by arrow plus settled path and shared by both endpoints. Restores reject malformed, unreachable, duplicate-cell, wrong-length, or wrong-arrow paths and safely refresh the attempt while preserving the level, unlocks, and tutorial completion. Stable older saves for cube 2 resume exactly when their seeds match, as do cubes 8, 9, 11, 15 and 20; the content-10 seam-heading fix rebuilt 77 of generated cubes 2–200 (including 3, 4, 6, 7 and 10), so a content-9 attempt resumes only on generated cubes 2, 8 and 9 and the authored cubes, and every other attempt restarts once while keeping unlocks; content 11 rebuilt 51 more cubes (including 52) so no collision-free park can strand a level, and content-10 attempts on the other generated cubes up to 200 resume; changed generated attempts refresh under generator v7 metadata. Level 25 keeps `par-arrows:runtime:7:level:25:double-intro:1`; generated levels 12 and above use v7 seeds. Saved groups restore atomically and count as one failure for lives. Generated levels are regenerated by a worker on reload. On iOS, Safari, third-party browsers, and an installed home-screen PWA each hold an isolated storage container, so progress does not carry between them; progress carries normally across Safari sessions and across installed-PWA launches. In multiple tabs or windows, the tab writing most recently selects the resume state, and unlock progress never regresses: every write keeps the highest unlocked level visible to any tab.

PWA installation is supported where the browser provides it. A production installation needs a secure origin; local development can use localhost. Installation does not require an account. Offline gameplay is outside the current MVP scope.

The [icon suite](docs/icons.md) includes browser favicons, Apple touch artwork, and standard/maskable PWA icons. Run `make icons` to regenerate them from the checked-in SVG sources.

Use one active play session. Multi-tab save conflicts, physical-device performance, and installed-app save transfer still need qualification.

## Structure

`src/core` holds pure topology, movement, game state, and validation. `src/content` holds the authored level 1 and mechanic-intro cubes, the deterministic generator, and the worker loader; `src/tutorial.ts` holds the scripted walkthroughs. The remaining `src` modules handle rendering, input, UI, storage, and installation. The renderer animates the core's outcome and does not decide life deductions.

The [supplied reference images](docs/references/README.md) are preserved as visual references, including dense multi-bend arrow layouts and a yellow continuation edge. Project source uses the [MIT license](LICENSE); third-party references and dependencies retain their respective rights and licenses.

## Scope

Level 11 is an authored 4 × 4 cube with six short arrows, one on each face, and five lives. Its front-west/left-east yellow edge is a whole physical seam and works in both directions: two safe moves wrap across it, while the other four arrows exit through ordinary edges. A new head crossing an ordinary edge exits, while an existing arrow body can still unwrap across ordinary seams. Cube 15 introduces overlapping tails on a small authored cube. Levels 12–14 are generated under the v7 generator, having taken new layouts in the v5 density bump, v6 park-catalog bump, and v7 two-headed-arrow release; pairs and trios enter generated layouts at level 16. Their edge-count distribution keeps zero edges at 25%, with the remaining weights shifting toward 15% one edge, 30% two, and 30% three by level 100. Edge selection uses a separate seeded stream, so generation retries keep the same seams, and the solver validates each generated layout before play. The authored levels 11 and 15 are exempt from random edge-count selection and generated density. Non-cube content, undo, accounts, cloud saves, and custom audio remain deferred. Hints, dark theme, and completion confetti remain available.
