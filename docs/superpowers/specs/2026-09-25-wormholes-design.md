# Wormholes Design

Date: 2026-09-25

## Goal

Add wormholes: paired portal cells that teleport a moving head from one end to the other. Ends may sit on any face, including both on the same face. A level carries at most two wormholes. Portal loops must be impossible in any shipped level.

## Rules

- `LevelDefinition.wormholes?: { id: string; a: Cell; b: Cell }[]`, at most 2 entries.
- Travel is two-way. A head stepping onto end A is placed on end B's cell in the same step, and vice versa.
- Heading is preserved in the face-local frame: a head moving "up" in A's face grid leaves B moving "up" in B's face grid, regardless of the faces' 3D relationship. The head continues from B on the next step.
- The body follows cell by cell, so an arrow in transit occupies cells on both sides of the portal. A route records the jump explicitly; no drawn segment joins A and B.
- A blocked exit is an ordinary collision: if another arrow covers B or the cell after B, the head collides there. The first failure at a position costs one life and turns the arrow (or group) red; the arrow rewinds back through the portal. Repeats are free.
- An arrow never collides with its own body. A head re-entering a portal its own body still fills simply continues.
- A stop circle or spot may sit on the cell after an end; a head exiting onto it parks or bends normally. Ends never share a cell with an arrow's starting cell, a stop, a spot, or another end, and A ≠ B.
- Two-headed arrows and overlapping-tail groups may use portals. A group's shared track passes through statically, so the shared-offset model holds. Parked arrows may straddle a portal; offsets and `settledPaths` already carry explicit cells.

## Loop prevention

`loopError` treats a portal jump as one step and walks every endpoint under every flip-direction combination. A level whose route repeats a (cell, heading) pair is rejected. Generation retries or drops the offending wormhole. The runtime repeated-state check still returns `invalid` at no life cost as a backstop.

## Content

**Level 35** (`src/content/wormhole-intro.ts`, seed `par-arrows:runtime:7:level:35:wormhole-intro:1`): a level-1-style 4 × 4 cube, one wormhole (front face ↔ right face), five lives, no wrapping edges. The portal arrow's straight lane is blocked by an arrow that can only leave after the portal arrow, so the wormhole is the only opening. A test asserts the cube with `wormholes: []` is unsolvable. A scripted walkthrough gates input to the portal arrow first. `?feature=wormhole` (also `portal`, `wormholes`) opens it without touching campaign saves.

## Generation (ids 36+)

- `:wormhole-plan` draws the count. Frequency of at least one wormhole rises linearly from 0.25 at level 36 to 0.60 at level 90 and holds. A second wormhole is possible from level 50.
- `:wormhole-core` places one required-use core: a traverser whose straight exit is blocked and whose portal route exits clear, plus a blocker that clears only after it. Both ends and the exit corridor are reserved from later placement. The level must be unsolvable with its wormholes stripped.
- The second wormhole, or a wormhole with no core, is decorative: ends go on cells some arrow's route passes through, kept only if the certificate still replays and loop validation passes.
- Placement failure drops the wormhole rather than restarting the level.
- Wormhole cells stay out of every flip region; region proofs are unchanged.
- Plan and core use their own seeded streams, so a level that draws zero wormholes is identical to today's layout. `GENERATOR_VERSION` stays 8. The v8 fixture is updated only for ids that gain a wormhole.

## Rendering

- Each end is a colored ring with an inner swirl. Both ends of one wormhole share a color, and each wormhole on a level has a unique color: wormhole 1 orange, wormhole 2 deep blue (distinct from the cyan chevrons). Colors live in the theme palette as `wormhole: [orange, blue]`.
- Each end carries four direction dots, one per face-local side, in four colors distinct from every other mechanic color. End B's dot pattern is end A's turned half a revolution, so the dot a head crosses entering one end has the same color as the dot it crosses leaving the other, in both directions.
- The ribbon splits at the portal: the part entering A shrinks into A while the part leaving B grows out of it at the same world-space speed. The head glyph jumps to B at the matching travel fraction. An arrow keeps its own color in transit.
- `render_game_to_text` reports each wormhole's id, ends, and color index.

## Storage

`CONTENT_VERSION` becomes 13. Path validation accepts consecutive cells that are adjacent or form a real wormhole jump (A→B or B→A); any other jump is rejected. Existing fingerprint-based refresh handles levels whose layout changed.

## Testing

- `tests/wormhole.test.ts`: jump and heading mapping for every face pair and for same-face ends; collision at B and at the cell after B with rewind through the portal; travel over the arrow's own body through a portal; stop and spot after an end; doubles and groups in transit; validator rejections (overlapping cells, end on arrow start / stop / spot, a third wormhole, portal loops under flip states).
- `tests/wormhole-content.test.ts`: level 35 solvable, unsolvable without wormholes, walkthrough gating, preview selector.
- `tests/wormhole-generation.test.ts`: sweep 36–200 for frequency and caps, core required-use, loop validation, flip-region disjointness, and fingerprint parity for zero-wormhole levels.
- `tests/storage.test.ts`: forged jumps rejected; a parked arrow straddling a portal survives reload.
- Palette test: the two wormhole colors differ from each other and from every other mechanic color.
- `tests/wormhole-browser.ts` (`WORMHOLE_ONLY=1 make browser-test`): level-35 walkthrough, split ribbon mid-jump, blocked exit costing one life with rewind, reload mid-level, and a generated two-wormhole level showing two distinct ring colors.
- Docs: CLAUDE.md, README, tutorial copy.
