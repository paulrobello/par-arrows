# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Par Arrows is a 3D arrow-removal puzzle game (desktop and mobile web). Rotate a cube, click an unobstructed arrow, and it flies off the surface; a first collision costs a life and marks that arrow red. TypeScript, three.js, Vite, and the Bun toolchain, with no UI framework.

## Commands

Bun is the package manager and test runner — not npm/node.

```sh
bun install --frozen-lockfile   # install
make dev                        # Vite dev server at http://localhost:8057 (strict port)
make dev-stop                   # release the dev port
make checkall                   # full gate: format-check, lint, typecheck, test, build, icons-check
make test                       # bun test (unit tests in tests/*.test.ts)
bun test tests/core.test.ts     # one test file
bun test -t "wrapping"          # tests matching a name
make fmt                        # biome format --write (format only files you touched)
make icons                      # regenerate icon suite from SVG sources (make icons-check verifies)
```

Browser (Playwright) tests are separate from unit tests and build/serve production assets on port 8058 with a headed browser:

```sh
make browser-install            # playwright install chromium
make browser-test               # builds, serves, runs tests/browser-runner.ts
BROWSER_ENGINE=webkit make browser-test   # after: bunx playwright install webkit
```

Linux CI runs browser tests under `xvfb-run --auto-servernum` (see `.github/workflows/ci.yml`, which runs `make checkall` plus browser tests on every push).

`make pre-commit` runs the pinned secret-scanning and project checks over all files.

## Architecture

The layering is the central design constraint:

- **`src/core` — pure game logic.** Topology (face/cell grid, seams, `stepSurface`), movement (`simulateMove`/`applyMove` returning a fully deterministic `MoveResult` with route, waypoints, contact/exit traces), game state, and validation (`solveLevel` — every authored and generated level is solver-validated). No DOM, no rendering, no storage imports. Core is renderer-neutral: it produces positions/traces the renderer animates.
- **`src/content` — level content.** Authored levels (`intro.ts`: level 1 and the authored level-11 wrap-intro cube) plus the deterministic seeded generator (`procedural.ts`). Generation runs in a Web Worker (`generation-worker.ts`) driven by `level-loader.ts`; results are validated before play. `level-preview.ts` implements the URL selectors (`?level=N`, `?feature=wrap`, `?wraps=N`) — preview sessions must never write or clear campaign saves.
- **`src/render/renderer.ts`** — three.js scene, arrow ribbon geometry, camera rotation, animation. It animates the core's outcome; it never decides life deductions or move legality.
- **`src/app.ts` (`ParArrowsApp`)** — orchestrator: mode (demo/campaign), lives, hints, celebration/confetti, HUD, and wiring input → core → renderer → storage. `src/input.ts` handles pointer/touch/gesture disambiguation (tap vs drag vs pinch). `src/storage.ts` is the only module touching `localStorage`.

### Domain model (`src/core/types.ts`)

A level is a cube of `FaceId` faces, each an integer cell grid. Arrows are ordered `Cell` paths with a head (active) and tail. Moves resolve to `exit` (arrow leaves via an edge), `blocked` (first collision: costs one life, arrow turns red; further collisions by the same red arrow are free), or `invalid`. `EdgePolicyDefinition` declares boundary rules; `policy: "continue"` is a wrapping (yellow) edge where a moving head wraps to a neighbor face instead of exiting.

### Generation and seeds

Levels 1 and 11 are authored. Levels 2–10 use generator v1 seeds, levels 12+ use generator v2 seeds (`GENERATOR_VERSION`, `seedForLevel`, `MAX_LEVEL_ID`); level 11's seed carries a `:wrap-intro:1` suffix. Generation is deterministic from the seed, retries preserve selected wrapping seams (separate seeded stream), and generated layouts are validated by the solver. Wrapping-edge counts follow a level-scaled distribution (`getWrappingEdgeWeights`). Changing `GENERATOR_VERSION` or seed format invalidates existing saves — see storage migration rules in the README.

### Storage

`localStorage` under `par-arrows:campaign:v1` / `par-arrows:settings:v1` keys with `CONTENT_VERSION = 6` guarding the logical save. Valid generator-v1 saves ≤ level 10 resume exactly; v1 attempts above level 10 refresh while preserving level, unlocks, and tutorial completion. The browser test hooks (`window.render_game_to_text` etc.) are enabled only by `?test=1`; `?test=1` alone does not start preview mode.

### Tests

- Unit tests (`tests/*.test.ts`) run under Bun and cover core, content, procedural, storage, icons, and geometry.
- Browser assertions live in `tests/*-browser.ts` modules (runtime, tap, motion, wrapping, wrap-intro, seam-fill, preview, hints) orchestrated by `tests/browser-runner.ts`, which drives a headed Playwright browser against the production build.
- `scripts/generate-campaign.ts` and `campaign-quality.ts` operate on the former fixed catalog — historical reference and test fixtures only, excluded from production imports.
