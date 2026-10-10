/** Text-only inspection of generated parking, rotor or flip layouts.
 * Run: bun scripts/inspect-parking.ts [levelIds...]
 *      MECHANIC=rotor bun scripts/inspect-parking.ts 42 58 111 196 */
import { generateLevel } from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { arrowTrack } from "../src/core/stops";
import { cellKey, headingForPath } from "../src/core/topology";
import type { FaceId } from "../src/core/types";
import { solveLevelTargets } from "../src/core/validation";

const mechanic = ["rotor", "flip"].includes(process.env.MECHANIC ?? "")
  ? process.env.MECHANIC!
  : "park";
const marker = `-${mechanic}-`;
const ids = process.argv.slice(2).map(Number);
for (const id of ids.length ? ids : [6, 17, 58, 150]) {
  const level = generateLevel(id);
  const core = level.arrows.filter(
    (arrow) =>
      arrow.id.includes(marker) ||
      (mechanic === "flip" && arrow.id.includes("-flipb-")),
  );
  const lanes = new Set(
    core.flatMap((arrow) =>
      arrowTrack(level, arrow).slice(arrow.path.length).map(cellKey),
    ),
  );
  const blockers = level.arrows.filter(
    (arrow) =>
      /^r\d+-\d+$/.test(arrow.id) &&
      arrow.path.some((cell) => lanes.has(cellKey(cell))),
  );
  const solution = solveLevelTargets(level);
  if (!solution) throw new Error(`No solution for level ${id}`);
  let state = createGameState(level);
  let beforePark = 0;
  let firstPause: string | undefined;
  for (const target of solution) {
    const move = simulateMove(level, state, target.arrowId, target.endpoint);
    if (move.kind !== "exit" && move.kind !== "paused")
      throw new Error(`Unsafe certificate at ${target.arrowId}`);
    if (move.kind === "paused" && target.arrowId.includes(marker)) {
      firstPause = target.arrowId;
      break;
    }
    state = applyMove(level, state, move);
    beforePark += 1;
  }
  console.log(
    `\nCube ${id}: grid ${level.gridSize}, ${level.arrows.length} arrows, ${core.length} ${mechanic} arrows`,
  );
  console.log(
    `Ordinary ${mechanic}-lane blockers (${blockers.length}): ${blockers.map((arrow) => arrow.id).join(", ")}`.trimEnd(),
  );
  console.log(
    `${firstPause ? `First ${mechanic} pause: ${firstPause}; solver taps before it: ${beforePark}` : `No ${mechanic} pause in this solution`}; total safe solution taps: ${solution.length}`,
  );
  const marks = new Map<string, string>();
  for (const arrow of level.arrows)
    for (const cell of arrow.path) marks.set(cellKey(cell), ".");
  for (const arrow of core) {
    const label =
      mechanic === "flip" && arrow.id.includes("-flipb-")
        ? arrow.id.endsWith("0")
          ? "X"
          : "Y"
        : mechanic === "flip" && arrow.id.endsWith(`${marker}a`)
          ? "A"
          : arrow.id.endsWith(`${marker}p`)
            ? "P"
            : arrow.id.endsWith(`${marker}b`)
              ? "B"
              : arrow.id.slice(-1);
    for (const cell of arrow.path) marks.set(cellKey(cell), label);
    console.log(
      `${label}: ${arrow.id}, ${arrow.path.length} cells, ${[...new Set(arrow.path.map((cell) => cell.face))].join("/")}, head ${cellKey(arrow.path[arrow.path.length - 1]!)}, heading ${headingForPath(arrow.path, level.gridSize)}`,
    );
  }
  for (const stop of level.stops ?? []) marks.set(cellKey(stop), "O");
  for (const spot of level.directionals ?? []) {
    if (spot.kind !== mechanic) continue;
    const mark = mechanic === "rotor" ? "R" : "F";
    marks.set(cellKey(spot.cell), mark);
    console.log(
      `${mark}: ${mechanic} ${cellKey(spot.cell)}, initial heading ${spot.heading}`,
    );
  }
  console.log(
    mechanic === "flip"
      ? "F flip; A/B approachers; 0/1/2 lane contacts; X/Y grown seeded blockers; O stop; . outside body; blank empty"
      : "R rotor; P parker; B continuation blocker; 0/1/2 followers; O stop; . outside body; blank empty",
  );
  const faces: FaceId[] = ["front", "back", "left", "right", "top", "bottom"];
  console.log(
    faces
      .map((face) => face.padEnd(level.gridSize))
      .join(" | ")
      .concat(" |"),
  );
  for (let y = 0; y < level.gridSize; y += 1)
    console.log(
      faces
        .map((face) =>
          Array.from(
            { length: level.gridSize },
            (_, x) => marks.get(cellKey({ face, x, y })) ?? " ",
          ).join(""),
        )
        .join(" | ")
        .concat(" |"),
    );
}
