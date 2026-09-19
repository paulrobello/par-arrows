import type { LevelDefinition } from "../core/types";
import { CAMPAIGN_LAYOUTS } from "./campaign-layouts";
import { LEVEL_ONE } from "./intro";

export { LEVEL_ONE } from "./intro";

export const LEVELS: readonly LevelDefinition[] = [
  LEVEL_ONE,
  ...CAMPAIGN_LAYOUTS,
];
