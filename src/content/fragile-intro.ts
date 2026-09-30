import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/**
 * The first fragile cell. Two lanes share the cracked bridge at front(1, 1):
 * the crosser runs north over it, and the double's head end runs west over
 * it. Whichever crosses first passes clean and the bridge collapses behind
 * it, so the other lane now ends in a hole. The double's tail end is the way
 * round, but it runs west into the crosser's body, so the crosser must go
 * first; sending the double's head across first leaves the crosser nothing
 * but the hole and costs a life. One filler arrow per remaining face, off
 * both lanes.
 */
export const FRAGILE_INTRO_LEVEL: LevelDefinition = {
  id: 45,
  title: "Cube 45",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  fragile: [cell("front", 1, 1)],
  arrows: [
    {
      id: "fragile-intro-crosser",
      path: [cell("front", 1, 3), cell("front", 1, 2)],
    },
    {
      id: "fragile-intro-double",
      kind: "double",
      path: [
        cell("front", 2, 2),
        cell("front", 3, 2),
        cell("front", 3, 1),
        cell("front", 2, 1),
      ],
    },
    {
      id: "fragile-intro-back",
      path: [cell("back", 1, 1), cell("back", 2, 1)],
    },
    {
      id: "fragile-intro-left",
      path: [cell("left", 1, 2), cell("left", 2, 2)],
    },
    { id: "fragile-intro-top", path: [cell("top", 1, 1), cell("top", 2, 1)] },
    {
      id: "fragile-intro-bottom",
      path: [cell("bottom", 1, 2), cell("bottom", 2, 2)],
    },
  ],
};
