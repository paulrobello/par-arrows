import type { Endpoint, MoveKind } from "./core/types";

export type TutorialAdvance =
  | {
      kind: "move";
      arrowIds: readonly string[];
      endpoint?: Endpoint;
      outcomes?: readonly MoveKind[];
    }
  | { kind: "won" };

export interface TutorialStep {
  readonly copy: string;
  readonly highlightId?: string;
  readonly advance: TutorialAdvance;
}

export interface TutorialScript {
  readonly levelId: number;
  readonly title: string;
  readonly steps: readonly TutorialStep[];
}

export const SCRIPTED_LEVEL_IDS: readonly number[] = [
  1, 5, 11, 15, 20, 25, 30, 35,
];

const LEVEL_ONE_SCRIPT: TutorialScript = {
  levelId: 1,
  title: "Find the open way.",
  steps: [
    {
      copy: "Tap an arrow with a clear lane and it flies off the cube. Lanes can be blocked, though — tap this one to see what happens.",
      highlightId: "l1-front-blocked",
      advance: { kind: "move", arrowIds: ["l1-front-blocked"] },
    },
    {
      copy: "It rebounded and turned red, and that collision cost a life. Only a first collision costs — retries are free. Clear the way: tap the arrow blocking it.",
      highlightId: "l1-front-blocker",
      advance: {
        kind: "move",
        arrowIds: ["l1-front-blocker"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "The lane is open. Send the red arrow off.",
      highlightId: "l1-front-blocked",
      advance: {
        kind: "move",
        arrowIds: ["l1-front-blocked"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "Clear the remaining arrows to finish the cube.",
      advance: { kind: "won" },
    },
  ],
};

const STOP_INTRO_SCRIPT: TutorialScript = {
  levelId: 5,
  title: "Park it.",
  steps: [
    {
      copy: "Green circles are parking spots. An arrow that reaches one stops there instead of flying off, and parking is free. Tap this arrow.",
      highlightId: "stop-intro-parker",
      advance: {
        kind: "move",
        arrowIds: ["stop-intro-parker"],
        outcomes: ["paused"],
      },
    },
    {
      copy: "Parked. Its tail was blocking this arrow — parking freed the lane. Tap it.",
      highlightId: "stop-intro-freed",
      advance: {
        kind: "move",
        arrowIds: ["stop-intro-freed"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "This one sits across the parker's lane past the circle. Clear it.",
      highlightId: "stop-intro-blocker",
      advance: {
        kind: "move",
        arrowIds: ["stop-intro-blocker"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "Tap the parked arrow to send it on its way.",
      highlightId: "stop-intro-parker",
      advance: {
        kind: "move",
        arrowIds: ["stop-intro-parker"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "Clear the remaining arrows.",
      advance: { kind: "won" },
    },
  ],
};

const WRAP_INTRO_SCRIPT: TutorialScript = {
  levelId: 11,
  title: "Ride the yellow edge.",
  steps: [
    {
      copy: "Yellow edges don't end a flight — they carry the arrow onto the neighboring face. Tap this arrow and watch it wrap.",
      highlightId: "wrap-intro-front",
      advance: {
        kind: "move",
        arrowIds: ["wrap-intro-front"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "Wrapped. Other yellow edges work the same way — clear the remaining arrows.",
      advance: { kind: "won" },
    },
  ],
};

const OVERLAP_INTRO_SCRIPT: TutorialScript = {
  levelId: 15,
  title: "Fly together.",
  steps: [
    {
      copy: "These arrows share a tail: they fly as one group. The group's lane is blocked, though. Tap the blocker to clear the way.",
      highlightId: "overlap-intro-blocker",
      advance: {
        kind: "move",
        arrowIds: ["overlap-intro-blocker"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "Now tap any part of the group — head, body, or shared tail. Every member launches together.",
      highlightId: "overlap-intro-pair-a",
      advance: {
        kind: "move",
        arrowIds: ["overlap-intro-pair-a", "overlap-intro-pair-b"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "A trio waits on the left face — same rule. Clear the whole cube.",
      highlightId: "overlap-intro-trio-a",
      advance: { kind: "won" },
    },
  ],
};

const DIRECTIONAL_INTRO_SCRIPT: TutorialScript = {
  levelId: 20,
  title: "Mind the chevrons.",
  steps: [
    {
      copy: "Cyan chevrons bend the road. Any arrow that reaches one turns onto the chevron's heading. Tap this arrow and watch it turn.",
      highlightId: "dir-intro-east",
      advance: {
        kind: "move",
        arrowIds: ["dir-intro-east"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "The east arrow's body was blocking this one. With it gone, the lane is open. Tap it.",
      highlightId: "dir-intro-freed",
      advance: {
        kind: "move",
        arrowIds: ["dir-intro-freed"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "The long arrow was blocked by the freed one. Clear it.",
      highlightId: "dir-intro-blocker",
      advance: {
        kind: "move",
        arrowIds: ["dir-intro-blocker"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "Chevrons turn every arrow that passes them — use them to dodge trouble. Clear the remaining arrows.",
      advance: { kind: "won" },
    },
  ],
};

export const DOUBLE_INTRO_SCRIPT: TutorialScript = {
  levelId: 25,
  title: "Choose a direction.",
  steps: [
    {
      copy: "Each colored half chooses which head moves. Tap the violet half to send this arrow toward its tail and open the lane.",
      highlightId: "double-intro-choice",
      advance: {
        kind: "move",
        arrowIds: ["double-intro-choice"],
        endpoint: "tail",
        outcomes: ["exit"],
      },
    },
    {
      copy: "The blocker is free. Clear it, then finish the cube.",
      highlightId: "double-intro-blocker",
      advance: {
        kind: "move",
        arrowIds: ["double-intro-blocker"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "Two-headed arrows can move in either direction. Clear the remaining arrows.",
      advance: { kind: "won" },
    },
  ],
};

const FLIP_INTRO_SCRIPT: TutorialScript = {
  levelId: 30,
  title: "Read the flip.",
  steps: [
    {
      copy: "Magenta spots flip. An arrow that runs into one head-on turns around and travels back over itself. Tap this arrow.",
      highlightId: "flip-intro-reverser",
      advance: {
        kind: "move",
        arrowIds: ["flip-intro-reverser"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "The spot flipped once that arrow had fully passed. Now it would turn the other arrow into this one, so clear this one first.",
      highlightId: "flip-intro-guard",
      advance: {
        kind: "move",
        arrowIds: ["flip-intro-guard"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "The lane is open. Send this arrow through the spot.",
      highlightId: "flip-intro-runner",
      advance: {
        kind: "move",
        arrowIds: ["flip-intro-runner"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "Every pass flips the spot again. Clear the remaining arrows.",
      advance: { kind: "won" },
    },
  ],
};

const WORMHOLE_INTRO_SCRIPT: TutorialScript = {
  levelId: 35,
  title: "Use the rings.",
  steps: [
    {
      copy: "Paired rings join two faces: a head entering one comes out of the matching ring, still heading the same way. Tap this arrow to ride it.",
      highlightId: "wormhole-intro-portal",
      advance: {
        kind: "move",
        arrowIds: ["wormhole-intro-portal"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "This arrow was aimed at the one that just left, so neither could move first. With it gone through the rings, this lane is clear. Tap it.",
      highlightId: "wormhole-intro-gate",
      advance: {
        kind: "move",
        arrowIds: ["wormhole-intro-gate"],
        outcomes: ["exit"],
      },
    },
    {
      copy: "Every ring pair works the same way. Clear the remaining arrows.",
      advance: { kind: "won" },
    },
  ],
};

const SCRIPTS: readonly TutorialScript[] = [
  LEVEL_ONE_SCRIPT,
  STOP_INTRO_SCRIPT,
  WRAP_INTRO_SCRIPT,
  OVERLAP_INTRO_SCRIPT,
  DIRECTIONAL_INTRO_SCRIPT,
  DOUBLE_INTRO_SCRIPT,
  FLIP_INTRO_SCRIPT,
  WORMHOLE_INTRO_SCRIPT,
];

export function scriptForLevel(levelId: number): TutorialScript | undefined {
  return SCRIPTS.find((script) => script.levelId === levelId);
}

/**
 * Steps through one level's script. Moves matching a later step jump the
 * runner forward, so resumed boards replay cleanly instead of stalling on
 * steps whose moment has passed.
 */
export class TutorialRunner {
  readonly levelId: number;

  private index = 0;

  constructor(private readonly script: TutorialScript) {
    this.levelId = script.levelId;
  }

  get done(): boolean {
    return this.index >= this.script.steps.length;
  }

  get stepIndex(): number {
    return this.index;
  }

  get current(): TutorialStep {
    const steps = this.script.steps;
    const step = steps[Math.min(this.index, steps.length - 1)];
    if (!step) throw new Error("Tutorial script has no steps.");
    return step;
  }

  /**
   * Arrow ids the current step accepts taps for, or undefined once the
   * script is finished or reaches its final free-play "won" step.
   */
  get gateTarget():
    | { readonly arrowIds: ReadonlySet<string>; readonly endpoint?: Endpoint }
    | undefined {
    if (this.done) return undefined;
    const advance = this.current.advance;
    if (advance.kind === "won") return undefined;
    return {
      arrowIds: new Set(advance.arrowIds),
      ...(advance.endpoint ? { endpoint: advance.endpoint } : {}),
    };
  }

  get gate(): ReadonlySet<string> | undefined {
    return this.gateTarget?.arrowIds;
  }

  /** Skips steps whose every named arrow has already left the board. */
  attach(remainingIds: readonly string[]): void {
    const remaining = new Set(remainingIds);
    while (!this.done) {
      const advance = this.current.advance;
      if (
        advance.kind !== "move" ||
        advance.arrowIds.some((id) => remaining.has(id))
      ) {
        return;
      }
      this.index += 1;
    }
  }

  onMove(result: {
    arrowId: string;
    endpoint?: Endpoint;
    kind: MoveKind;
  }): void {
    let i = this.index;
    for (const step of this.script.steps.slice(this.index)) {
      const advance = step.advance;
      if (
        advance.kind === "move" &&
        advance.arrowIds.includes(result.arrowId) &&
        this.matches(advance, result.kind, result.endpoint)
      ) {
        this.index = i + 1;
        return;
      }
      i += 1;
    }
  }

  onWon(): void {
    let i = this.index;
    for (const step of this.script.steps.slice(this.index)) {
      if (step.advance.kind === "won") {
        this.index = i + 1;
        return;
      }
      i += 1;
    }
    this.index = this.script.steps.length;
  }

  private matches(
    advance: Extract<TutorialAdvance, { kind: "move" }>,
    kind: MoveKind,
    endpoint?: Endpoint,
  ): boolean {
    if (kind === "invalid") return false;
    if (advance.endpoint !== undefined && advance.endpoint !== endpoint) {
      return false;
    }
    return advance.outcomes ? advance.outcomes.includes(kind) : true;
  }
}
