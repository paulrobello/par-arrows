import { describe, expect, test } from "bun:test";
import {
  SCRIPTED_LEVEL_IDS,
  TutorialRunner,
  scriptForLevel,
} from "../src/tutorial";

function runnerFor(levelId: number): TutorialRunner {
  const script = scriptForLevel(levelId);
  if (!script) throw new Error(`No tutorial script for level ${levelId}.`);
  return new TutorialRunner(script);
}

describe("tutorial scripts", () => {
  test("exposes the authored intro levels", () => {
    expect(SCRIPTED_LEVEL_IDS).toEqual([1, 5, 11, 15, 20, 25, 30, 35]);
    expect(scriptForLevel(2)).toBeUndefined();
    for (const levelId of SCRIPTED_LEVEL_IDS)
      expect(scriptForLevel(levelId)?.levelId).toBe(levelId);
  });
});

describe("level one runner", () => {
  test("walks blocked collision, blocker, then red arrow", () => {
    const runner = runnerFor(1);
    expect(runner.current.highlightId).toBe("l1-front-blocked");

    runner.onMove({ arrowId: "l1-front-blocked", kind: "blocked" });
    expect(runner.current.highlightId).toBe("l1-front-blocker");

    runner.onMove({ arrowId: "l1-front-blocker", kind: "exit" });
    expect(runner.current.highlightId).toBe("l1-front-blocked");

    runner.onMove({ arrowId: "l1-front-blocked", kind: "exit" });
    expect(runner.current.advance.kind).toBe("won");
    expect(runner.done).toBe(false);

    runner.onWon();
    expect(runner.done).toBe(true);
  });

  test("ignores arrows outside the script and invalid moves", () => {
    const runner = runnerFor(1);
    runner.onMove({ arrowId: "l1-back", kind: "exit" });
    expect(runner.stepIndex).toBe(0);
    runner.onMove({ arrowId: "l1-front-blocked", kind: "invalid" });
    expect(runner.stepIndex).toBe(0);
    runner.onMove({ arrowId: "l1-front-blocked", kind: "blocked" });
    expect(runner.stepIndex).toBe(1);
    runner.onMove({ arrowId: "l1-back", kind: "exit" });
    expect(runner.stepIndex).toBe(1);
  });

  test("jumps to the matching step when a later lesson's move happens first", () => {
    const runner = runnerFor(1);
    // Blocker cleared off-script: the next lesson is the freed red arrow.
    runner.onMove({ arrowId: "l1-front-blocker", kind: "exit" });
    expect(runner.stepIndex).toBe(2);
    expect(runner.current.highlightId).toBe("l1-front-blocked");
    runner.onMove({ arrowId: "l1-front-blocked", kind: "exit" });
    expect(runner.current.advance.kind).toBe("won");
  });
});

describe("stop intro runner", () => {
  test("requires the parked outcome, then the same arrow's exit", () => {
    const runner = runnerFor(5);

    runner.onMove({ arrowId: "stop-intro-parker", kind: "paused" });
    expect(runner.current.highlightId).toBe("stop-intro-freed");

    runner.onMove({ arrowId: "stop-intro-freed", kind: "exit" });
    expect(runner.current.highlightId).toBe("stop-intro-blocker");

    runner.onMove({ arrowId: "stop-intro-blocker", kind: "exit" });
    expect(runner.current.highlightId).toBe("stop-intro-parker");

    runner.onMove({ arrowId: "stop-intro-parker", kind: "exit" });
    expect(runner.current.advance.kind).toBe("won");
    runner.onWon();
    expect(runner.done).toBe(true);
  });

  test("an unmatched parker exit before any lesson jumps to the win step", () => {
    const runner = runnerFor(5);
    runner.onMove({ arrowId: "stop-intro-parker", kind: "exit" });
    expect(runner.current.advance.kind).toBe("won");
    expect(runner.done).toBe(false);
    runner.onWon();
    expect(runner.done).toBe(true);
  });

  test("a freed-blocker exit out of order still advances the chain", () => {
    const runner = runnerFor(5);
    runner.onMove({ arrowId: "stop-intro-parker", kind: "paused" });
    runner.onMove({ arrowId: "stop-intro-blocker", kind: "exit" });
    expect(runner.current.highlightId).toBe("stop-intro-parker");
  });
});

describe("wrap intro runner", () => {
  test("advances on the wrap arrow's exit and finishes on win", () => {
    const runner = runnerFor(11);
    expect(runner.current.highlightId).toBe("wrap-intro-front");
    runner.onMove({ arrowId: "wrap-intro-front", kind: "exit" });
    expect(runner.current.advance.kind).toBe("won");
    runner.onWon();
    expect(runner.done).toBe(true);
  });
});

describe("overlap intro runner", () => {
  test("walks blocker, group launch, then trio win", () => {
    const runner = runnerFor(15);
    expect(runner.current.highlightId).toBe("overlap-intro-blocker");

    runner.onMove({ arrowId: "overlap-intro-blocker", kind: "exit" });
    expect(runner.current.highlightId).toBe("overlap-intro-pair-a");

    // Any group member's launch satisfies the step, pair-b included.
    runner.onMove({ arrowId: "overlap-intro-pair-b", kind: "exit" });
    expect(runner.current.advance.kind).toBe("won");
    runner.onWon();
    expect(runner.done).toBe(true);
  });
});

describe("double intro runner", () => {
  test("requires the tail endpoint before advancing", () => {
    const runner = runnerFor(25);
    expect(runner.gateTarget).toEqual({
      arrowIds: new Set(["double-intro-choice"]),
      endpoint: "tail",
    });
    runner.onMove({
      arrowId: "double-intro-choice",
      endpoint: "head",
      kind: "blocked",
    });
    expect(runner.stepIndex).toBe(0);
    runner.onMove({
      arrowId: "double-intro-choice",
      endpoint: "tail",
      kind: "exit",
    });
    expect(runner.current.highlightId).toBe("double-intro-blocker");
  });
});

describe("runner gate", () => {
  test("level one gates each lesson arrow, then opens at the won step", () => {
    const runner = runnerFor(1);
    expect(runner.gate).toEqual(new Set(["l1-front-blocked"]));
    runner.onMove({ arrowId: "l1-front-blocked", kind: "blocked" });
    expect(runner.gate).toEqual(new Set(["l1-front-blocker"]));
    runner.onMove({ arrowId: "l1-front-blocker", kind: "exit" });
    expect(runner.gate).toEqual(new Set(["l1-front-blocked"]));
    runner.onMove({ arrowId: "l1-front-blocked", kind: "exit" });
    expect(runner.gate).toBeUndefined();
    runner.onWon();
    expect(runner.gate).toBeUndefined();
  });

  test("a move outside the gate leaves it unchanged", () => {
    const runner = runnerFor(1);
    runner.onMove({ arrowId: "l1-back", kind: "exit" });
    expect(runner.stepIndex).toBe(0);
    expect(runner.gate).toEqual(new Set(["l1-front-blocked"]));
  });

  test("stop intro gates park, freed arrow, blocker, then the exit", () => {
    const runner = runnerFor(5);
    expect(runner.gate).toEqual(new Set(["stop-intro-parker"]));
    runner.onMove({ arrowId: "stop-intro-parker", kind: "paused" });
    expect(runner.gate).toEqual(new Set(["stop-intro-freed"]));
    runner.onMove({ arrowId: "stop-intro-freed", kind: "exit" });
    expect(runner.gate).toEqual(new Set(["stop-intro-blocker"]));
    runner.onMove({ arrowId: "stop-intro-blocker", kind: "exit" });
    expect(runner.gate).toEqual(new Set(["stop-intro-parker"]));
    runner.onMove({ arrowId: "stop-intro-parker", kind: "exit" });
    expect(runner.gate).toBeUndefined();
  });

  test("wrap intro gates the wrap arrow only", () => {
    const runner = runnerFor(11);
    expect(runner.gate).toEqual(new Set(["wrap-intro-front"]));
    runner.onMove({ arrowId: "wrap-intro-front", kind: "exit" });
    expect(runner.gate).toBeUndefined();
  });

  test("overlap intro gates the whole pair at the group step", () => {
    const runner = runnerFor(15);
    expect(runner.gate).toEqual(new Set(["overlap-intro-blocker"]));
    runner.onMove({ arrowId: "overlap-intro-blocker", kind: "exit" });
    expect(runner.gate).toEqual(
      new Set(["overlap-intro-pair-a", "overlap-intro-pair-b"]),
    );
    runner.onMove({ arrowId: "overlap-intro-pair-b", kind: "exit" });
    expect(runner.gate).toBeUndefined();
  });

  test("attach skips consumed steps and gates the next one", () => {
    const runner = runnerFor(5);
    runner.attach(["stop-intro-freed", "stop-intro-blocker"]);
    expect(runner.stepIndex).toBe(1);
    expect(runner.gate).toEqual(new Set(["stop-intro-freed"]));
  });

  test("an unmatched parker exit jumps straight to free play", () => {
    const runner = runnerFor(5);
    runner.onMove({ arrowId: "stop-intro-parker", kind: "exit" });
    expect(runner.current.advance.kind).toBe("won");
    expect(runner.gate).toBeUndefined();
  });
});
