import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/**
 * The first wormhole. The portal arrow heads east along the front face and
 * its lane ahead ends on ring end A; the gate enters the front face across
 * the right seam heading west, wraps over the top of the face and comes down
 * on column 1 facing the portal's head. Without the rings the two arrows
 * deadlock: the portal's lane ends on the gate's body at front(3, 2), the
 * gate's lane on the portal at front(1, 2). Through the rings, the portal
 * enters A, leaves B heading east and flies off; that vacates front(1, 2),
 * so the gate runs south and exits too. End B sits on the right face's top
 * row; the far blocker stands in the corridor cell east of B and leaves
 * north first, so the far end starts blocked like the near one.
 */
export const WORMHOLE_INTRO_LEVEL: LevelDefinition = {
  id: 35,
  title: "Cube 35",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  wormholes: [{ id: "w1", a: cell("front", 2, 2), b: cell("right", 2, 0) }],
  arrows: [
    {
      id: "wormhole-intro-portal",
      path: [cell("front", 0, 2), cell("front", 1, 2)],
    },
    {
      id: "wormhole-intro-gate",
      path: [
        cell("right", 0, 2),
        cell("front", 3, 2),
        cell("front", 3, 1),
        cell("front", 3, 0),
        cell("front", 2, 0),
        cell("front", 1, 0),
        cell("front", 1, 1),
      ],
    },
    {
      id: "wormhole-intro-far",
      path: [cell("right", 3, 1), cell("right", 3, 0)],
    },
  ],
};
