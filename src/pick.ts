import type { MoveTarget } from "./core/types";

/** A pickable arrow endpoint and how far the pointer landed from it, in CSS pixels. */
export interface PickCandidate {
  readonly target: MoveTarget;
  readonly distancePx: number;
}

/**
 * Chooses the arrow a pointer meant to hit. Arrows the pointer landed on
 * outright exclude ones it merely came close to, so a press aimed squarely at
 * an arrow always gets that arrow. Among the arrows left, one whose move avoids
 * a collision wins over a nearer one that would cost a life, and the closest
 * arrow settles every other case.
 */
export function resolvePick(
  candidates: readonly PickCandidate[],
  isSafe: (target: MoveTarget) => boolean,
): MoveTarget | undefined {
  const direct = candidates.filter((candidate) => candidate.distancePx === 0);
  const ordered = [...candidates].sort(
    (a, b) =>
      a.distancePx - b.distancePx ||
      a.target.arrowId.localeCompare(b.target.arrowId) ||
      Number(a.target.endpoint === "tail") -
        Number(b.target.endpoint === "tail"),
  );
  const contested = direct.length > 0 ? direct : ordered;
  return (
    contested.find((candidate) => isSafe(candidate.target)) ?? contested[0]
  )?.target;
}
