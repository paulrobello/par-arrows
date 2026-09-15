# Arrow complexity reference study

Study date: 2026-09-14. Current content inspected at commit `9d3c8f8`, including the live level-10 board. This is a visual assessment and corrected authoring guidance; gameplay and level data are unchanged.

## Current mismatch

The density revision emphasized arrow count and bend count while retaining repeated geometry and regular bands. A long path with 24 alternating bends can still be a repeated pattern. It does not necessarily resemble the varied paths in the references.

Of level 10's 90 arrows, 87 stay on a single face. Those 87 use only eight distinct geometric footprints when translation, rotation, reflection, and traversal reversal are ignored. Length remains part of the footprint. Three wrapped arrows are excluded from this comparison.

| Repeated footprint | Copies |
| --- | --- |
| 12-cell S shape | 29 |
| 4-cell straight line | 29 |
| 2-cell straight line | 9 |
| 26-cell repeating winder | 7 |
| 20-cell repeating winder | 5 |
| Two other 6-cell bend shapes | 4 and 3 |
| 8-cell straight line | 1 |

The S shape accounts for 29 of the 48 multi-bend arrows. The S shapes and two repeating winders occupy 630 of the board's 890 path cells. Their repeated placement creates the dominant stripes visible across the cube.

## What the references show

- F1 — **Uneven runs within a path.** Long runs alternate with short offsets, compact hooks, and turns placed at different intervals. In [reference 01](reference-01.jpeg), the center-left route combines a long near-vertical section with short steps near its lower end.
- F2 — **Different overall footprints.** Paths occupy compact areas, broad L-shaped regions, large returning bends, and irregular winding regions. In [reference 04](reference-04.jpeg), the outer right route has long boundary-following runs around a broad corner, while the upper-center routes have compact clusters of turns. More bends are not automatically more visually complex.
- F3 — **Neighboring paths fit around each other.** Broad returning paths sit beside smaller paths that fill the intervening spaces. [Reference 04](reference-04.jpeg) has nested bends and short arrows among long paths; [reference 03](reference-03.jpeg) mixes close parallel stretches with routes that depart into other parts of the face. The arrangement does not resolve into repeated columns or uniform three-row blocks.
- F4 — **Heads and tails are distributed through the face.** Directions, endpoint positions, and route extents vary together. The lower half of [reference 04](reference-04.jpeg) has heads pointing in several directions inside the face. Reversing a stamped shape changes its direction but leaves its repeated footprint visible.

These are observations of the supplied images, not claims about the source game's generation algorithm. Some parallel runs and repeated simple shapes are present. Their frequency and arrangement do not dominate the composition as they do in the current game. Apparent projection crossings do not imply permitted overlap, branching, or overpasses.

## Criteria for the next content revision

- A1 — Author a mixture of route footprints with different aspect ratios and irregular run-length and turn sequences. Include simple short arrows and long paths with few turns as well as compact and extended winding paths.
- A2 — Arrange routes together across each face and its seams. Let paths occupy spaces around neighboring routes instead of reserving repeated rectangular bands or full-height narrow strips.
- A3 — Measure duplicate footprints after rotation/reflection normalization, plus repeated turn/run sequences and endpoint clustering. Count changes, mirrored copies, or changing which end has the head do not establish sufficient new shape variety.
- A4 — Inspect the whole board beside the references, especially level 2 and a late level. Repeating face-wide stripes or a dominant S footprint fail the visual review even when density, bend totals, and solvability tests pass.
- A5 — Retain the existing rules: simple level 1, flat ribbons, varied straight lengths, static body wraps, no overlaps or self-contact, and complete solutions with meaningful removal dependencies. Yellow-edge head continuation remains a separate future mechanic.

The corrective direction is to replace the repeated band templates with irregular paths composed around one another. Adding more copies or making a repeating staircase longer does not address the observed mismatch.
