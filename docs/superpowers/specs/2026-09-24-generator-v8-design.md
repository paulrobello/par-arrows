# Generator V8: Interaction Regions and Unleashed Reversal

Date: 2026-09-24
Status: Implemented (2026-09-24). The body is unchanged as the approved design
record. Deviations:

1. Ids 2-10 keep their legacy seeds and layouts; only generated ids from 12 up
   re-roll.
2. Every generated region equals its flip core: no outside arrow's track
   reaches a core in practice, so closure adds no arrows.
3. One flip core per level carries one or two flip spots (relay2 has two),
   not one to three.
4. Groups on spot cubes: the group is placed first and its tracks are reserved
   against every later spot placer, rather than `overlapStarter` seeing the
   spots. `flipRegionLead` rejects a region holding a group member.
5. Resume compares layout fingerprint and seed on content 12 and ignores the
   stored generator version.
6. Accepted spot-density drop: when extra or reversal spots break the
   assembled level, it falls back to its core-only spot set, so some cubes
   carry fewer static spots than planned. A follow-up (2026-09-25) keeps the
   longest prefix of the optional spots that still replays instead, raising
   static spots over ids 2-200 from 684 to 724 (914 planned); only ids 22, 67,
   80, 84, 105, 122, 153, 164, 195 and 198 changed layout.
8. Shape cap (2026-09-25): from level 12 the fill and blocker passes skip a
   candidate whose canonical shape already has `shapeCap(arrowCount)` copies.
   The 72 ids from 12 to 200 that exceeded the cap changed layout, and every
   other id is unchanged. Static spots over 2-200 read 716 afterwards.
9. Spot plan gap (2026-09-25): extra spots now keep every traverser's bent
   route off the flip region's cells, as reversal spots already did. Before,
   a flip pass whose extras bent a traverser into the region failed
   `flipRegionLead` and trimmed its extras, often to none. Static spots over
   2-200 rose from 716 to 760 of 914 planned; 19 ids changed layout. The
   rest is accepted: 138 planned slots on otherwise accepted levels find no
   candidate that survives vetting, which is a candidate-pool limit rather
   than a replay failure.
10. Fill heads off reserved cells (2026-09-25): `candidate` let a fill or
    blocker arrow's head sit on the directional core's reserved exit corridor,
    because the corridor is exempt for the ray. That dooms the core's first
    arrow in the certificate replay and wasted the restart. Heads may no
    longer sit on any reserved cell; static spots over 2-200 read 767, the
    2-200 sweep runs faster, and 53 ids changed layout.
11. Both turns (2026-09-25): an extra spot candidate whose seeded
    perpendicular turn fails vetting now tries the other turn before the
    next candidate. Static spots over 2-200 read 778; 96 ids changed layout,
    none losing a spot or an arrow. The rest of the gap (136 of 914) is the
    candidate-pool limit: measured after this change, reversal placement ran
    out of plain arrows with 139 slots of room left and hit its one-or-two cap
    with only 6 left, and removing the cap placed no additional spot.
7. Park-with-pending-flip puzzles shipped in a follow-up (2026-09-25). As
   first implemented, a region circle was kept only when parking moved no body
   onto another arrow's track, which ruled out any park covering a flip spot.
   `flipCore` now tries circles whose park leaves a flip pending first, relying
   on the region's enumeration for safety; 24 of 92 flip levels in 31-200
   reach such a park. The headed check parks level 76's west arrow over its
   spot, reloads with the flip pending, and fires it on resume.

## Problem

The game is unreleased, so nothing constrains generated layouts to stay stable.
The v7 generator treats arrows-passing-over-themselves as a hazard to contain
rather than a mechanic to use: flip cores live behind a footprint-isolation rule
that forbids stops and parking inside flip areas, closes off park-with-pending-
flip puzzles, caps flip density at one spot per level in tier 1 only, and rejects
overlap groups on any spot cube. Migration code accumulated three hand-maintained
resume ladders (content 9, 10, 11) that exist purely to protect old layouts.

Owner's standing constraints that survive: no collision-free move may ever make a
level unwinnable (only collisions cost lives); hints stay free and unlimited
until V1.

## Goals and non-goals

Goals:

1. One campaign re-roll (`GENERATOR_VERSION` 8) that makes reversal and
   self-passing deliberate generator content.
2. Replace footprint isolation with bounded whole-region enumeration so stops,
   parking and multiple flip spots can coexist, proven strand-free.
3. Overlap groups on spot cubes (never routing through spots).
4. Delete every legacy save-resume ladder; keep only the layout fingerprint.

Non-goals: new player-facing rules (everything here uses shipped rules);
authored levels 1, 5, 11, 15, 20, 25, 30 (layouts and seeds unchanged); hint
limits (V1); level-id range or difficulty-curve shape changes beyond what the
re-roll forces.

## Interaction regions (the safety mechanism)

An interaction region is 3-6 arrows, the flip spots and stop circles any of them
can reach under any spot state, and every arrow whose track crosses that area,
closed under reachability until stable.

Per region, run the existing state enumerator (`hasStrandingState`, which already
includes spot state) on the region as a mini-level where outside arrows are
static blockers — a conservative over-approximation, since an outside arrow can
only block, never move or flip. Require all of:

- zero stranded states (this subsumes the fold rule inside regions and closes
  the known fold-check coverage gap by construction);
- `flipInterest` true — the flip changes which arrow is safe right now;
- solvability by the existing greedy/certificate logic.

Outside the regions, arrows keep the reverse-construction certificate. The level
is safe by composition: region closure means no outside track enters a region,
and placement reserves region cells before other arrows are placed.

Enumeration overflow (state space over the limit): shrink the region by moving
the offending stop or spot and re-derive, or drop the flip spot and fall back to
today's isolated core. Never ship an unproven region.

Regions are bounded (<= 6 arrows, <= 3 flip spots); enumeration is seconds-bounded
in the existing web worker and replaces the current core-only enumeration rather
than adding to it.

## Generator v8 content and placement

- **Version and re-roll.** `GENERATOR_VERSION` 8. Every generated id re-rolls
  once; authored ids keep their pinned seeds and layouts. Deterministic per seed.
- **Reversal blockers.** Head-on static spots that bounce an arrow back along
  its own body into a lane another arrow needs. Placed after cores wherever the
  reversed exit ray is clear; validated by the existing loop check.
- **Bounce park cores.** New `PARK_PATTERNS` entries where the parker reaches
  its circle through a reversal (a head-on spot between start and circle). The
  `parkingCore` replay already proves arbitrary routes.
- **Flip chains.** `FLIP_PATTERNS` gains a two-spot relay where one arrow bends
  through both spots in sequence; a third arrow's safety depends on both states.
  Per level: 1-3 flip spots, one region.
- **Frequency.** `flipCoreFrequency` cap rises from 0.50 to 0.65 by level 90 and
  holds. Region placement tries every generation tier, falling back to isolated
  cores or nothing on exhaustion (the tier-1-only restriction is dropped).
- **Groups + spots.** The all-spots shared-tail rejection is dropped in the
  generator; `overlapStarter` may run on spot cubes, but member routes avoid
  every spot cell. Validation keeps rejecting a group whose members' future
  routes cross a spot cell (a group's shared offset is unsound on a
  spot-dependent track).
- **Curves.** `blockedTarget`, arrow counts and the acceptance gates (full
  density, blocked share, solver-validated) are unchanged; the re-roll changes
  which levels need the blocker top-up pass. Pinned hash tests re-pin once to
  the v8 baseline.
- **Untouched:** tier structure, certificate replay, seam/wrap generation,
  `strandSafeCircle` for decorative circles outside regions, authored levels,
  all player rules.

## Saves

The shipped fingerprint mechanism stays: `saveCampaign` writes `layout`;
content-12 saves resume only on an exact fingerprint match. Delete the legacy
ladder — `isUnchangedLevel`, `isUnchangedSinceContentNine`,
`isUnchangedSinceContentTen`, `CONTENT_ELEVEN_LAYOUTS`, and the generator-version
backflips in `hasMatchingGeneratorMetadata`. Any older or layout-mismatched save
refreshes once, keeping unlocks and tutorial completion. `CONTENT_VERSION` stays
12 (no state-shape change). Net: roughly 150 lines of migration code deleted;
future layout changes cost zero migration work.

## Testing and verification

- Unit: region extraction and proof (closure property, conservative-blocker
  soundness, overflow fallback); reversal-blocker and bounce-park validity; the
  chain pattern enumerated; groups-with-spots validator behavior; save matrix
  (v12 + matching fingerprint resumes; everything else refreshes with unlocks
  kept; no legacy paths remain).
- Sweep: regenerate ids 2-200 — every level valid, solver-cleared, at full
  density, blocked share on curve, regions proven, groups never route through
  spots. Commit the v8 hash baseline as the new pin.
- Browser: existing suites plus `FLIP_ONLY=1`; one new headed check that a
  stop-inside-region level parks and resumes with the pending flip visible.

## Documentation updates

CLAUDE.md (generation and seeds section: v8, interaction regions, groups with
spots), README.md (version sentence), PRD (R-sections where isolation and
migration ladder are described), and the spec's status note records the v7
deviations this supersedes.

## Risks

- **Enumeration cost.** Bounded regions keep it seconds-scale in the worker;
  overflow falls back rather than loops. Measured in the sweep.
- **Blocked-share drift after the re-roll.** The top-up pass absorbs it; the
  sweep re-measures against the same curve.
- **The re-roll itself.** Pre-release, the only saves in the wild are the
  owner's test devices; they refresh once keeping unlocks.
