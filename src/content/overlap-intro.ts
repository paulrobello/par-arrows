import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/** First hands-on example of shared tails, atomic group motion, and retry. */
export const OVERLAP_INTRO_LEVEL: LevelDefinition = {
  id: 15,
  title: "Cube 15",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  arrows: [
    {
      id: "overlap-intro-pair-a",
      path: [
        cell("front", 0, 1),
        cell("front", 1, 1),
        cell("front", 1, 0),
        cell("front", 2, 0),
      ],
    },
    {
      id: "overlap-intro-pair-b",
      path: [
        cell("front", 0, 1),
        cell("front", 1, 1),
        cell("front", 1, 2),
        cell("front", 2, 2),
      ],
    },
    {
      id: "overlap-intro-blocker",
      path: [cell("front", 3, 0), cell("front", 3, 1)],
    },
    {
      id: "overlap-intro-trio-a",
      path: [
        cell("left", 0, 1),
        cell("left", 1, 1),
        cell("left", 1, 0),
        cell("left", 2, 0),
      ],
    },
    {
      id: "overlap-intro-trio-b",
      path: [
        cell("left", 0, 1),
        cell("left", 1, 1),
        cell("left", 1, 2),
        cell("left", 2, 2),
      ],
    },
    {
      id: "overlap-intro-trio-c",
      path: [cell("left", 0, 1), cell("left", 1, 1), cell("left", 2, 1)],
    },
  ],
};
