import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/**
 * The first key and gate. The opener sits ready at the left edge of row 1
 * with a short, empty lane east, but a barred gate stands in it at
 * front(2, 1). The key arrow is the long bent one that looks boxed in: its
 * lane runs north up column 3 over the key at front(3, 0), crossing the
 * opener's lane past the gate. Sent first, it opens the gate for good and
 * the opener follows it off; sent second, the opener only rewinds off the
 * gate, which costs nothing. With the lock stripped the opener could simply
 * leave first. One filler arrow per remaining face, off both lanes.
 */
export const LOCK_INTRO_LEVEL: LevelDefinition = {
  id: 50,
  title: "Cube 50",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  locks: [
    {
      id: "lock-intro",
      key: cell("front", 3, 0),
      lock: cell("front", 2, 1),
    },
  ],
  arrows: [
    {
      id: "lock-intro-opener",
      path: [cell("front", 0, 1), cell("front", 1, 1)],
    },
    {
      id: "lock-intro-key",
      path: [
        cell("front", 1, 3),
        cell("front", 2, 3),
        cell("front", 3, 3),
        cell("front", 3, 2),
      ],
    },
    {
      id: "lock-intro-back",
      path: [cell("back", 1, 1), cell("back", 2, 1)],
    },
    {
      id: "lock-intro-left",
      path: [cell("left", 1, 2), cell("left", 2, 2)],
    },
    { id: "lock-intro-top", path: [cell("top", 1, 1), cell("top", 2, 1)] },
    {
      id: "lock-intro-bottom",
      path: [cell("bottom", 1, 2), cell("bottom", 2, 2)],
    },
  ],
};
