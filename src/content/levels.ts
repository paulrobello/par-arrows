import type { Cell, FaceId, LevelDefinition } from "../core/types";
import { CAMPAIGN_LAYOUTS } from "./campaign-layouts";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

// Kept byte-for-byte stable so the compatible Level 1 save migration can resume it.
const LEVEL_ONE: LevelDefinition = {
  id: 1,
  title: "Cube 1",
  gridSize: 4,
  lives: 5,
  arrows: [
    { id: "l1-front-clear", path: [cell("front", 2, 0), cell("front", 3, 0)] },
    { id: "l1-back-clear", path: [cell("back", 2, 0), cell("back", 3, 0)] },
    { id: "l1-right-clear", path: [cell("right", 2, 0), cell("right", 3, 0)] },
    { id: "l1-left-clear", path: [cell("left", 2, 0), cell("left", 3, 0)] },
    { id: "l1-top-clear", path: [cell("top", 2, 0), cell("top", 3, 0)] },
    {
      id: "l1-bottom-clear",
      path: [cell("bottom", 2, 0), cell("bottom", 3, 0)],
    },
  ],
};

export const LEVELS: readonly LevelDefinition[] = [
  LEVEL_ONE,
  ...CAMPAIGN_LAYOUTS,
];

export const DEMO_BLOCKED_ID = "demo-blocked";
export const DEMO_SUCCESS_ID = "demo-success";

/** Small independent onboarding fixture: fail visibly, then remove its blocker. */
export const DEMO_LEVEL: LevelDefinition = {
  id: 0,
  title: "First Flight",
  gridSize: 4,
  lives: 2,
  arrows: [
    { id: DEMO_BLOCKED_ID, path: [cell("front", 0, 1), cell("front", 1, 1)] },
    { id: DEMO_SUCCESS_ID, path: [cell("front", 2, 1), cell("front", 3, 1)] },
    { id: "demo-clear", path: [cell("front", 0, 2), cell("front", 1, 2)] },
  ],
};
