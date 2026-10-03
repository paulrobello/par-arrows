import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/**
 * First leap lesson: a closed gate bars the leaper's lane, and the pad throws
 * the head over the barred cell onto the gate's key, which opens the barred
 * arrow's lane. Stripped of the pad, the gate is terrain nobody can pass, the
 * key behind it is unreachable, and the cube deadlocks.
 */
export const LEAP_INTRO_LEVEL: LevelDefinition = {
  id: 60,
  title: "Cube 60",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  leaps: [cell("front", 1, 1)],
  locks: [
    {
      id: "leap-intro-lock",
      key: cell("front", 1, 3),
      lock: cell("front", 1, 2),
    },
  ],
  arrows: [
    {
      id: "leap-intro-leaper",
      path: [
        cell("top", 1, 1),
        cell("top", 1, 2),
        cell("top", 1, 3),
        cell("front", 1, 0),
      ],
    },
    {
      id: "leap-intro-barred",
      path: [cell("front", 0, 3), cell("front", 0, 2)],
    },
  ],
};
