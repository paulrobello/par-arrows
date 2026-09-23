# Two-Headed Directional Arrows

Date: 2026-09-22
Status: Implemented, pending final delivery verification

## Problem

Every current arrow has one active head, so tapping any exposed part has one
meaning. The next mechanic adds a deliberate directional choice: one logical
arrow has two heads, and the colored half the player selects determines which
head advances. A wrong choice remains a real move and can cost a life even when
the opposite direction is clear.

The repository already carries dormant support for `kind: "double"`, the
`Endpoint` type, endpoint-aware movement results, reverse-path validation, and
basic endpoint simulation. The shipped input, renderer, parked-state model,
solver, generator, storage, tutorials, and tests still assume one selectable
head. This design completes that vertical slice without representing one arrow
as two linked entities.

## Goals and non-goals

Goals:

1. Make each half of a two-headed arrow a distinct, readable move target.
2. Preserve deterministic core movement across seams, wrapping edges, stops,
   directional spots, collisions, rewinds, parking, and exits.
3. Let a parked two-headed arrow resume in either direction.
4. Introduce the mechanic in authored level 25 and generate required-use cases
   from level 26 onward.
5. Preserve campaign progress safely across the content change.

Non-goals:

- Double arrows never join overlapping-tail groups.
- Existing authored levels 1–20 do not change.
- Existing single arrows keep their one-way offset representation and behavior.
- This work does not create a generic mechanic framework or configurable color
  system.

## Player rules

- A two-headed arrow has one head at each end and one logical identity.
- Its two halves use a consistent violet/lime pair. Selecting a half moves the
  arrow toward that half's head.
- Choosing a blocked half produces the normal collision even if the opposite
  half could move safely.
- The first collision by that arrow at a settled position costs one life. The
  failure exemption is shared by both endpoints at that position. If the arrow
  later parks at a different position, that position receives its own first
  paid failure.
- On collision, the arrow rewinds to the path it occupied when the attempt
  began. Both directional colors stay visible and a red outline or glow marks
  the whole arrow as failed at that settled position.
- A stop circle parks whichever selected head reaches it. The parked arrow may
  then resume toward either head.
- A cyan directional spot bends the selected moving head. The violet and lime
  colors remain attached to their respective heads through movement and bends.
- A successful exit in either direction removes the whole arrow.
- A double arrow is independent and cannot be part of a shared-tail group.
- A hint pulses only the safe half and its head, not the whole arrow.

## Move identity and core state

### Endpoint-aware move target

Use one canonical value throughout input, application, tutorials, hints, solver
certificates, and animation:

```ts
interface MoveTarget {
  readonly arrowId: string;
  readonly endpoint: Endpoint;
}
```

Single arrows always produce `endpoint: "head"`. Double arrows produce the
endpoint belonging to the selected half. `PickCandidate`, safe-move callbacks,
selection state, tutorial expectations, and hint focus carry `MoveTarget`
instead of a bare arrow ID.

The existing `ArrowDefinition.kind`, `Endpoint`, and endpoint on `MoveResult`
remain the domain vocabulary. The feature extends those types rather than
adding linked pseudo-arrows.

### Settled path, not signed displacement

A signed integer is insufficient after a directional spot bends one endpoint:
the two future routes can branch and a later reverse cannot reconstruct the
occupied cells from an authored-path offset alone. Therefore:

- Single arrows keep the existing positive numeric offset in `GameState.offsets`.
- A parked double arrow stores its complete settled `Cell[]` path in a dedicated
  state map keyed by arrow ID.
- An unparked double arrow uses its authored path and needs no stored entry.
- Simulation starts from the stored settled path when present, reverses it for a
  tail-endpoint attempt, and applies topology and directional spots from the
  selected active head.
- A paused result carries the complete settled path produced by that move.
  `applyMove` installs it atomically.
- Blocked and invalid results never alter the settled path. Exit deletes all
  state associated with the arrow.

The stored path is logical occupancy, not renderer geometry. Validation must
prove that it has the original arrow length, consists of valid adjacent cells,
contains no duplicates, and is reachable through a settled move sequence for
the matching level.

### Position-scoped failure history

Replace the double-arrow use of the global `failedIds` exemption with a
position-aware key derived from arrow ID plus the exact settled-path cell-key
sequence. Both endpoints share that key. A collision checks and records the key
for the attempt's starting path.

Existing single-arrow and overlap-group failure semantics remain unchanged.
Storage may use a general failure-key collection internally, but migration must
preserve every existing single/group exemption exactly.

## Movement interactions

The selected endpoint determines path orientation for the entire attempt.
Movement then retains the existing rules:

- occupancy is evaluated against every other remaining arrow's current path;
- an ordinary boundary exits;
- a yellow continuation edge crosses the cube seam;
- a cyan spot replaces the moving head's heading on entry;
- self-contact and continuation cycles are invalid content;
- a blocker returns `blocked` with contact trace;
- a stop returns `paused` with the new settled path;
- collision rewind uses the complete attempt-start path.

Validation checks self-contact independently from both endpoints of every double
arrow. A double arrow must not share a directed tail link with another arrow,
and overlap derivation must always return it as a one-member unit.

The solver's action space becomes endpoint-aware. It considers one action for a
single arrow and two for an active double arrow. Its visited-state key includes
parked double-arrow paths and position-scoped failure keys. The existing policy
of greedily clearing and only backtracking over meaningful choices must expand
to include double-arrow endpoint choices.

## Rendering and input

### Color and shape

Use a theme-specific, consistent pair chosen to remain distinct from green/teal
stops, cyan spots, yellow wraps, red failures, and blue selection:

| Theme | Violet half | Lime half |
| --- | --- | --- |
| Light | `#6D28D9` | `#4D7C0F` |
| Dark | `#C084FC` | `#A3E635` |

Color is reinforced by a visible arrowhead at each endpoint. Direction never
relies on color alone.

Split the rendered ribbon by accumulated distance along the full expanded
surface path, not by authored cell count or screen-space bounds. The split is at
50 percent of visual path length. Each side includes its endpoint head. If the
midpoint crosses a cell or rendered ribbon segment, divide that geometry at the
exact midpoint so violet and lime meet without a dead zone.

### Picking and ranking

Each head and ribbon segment carries both `arrowId` and `endpoint` in picker
metadata. Direct hits preserve the exact endpoint. Nearby touch candidates
measure distance to each half independently and return endpoint-aware
`PickCandidate` values.

Keep the existing ranking rules at move-target granularity:

1. Any direct hit excludes widened nearby hits.
2. Among remaining candidates, a safe endpoint beats an unsafe endpoint.
3. Distance settles every other case.

At the shared midpoint boundary, both halves may be candidates at the same
distance. Deterministic tie-breaking uses the picker hit order for a direct hit
and a fixed endpoint order for a mathematically exact nearby tie. There is no
middle dead zone.

Selection and tutorial gating identify one `MoveTarget`. Hints pulse only that
half. Animation consumes the selected endpoint's `MoveResult`, including parked
resume, bend, seam crossing, collision rewind, and exit traces.

Failure does not replace the violet/lime materials. Add a red outline or glow to
the complete visual while the current position's failure key exists. Moving to
a new parked position removes that position's failed styling until it fails
there.

## Authored introduction and progression

Level 25 is an authored introduction cube. Its layout must teach the mechanic by
requiring selection of the non-default tail direction before the level can be
cleared. The walkthrough rotates the cube as needed, highlights the correct
half, gates input to that `MoveTarget`, and explains that either colored half
chooses a direction.

`?feature=double` opens level 25 in preview mode without reading, writing, or
clearing campaign progress. Level 25 receives a pinned authored seed string.
Existing authored levels 1, 5, 11, 15, and 20 and protected generated levels
remain unchanged.

Generated double arrows begin at level 26. Levels may still contain none. Any
generated level that contains one must have a replayable certificate proving
that at least one double arrow is moved from its tail endpoint in the solution.
A double arrow never participates in generated overlap starters or groups.

## Generation

Add a bounded double-arrow insertion pass to procedural construction. Candidate
requirements:

- both endpoint paths are structurally valid through the selected wrapping
  topology and directional spots;
- neither endpoint can contact its own moving body;
- the static path does not overlap another arrow;
- future routes satisfy the existing route-crossing and occupancy constraints;
- the candidate is not connected to an overlap group;
- the construction certificate remains replayable; and
- at least one selected candidate is certified as requiring a tail-endpoint
  action in the final solution.

Use a dedicated seeded stream for double-arrow planning and placement so retries
in unrelated passes do not perturb the mechanic. Generation remains bounded and
retains the existing degradation guarantee: if the optional double-arrow pass
cannot produce a valid required-use case, omit double arrows for that cube
rather than throw or accept decorative use.

Bump `GENERATOR_VERSION` for generated levels 12 and above. Pin level 25 to its
own authored seed. The implementation plan must freeze the exact stream names,
frequency ramp, and affected geometry hashes after measuring generation cost and
arrowing the smallest deterministic change.

## Storage and migration

Bump `CONTENT_VERSION` because level 25 and generated levels 26 onward change and
the saved game state gains parked double paths plus position-scoped failures.

- Existing positive offsets remain valid for single arrows.
- Existing attempts through protected unchanged levels resume under the current
  seed-metadata rules.
- Changed attempts refresh safely while preserving campaign level, unlocks,
  settings, and completed tutorials.
- A save containing a double arrow validates its settled path and failure keys
  against the exact level before restoration.
- Invalid, partial, or unreachable parked paths reject the attempt snapshot and
  use the established safe refresh path.
- Preview sessions, including `?feature=double`, never mutate campaign saves.

Because double arrows do not exist in older content, there is no legacy parked
double state to reinterpret.

## Testing and verification

### Core unit tests

- Head and tail endpoint exits on straight and seam-spanning paths.
- Wrong endpoint blocks and costs a life even when the other endpoint is safe.
- First failure is paid once per settled position and shared by both endpoints.
- Moving to a new parked position creates a fresh failure scope.
- Collision rewinds to authored and parked attempt-start paths.
- A stop reached from either endpoint stores the exact settled path.
- A parked arrow resumes toward either endpoint.
- Directional spots bend either selected head; reversing after a bend uses the
  stored settled path correctly.
- Yellow wrapping, self-contact, continuation cycles, and occupancy behave from
  both endpoints.
- Double arrows are rejected from overlap groups.
- Solver certificates include endpoint choices and clear required-use fixtures.

### Picking, rendering, and browser tests

- Direct hits on each head, each body half, and the midpoint choose the expected
  endpoint.
- Widened touch targets rank safe endpoint candidates and preserve direct hits.
- Violet/lime splitting follows accumulated visual distance across seams.
- Light and dark palettes keep both halves legible; both heads provide a
  non-color cue.
- Selection and hints affect only one half.
- Failure preserves both colors and marks the whole arrow red.
- Motion covers headward/tailward exit, park, resume, bend, blocked rewind, and
  cube rotation during animation.
- The level-25 walkthrough gates the expected endpoint and campaign progression
  continues 24 → 25 → 26.
- `DOUBLE_ONLY=1 make browser-test` provides the focused headed suite; the full
  suite also covers the introduction unless runtime requires the same explicit
  focused exception used by overlap.

### Generation and storage tests

- Generated cubes with double arrows require at least one tail-endpoint action.
- Generated double arrows never join overlap groups and pass both-end validation.
- Deterministic samples pin frequency, certificates, geometry hashes, maximum
  arrow count, and generation-time budgets.
- Save round trips preserve parked paths and position-scoped failures.
- Corrupt, partial, duplicate-cell, wrong-length, and unreachable paths refresh
  safely.
- Existing protected saves resume, while changed level-25-and-later attempts
  refresh with progress preserved.

Run `make checkall`, the focused double browser suite, and the adjacent stop,
directional, overlap, motion, picking, preview, storage, and campaign browser
coverage. WebKit verification is required for the focused suite because the
mechanic depends on fine segment picking and WebGL rendering.

## Documentation updates

The implementation updates `README.md` and `CLAUDE.md` with the shipped level,
mechanic rules, generation contract, storage version, and focused test command.
The PRD future-mechanic section is updated now with the approved contract so it
no longer specifies blue/green colors, solid-red replacement, an unresolved
midpoint, or unresolved endpoint failure semantics.

## Risks

- **State growth:** complete parked paths are larger than offsets. Only parked
  double arrows store them, and level paths are bounded by existing topology
  limits.
- **Solver branching:** two actions per double arrow expand search. Generated
  counts stay bounded and certificates provide the fast path.
- **Ambiguous midpoint input:** exact geometry splitting and deterministic ties
  avoid a dead zone, with browser tests at multiple rotations and pixel ratios.
- **Generator pressure:** two-end validity is stricter. The pass is optional,
  bounded, independently seeded, and omits the mechanic on exhaustion.
- **Color confusion:** the selected palette avoids existing mechanic colors,
  both themes provide separate values, and dual arrowheads carry direction
  without relying on color.
