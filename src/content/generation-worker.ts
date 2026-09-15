import { generateLevel } from "./procedural";
import type { LevelDefinition } from "../core/types";

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

self.addEventListener("message", (event: MessageEvent<GenerateRequest>) => {
  const request = event.data;
  if (request.type !== "generate") return;
  try {
    const response: GenerateSuccess = {
      type: "generated",
      requestId: request.requestId,
      level: generateLevel(request.levelId),
    };
    self.postMessage(response);
  } catch (error) {
    const response: GenerateFailure = {
      type: "failed",
      requestId: request.requestId,
      error: error instanceof Error ? error.message : "Could not prepare cube.",
    };
    self.postMessage(response);
  }
});
