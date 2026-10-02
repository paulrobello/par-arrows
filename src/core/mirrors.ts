import { cellKey } from "./topology";
import type { Cell, Heading, LevelDefinition, MirrorDefinition } from "./types";

type MirrorSource = Pick<LevelDefinition, "mirrors">;

export const MAX_MIRRORS = 2;

interface MirrorIndex {
  readonly mirrors: ReadonlyMap<string, MirrorDefinition>;
}

const EMPTY_INDEX: MirrorIndex = { mirrors: new Map() };

/**
 * Keyed on the mirror array rather than the level, like the spot index: a
 * mirror array must never be mutated after it is attached to a level.
 */
const MIRROR_INDEX = new WeakMap<readonly MirrorDefinition[], MirrorIndex>();

function index(level: MirrorSource): MirrorIndex {
  const mirrors = level.mirrors;
  if (!mirrors) return EMPTY_INDEX;
  let cached = MIRROR_INDEX.get(mirrors);
  if (!cached) {
    cached = {
      mirrors: new Map(mirrors.map((mirror) => [cellKey(mirror.cell), mirror])),
    };
    MIRROR_INDEX.set(mirrors, cached);
  }
  return cached;
}

/** The mirror on a cell, or undefined when the cell carries none. */
export function mirrorAt(
  level: MirrorSource,
  cell: Cell,
): MirrorDefinition | undefined {
  return index(level).mirrors.get(cellKey(cell));
}

/** True when a level carries any mirror. */
export function hasMirrors(level: MirrorSource): boolean {
  return (level.mirrors?.length ?? 0) > 0;
}

/**
 * Reflect a heading across a mirror's diagonal in face-local terms. A "/"
 * (south-west to north-east) maps east to north and south to west; a "\" maps
 * east to south and north to west. Reflection is an involution, so a head
 * travelling the outgoing heading re-enters the same travel line reversed.
 */
export function reflectedHeading(
  orientation: MirrorDefinition["orientation"],
  incoming: Heading,
): Heading {
  if (orientation === "/") {
    return incoming === "east"
      ? "north"
      : incoming === "north"
        ? "east"
        : incoming === "west"
          ? "south"
          : "west";
  }
  return incoming === "east"
    ? "south"
    : incoming === "north"
      ? "west"
      : incoming === "west"
        ? "north"
        : "east";
}

/**
 * The heading a mirror sends an entering head along, or undefined when the
 * cell carries no mirror. Unlike a spot the result depends on the entry
 * heading, so the same mirror routes two approaches to two destinations.
 */
export function mirrorHeadingAt(
  level: MirrorSource,
  cell: Cell,
  incoming: Heading,
): Heading | undefined {
  const mirror = mirrorAt(level, cell);
  return mirror ? reflectedHeading(mirror.orientation, incoming) : undefined;
}
