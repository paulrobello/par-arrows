import { advanceHead, cellsEqual, headingForPath } from "./topology";
import { isLeapPad, leapLinkHeading } from "./leaps";
import type { Cell, ForwardInfo, Heading, LevelDefinition } from "./types";

export type PortalSource = Pick<
  LevelDefinition,
  "gridSize" | "edgePolicies" | "wormholes" | "leaps"
>;

export const MAX_WORMHOLES = 2;

export function wormholePartner(
  level: Pick<LevelDefinition, "wormholes">,
  cell: Cell,
): Cell | undefined {
  for (const hole of level.wormholes ?? []) {
    if (cellsEqual(hole.a, cell)) return hole.b;
    if (cellsEqual(hole.b, cell)) return hole.a;
  }
  return undefined;
}

/** One head step; entering an end lands on its partner with the heading unchanged. */
export function advanceWithPortals(
  level: PortalSource,
  cell: Cell,
  heading: Heading,
): ForwardInfo & { readonly portal?: Cell } {
  const forward = advanceHead(level, cell, heading);
  if (forward.exits || !forward.next) return forward;
  const partner = wormholePartner(level, forward.next);
  return partner
    ? { ...forward, next: partner, portal: forward.next }
    : forward;
}

const HEADINGS: readonly Heading[] = ["east", "west", "south", "north"];

/** The heading a head arrives at `to` with, through an adjacent link, a portal jump, or a leap. */
export function linkHeading(
  level: PortalSource,
  from: Cell,
  to: Cell,
): Heading | undefined {
  // A head on a leap pad skips its next cell, so its link to the landing
  // resolves through the leap — never through an adjacency or a portal on
  // the skipped cell.
  if (isLeapPad(level, from)) {
    return leapLinkHeading(level, from, to);
  }
  const adjacent = headingForPath([from, to], level.gridSize);
  if (adjacent && !wormholePartner(level, to)) return adjacent;
  for (const heading of HEADINGS) {
    const step = advanceWithPortals(level, from, heading);
    if (step.portal && step.next && cellsEqual(step.next, to))
      return step.heading;
  }
  return adjacent;
}

export function isPortalLink(
  level: PortalSource,
  from: Cell,
  to: Cell,
): boolean {
  return HEADINGS.some((heading) => {
    const step = advanceWithPortals(level, from, heading);
    return (
      step.portal !== undefined &&
      step.next !== undefined &&
      cellsEqual(step.next, to)
    );
  });
}

export function pathHeading(
  level: PortalSource,
  path: readonly Cell[],
): Heading | undefined {
  const previous = path[path.length - 2];
  const head = path[path.length - 1];
  return previous && head ? linkHeading(level, previous, head) : undefined;
}
