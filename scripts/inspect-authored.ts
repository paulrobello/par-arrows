/** Engine and six-face inspection of authored lessons: bun scripts/inspect-authored.ts 20 40 55 */
import { generateLevel, isAuthoredLevel } from "../src/content/procedural";
import {
  createGameState,
  simulateMove,
  applyMove,
} from "../src/core/game-state";
import { cellKey, headingForPath } from "../src/core/topology";
import { solveLevelTargets } from "../src/core/validation";
import type { FaceId } from "../src/core/types";
const ids = process.argv.slice(2).map(Number);
for (const id of ids.length ? ids : [20, 40, 55]) {
  if (!isAuthoredLevel(id)) throw new Error(`Level ${id} is not authored`);
  const level = generateLevel(id),
    initial = createGameState(level);
  const ground = {
    id,
    title: level.title,
    gridSize: level.gridSize,
    lives: level.lives,
    arrows: level.arrows,
    ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
  };
  const marks = new Map<string, string>();
  console.log(
    `\nCube ${id}: ${level.gridSize} cells per face, ${level.arrows.length} authored arrows`,
  );
  for (const [index, arrow] of level.arrows.entries()) {
    for (const c of arrow.path) marks.set(cellKey(c), String(index));
    const plain = simulateMove(ground, initial, arrow.id);
    console.log(
      `${index}: ${arrow.id}; ${arrow.path.length} cells; ${[...new Set(arrow.path.map((c) => c.face))].join("/")}; head ${cellKey(arrow.path.at(-1)!)} ${headingForPath(arrow.path, level.gridSize)}; ground ${plain.kind}${plain.blockerId ? ` on ${plain.blockerId} at ${cellKey(plain.contact!.cell)}` : ""}`,
    );
  }
  for (const spot of level.directionals ?? []) {
    const label =
      spot.kind === "rotor" ? "R" : spot.kind === "flip" ? "F" : "Q";
    marks.set(cellKey(spot.cell), label);
    console.log(`${label}: ${cellKey(spot.cell)} ${spot.heading}`);
  }
  for (const mirror of level.mirrors ?? [])
    marks.set(cellKey(mirror.cell), mirror.orientation);
  for (const c of level.stops ?? []) marks.set(cellKey(c), "O");
  for (const c of level.leaps ?? []) marks.set(cellKey(c), "L");
  for (const c of level.fragile ?? []) marks.set(cellKey(c), "#");
  for (const gate of level.locks ?? []) {
    marks.set(cellKey(gate.lock), "G");
    marks.set(cellKey(gate.key), "K");
  }
  for (const w of level.wormholes ?? []) {
    marks.set(cellKey(w.a), "A");
    marks.set(cellKey(w.b), "B");
  }
  const faces: FaceId[] = ["front", "back", "left", "right", "top", "bottom"];
  console.log(faces.map((f) => f.padEnd(level.gridSize)).join(" | ") + " |");
  for (let y = 0; y < level.gridSize; y++)
    console.log(
      faces
        .map((face) =>
          Array.from(
            { length: level.gridSize },
            (_, x) => marks.get(cellKey({ face, x, y })) ?? " ",
          ).join(""),
        )
        .join(" | ") + " |",
    );
  const cert = solveLevelTargets(level);
  if (!cert) throw new Error(`No zero-life solution for ${id}`);
  let state = initial;
  for (const target of cert) {
    const move = simulateMove(level, state, target.arrowId, target.endpoint);
    if (move.kind !== "exit" && move.kind !== "paused")
      throw new Error(`Unsafe certificate ${target.arrowId}`);
    console.log(
      `${target.arrowId}:${target.endpoint} ${move.kind}: ${move.route.map(cellKey).join(" -> ")}`,
    );
    state = applyMove(level, state, move);
    if (state.spotHeadings)
      console.log(`Settled headings: ${JSON.stringify(state.spotHeadings)}`);
  }
  if (state.status !== "won" || state.lives !== level.lives)
    throw new Error(`Certificate failed for ${id}`);
  console.log(`Whole cube ${state.status}, ${state.lives} lives`);
}
