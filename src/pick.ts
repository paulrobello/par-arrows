/** A pickable arrow and how far the pointer landed from it, in CSS pixels. */
export interface PickCandidate {
  readonly arrowId: string;
  readonly distancePx: number;
}

/**
 * Chooses the arrow a pointer meant to hit. An arrow whose move avoids a
 * collision wins over a nearer one that would cost a life, and the closest
 * arrow settles every other case.
 */
export function resolvePick(
  candidates: readonly PickCandidate[],
  isSafe: (arrowId: string) => boolean,
): string | undefined {
  const ordered = [...candidates].sort((a, b) => a.distancePx - b.distancePx);
  const safe = ordered.find((candidate) => isSafe(candidate.arrowId));
  return (safe ?? ordered[0])?.arrowId;
}
