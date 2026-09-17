# Par Arrows

A desktop and mobile 3D arrow-removal puzzle with flat ribbon arrows. Rotate a cube, find an unobstructed arrow, and send it off the surface. A first collision costs one life and marks that arrow red; further collisions by the same red arrow are free. An arrow whose head reaches a green stop circle parks there until it is touched again, which lets it move forward to clear a lane without running into anything; if it is then blocked, it rebounds to the circle rather than to its starting place. Two or three arrows can share tail segments: touching any member moves the whole group, and an outside collision sends all members back red for one life. Their heads and travel paths stay separate.

Play at [arrows.pardev.net](https://arrows.pardev.net).

Level 1 is the authored teaching cube. Level 5 introduces green stop circles, level 11 introduces reciprocal yellow-edge wrapping, and level 15 teaches overlapping tails; levels 2–4, 6–10, 12–14, and 16 onward are generated at runtime from their logical level numbers. Generated cubes from level 6 carry zero to three stop circles. The campaign continues indefinitely, and generated layouts are validated before play. See [PRD.md](PRD.md) for product rules and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the runtime design.

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
- [First level with wrapping](http://localhost:8057/?feature=wrap) finds the first level containing a yellow physical edge.
- [Level with exactly three wrapping edges](http://localhost:8057/?wraps=3) searches for an exact edge count.
- [Three wrapping edges at or after level 50](http://localhost:8057/?level=50&wraps=3) searches from level 50 for an exact count.

`feature` accepts `overlap` or `overlapping` for linked tails, `stop`, `stops`, or `stopcircle` for green circles, and `wrap`, `wrapping`, or `wraparound` for yellow edges, case-insensitively. `wraps` accepts `0`, `1`, `2`, or `3`. A filter searches from level 1 unless `level` sets the starting point; Go and Next keep the filter active, and the resolved level is written into the URL for reloads. Searches inspect at most 1,000 candidates using edge-count metadata rather than generating and rendering every level. Levels must be safe integers from 1 through `Number.MAX_SAFE_INTEGER - 1`; malformed values, duplicate parameters, conflicting selectors, unknown features, and searches with no match show a clear error.

Using `level`, `feature`, or `wraps` opens a separate preview session, skips the onboarding demo, and never writes or deletes campaign saves during play, Retry, Next, Reset, or error handling. Use **Return to campaign** to leave preview. The existing `?test=1` flag only enables automation hooks; by itself it does not start preview mode.

## Verify

```sh
make checkall
make browser-install
make browser-test
```

`checkall` runs format verification, lint, TypeScript checks, unit tests, and a production build. Browser checks use Playwright and are separate from physical-device and installed-PWA acceptance. The isolated browser test port is 8058. `make fmt` formats the project; during ongoing work, format only the files being changed.

For the WebKit compatibility run, install its browser with `bunx playwright install webkit`, then run `BROWSER_ENGINE=webkit make browser-test`. Browser tests build and serve production assets, use a headed browser, and clean up their temporary server. Run them on a machine with a real graphical session and working WebGL; virtual X and headless CI are insufficient for the canvas-pixel assertions.

Install pre-commit and run `pre-commit install` to enable the pinned secret-scanning and project checks. `make pre-commit` runs them over tracked files. Dependencies are pinned in `package.json` and `bun.lock`.

## Controls and progress

- Click or touch an arrow to attempt a move. Drag to rotate continuously in any direction, including over the top and bottom. Use the mouse wheel or pinch to zoom, and View to restore the starting angle.
- A press highlights its arrow or connected tail group. Ambiguous touches do nothing. Dragging and pinching do not activate arrows.
- The first-run demo shows a failed move followed by a successful move before campaign play.
- The authored introductions at levels 1, 5, 11, and 15 have five lives. Runtime-generated levels are deterministic reverse-constructed puzzles, growing from 60 to 180 arrows early and then capped at 240 arrows, 26 × 26 cells per face, 40 cells per path, and a three-life floor.
- Retry restores the same layout and full life budget. Next continues to the next level; there is no final campaign screen. The numeric level control accepts Go or Enter for any unlocked safe-integer level.
- Progress, lives, failed-arrow history, parked stop-circle positions, and generator metadata are stored as a v8 logical save in browser `localStorage`. Stable older saves through level 4 resume exactly when their seeds match, as do the authored cubes 11 and 15. Changed attempts from level 5 onward refresh while preserving the level, unlocks, and tutorial completion. Level 11 retains its version-2 `:wrap-intro:1` seed and level 15 its version-3 `:overlap-intro:1` seed; level 5 and other generated content use generator version 4. Saved groups restore atomically and count as one failure for lives, and a parked arrow restores exactly on its circle. Generated levels are regenerated by a worker on reload. On iOS, Safari, third-party browsers, and an installed home-screen PWA each hold an isolated storage container, so progress does not carry between them; progress carries normally across Safari sessions and across installed-PWA launches.

PWA installation is supported where the browser provides it. A production installation needs a secure origin; local development can use localhost. Installation does not require an account. Offline gameplay is outside the current MVP scope.

The [icon suite](docs/icons.md) includes browser favicons, Apple touch artwork, and standard/maskable PWA icons. Run `make icons` to regenerate them from the checked-in SVG sources.

Use one active play session. Multi-tab save conflicts, physical-device performance, and installed-app save transfer still need qualification.

## Structure

`src/core` holds pure topology, movement, game state, and validation. `src/content` holds the authored level 1, demo, deterministic generator, and worker loader. The remaining `src` modules handle rendering, input, UI, storage, and installation. The renderer animates the core's outcome and does not decide life deductions.

The [supplied reference images](docs/references/README.md) are preserved as visual references, including dense multi-bend arrow layouts and a yellow continuation edge. Project source uses the [MIT license](LICENSE); third-party references and dependencies retain their respective rights and licenses.

## Scope

Level 11 is an authored 4 × 4 cube with six short arrows, one on each face, and five lives. Its front-west/left-east yellow edge is a whole physical seam and works in both directions: two safe moves wrap across it, while the other four arrows exit through ordinary edges. A new head crossing an ordinary edge exits, while an existing arrow body can still unwrap across ordinary seams. Cube 15 introduces overlapping tails on a small authored cube. Levels 12–14 retain their original generated layouts; pairs and trios enter generated layouts at level 16. Their edge-count distribution keeps zero edges at 25%, with the remaining weights shifting toward 15% one edge, 30% two, and 30% three by level 100. Edge selection uses a separate seeded stream, so generation retries keep the same seams, and the solver validates each generated layout before play. The authored levels 11 and 15 are exempt from random edge-count selection and generated density. Blue/green two-ended arrows, non-cube content, undo, accounts, cloud saves, and custom audio remain deferred. Hints, dark theme, and completion confetti remain available.
