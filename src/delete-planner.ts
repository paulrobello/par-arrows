import type { DeletePlan } from "./core/delete-arrow";
import type { GameState, LevelDefinition, MoveTarget } from "./core/types";

/** One cancellable proof job, with a deadline, and no main-thread search. */
export class DeletePlanner {
  private worker: Worker | undefined;
  private finish: ((plan: DeletePlan) => void) | undefined;

  constructor(private readonly timeoutMs = 5000) {}

  cancel(): void {
    this.finish?.({ eligible: false, reason: "Cancelled. No coins spent" });
  }

  plan(
    level: LevelDefinition,
    state: GameState,
    target: MoveTarget,
  ): Promise<DeletePlan> {
    this.cancel();
    return new Promise((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (plan: DeletePlan) => {
        if (this.finish !== finish) return;
        if (timeout !== undefined) clearTimeout(timeout);
        this.worker?.terminate();
        this.worker = undefined;
        this.finish = undefined;
        resolve(plan);
      };
      this.finish = finish;
      try {
        const worker = new Worker(
          new URL("./delete-worker.ts", import.meta.url),
          { type: "module" },
        );
        this.worker = worker;
        worker.onmessage = (event: MessageEvent<DeletePlan>) => {
          const plan = event.data;
          if (
            plan &&
            typeof plan === "object" &&
            typeof plan.eligible === "boolean" &&
            (plan.eligible
              ? Array.isArray(plan.certificate)
              : typeof plan.reason === "string")
          )
            finish(plan);
          else
            finish({
              eligible: false,
              reason: "This removal could not be checked",
            });
        };
        const fail = (event: Event) => {
          event.preventDefault();
          finish({
            eligible: false,
            reason: "This removal could not be checked. Try another arrow",
          });
        };
        worker.onerror = fail;
        worker.onmessageerror = fail;
        timeout = setTimeout(
          () =>
            finish({
              eligible: false,
              reason: "Safety check took too long. Choose another arrow",
            }),
          this.timeoutMs,
        );
        worker.postMessage({ level, state, target });
      } catch {
        finish({
          eligible: false,
          reason: "Safety checks are unavailable in this browser",
        });
      }
    });
  }
}
