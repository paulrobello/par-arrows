import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/**
 * The first rotor. The turner runs east into the west-pointing rotor
 * head-on, reverses back over its own body and leaves; once its last cell
 * has left, the rotor turns a quarter clockwise to point north. The bender
 * enters the front face across the right seam heading west; with the rotor
 * pointing west it would run straight on into the turner, and with the rotor
 * turned it bends north and exits. Without the rotor the two face each other
 * across its cell and deadlock.
 */
export const ROTOR_INTRO_LEVEL: LevelDefinition = {
  id: 40,
  title: "Cube 40",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  directionals: [{ cell: cell("front", 2, 1), heading: "west", kind: "rotor" }],
  arrows: [
    {
      id: "rotor-intro-turner",
      path: [cell("front", 0, 1), cell("front", 1, 1)],
    },
    {
      id: "rotor-intro-bender",
      path: [cell("right", 1, 1), cell("right", 0, 1), cell("front", 3, 1)],
    },
  ],
};
