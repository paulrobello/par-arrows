import { planDelete, type DeletePlan } from "./core/delete-arrow";
import type { GameState, LevelDefinition, MoveTarget } from "./core/types";

export interface DeleteRequest {
  readonly level: LevelDefinition;
  readonly state: GameState;
  readonly target: MoveTarget;
}

self.onmessage = (event: MessageEvent<DeleteRequest>): void => {
  let plan: DeletePlan;
  try {
    plan = planDelete(event.data.level, event.data.state, event.data.target);
  } catch {
    plan = {
      eligible: false,
      reason: "This removal could not be checked. Choose another",
    };
  }
  self.postMessage(plan);
};
