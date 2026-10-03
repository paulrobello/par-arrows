import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/**
 * First cube doubles as the interactive tutorial: the front face holds a
 * deliberately blocked pair, the walkthrough taps the blocked arrow first to
 * teach collisions, and the pair is the whole cube.
 */
export const LEVEL_ONE: LevelDefinition = {
  id: 1,
  title: "Cube 1",
  gridSize: 4,
  lives: 5,
  arrows: [
    {
      id: "l1-front-blocked",
      path: [cell("front", 0, 1), cell("front", 1, 1)],
    },
    {
      id: "l1-front-blocker",
      path: [cell("front", 2, 1), cell("front", 3, 1)],
    },
  ],
};

/** A sparse first encounter with the reciprocal front-left wrap seam. */
export const WRAP_INTRO_LEVEL: LevelDefinition = {
  id: 11,
  title: "Cube 11",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  edgePolicies: [
    {
      face: "front",
      edge: "west",
      policy: "continue",
      neighbor: { face: "left", entering: "west" },
    },
    {
      face: "left",
      edge: "east",
      policy: "continue",
      neighbor: { face: "front", entering: "east" },
    },
  ],
  arrows: [
    {
      id: "wrap-intro-front",
      path: [cell("front", 1, 1), cell("front", 0, 1)],
    },
    { id: "wrap-intro-left", path: [cell("left", 2, 2), cell("left", 3, 2)] },
  ],
};
