export interface PointerInputHandlers {
  readonly pick: (
    x: number,
    y: number,
    pointerType: string,
  ) => string | undefined;
  readonly onPress: (id: string | undefined) => void;
  readonly onTap: (id: string) => void;
  readonly onOrbit: (deltaX: number, deltaY: number) => void;
  readonly onZoom: (delta: number) => void;
}

interface ActivePointer {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly pressX: number;
  readonly pressY: number;
  readonly arrowId: string | undefined;
  readonly dragging: boolean;
  readonly tapThreshold: number;
}

const TAP_THRESHOLD = 9;
/** A thumb rolls further than a fingertip or cursor while it presses. */
const TOUCH_TAP_THRESHOLD = 16;
const PINCH_ZOOM_SCALE = 3.6;

/** Normalizes mouse and touch gestures before handing actions to the game. */
export class PointerInput {
  private active: ActivePointer | undefined;
  private pinchDistance: number | undefined;
  private readonly touches = new Map<number, PointerEvent>();
  private readonly view: Window | null;

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: PointerInputHandlers,
  ) {
    this.view = element.ownerDocument?.defaultView ?? null;
    this.view?.addEventListener("blur", this.cancel);
    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("pointermove", this.onPointerMove);
    element.addEventListener("pointerup", this.onPointerUp);
    element.addEventListener("pointercancel", this.cancel);
    element.addEventListener("lostpointercapture", this.cancel);
    element.addEventListener("wheel", this.onWheel, { passive: false });
    element.addEventListener("contextmenu", this.onContextMenu);
  }

  dispose(): void {
    this.view?.removeEventListener("blur", this.cancel);
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointermove", this.onPointerMove);
    this.element.removeEventListener("pointerup", this.onPointerUp);
    this.element.removeEventListener("pointercancel", this.cancel);
    this.element.removeEventListener("lostpointercapture", this.cancel);
    this.element.removeEventListener("wheel", this.onWheel);
    this.element.removeEventListener("contextmenu", this.onContextMenu);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    this.touches.set(event.pointerId, event);
    if (this.touches.size > 1) {
      this.active = undefined;
      this.handlers.onPress(undefined);
      this.updatePinchDistance();
      return;
    }
    this.element.setPointerCapture(event.pointerId);
    const arrowId = this.handlers.pick(
      event.clientX,
      event.clientY,
      event.pointerType,
    );
    this.active = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pressX: event.clientX,
      pressY: event.clientY,
      arrowId,
      dragging: false,
      tapThreshold:
        event.pointerType === "touch" ? TOUCH_TAP_THRESHOLD : TAP_THRESHOLD,
    };
    this.handlers.onPress(arrowId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) return;
    if (this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, event);
    }
    if (this.touches.size > 1) {
      const prior = this.pinchDistance;
      this.updatePinchDistance();
      if (prior && this.pinchDistance) {
        this.handlers.onZoom((prior - this.pinchDistance) * PINCH_ZOOM_SCALE);
      }
      this.active = undefined;
      this.handlers.onPress(undefined);
      return;
    }
    if (!this.active || this.active.id !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - this.active.x;
    const deltaY = event.clientY - this.active.y;
    if (
      !this.active.dragging &&
      Math.hypot(deltaX, deltaY) >= this.active.tapThreshold
    ) {
      this.active = {
        ...this.active,
        x: event.clientX,
        y: event.clientY,
        arrowId: undefined,
        dragging: true,
      };
      this.handlers.onPress(undefined);
      this.handlers.onOrbit(deltaX, deltaY);
    } else if (this.active.dragging) {
      this.active = { ...this.active, x: event.clientX, y: event.clientY };
      this.handlers.onOrbit(deltaX, deltaY);
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const active = this.active;
    const trackedTouch = this.touches.has(event.pointerId);
    if (active?.id !== event.pointerId && !trackedTouch) return;
    this.touches.delete(event.pointerId);
    this.pinchDistance = undefined;
    if (active?.id !== event.pointerId) return;
    this.active = undefined;
    this.handlers.onPress(undefined);
    if (
      active.arrowId &&
      !active.dragging &&
      event.button === 0 &&
      Math.hypot(event.clientX - active.pressX, event.clientY - active.pressY) <
        active.tapThreshold
    ) {
      this.handlers.onTap(active.arrowId);
    }
  };

  private readonly cancel = (): void => {
    this.active = undefined;
    this.pinchDistance = undefined;
    this.touches.clear();
    this.handlers.onPress(undefined);
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.cancel();
    const multiplier =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 18
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? 280
          : 1;
    this.handlers.onZoom(event.deltaY * multiplier);
  };

  private updatePinchDistance(): void {
    const [first, second] = [...this.touches.values()];
    this.pinchDistance =
      first && second
        ? Math.hypot(
            first.clientX - second.clientX,
            first.clientY - second.clientY,
          )
        : undefined;
  }
}
