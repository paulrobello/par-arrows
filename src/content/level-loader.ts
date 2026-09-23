import type { LevelDefinition } from "../core/types";
import { LEVEL_ONE } from "./intro";
import { DOUBLE_INTRO_LEVEL } from "./double-intro";

interface GenerateRequest {
  readonly type: "generate";
  readonly requestId: number;
  readonly levelId: number;
}

interface GenerateSuccess {
  readonly type: "generated";
  readonly requestId: number;
  readonly level: LevelDefinition;
}

interface GenerateFailure {
  readonly type: "failed";
  readonly requestId: number;
  readonly error: string;
}

type GenerateResponse = GenerateSuccess | GenerateFailure;

interface PendingRequest {
  readonly resolve: (level: LevelDefinition) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: number;
}

const CACHE_LIMIT = 3;
const GENERATION_TIMEOUT_MS = 12_000;

/** Resolves deterministic campaign levels without blocking the interactive view. */
export class LevelLoader {
  private readonly cache = new Map<number, LevelDefinition>([
    [1, LEVEL_ONE],
    [25, DOUBLE_INTRO_LEVEL],
  ]);
  private readonly pending = new Map<number, PendingRequest>();
  private worker: Worker | undefined;
  private nextRequestId = 1;
  private disposed = false;

  load(levelId: number): Promise<LevelDefinition> {
    if (this.disposed) {
      return Promise.reject(new Error("Level loader has been disposed."));
    }
    if (!Number.isSafeInteger(levelId) || levelId < 1) {
      return Promise.reject(new Error("Cube number is not valid."));
    }
    const cached = this.cache.get(levelId);
    if (cached) {
      this.cache.delete(levelId);
      this.cache.set(levelId, cached);
      return Promise.resolve(cached);
    }
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    return new Promise<LevelDefinition>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        const error = new Error(
          "Preparing this cube took too long. Please retry.",
        );
        reject(error);
        this.resetWorker();
        this.rejectPending(error);
      }, GENERATION_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timeout });
      const request: GenerateRequest = { type: "generate", requestId, levelId };
      worker.postMessage(request);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.rejectPending(new Error("Level loader has been disposed."));
    this.worker?.terminate();
    this.worker = undefined;
    this.cache.clear();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(
      new URL("./generation-worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    worker.addEventListener("message", this.handleMessage);
    worker.addEventListener("error", this.handleWorkerError);
    worker.addEventListener("messageerror", this.handleWorkerError);
    this.worker = worker;
    return worker;
  }

  private readonly handleMessage = (
    event: MessageEvent<GenerateResponse>,
  ): void => {
    const response = event.data;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    window.clearTimeout(pending.timeout);
    if (response.type === "failed") {
      pending.reject(new Error(response.error));
      return;
    }
    this.remember(response.level);
    pending.resolve(response.level);
  };

  private readonly handleWorkerError = (): void => {
    this.rejectPending(new Error("Could not prepare this cube. Please retry."));
    this.resetWorker();
  };

  private remember(level: LevelDefinition): void {
    this.cache.delete(level.id);
    this.cache.set(level.id, level);
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined || oldest === 1) {
        const next = [...this.cache.keys()].find((id) => id !== 1);
        if (next === undefined) return;
        this.cache.delete(next);
      } else {
        this.cache.delete(oldest);
      }
    }
  }

  private resetWorker(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
