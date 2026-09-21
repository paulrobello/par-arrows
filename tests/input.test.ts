import { describe, expect, test } from "bun:test";
import type { PointerInputHandlers } from "../src/input";
import { PointerInput } from "../src/input";

type Listener = (event: PointerEvent) => void;

class MockWindow {
  private readonly listeners = new Map<string, () => void>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  emit(type: string): void {
    this.listeners.get(type)?.();
  }
}

class MockElement {
  private readonly listeners = new Map<string, Listener>();
  readonly ownerDocument = { defaultView: new MockWindow() };

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  setPointerCapture(): void {}

  emit(type: string, event: object): void {
    const listener = this.listeners.get(type);
    if (!listener) throw new Error(`No ${type} listener`);
    listener(event as PointerEvent);
  }
}

function pointer(
  x: number,
  y: number,
  pointerId = 1,
  pointerType = "mouse",
  button = 0,
): Partial<PointerEvent> {
  return {
    pointerId,
    pointerType,
    button,
    buttons: 1,
    clientX: x,
    clientY: y,
  };
}

function harness(pick: PointerInputHandlers["pick"] = () => "arrow-a") {
  const element = new MockElement();
  const taps: string[] = [];
  const presses: Array<string | undefined> = [];
  const zooms: number[] = [];
  const input = new PointerInput(element as unknown as HTMLElement, {
    pick,
    onPress: (id) => presses.push(id),
    onTap: (id) => taps.push(id),
    onOrbit: () => {},
    onZoom: (delta) => zooms.push(delta),
  });
  return { element, input, taps, presses, zooms };
}

describe("PointerInput", () => {
  test("ignores unpressed hover events interleaved with a captured mouse drag", () => {
    const element = new MockElement();
    const orbit: Array<readonly [number, number]> = [];
    new PointerInput(element as unknown as HTMLElement, {
      pick: () => "arrow-a",
      onPress: () => {},
      onTap: () => {},
      onOrbit: (x, y) => orbit.push([x, y]),
      onZoom: () => {},
    });
    element.emit("pointerdown", pointer(10, 10));
    element.emit("pointermove", { ...pointer(500, 500), buttons: 0 });
    element.emit("pointermove", pointer(30, 10));
    element.emit("pointermove", { ...pointer(100, 300), buttons: 0 });
    element.emit("pointermove", pointer(50, 30));
    // The threshold-crossing move only anchors the drag, so its delta never
    // reaches the orbit.
    expect(orbit).toEqual([[20, 20]]);
  });

  test("consumes the tap slop then forwards every subsequent pointer delta", () => {
    const element = new MockElement();
    const orbit: Array<readonly [number, number]> = [];
    new PointerInput(element as unknown as HTMLElement, {
      pick: () => "arrow-a",
      onPress: () => {},
      onTap: () => {},
      onOrbit: (x, y) => orbit.push([x, y]),
      onZoom: () => {},
    });

    element.emit("pointerdown", pointer(0, 0));
    element.emit("pointermove", pointer(9, 0));
    element.emit("pointermove", pointer(10, 0));
    element.emit("pointermove", pointer(11, 1));

    // Crossing the threshold anchors the drag: the slop distance is never
    // rotated in as one jump.
    expect(orbit).toEqual([
      [1, 0],
      [1, 1],
    ]);
  });

  test("activates the press target after small release jitter without repicking", () => {
    let picks = 0;
    const { element, taps } = harness(() => {
      picks += 1;
      return picks === 1 ? "arrow-a" : "arrow-b";
    });

    element.emit("pointerdown", pointer(10, 10));
    element.emit("pointermove", pointer(14, 12));
    element.emit("pointerup", pointer(15, 13));

    expect(picks).toBe(1);
    expect(taps).toEqual(["arrow-a"]);
  });

  test("rejects a release at the drag threshold even without a move event", () => {
    const { element, taps } = harness();
    element.emit("pointerdown", pointer(10, 10));
    element.emit("pointerup", pointer(19, 10));
    expect(taps).toEqual([]);
  });

  test("does not activate after dragging out and back to the press point", () => {
    const { element, taps } = harness();
    element.emit("pointerdown", pointer(10, 10));
    element.emit("pointermove", pointer(19, 10));
    element.emit("pointermove", pointer(10, 10));
    element.emit("pointerup", pointer(10, 10));
    expect(taps).toEqual([]);
  });

  test("does not activate a blank press", () => {
    const { element, taps } = harness(() => undefined);
    element.emit("pointerdown", pointer(10, 10));
    element.emit("pointerup", pointer(10, 10));
    expect(taps).toEqual([]);
  });

  test("ignores an unrelated pointerup while preserving the active press", () => {
    const { element, taps } = harness();
    element.emit("pointerdown", pointer(10, 10));
    element.emit("pointerup", pointer(10, 10, 2, "touch"));
    element.emit("pointerup", pointer(10, 10, 1, "mouse"));
    expect(taps).toEqual(["arrow-a"]);
  });

  test("ignores non-primary mouse buttons", () => {
    const { element, taps, presses } = harness();
    element.emit("pointerdown", pointer(10, 10, 1, "mouse", 2));
    element.emit("pointerup", pointer(10, 10, 1, "mouse", 2));
    expect(presses).toEqual([]);
    expect(taps).toEqual([]);
  });

  test("rejects a non-primary mouse release and clears the active press", () => {
    const { element, taps, presses } = harness();
    element.emit("pointerdown", pointer(10, 10));
    element.emit("pointerup", pointer(10, 10, 1, "mouse", 2));
    element.emit("pointerup", pointer(10, 10));
    expect(taps).toEqual([]);
    expect(presses).toEqual(["arrow-a", undefined]);
  });

  test("ignores non-primary pen buttons while preserving touch input", () => {
    const { element, taps, presses } = harness();
    element.emit("pointerdown", pointer(10, 10, 1, "pen", 2));
    element.emit("pointerup", pointer(10, 10, 1, "pen", 2));
    expect(presses).toEqual([]);
    expect(taps).toEqual([]);

    element.emit("pointerdown", pointer(10, 10, 2, "touch"));
    element.emit("pointerup", pointer(10, 10, 2, "touch"));
    expect(taps).toEqual(["arrow-a"]);
  });

  test("multi-touch pinch requires every finger to travel before zoom engages", () => {
    const { element, taps, zooms } = harness();
    element.emit("pointerdown", pointer(0, 0, 1, "touch"));
    element.emit("pointerdown", pointer(10, 0, 2, "touch"));
    element.emit("pointermove", pointer(17, 0, 1, "touch"));
    element.emit("pointermove", pointer(29, 0, 2, "touch"));
    // The engagement move zooms from the second finger's landing baseline.
    expect(zooms).toEqual([-10.4]);
    element.emit("pointermove", pointer(48, 0, 2, "touch"));
    element.emit("pointerup", pointer(48, 0, 2, "touch"));
    element.emit("pointerup", pointer(17, 0, 1, "touch"));
    expect(zooms).toEqual([-10.4, -98.8]);
    expect(taps).toEqual([]);
  });

  test("a resting second finger cannot eat a held tap or jitter the zoom", () => {
    const { element, taps, zooms, presses } = harness();
    element.emit("pointerdown", pointer(10, 10, 1, "touch"));
    element.emit("pointerdown", pointer(10, 0, 2, "touch"));
    element.emit("pointermove", pointer(14, 12, 1, "touch"));
    element.emit("pointermove", pointer(13, 0, 2, "touch"));
    element.emit("pointerup", pointer(13, 0, 2, "touch"));
    element.emit("pointerup", pointer(14, 12, 1, "touch"));
    expect(zooms).toEqual([]);
    expect(taps).toEqual(["arrow-a"]);
    // The graze never cleared the held press's highlight.
    expect(presses).toEqual(["arrow-a", undefined]);
  });

  test("pointer cancellation and lost capture cancel the pending tap", () => {
    for (const eventType of ["pointercancel", "lostpointercapture"]) {
      const { element, taps } = harness();
      element.emit("pointerdown", pointer(10, 10));
      element.emit(eventType, pointer(10, 10));
      element.emit("pointerup", pointer(10, 10));
      expect(taps).toEqual([]);
    }
  });

  test("wheel zoom cancels the pending tap while retaining zoom", () => {
    const priorWheelEvent = globalThis.WheelEvent;
    Object.defineProperty(globalThis, "WheelEvent", {
      configurable: true,
      value: { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
    });
    try {
      const { element, taps, zooms } = harness();
      element.emit("pointerdown", pointer(10, 10));
      element.emit("wheel", {
        deltaY: 12,
        deltaMode: 0,
        preventDefault: () => {},
      });
      element.emit("pointerup", pointer(10, 10));
      expect(zooms).toEqual([12]);
      expect(taps).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, "WheelEvent", {
        configurable: true,
        value: priorWheelEvent,
      });
    }
  });

  test("window blur cancels the pending tap", () => {
    const { element, taps } = harness();
    element.emit("pointerdown", pointer(10, 10));
    element.ownerDocument.defaultView.emit("blur");
    element.emit("pointerup", pointer(10, 10));
    expect(taps).toEqual([]);
  });
});
