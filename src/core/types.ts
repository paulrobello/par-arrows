/** A named face of the fixed MVP cube topology. */
export type FaceId = "front" | "back" | "right" | "left" | "top" | "bottom";

/** An integer cell center in a face-local grid. */
export interface Cell {
  readonly face: FaceId;
  readonly x: number;
  readonly y: number;
}

/** An authored surface route, ordered from its tail to its active head. */
export interface ArrowDefinition {
  readonly id: string;
  readonly path: readonly Cell[];
  readonly kind?: "single" | "double";
}

/** A declared rule for an oriented cube boundary. */
export interface EdgePolicyDefinition {
  readonly face: FaceId;
  readonly edge: Heading;
  readonly policy: "exit" | "continue";
  /** Required for a continuation and describes its neighbor's incoming tangent. */
  readonly neighbor?: {
    readonly face: FaceId;
    readonly entering: Heading;
  };
}

/** A floor fixture that bends any entering head onto its heading. */
export interface DirectionalSpotDefinition {
  readonly cell: Cell;
  readonly heading: Heading;
}

/** Cube-only level data with ordinary exits and optional continuation edges. */
export interface LevelDefinition {
  readonly id: number;
  readonly title: string;
  readonly gridSize: number;
  readonly lives: number;
  /** Presentation-only sizing relative to grid spacing; defaults to 1. */
  readonly arrowScale?: number;
  readonly arrows: readonly ArrowDefinition[];
  readonly edgePolicies?: readonly EdgePolicyDefinition[];
  /** Cells that pause a passing head until it is activated again. */
  readonly stops?: readonly Cell[];
  /** Spots that bend a passing head onto their heading from its next step. */
  readonly directionals?: readonly DirectionalSpotDefinition[];
}

export type GameStatus = "playing" | "won" | "lost";

/** The complete settled logical state that persistence may store directly. */
export interface GameState {
  readonly levelId: number;
  readonly remainingIds: readonly string[];
  readonly failedIds: readonly string[];
  readonly lives: number;
  readonly status: GameStatus;
  /** Increments after every accepted settled outcome and guards stale results. */
  readonly revision: number;
  /** Forward steps already travelled by each arrow parked on a stop circle. */
  readonly offsets: Readonly<Record<string, number>>;
}

export type Endpoint = "head" | "tail";

export type MoveKind = "exit" | "blocked" | "invalid" | "paused";

/** A renderer-neutral position in a settled attempt trace. */
export interface MoveWaypoint {
  readonly cell: Cell;
  readonly phase: "surface" | "flight";
}

export type WorldPoint = readonly [number, number, number];

export interface ExitTrace {
  readonly edgePoint: WorldPoint;
  readonly tangent: WorldPoint;
}

export interface ContactTrace {
  readonly cell: Cell;
  readonly point: WorldPoint;
  readonly distance: number;
}

/**
 * A complete deterministic move result. `route` ends at the first blocker for
 * rebounds, at the stop circle for pauses, and at the last surface cell for exits.  Flight happens only
 * after that final surface cell and cannot collide with other cube faces.
 */
export interface MoveResult {
  readonly arrowId: string;
  readonly endpoint: Endpoint;
  readonly kind: MoveKind;
  readonly distance: number;
  readonly route: readonly Cell[];
  readonly waypoints: readonly MoveWaypoint[];
  readonly stateRevision: number;
  /** Forward steps already travelled before this attempt began. */
  readonly offset: number;
  /** Forward steps this attempt travels before parking on a stop circle. */
  readonly pausedSteps?: number;
  readonly blockerId?: string;
  readonly contact?: ContactTrace;
  readonly exit?: ExitTrace;
  readonly reason?: string;
  /** Per-arrow traces when a connected shared-tail group moves together. */
  readonly members?: readonly MoveResult[];
}

export type Heading = "east" | "west" | "south" | "north";

export interface ForwardInfo {
  readonly heading: Heading;
  readonly next?: Cell;
  readonly exits: boolean;
}
