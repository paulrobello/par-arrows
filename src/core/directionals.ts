import { cellKey, oppositeHeading } from "./topology";
import type {
  Cell,
  DirectionalSpotDefinition,
  Heading,
  LevelDefinition,
} from "./types";

type SpotSource = Pick<LevelDefinition, "directionals">;

interface SpotIndex {
  readonly headings: ReadonlyMap<string, Heading>;
  readonly flips: ReadonlySet<string>;
  readonly rotors: ReadonlySet<string>;
}

const EMPTY_INDEX: SpotIndex = {
  headings: new Map(),
  flips: new Set(),
  rotors: new Set(),
};

/**
 * Keyed on the spot array rather than the level: generation builds many
 * spread copies of one level that share it. A spot array must therefore
 * never be mutated after it is attached to a level.
 */
const SPOT_INDEX = new WeakMap<
  readonly DirectionalSpotDefinition[],
  SpotIndex
>();

function keysOfKind(
  spots: readonly DirectionalSpotDefinition[],
  kind: DirectionalSpotDefinition["kind"],
): ReadonlySet<string> {
  return new Set(
    spots
      .filter((spot) => spot.kind === kind)
      .map((spot) => cellKey(spot.cell)),
  );
}

function index(level: SpotSource): SpotIndex {
  const spots = level.directionals;
  if (!spots) return EMPTY_INDEX;
  let cached = SPOT_INDEX.get(spots);
  if (!cached) {
    cached = {
      headings: new Map(
        spots.map((spot) => [cellKey(spot.cell), spot.heading]),
      ),
      flips: keysOfKind(spots, "flip"),
      rotors: keysOfKind(spots, "rotor"),
    };
    SPOT_INDEX.set(spots, cached);
  }
  return cached;
}

/**
 * The heading a spot sends any entering head along, or undefined when the
 * cell carries no spot. A flip or rotor spot reads its current direction
 * from `spotHeadings`, falling back to its authored heading.
 */
export function spotHeadingAt(
  level: SpotSource,
  cell: Cell,
  spotHeadings?: Readonly<Record<string, Heading>>,
): Heading | undefined {
  const key = cellKey(cell);
  const { headings, flips, rotors } = index(level);
  if ((flips.has(key) || rotors.has(key)) && spotHeadings?.[key])
    return spotHeadings[key];
  return headings.get(key);
}

export function isFlipSpot(level: SpotSource, cell: Cell): boolean {
  return index(level).flips.has(cellKey(cell));
}

export function hasFlipSpots(level: SpotSource): boolean {
  return index(level).flips.size > 0;
}

export function isRotorSpot(level: SpotSource, cell: Cell): boolean {
  return index(level).rotors.has(cellKey(cell));
}

export function hasRotorSpots(level: SpotSource): boolean {
  return index(level).rotors.size > 0;
}

/** True for a spot whose direction changes when an arrow fully passes it. */
export function isStatefulSpot(level: SpotSource, cell: Cell): boolean {
  const key = cellKey(cell);
  const { flips, rotors } = index(level);
  return flips.has(key) || rotors.has(key);
}

/** True when a level carries any flip or rotor spot. */
export function hasStatefulSpots(level: SpotSource): boolean {
  const { flips, rotors } = index(level);
  return flips.size > 0 || rotors.size > 0;
}

export const flippedHeading = oppositeHeading;

const CLOCKWISE: Readonly<Record<Heading, Heading>> = {
  north: "east",
  east: "south",
  south: "west",
  west: "north",
};

/** One quarter-turn clockwise in face-local grid terms: N, E, S, W, N. */
export function rotatedHeading(heading: Heading): Heading {
  return CLOCKWISE[heading];
}

/**
 * The direction a stateful spot takes once an arrow has fully passed it:
 * a flip reverses and a rotor turns a quarter clockwise. Undefined when the
 * cell carries no stateful spot.
 */
export function advancedSpotHeading(
  level: SpotSource,
  cell: Cell,
  spotHeadings?: Readonly<Record<string, Heading>>,
): Heading | undefined {
  const current = spotHeadingAt(level, cell, spotHeadings);
  if (!current) return undefined;
  const { flips, rotors } = index(level);
  const key = cellKey(cell);
  if (flips.has(key)) return flippedHeading(current);
  if (rotors.has(key)) return rotatedHeading(current);
  return undefined;
}

/**
 * Every direction a spot can hold, starting with its authored heading and in
 * the order it advances: one for a static spot, two for a flip, four for a
 * rotor.
 */
export function spotStates(spot: DirectionalSpotDefinition): Heading[] {
  if (spot.kind === "flip") return [spot.heading, flippedHeading(spot.heading)];
  if (spot.kind === "rotor") {
    const states = [spot.heading];
    for (let turn = 1; turn < 4; turn += 1) {
      states.push(rotatedHeading(states[turn - 1] as Heading));
    }
    return states;
  }
  return [spot.heading];
}
