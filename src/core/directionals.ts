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
}

const EMPTY_INDEX: SpotIndex = { headings: new Map(), flips: new Set() };

/**
 * Keyed on the spot array rather than the level: generation builds many
 * spread copies of one level that share it. A spot array must therefore
 * never be mutated after it is attached to a level.
 */
const SPOT_INDEX = new WeakMap<
  readonly DirectionalSpotDefinition[],
  SpotIndex
>();

function index(level: SpotSource): SpotIndex {
  const spots = level.directionals;
  if (!spots) return EMPTY_INDEX;
  let cached = SPOT_INDEX.get(spots);
  if (!cached) {
    cached = {
      headings: new Map(
        spots.map((spot) => [cellKey(spot.cell), spot.heading]),
      ),
      flips: new Set(
        spots
          .filter((spot) => spot.kind === "flip")
          .map((spot) => cellKey(spot.cell)),
      ),
    };
    SPOT_INDEX.set(spots, cached);
  }
  return cached;
}

/**
 * The heading a spot sends any entering head along, or undefined when the
 * cell carries no spot. A flip spot reads its current direction from
 * `spotHeadings`, falling back to its authored heading.
 */
export function spotHeadingAt(
  level: SpotSource,
  cell: Cell,
  spotHeadings?: Readonly<Record<string, Heading>>,
): Heading | undefined {
  const key = cellKey(cell);
  const { headings, flips } = index(level);
  if (flips.has(key) && spotHeadings?.[key]) return spotHeadings[key];
  return headings.get(key);
}

export function isFlipSpot(level: SpotSource, cell: Cell): boolean {
  return index(level).flips.has(cellKey(cell));
}

export function hasFlipSpots(level: SpotSource): boolean {
  return index(level).flips.size > 0;
}

export const flippedHeading = oppositeHeading;
