import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/** First mirror lesson: one silver mirror, two arrows, two destinations. */
export const MIRROR_INTRO_LEVEL: LevelDefinition = {
  id: 55,
  title: "Cube 55",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  mirrors: [{ cell: cell("front", 1, 1), orientation: "/" }],
  arrows: [
    // Face-off pair around the mirror: each straight lane ends on the other's
    // head, so only the reflection clears them, and the same mirror routes
    // the two approaches to two different edges.
    {
      id: "mirror-intro-north",
      path: [cell("front", 1, 3), cell("front", 1, 2)],
    },
    {
      id: "mirror-intro-south",
      path: [
        cell("top", 1, 1),
        cell("top", 1, 2),
        cell("top", 1, 3),
        cell("front", 1, 0),
      ],
    },
  ],
};
