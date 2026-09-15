# Par Arrows

A desktop and mobile 3D arrow-removal puzzle with flat ribbon arrows. Rotate a cube, find an unobstructed arrow, and send it off the surface. A first collision costs one life and marks that arrow red; further collisions by the same red arrow are free.

The initial ten-level MVP is implemented. See the [verification report](docs/verification/2026-09-14-mvp.md) for browser evidence and outstanding device qualification, [PRD.md](PRD.md) for product rules, and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the delivery plan.

The [dense zigzag revision](docs/verification/dense-zigzags.md) increases levels 2–10 to 30–90 arrows with substantially more bends and removal dependencies. Older attempts on these revised levels restart with their unlocks preserved; compatible level-one saves resume exactly.

## Develop

Install Bun, then run from the repository root:

```sh
bun install --frozen-lockfile
make dev
```

Open [the local game](http://localhost:8057). The development server binds to loopback and uses a reserved port. Use `make dev-stop` to stop it or `make dev-restart` to restart it after the port is released.

## Verify

```sh
make checkall
make browser-install
make browser-test
```

`checkall` runs format verification, lint, TypeScript checks, unit tests, and a production build. Browser checks use Playwright and are separate from physical-device and installed-PWA acceptance. The isolated browser test port is 8058. `make fmt` formats the project; during ongoing work, format only the files being changed.

For the WebKit compatibility run, install its browser with `bunx playwright install webkit`, then run `BROWSER_ENGINE=webkit make browser-test`. Browser tests build and serve production assets, use a headed browser, and clean up their temporary server. Linux needs a graphical session or `xvfb-run --auto-servernum`.

Install pre-commit and run `pre-commit install` to enable the pinned secret-scanning and project checks. `make pre-commit` runs them over tracked files. Dependencies are pinned in `package.json` and `bun.lock`.

## Controls and progress

- Click or touch an arrow to attempt a move. Drag to rotate continuously in any direction, including over the top and bottom. Use the mouse wheel or pinch to zoom, and View to restore the starting angle.
- A press highlights its arrow. Ambiguous touches do nothing. Dragging and pinching do not activate arrows.
- The first-run demo shows a failed move followed by a successful move before campaign play.
- Ten curated cube levels use five, four, then three starting lives. Retry restores the same layout and full life budget.
- Starting at level 2, denser boards mix short and long arrows, winding zigzags, stepped bends, and paths wrapping over cube edges.
- Progress, lives, and failed-arrow history are stored in browser `localStorage` for resume.

PWA installation is supported where the browser provides it. A production installation needs a secure origin; local development can use localhost. Installation does not require an account. Offline gameplay is outside the current MVP scope.

The [icon suite](docs/icons.md) includes browser favicons, Apple touch artwork, and standard/maskable PWA icons. Run `make icons` to regenerate them from the checked-in SVG sources.

Use one active play session. Multi-tab save conflicts, physical-device performance, and installed-app save transfer still need qualification.

## Structure

`src/core` holds pure topology, movement, game state, and validation. `src/content` holds the fixed campaign and demo. The remaining `src` modules handle rendering, input, UI, storage, and installation. The renderer animates the core's outcome and does not decide life deductions.

The [supplied reference images](docs/references/README.md) are preserved as visual references, including dense multi-bend arrow layouts and the future yellow continuation edge. Project source uses the [MIT license](LICENSE); third-party references and dependencies retain their respective rights and licenses.

## Scope

Later blue/green two-ended arrows and yellow continuation edges have explicit engine boundaries and fixtures, but do not appear in the MVP campaign. Non-cube content, hints, undo, accounts, cloud saves, and custom audio are deferred.
