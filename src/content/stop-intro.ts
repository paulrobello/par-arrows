import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/**
 * First hands-on example of a stop circle. The three front-face arrows form a
 * deadlock: the parker blocks the freed arrow, the freed arrow blocks the
 * blocker, and the blocker sits on the parker's lane past the circle. Parking
 * the parker on the circle is the only opening move, which is exactly the
 * lesson. Clearing the same cube with `stops: []` is impossible.
 */
export const STOP_INTRO_LEVEL: LevelDefinition = {
  id: 5,
  title: "Cube 5",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  stops: [cell("front", 2, 1)],
  arrows: [
    {
      id: "stop-intro-parker",
      path: [cell("front", 0, 1), cell("front", 1, 1)],
    },
    {
      id: "stop-intro-freed",
      path: [cell("front", 0, 3), cell("front", 0, 2)],
    },
    {
      id: "stop-intro-blocker",
      path: [
        cell("front", 3, 1),
        cell("front", 3, 2),
        cell("front", 2, 2),
        cell("front", 1, 2),
      ],
    },
    { id: "stop-intro-back", path: [cell("back", 2, 0), cell("back", 3, 0)] },
    {
      id: "stop-intro-right",
      path: [cell("right", 2, 0), cell("right", 3, 0)],
    },
    { id: "stop-intro-top", path: [cell("top", 2, 0), cell("top", 3, 0)] },
  ],
};
