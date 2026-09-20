import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/**
 * A sparse first encounter with directional spots, built on the level-5
 * deadlock: the east arrow is blocked by the blocker's tail, the freed arrow
 * is blocked by the east arrow's body, and the blocker is blocked by the
 * freed arrow's head. The chevron spot bends the east arrow off the lane and
 * out of the cube, so without the spot nothing on the front face can ever
 * move. The freed and blocker arrows then clear in sequence.
 */
export const DIRECTIONAL_INTRO_LEVEL: LevelDefinition = {
  id: 20,
  title: "Cube 20",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  directionals: [{ cell: cell("front", 2, 1), heading: "north" }],
  arrows: [
    { id: "dir-intro-east", path: [cell("front", 0, 1), cell("front", 1, 1)] },
    { id: "dir-intro-freed", path: [cell("front", 0, 3), cell("front", 0, 2)] },
    {
      id: "dir-intro-blocker",
      path: [
        cell("front", 3, 1),
        cell("front", 3, 2),
        cell("front", 2, 2),
        cell("front", 1, 2),
      ],
    },
    { id: "dir-intro-back", path: [cell("back", 1, 1), cell("back", 2, 1)] },
    { id: "dir-intro-right", path: [cell("right", 1, 1), cell("right", 2, 1)] },
    { id: "dir-intro-top", path: [cell("top", 1, 1), cell("top", 2, 1)] },
  ],
};
