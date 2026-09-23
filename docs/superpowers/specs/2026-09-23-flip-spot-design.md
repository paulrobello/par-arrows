# Flip Spots and Spot Entry Rules

Date: 2026-09-23
Status: Approved design (D1–D8, 2026-09-23), awaiting spec review

## Problem

Directional spots are static and only ever bend a head that arrives from the
side. The owner wants a second spot kind whose direction reverses each time an
arrow passes through it, so a lane that is safe now can become a collision
after another arrow flips the spot, and the reverse. The owner also set the
entry rules for every spot and the rule that arrows never collide with
themselves.

Two constraints from the owner bound the design:

- No collision-free move may ever make a level unwinnable. Only collisions cost
  lives. (Recorded 2026-09-23; enforced for stop circles by content 11.)
- Hints stay free and unlimited until V1.

## Goals and non-goals

Goals:

1. Apply the owner's entry rules to both spot kinds and remove self-collision.
2. Add flip spots with the owner's timing: a spot flips only after the arrow
   has finished passing through it, and a collision undoes only flips that
   actually happened.
3. Keep every level winnable from every collision-free state, proven by
   enumeration where flip spots appear.
4. Introduce flip spots in authored level 30 and generate them from level 31.
5. Replace hand-maintained lists of changed levels with a per-save layout
   fingerprint.

Non-goals:

- Flip spots are never load-bearing for solvability (see "Generation"). They
  change which arrow is safe now, never whether the level can be cleared.
- Hint limits (V1).
- Changing any existing generated layout that does not gain a flip core.

## Player rules

Every spot, static or flip, has a current direction. When an arrow's head
enters a spot cell:

| Head travelling | Result |
| --- | --- |
| The spot's direction | Passes straight through |
| Opposite the spot's direction | Reverses and travels back the way it came |
| Either side | Bends onto the spot's direction |

After the rule applies, a flip spot reverses its direction (north ↔ south,
east ↔ west) once the arrow has finished passing through it, meaning at the
moment no cell of that arrow remains on the spot. Static spots never change.

- **Arrows never collide with themselves.** A reversing head travels back over
  its own body. Only other arrows block.
- **One passage, one flip.** A head that re-enters a spot while its own body is
  still on it continues the same passage, so the spot flips once when the arrow
  finally clears it.
- **Parking holds a flip.** An arrow that parks on a stop circle with part of
  its body on a flip spot leaves that flip pending. It fires when the arrow
  later moves off the spot, on whichever move that is.
- **Collisions undo exactly what happened.** On a collision the arrow rewinds to
  its starting cells and every spot returns to its direction at the start of
  the move:
  - an arrow still on the spot when it collides never flipped it, so nothing
    is undone;
  - a spot the arrow fully cleared before colliding flipped and flips back;
  - an arrow that began the move parked on a spot rewinds onto it and its flip
    stays pending;
  - the rebound itself never flips anything.
- **Occupied spots block.** Another arrow entering a spot cell while an arrow
  sits on it is an ordinary collision.
- Lives, red failure marks and repeated-failure rules are unchanged.

## Core model

### Spot kinds and state

```ts
interface DirectionalSpotDefinition {
  readonly cell: Cell;
  readonly heading: Heading;          // starting direction
  readonly kind?: "static" | "flip";  // default "static"
}

interface GameState {
  // ...existing fields
  /** Current direction of each flip spot, keyed by cellKey; absent = authored heading. */
  readonly spotHeadings?: Readonly<Record<string, Heading>>;
}
```

`spotHeadingAt(level, cell)` gains a state-aware form that reads
`spotHeadings` first. Static-spot lookups keep their cached map.

Pending flips need no stored state. Validation already forbids a spot on any
arrow's starting cell, so any arrow resting on a flip spot entered it during an
earlier move, and the flip fires when that arrow's body next leaves the cell.

### Movement

`simulateSingle` changes in three places:

1. Delete the "Move contacted its own moving body" rejection. Occupancy is
   built from other arrows only, as it already is.
2. The heading after entering a spot is the spot's current heading (the
   existing `spotHeadingAt(level, next) ?? forward.heading` line, made
   state-aware). This single rule yields pass-through, reversal and bend.
3. Track flips as the body advances. At each step the tail cell that leaves the
   board position is checked: if it was a flip-spot cell and no remaining body
   cell occupies it, that spot flips now, affecting any later entry in the same
   move. `MoveResult` gains `spotFlips: readonly { cell: Cell; step: number }[]`
   so the renderer can turn each glyph on the exact frame.

A collision result discards `spotFlips` from the settled state (the move is
rewound) but keeps them in the trace so the renderer can turn glyphs back
during the rebound. `applyMove` writes `spotHeadings` only for `exit` and
`paused` results.

Loop safety: the visited-state key becomes `(head cell, heading, spot
headings)`. A repeated key returns `invalid` with no life cost, as today.
Generation and validation reject any level where a tap could loop (see
"Validation").

### Where an arrow is

Single arrows keep numeric `offsets` only on levels without flip spots. On a
level with any flip spot, every parked single arrow stores its exact cells in
`settledPaths`, the model already used for parked double arrows, because a
route that depends on spot state cannot be reconstructed from an offset.
`arrowTrack`, `maximumOffset` and `currentPath` stay correct for spot-free and
static-spot levels, where tracks are still fixed.

### Solver and stranding check

`solveKey` includes `spotHeadings` and settled paths. `hasStrandingState`
enumerates spot state with everything else. `targetsFor`, `clearWhatExits` and
`searchSolution` are unchanged in shape.

## Validation

- `selfContactError` is replaced by a loop check: for each endpoint, simulate
  the arrow alone from the starting spot state and from each reachable flip
  state of the spots its route crosses; any repeated
  `(cell, heading, spot headings)` key rejects the level.
- A flip spot may not sit on a stop circle, another spot, or an arrow's
  starting cell (the last two already apply to static spots).
- No arrow may park folded back over its own body: a stop circle is rejected
  if, under any reachable spot state, an arrow reaching it would hold the same
  cell twice. Settled paths therefore stay free of self-overlap, which keeps
  the existing unique-cell checks on saved paths valid.
- A flip spot's route set must be enumerable: every arrow whose track, under
  any flip state, crosses a flip spot must belong to the flip core (see
  "Generation"). Authored levels are checked the same way.
- Saved `spotHeadings` must name only flip spots and hold a heading on that
  spot's axis.

## Generation

### Safety argument

A flip spot cannot make a level require its flip: each arrow leaves a flip spot
along its current direction, so the first arrow through proves that route is
clear. What a flip spot can do is change which arrow is safe right now. Safety
therefore comes from containment plus enumeration:

- All flip spots live inside one small **flip core** (3–5 arrows) placed on its
  own seeded stream, like the parking and directional cores.
- Every track any core arrow can take, under every flip state, is reserved from
  later placement. No non-core arrow's track, under any state, touches a flip
  spot or a core arrow's reachable cells.
- `hasStrandingState` on the isolated core must return `false` (every
  collision-free order clears it). Because nothing outside the core interacts
  with it, the whole level inherits the property, and the existing reverse
  certificate still covers the non-core arrows.

### Required interest

A core is accepted only if some arrow in it is safe with the spot in one state
and a collision with the spot in the other, both states being reachable
without a collision. This is checked from the core's enumerated state graph.
Cores that would be decorative are rejected, not placed.

### Catalog and progression

- Three core patterns on a new `:flip-core` stream, chosen from a
  `:flip-plan` stream: **gate** (one arrow bends through the spot and flips it
  away from a second arrow's lane), **bounce** (one arrow enters head-on,
  reverses back out and flips the spot for a second arrow), and **relay** (two
  sequential passes, so the third arrow's safety depends on how many arrows
  have passed).
- Frequency: 0 before level 31, then 0.25 at level 31 rising linearly to 0.50
  at level 70 and holding (`flipCoreFrequency(id)`).
- Placement exhaustion omits the core rather than rejecting the level.
- A level that gains no flip core must be byte-identical to today's layout.
  New streams are independent of all existing streams, and the flip core is
  placed after every existing core so it only removes candidate cells that
  would otherwise be unused.
- Stop circles are not placed where an arrow would park folded back over its
  own body (the validation rule above), which keeps parked ribbons readable.

### Authored introduction

Level 30 becomes an authored 4 × 4 teaching cube (`FLIP_INTRO_LEVEL`,
`src/content/flip-intro.ts`), added to `AUTHORED_LEVEL_IDS` and
`SCRIPTED_LEVEL_IDS`. It uses the bounce pattern: one arrow points straight at
the flip spot, reverses back out along its own body, and flips the spot, which
opens the exit for a second arrow. The walkthrough rotates to each highlighted
arrow and gates input as the existing walkthroughs do. `?feature=flip` opens it
in preview mode without touching campaign saves. The seed string is
`par-arrows:runtime:7:level:30:flip-intro:1`.

`GENERATOR_VERSION` stays 7 so levels without a flip core keep their seeds.

## Rendering and input

- Flip spot glyph: a filled dot followed by one chevron (⏺>), in magenta
  (`flip: 0xc0266d` light, `0xff6fb5` dark), a colour no other element uses.
  The dot distinguishes it from the two-chevron static spot without relying on
  colour.
- The glyph rotates 180° over 150 ms on the frame its `spotFlips` entry fires,
  and back again on the matching rebound frame. Reduced motion snaps.
- A reversing arrow's ribbon is drawn folded back over itself during motion; the
  moving half renders above the resting half so the head stays visible.
- `render_game_to_text` reports each flip spot's current heading and any
  pending flip.
- Picking, hints and pick preference use the state-aware simulation, so a hint
  never points at an arrow whose safety depends on a flip it has not seen.

## Storage and migration

Replace hand-maintained changed-level lists with a layout fingerprint:

- `saveCampaign` writes `layout: sha1(JSON.stringify(level))`, truncated to 16
  hex characters, for the current level.
- `loadCampaign` resumes an attempt only when the stored fingerprint equals the
  fingerprint of the level it resolves. A mismatch refreshes the attempt while
  keeping unlocks and tutorial completion, as today.
- Saves written before this release have no fingerprint. A content-11 save
  resumes only when the resolved level contains no flip spot and is not level
  30. That test needs no list of level ids, because generation guarantees that
  a level without a flip core is byte-identical to its content-11 layout (the
  hash sweep over 2–200 verifies this). Everything else refreshes, and the
  next save writes a fingerprint.
- `CONTENT_VERSION` becomes 12 because `GameState` gains `spotHeadings` and
  flip levels store single-arrow settled paths.
- Preview sessions never write campaign saves.

## Testing and verification

Core unit tests:

- Entry rules for both spot kinds: pass-through, bend, reversal back over the
  arrow's own body with no self-collision.
- Flip timing: a spot flips only when the arrow's last cell leaves it; a
  reversing arrow flips it once; an arrow parked on a spot leaves the flip
  pending until it moves off.
- Collision before the arrow clears the spot: spot unflipped. Collision after
  clearing: spot restored. Collision by an arrow that started parked on the
  spot: flip still pending. Rebound frames mirror forward frames.
- Loop detection returns `invalid` with no life cost; validation rejects a
  level that can loop.
- `spotHeadings` round-trips through `applyMove`, the solver key and storage;
  malformed values refresh safely.

Content and generation:

- `FLIP_INTRO_LEVEL` is valid, solvable, has zero stranding states, and is
  unsolvable if its flip spot is made static in its starting direction.
- Every generated flip core in 31–200 has zero stranding states and passes the
  required-interest check. No non-core track touches a core's reachable cells.
- Hash sweep: every level in 2–200 without a flip core is byte-identical to
  the pre-change baseline, except level 30.
- Existing solver, certificate and density tests keep passing.

Browser (headed, `FLIP_ONLY=1` focused mode plus the full sweep):

- Flip intro walkthrough, glyph turns on the correct frame, rebound restore,
  reversal ribbon visibility, hint correctness after a flip, reload mid-level
  with a flipped spot and a pending flip.

## Documentation updates

README, CLAUDE.md (new "Flip spots" section, spot entry rules, save
fingerprint), PRD (replace R18's self-contact rejection with "arrows never
collide with themselves"; note in R17 that a moving arrow may pass back over
its own body while settled arrows never overlap themselves; add the flip-spot
requirement and level-30 intro).

## Risks

- **Stranding through interaction.** Mitigated by containment plus core
  enumeration. The validation rule that every arrow crossing a flip spot belongs
  to the core is the enforcement point.
- **Readability of folded ribbons.** A reversing arrow overlaps itself on
  screen. Mitigated by render order and by avoiding folded parks.
- **Generation cost.** Core enumeration is bounded (3–5 arrows, two-state spots)
  and runs only on levels that draw a flip core.
- **Removing self-collision** changes a rule tested today
  (`tests/directional.test.ts` "a 180-degree redirect into the arrow's own body
  is invalid and free"). That test is rewritten to assert the reversal.
