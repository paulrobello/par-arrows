import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/**
 * The first flip spot. The reverser enters the south-pointing spot head-on,
 * reverses back over its own body and leaves; the spot flips north once its
 * last cell has left. The runner was blocked by the reverser; now it would
 * turn north into the guard, so the player reads the flipped spot, clears
 * the guard, and the runner turns north and leaves, flipping the spot back.
 */
export const FLIP_INTRO_LEVEL: LevelDefinition = {
  id: 30,
  title: "Cube 30",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  directionals: [{ cell: cell("front", 1, 1), heading: "south", kind: "flip" }],
  arrows: [
    {
      id: "flip-intro-reverser",
      path: [cell("front", 1, 3), cell("front", 1, 2)],
    },
    {
      id: "flip-intro-guard",
      path: [cell("front", 0, 0), cell("front", 1, 0)],
    },
    {
      id: "flip-intro-runner",
      path: [cell("front", 3, 1), cell("front", 2, 1)],
    },
    { id: "flip-intro-back", path: [cell("back", 1, 1), cell("back", 2, 1)] },
    {
      id: "flip-intro-right",
      path: [cell("right", 1, 1), cell("right", 2, 1)],
    },
    { id: "flip-intro-left", path: [cell("left", 1, 2), cell("left", 2, 2)] },
    { id: "flip-intro-top", path: [cell("top", 1, 1), cell("top", 2, 1)] },
    {
      id: "flip-intro-bottom",
      path: [cell("bottom", 1, 2), cell("bottom", 2, 2)],
    },
  ],
};
