import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/** The turner releases a contact body and advances the rotor; then the
 * body releases the second approach. No reciprocal head-only pair. */
export const ROTOR_INTRO_LEVEL: LevelDefinition = {
  id: 40,
  title: "Cube 40",
  gridSize: 6,
  lives: 5,
  arrowScale: 1,
  directionals: [{ cell: cell("front", 3, 2), heading: "west", kind: "rotor" }],
  arrows: [
    {
      id: "rotor-intro-turner",
      path: [cell("front", 0, 2), cell("front", 1, 2), cell("front", 2, 2)],
    },
    {
      id: "rotor-intro-release",
      path: [
        cell("front", 4, 2),
        cell("front", 4, 3),
        cell("front", 4, 4),
        cell("front", 3, 4),
        cell("front", 2, 4),
        cell("front", 1, 4),
        cell("front", 1, 3),
      ],
    },
    {
      id: "rotor-intro-bender",
      path: [cell("right", 1, 2), cell("right", 0, 2), cell("front", 5, 2)],
    },
  ],
};
