# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Par Arrows is a 3D arrow-removal puzzle game (desktop and mobile web). Rotate a cube and tap an unobstructed arrow to send it off the surface. A green stop circle parks a passing head until it is tapped again. Two or three arrows with overlapping tails form a group that moves together. A first collision costs one life and marks the arrow or entire group red. A cyan chevron spot bends a passing head onto its heading, and a cube carrying spots needs that turn to clear. TypeScript, three.js, Vite, and the Bun toolchain, with no UI framework.

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

GitHub Actions runs `make checkall` on every push. Run the browser suite locally on a machine with a real headed browser and working WebGL; a virtual X display does not provide valid canvas-pixel evidence.

`make pre-commit` runs the pinned secret-scanning and project checks over all files.

## Git and deployment

Standing authorization: after every verified batch of work — gates green (`make checkall`, plus the headed browser suite when browser-relevant) and committed — push to `main` immediately without asking. A push to `main` is the deploy: Actions runs `make checkall` (ci.yml) and publishes GitHub Pages (deploy.yml). Confirm the pushed run passes and fix forward if it fails; push per batch, not per commit.

## Architecture

The layering is the central design constraint:

- **`src/core` — pure game logic.** Topology (face/cell grid, seams, `stepSurface`), movement (`simulateMove`/`applyMove` returning a fully deterministic `MoveResult` with route, waypoints, contact/exit traces), game state, and validation (`solveLevel` — every authored and generated level is solver-validated). No DOM, no rendering, no storage imports. Core is renderer-neutral: it produces positions/traces the renderer animates.
- **`src/content` — level content.** Authored levels (`intro.ts`: level 1 and the authored level-11 wrap-intro cube, with level 5 in `stop-intro.ts`, level 15 in `overlap-intro.ts`, level 20 in `directional-intro.ts`, and level 25 in `double-intro.ts`) plus the deterministic seeded generator (`procedural.ts`). Generation runs in a Web Worker (`generation-worker.ts`) driven by `level-loader.ts`; results are validated before play. `level-preview.ts` implements the URL selectors (`?level=N`, `?feature=wrap|overlap|stop|directional|double`, `?wraps=N`) — preview sessions must never write or clear campaign saves.
- **`src/render/renderer.ts`** — three.js scene, arrow ribbon geometry, camera rotation, animation. It animates the core's outcome; it never decides life deductions or move legality.
- **`src/app.ts` (`ParArrowsApp`)** — orchestrator: mode (demo/campaign), lives, hints, celebration/confetti, HUD, and wiring input → core → renderer → storage; while a scripted walkthrough expects an arrow, only that arrow (or its group) responds to taps until the script's interactions finish. `src/input.ts` handles pointer/touch/gesture disambiguation (tap vs drag vs pinch). `src/storage.ts` is the only module touching `localStorage`.

### Domain model (`src/core/types.ts`)

A level is a cube of `FaceId` faces, each an integer cell grid. Arrows are ordered `Cell` paths with a head (active) and tail. Moves resolve to `exit` (the arrow or whole group leaves), `paused` (the head parked on a stop circle), `blocked` (first collision costs one life and turns the arrow or whole group red, with repeated failures free), or `invalid`. `EdgePolicyDefinition` declares boundary rules. Its `policy: "continue"` is a wrapping (yellow) edge where a moving head wraps to a neighbor face instead of exiting.

### Stop circles

**Gameplay rules:** `LevelDefinition.stops` lists cells that carry a green circle. A head that steps onto one parks there and the arrow keeps its new cells; the attempt costs nothing and removes nothing. Tapping it again continues forward, and the cell it is leaving never re-parks it. Parking is the way to push an arrow forward to unblock others without it colliding. A collision after leaving a circle costs the usual single life, turns the arrow red, and rebounds it to the circle rather than to its authored start. A circle may not sit on any arrow's starting cell. A group with a shared tail parks as one unit at the earliest member's circle, every member travelling the same distance; a collision on the same step as a circle still costs the life.

**Introduction:** Level 5 is a level-1-style 4 x 4 cube with six arrows, five lives and no yellow edges. Its three front-face arrows form a cycle — the parker blocks the freed arrow, the freed arrow blocks the blocker, and the blocker sits in the parker's lane past the circle — so parking is the only opening move. `tests/stop-content.test.ts` pins this by asserting the same cube with `stops: []` is unsolvable. Levels 1-4 are unchanged; generated levels from 6 onward carry 0-3 circles, and level 6 always carries one. Every generated level that carries at least one circle embeds a parking-required deadlock from the core catalog, so parking is required to clear it; zero-circle levels clear without parking. `?feature=stop` opens the introduction without changing campaign saves.

**Implementation:** `src/core/stops.ts` derives each arrow's static track (authored path plus its pure-topology head route) and its current path at a given offset, so `GameState.offsets` is the single source of where every arrow sits. `simulateMove` builds occupancy from current paths and returns `paused` with `pausedSteps`; `applyMove` advances the whole group's offsets without touching lives. Generated circle levels require parking by construction: the generator embeds a parking-required deadlock core drawn from a seeded catalog (`PARK_PATTERNS`, seven patterns — the level-5 classic, a long-lane stretch, a four-arrow cascade, and a two-circle double park, plus twist (an L-shaped freed lane), crossfire (four arrows, a parker plus three followers, with an interleaved unwind), and twin (two independent one-circle deadlocks that each need their own parker); ids ≤ 10 draw only from the original four so their layouts stay byte-identical) from a dedicated `:park-core` seeded stream, and the core geometry proves the requirement — with the circles stripped, every core arrow's first route cell hits another core arrow, and `others` lists each pattern's arrows in reverse unwinding order so the certificate unwinds them after the park. `validateGenerated` in `procedural.ts` replays a park-prefixed certificate cheaply, `parkingCore` replays the core-only certificate at placement time so a wrap config that would strand a core arrow rejects the placement instead of failing the level, and reserving the core's circle cells keeps the level replay infallible without restarting construction. `solveLevel` clears greedily and only backtracks over parking choices, which is what authored cubes like level 5 need. Do not put the backtracking search on the generation path.

### Overlapping tails

**Gameplay rules:** Two or three single-ended arrows may share a continuous tail segment in the same direction. Arrowheads must remain separate. A point crossing does not create a group. Tapping any exposed portion of any member, including its head, individual body or shared tail, activates every connected member at once. Members never block each other or cross each other's travel paths.

If any member hits an outside arrow, every member reverses together at the earliest contact, returns to its exact starting path and stays red, including members whose own exits were clear. The first failure costs one life for the whole group; repeated failures are free. A successful attempt removes every member together. Only one arrow or group attempt runs at a time, while orbit and zoom remain available. Press selection and safe hints highlight the entire group.

**Introduction:** Level 15 uses a level-1-style 4 × 4 cube with six arrows, five lives and no yellow wrapping edges. A pair and its removable blocker occupy the front face; a trio occupies the left face. Levels 1–11 retain their original layouts; generated cubes 12–14 took new layouts in the v5 density bump and again in the v6 park-catalog bump. Generated levels from 16 onward include pairs/trios. `?feature=overlap` opens the introduction without changing campaign saves.

**Implementation:** `src/core/overlap.ts` derives connected groups from shared directed non-head links, including staggered tails. Validation rejects groups larger than three, shared heads, point crossings, opposite-direction overlap, double-ended members and intersecting future member routes, even when an outside blocker initially hides the problem. `simulateMove` supplies aggregate success/failure plus per-member `members` traces. The renderer uses equal travel distance for every member. `applyMove`, solver certificates and saved-state validation handle whole groups atomically. Reload must never restore partial group removal or failure history. Generated groups come from a seeded catalog in `overlapStarter` (`src/content/procedural.ts`): classic, staggered, lanes, seam, and wrap shapes whose members peel at different points and whose individual bodies run straight or cross one or two cube seams through `stepSurface`, parking heads on faces away from the shared tail; attempts reject on head collisions, non-prefix cell sharing, route crossings, or exit-ray contacts before the caller's `validateLevel` gate, and member paths stay within the 40-cell generator bound.

### Two-headed arrows

**Gameplay rules:** A double arrow is one logical arrow with violet and lime halves and an arrowhead at each endpoint. Selecting a half moves toward that half's head; a blocked choice collides normally even when the opposite endpoint is safe. A stop may park either moving head, and a parked double may resume in either direction. Directional spots bend the selected head. The first collision at one exact settled path costs one life and is shared by both endpoints; a new parked path has its own first failure. Failure preserves both colors and adds a whole-arrow red outline. Double arrows never join overlapping-tail groups, and hints highlight only the safe half.

**Introduction and generation:** Authored level 25 forces the violet tail move before its blocker can clear. `?feature=double` opens it without changing campaign saves. From level 26, `doubleArrowFrequency` rises from 0.20 to 0.45 by level 60; the independent `:double-plan` and `:double-core` streams optionally place one three-arrow required-use core. Its endpoint-aware certificate contains a tail action, both endpoint routes validate, and placement exhaustion omits the optional core rather than rejecting the level.

**Implementation:** `MoveTarget` carries arrow identity plus endpoint through picking, safety checks, attempts, hints, tutorials, solver targets and animation. Single arrows and groups retain numeric `offsets`; parked doubles store complete `settledPaths`, which are required because bends make a signed offset insufficient. Position failure keys use arrow id plus exact cell sequence. Renderer geometry splits by accumulated world-space length, gives both halves independent picker metadata and theme colors, and uses separate failure overlay meshes instead of replacing those colors.

### Pointer targets

`src/pick.ts` holds `resolvePick`, the pure rule that turns the renderer's ranked
candidates into one arrow. `PuzzleRenderer.pickCandidates` reports every arrow a
press could mean: a ray hit scores a zero gap, and any other arrow within the
margin scores the screen distance to its exposed ribbon or head. The margin is a
fingertip in CSS pixels (`TOUCH_PICK_MARGIN_PX` for touch, `MOUSE_PICK_MARGIN_PX`
otherwise), never scaled by grid density. Arrows the press landed on outright
exclude ones it merely came near, so a press aimed squarely at an arrow always
keeps that arrow; among whatever is left, an arrow whose move avoids a collision
beats a nearer one that would cost a life, and the closest arrow settles the
rest. The renderer ranks but never decides — move legality stays in `app.ts`,
which supplies the safe test that `beginHint` also uses. `tests/pick-browser.ts`
pins the widened zone against a measured baseline and proves the preference
by the life count rather than by projected centroids.

### Generation and seeds

Levels 1, 5, 11, 15, 20, and 25 are authored. Levels 2–4 keep generator v1 seeds, levels 6–10 keep their v4 runtime seeds so their layouts stay byte-identical, level 11 keeps its v2 `:wrap-intro:1` seed, level 15 keeps its v3 `:overlap-intro:1` seed, level 20 keeps the v4 `:directional-intro:1` seed, and level 25 uses the v7 `:double-intro:1` seed; generated cubes from level 12 up use generator v7 seeds (`GENERATOR_VERSION`, `seedForLevel`, `MAX_LEVEL_ID`), and level 5 carries `:stop-intro:1`. Stop-circle counts come from `getStopCount` on a stream independent of layout retries. Levels with at least one circle gain a parking-required deadlock core placed on its own `:park-core` stream, which also seeds the pattern choice from the catalog (multi-circle patterns need a stop budget that covers them); core placement failure falls back to decorative circles rather than restarting construction, and any remaining circles stay decorative on cells some arrow's head actually travels through. Generation is deterministic from the seed, retries preserve selected wrapping seams (separate seeded stream), and generated layouts are validated by the solver. Wrapping-edge counts follow a level-scaled distribution (`getWrappingEdgeWeights`). From level 21, every cube draws zero to four spot-bearing faces (`directionalFaceCount` on a `:dir-plan` stream) with one to four spots per bearing face (`directionalFacePlan` on `:dir-counts`, faces from `:dir-faces`); a cube with any spots embeds the required head-on core from a `:dir-core` stream — the spot cell and its whole bent exit corridor are reserved from later placement, spot-bearing cubes never carry overlap groups, their certificate leads with the two core arrows, and the level must be unsolvable with the spots removed. From level 21 one traverser may bend through two spots and from level 40 through three (`chainDepthLimit`); extra spots are placed on travelled cells by `extraDirectionalSpots`, which prefers candidates whose traverser already bent through an earlier placed spot so chains emerge from chain-first candidate ordering before plain single-bend candidates fill in, with a post-trial recheck rejecting a candidate that would push any traverser past the limit (a new spot can redirect a traverser onto a corridor with more bends than its pre-redirect track showed, so the pre-trial depth tag alone cannot be trusted); each candidate is further vetted so every traverser still exits alone with its bent route clear of earlier-replaying arrows and the parking core's tracks, and if the extras break the certificate replay, the cube falls back to core-only, with a cube whose directional pass exhausts its restarts rebuilding with the plan forced empty (spots are optional at zero faces). `GENERATOR_VERSION` is 7: optional required-use double cores were added from level 26 on independent `:double-plan` / `:double-core` streams; the v6 release previously the level-12-and-up park catalog grew from four patterns to seven (`PARK_PATTERNS` — see Stop circles above), and generated cubes now verify a rising blocked-arrow share against `blockedTarget(id)` (0 through the authored teaching ids, 0.30 at level 12 rising linearly to 0.55 at level 60 and holding). Fill is exact — every level still fills to its full historical `arrowCount`, no density cut — and `blockedStats`, measured on the fully assembled level (stops and directional spots already applied, since a stop converts `blocked` to `paused` and a spot bends a route), only rarely falls more than 0.06 below `blockedTarget(id)` after natural construction; on that rare shortfall a top-up blocker pass adds up to `blockerReserve(id)` extra arrows on top of the full count, appended last to the arrow list so they lead the reversed certificate. The two certificate-replayed tiers reject a cube that is still short after the top-up; the final, non-certificate tier also runs the top-up but accepts the cube even if it remains short, rather than throwing. Because the top-up adds arrows beyond the full count, raising `blockedTarget`'s curve in the future would make it fire more often and could push a level's arrow count past the 264-arrow cap (stated in README.md, asserted in `tests/procedural.test.ts`), with each top-up level also taking about ten seconds to generate instead of the fast path, so re-check both before raising the curve. Changing `GENERATOR_VERSION` or seed format invalidates existing saves — see storage migration rules in the README.

### Storage

`localStorage` under `par-arrows:campaign:v1` / `par-arrows:settings:v1` keys with `CONTENT_VERSION = 9` guarding the logical save. Stable older attempts through level 4 resume exactly when their seeds match, as do the authored cubes 11 and 15. Changed attempts from level 5 onward refresh while preserving level, unlocks, and tutorial completion. Group removal and failure history must be all-or-none, and lives count failed groups once. Saved `offsets` are validated against each single arrow's track length, group members must share one offset, and no two arrows may be parked onto the same cell. Parked double `settledPaths` must have the authored length, valid adjacent unique cells, name a remaining double arrow, and be reachable through legal pauses; `failedPositions` must match the authored or current settled path. The browser test hooks (`window.render_game_to_text` etc.) are enabled only by `?test=1`; `?test=1` alone does not start preview mode. The diagnostic exposes `mode` as `campaign` or `preview` — any `?level`/`?feature` session is a preview and never writes campaign saves.

### Tests

- Unit tests (`tests/*.test.ts`) run under Bun and cover core, content, procedural, storage, icons, and geometry.
- Stop-circle coverage lives in `tests/stop.test.ts`, `tests/stop-content.test.ts`, the parked cases in `tests/storage.test.ts`, and `tests/stop-browser.ts`. Run `STOP_ONLY=1 make browser-test` for the focused headed suite.
- Overlap coverage lives in `tests/overlap.test.ts`, `tests/overlap-content.test.ts`, and the group cases in `tests/storage.test.ts`. Verify individual head/body/shared-tail taps, a blocked nonclicked member, synchronized red rewind, free repeats, interrupted saves, and level 14 → 15 → 16 progression with `tests/overlap-browser.ts`. Run `OVERLAP_ONLY=1 make browser-test` for the focused headed suite — the full sweep never runs the overlap browser module, so the focused run is its only browser verification — adding `BROWSER_ENGINE=webkit` for WebKit.
- Directional coverage lives in `tests/directional.test.ts`, `tests/directional-content.test.ts`, and `tests/directional-browser.ts`. Verify bend-on-entry, persistence and chaining, parked resumes across a bend, 180° self-body invalids, validator rejections, required-use (stripped cubes unsolvable), and the scripted walkthrough with its input gating. Run `DIRECTIONAL_ONLY=1 make browser-test` for the focused headed suite.
- Double-arrow coverage lives in `tests/double.test.ts`, `tests/double-content.test.ts`, midpoint/picking cases in `tests/ribbon-geometry.test.ts` and `tests/pick.test.ts`, storage corruption cases in `tests/storage.test.ts`, and `tests/double-browser.ts`. Run `DOUBLE_ONLY=1 make browser-test`, adding `BROWSER_ENGINE=webkit` for WebKit.
- Browser assertions live in `tests/*-browser.ts` modules (runtime, tap, pick, motion, wrapping, wrap-intro, stop, overlap, directional, seam-fill, resize, context, preview, hints) orchestrated by `tests/browser-runner.ts`, which drives a headed Playwright browser against the production build. The stop suite (`tests/stop-browser.ts`) runs in both the full sweep and its own `STOP_ONLY=1` mode; the resize and context suites have the analogous `RESIZE_ONLY=1` and `CONTEXT_ONLY=1` modes.
- `scripts/generate-campaign.ts` and `campaign-quality.ts` operate on the former fixed catalog — historical reference and test fixtures only, excluded from production imports.
