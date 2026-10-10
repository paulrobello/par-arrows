import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/** A perpendicular bend releases a three-body cycle with interior contacts.
 * This lesson has its own routes rather than copying the parking introduction. */
export const DIRECTIONAL_INTRO_LEVEL: LevelDefinition = {
  id: 20,
  title: "Cube 20",
  gridSize: 6,
  lives: 5,
  arrowScale: 1,
  directionals: [{ cell: cell("front", 4, 3), heading: "east" }],
  arrows: [
    {
      id: "dir-intro-opener",
      path: [
        cell("front", 3, 2),
        cell("front", 3, 1),
        cell("front", 3, 0),
        cell("front", 4, 0),
        cell("front", 4, 1),
        cell("front", 4, 2),
      ],
    },
    {
      id: "dir-intro-blocker",
      path: [
        cell("front", 4, 4),
        cell("front", 3, 4),
        cell("front", 2, 4),
        cell("front", 1, 4),
        cell("front", 0, 4),
        cell("front", 0, 3),
      ],
    },
    {
      id: "dir-intro-freed",
      path: [cell("front", 0, 2), cell("front", 0, 1), cell("front", 1, 1)],
    },
  ],
};
