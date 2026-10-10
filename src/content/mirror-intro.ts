import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/** Two perpendicular approaches share one mirror and a release dependency.
 * North reflects east; the long body leaves; east then reflects north. */
export const MIRROR_INTRO_LEVEL: LevelDefinition = {
  id: 55,
  title: "Cube 55",
  gridSize: 5,
  lives: 5,
  arrowScale: 1,
  mirrors: [{ cell: cell("front", 2, 2), orientation: "/" }],
  arrows: [
    {
      id: "mirror-intro-north",
      path: [cell("front", 1, 4), cell("front", 2, 4), cell("front", 2, 3)],
    },
    {
      id: "mirror-intro-release",
      path: [
        cell("front", 2, 1),
        cell("front", 3, 1),
        cell("front", 4, 1),
        cell("right", 0, 1),
        cell("right", 0, 2),
        cell("right", 0, 3),
        cell("front", 4, 3),
        cell("front", 4, 4),
        cell("front", 3, 4),
      ],
    },
    {
      id: "mirror-intro-east",
      path: [cell("front", 0, 3), cell("front", 0, 2), cell("front", 1, 2)],
    },
  ],
};
