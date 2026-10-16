import { afterEach, beforeEach, expect, test } from "bun:test";
import { DeletePlanner } from "../src/delete-planner";
import { LEVEL_ONE } from "../src/content/intro";
import { createGameState } from "../src/core/game-state";
import type { DeletePlan } from "../src/core/delete-arrow";

const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | undefined;
  onerror: ((event: Event) => void) | undefined;
  onmessageerror: ((event: Event) => void) | undefined;
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
  respond(data: unknown) {
    this.onmessage?.({ data });
  }
}
beforeEach(() => {
  FakeWorker.instances = [];
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: FakeWorker,
  });
});
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "Worker", original);
  else Reflect.deleteProperty(globalThis, "Worker");
});
const target = { arrowId: "l1-front-blocked", endpoint: "head" } as const;
const worker = () => {
  const value = FakeWorker.instances.at(-1);
  if (!value) throw new Error("Expected worker");
  return value;
};
test("cancellation terminates proof work and ignores a late response", async () => {
  const planner = new DeletePlanner();
  const first = planner.plan(LEVEL_ONE, createGameState(LEVEL_ONE), target);
  const old = worker();
  planner.cancel();
  expect((await first).eligible).toBe(false);
  expect(old.terminated).toBe(true);
  const second = planner.plan(LEVEL_ONE, createGameState(LEVEL_ONE), target);
  const current = worker();
  old.respond({ eligible: true, certificate: [] });
  expect(current.terminated).toBe(false);
  const plan: DeletePlan = { eligible: false, reason: "Unproved" };
  current.respond(plan);
  expect(await second).toEqual(plan);
  expect(current.terminated).toBe(true);
});
test("worker errors and malformed replies fail closed", async () => {
  const planner = new DeletePlanner();
  let pending = planner.plan(LEVEL_ONE, createGameState(LEVEL_ONE), target);
  worker().onerror?.(new Event("error"));
  expect((await pending).eligible).toBe(false);
  pending = planner.plan(LEVEL_ONE, createGameState(LEVEL_ONE), target);
  worker().respond({ eligible: true, certificate: null });
  expect((await pending).eligible).toBe(false);
});
test("an unresponsive proof worker is terminated at the deadline", async () => {
  const planner = new DeletePlanner(1);
  const pending = planner.plan(LEVEL_ONE, createGameState(LEVEL_ONE), target);
  const current = worker();
  expect((await pending).eligible).toBe(false);
  expect(current.terminated).toBe(true);
});
