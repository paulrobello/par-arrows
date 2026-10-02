import { advanceHead, cellKey, cellsEqual } from "./topology";
import { advanceWithPortals } from "./wormholes";
import type { Cell, ForwardInfo, Heading, LevelDefinition } from "./types";

// wormholes.ts imports this module's leap-link helpers, so the import here is
// a call-time-only cycle: both sides only call each other inside function
// bodies, after both modules have finished evaluating.
type LeapSource = Pick<LevelDefinition, "leaps">;

export const MAX_LEAP_PADS = 2;

const HEADINGS: readonly Heading[] = ["east", "west", "south", "north"];

interface LeapIndex {
  readonly pads: ReadonlySet<string>;
}

const EMPTY_INDEX: LeapIndex = { pads: new Set() };

/**
 * Keyed on the pad array rather than the level, like the spot and mirror
 * indexes: a pad array must never be mutated after it is attached to a level.
 */
const LEAP_INDEX = new WeakMap<readonly Cell[], LeapIndex>();

function index(level: LeapSource): LeapIndex {
  const pads = level.leaps;
  if (!pads) return EMPTY_INDEX;
  let cached = LEAP_INDEX.get(pads);
  if (!cached) {
    cached = { pads: new Set(pads.map(cellKey)) };
    LEAP_INDEX.set(pads, cached);
  }
  return cached;
}

/** True when the cell carries a leap pad. */
export function isLeapPad(level: LeapSource, cell: Cell): boolean {
  return index(level).pads.has(cellKey(cell));
}

/** Cell keys of every leap pad declared by a level. */
export function padKeys(level: LeapSource): ReadonlySet<string> {
  return index(level).pads;
}

/** True when a level carries any leap pad. */
export function hasLeapPads(level: LeapSource): boolean {
  return (level.leaps?.length ?? 0) > 0;
}

export interface LeapForward extends ForwardInfo {
  /** The skipped cell, when this step leapt over one. */
  readonly over?: Cell;
  /** The pad this step launched from, when this step is a leap. */
  readonly pad?: Cell;
}

/**
 * One resolved head step — ordinary, portal, or leap — as the movement loop,
 * track walks, and validation traces consume it. An ordinary or portal step
 * carries no `pad`, so the leap fields stay undefined on it.
 */
export type StepForward = LeapForward & { readonly portal?: Cell };

/**
 * One head step off a leap pad: the head skips the next cell in its heading
 * and lands two cells on. The skipped cell is never entered, so nothing on it
 * triggers — no collision, no gate, key, hole, stop, spot, mirror, or portal.
 * Both hops are ordinary topology steps, so a wrapping edge wraps whichever
 * hop crosses it. When the landing is off the cube the head exits past the
 * skipped cell; when even the first hop is off it, the head exits at the
 * pad's edge like an ordinary step. A portal on the landing cell still fires:
 * the landing is an entered cell.
 */
export function leapForward(
  level: LeapSource &
    Pick<LevelDefinition, "gridSize" | "edgePolicies" | "wormholes">,
  cell: Cell,
  heading: Heading,
): LeapForward {
  const first = advanceHead(level, cell, heading);
  if (first.exits || !first.next) return first;
  const over = first.next;
  const second = advanceWithPortals(level, over, first.heading);
  if (second.exits || !second.next) return { ...second, over };
  return { ...second, over, pad: cell };
}

/**
 * The heading a head arrives at `to` with through a leap from a pad at
 * `from`, or undefined when no leap connects the two cells. The landing cell
 * of a reported leap is never a portal end: the portal fires on entry, so the
 * link and the path end on the partner cell.
 */
export function leapLinkHeading(
  level: LeapSource &
    Pick<LevelDefinition, "gridSize" | "edgePolicies" | "wormholes">,
  from: Cell,
  to: Cell,
): Heading | undefined {
  for (const heading of HEADINGS) {
    const step = leapForward(level, from, heading);
    if (step.pad && step.next && cellsEqual(step.next, to)) return step.heading;
  }
  return undefined;
}
