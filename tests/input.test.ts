import { describe, expect, test } from "bun:test";

import { PointerInput } from "../src/input";

type Listener = (event: PointerEvent) => void;

class MockElement {
  private readonly listeners = new Map<string, Listener>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  setPointerCapture(): void {}

  emit(type: string, event: Partial<PointerEvent>): void {
    const listener = this.listeners.get(type);
    if (!listener) throw new Error(`No ${type} listener`);
    listener(event as PointerEvent);
  }
}

function pointer(x: number, y: number): Partial<PointerEvent> {
  return {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    clientX: x,
    clientY: y,
  };
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
    expect(orbit).toEqual([
      [20, 0],
      [20, 20],
    ]);
  });

  test("enters drag once then forwards every subsequent pointer delta", () => {
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

    expect(orbit).toEqual([
      [9, 0],
      [1, 0],
      [1, 1],
    ]);
  });
});
