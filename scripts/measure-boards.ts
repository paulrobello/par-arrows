import { closureStats } from "../src/content/difficulty";
import { generateLevel, isAuthoredLevel } from "../src/content/procedural";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";

const LEAD = /-(park|dir|double|wormhole|flip)-/;
const ids = process.argv.slice(2).map(Number);
for (const id of ids.length > 0
  ? ids
  : Array.from({ length: 199 }, (_, i) => i + 2)) {
  if (isAuthoredLevel(id)) continue;
  const started = performance.now();
  const level = generateLevel(id);
  const ms = Math.round(performance.now() - started);
  const stats = closureStats(
    level.wormholes ? { ...level, wormholes: [] } : level,
  );
  const covered = new Set(
    level.arrows.flatMap((arrow) => arrow.path.map(cellKey)),
  ).size;
  const plain = level.arrows.filter((arrow) => !LEAD.test(arrow.id));
  const edge = plain.filter(
    (arrow) => arrowTrack(level, arrow).length === arrow.path.length,
  ).length;
  console.log(
    [
      id,
      level.gridSize,
      level.arrows.length,
      (covered / (6 * level.gridSize ** 2)).toFixed(2),
      (edge / plain.length).toFixed(2),
      stats.median,
      stats.deepShare.toFixed(2),
      stats.freeShare.toFixed(2),
      ms,
    ].join("\t"),
  );
}
