/** Text-only inspection of generated parking, rotor, flip, wormhole, double, overlap, fragile, lock or mirror layouts.
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

const mechanic = [
  "rotor",
  "flip",
  "wormhole",
  "double",
  "overlap",
  "fragile",
  "lock",
  "mirror",
].includes(process.env.MECHANIC ?? "")
  ? process.env.MECHANIC!
  : "park";
const marker = `-${mechanic}-`;
const ids = process.argv.slice(2).map(Number);
for (const id of ids.length ? ids : [6, 17, 58, 150]) {
  const level = generateLevel(id);
  const core = level.arrows.filter(
    (arrow) =>
      arrow.id.includes(marker) ||
      (mechanic === "flip" && arrow.id.includes("-flipb-")) ||
      (mechanic === "wormhole" && arrow.id.includes("-xblock-wormhole")) ||
      (mechanic === "fragile" && arrow.id.includes("-xblock-fragile")) ||
      (mechanic === "lock" && arrow.id.includes("-xblock-lock")) ||
      (mechanic === "mirror" && arrow.id.includes("-xblock-mirror")),
  );
  const solution = solveLevelTargets(level);
  if (!solution) throw new Error(`No solution for level ${id}`);
  const lanes = new Set(
    core.flatMap((arrow) => {
      const endpoint = solution.find(
        (target) => target.arrowId === arrow.id,
      )?.endpoint;
      const path =
        arrow.kind === "double" && endpoint === "tail"
          ? [...arrow.path].reverse()
          : arrow.path;
      return arrowTrack(level, { ...arrow, path })
        .slice(path.length)
        .map(cellKey);
    }),
  );
  const blockers = level.arrows.filter(
    (arrow) =>
      /^r\d+-\d+$/.test(arrow.id) &&
      arrow.path.some((cell) => lanes.has(cellKey(cell))),
  );
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
  if (mechanic === "double" || mechanic === "fragile")
    console.log(
      `Double endpoint actions: ${solution
        .filter((target) =>
          core.some((a) => a.kind === "double" && a.id === target.arrowId),
        )
        .map((t) => `${t.arrowId}:${t.endpoint}`)
        .join(", ")}`,
    );
  const marks = new Map<string, string>();
  for (const arrow of level.arrows)
    for (const cell of arrow.path) marks.set(cellKey(cell), ".");
  const wormLabels = "PCDEQHIKXYZ0123456789";
  for (const [index, arrow] of core.entries()) {
    const label =
      mechanic === "lock" || mechanic === "mirror"
        ? String(index)
        : mechanic === "double" || mechanic === "fragile"
          ? arrow.kind === "double"
            ? "D"
            : String(index)
          : mechanic === "wormhole"
            ? wormLabels[index % wormLabels.length]!
            : mechanic === "flip" && arrow.id.includes("-flipb-")
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
  if (mechanic === "wormhole")
    for (const hole of level.wormholes ?? []) {
      const marksForHole = hole.id === "w2" ? ["U", "V"] : ["A", "B"];
      marks.set(cellKey(hole.a), marksForHole[0]!);
      marks.set(cellKey(hole.b), marksForHole[1]!);
      console.log(`${hole.id}: ${cellKey(hole.a)} <-> ${cellKey(hole.b)}`);
    }
  if (mechanic === "fragile")
    for (const cell of level.fragile ?? []) {
      marks.set(cellKey(cell), "#");
      console.log(`#: crack ${cellKey(cell)}`);
    }
  if (mechanic === "lock")
    for (const lock of level.locks ?? []) {
      marks.set(cellKey(lock.lock), "G");
      marks.set(cellKey(lock.key), "K");
      console.log(
        lock.id +
          ": key " +
          cellKey(lock.key) +
          " -> gate " +
          cellKey(lock.lock),
      );
    }
  if (mechanic === "mirror")
    for (const mirror of level.mirrors ?? []) {
      marks.set(cellKey(mirror.cell), mirror.orientation);
      console.log("Mirror " + cellKey(mirror.cell) + ": " + mirror.orientation);
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
    mechanic === "mirror"
      ? "Slash mirror; numbered grown approaches, routed dependency body and blockers; O stop; . outside body; blank empty"
      : mechanic === "lock"
        ? "K key; G gate; numbered grown opener, key, dependencies and seeded blockers; O stop; . outside body; blank empty"
        : mechanic === "fragile"
          ? "# crack; D double; numbered grown crosser, dependencies and seeded blockers; O stop; . outside body; blank empty"
          : mechanic === "overlap"
            ? "0/1/2 shared-tail members (shared cells show the last member); O stop; . outside body; blank empty"
            : mechanic === "double"
              ? "D two-headed opener; numbered grown contact bodies; O stop; . outside body; blank empty"
              : mechanic === "wormhole"
                ? "A/B first portal pair; U/V second pair; labelled grown core/blocker bodies; O stop; . outside body; blank empty"
                : mechanic === "flip"
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
