import { cellKey } from "./topology";
import type { Cell, Heading, LevelDefinition } from "./types";

type SpotSource = Pick<LevelDefinition, "directionals">;

const SPOT_HEADINGS = new WeakMap<SpotSource, ReadonlyMap<string, Heading>>();

/**
 * The heading a directional spot forces onto any head entering its cell, or
 * undefined when the cell carries no spot. Levels are immutable, so the
 * per-level lookup map is cached the same way overlap groups are.
 */
export function spotHeadingAt(
  level: SpotSource,
  cell: Cell,
): Heading | undefined {
  let headings = SPOT_HEADINGS.get(level);
  if (!headings) {
    headings = new Map(
      (level.directionals ?? []).map((spot) => [
        cellKey(spot.cell),
        spot.heading,
      ]),
    );
    SPOT_HEADINGS.set(level, headings);
  }
  return headings.get(cellKey(cell));
}
