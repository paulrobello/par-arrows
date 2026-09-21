/**
 * Deterministic construction stress for generateLevel: asserts that a sample
 * of far level ids constructs without throwing and that every produced level
 * satisfies the observable runtime contract (validator, density floor, and
 * generator bounds). Ids are derived deterministically, so any failure
 * reproduces exactly.
 *
 * Run: bun scripts/stress-generate.ts [sampleSize]   (default 5000)
 * The acceptance-tier ladder in generateLevel keeps tier one (exact density,
 * replayed certificate) byte-identical; this script additionally guards that
 * relaxed tiers never fire for the sampled ids by asserting the exact
 * configured arrow count.
 */
import {
  generateLevel,
  getLevelConfig,
  MAX_LEVEL_ID,
} from "../src/content/procedural";
import type { LevelDefinition } from "../src/core/types";
import { validateLevel } from "../src/core/validation";

const target = Number(process.argv[2] ?? "5000");
if (!Number.isInteger(target) || target < 1) {
  throw new Error(`Sample size must be a positive integer, got ${target}`);
}

const ids = new Set<number>();
let cursor = 0;
while (ids.size < target) {
  cursor += 1;
  const hi = Math.imul(cursor, 0x9e3779b1) >>> 0;
  const lo = Math.imul(cursor, 0x85ebca77) >>> 0;
  const unit = (hi + lo / 4294967296) / 4294967296;
  const id = 21 + Math.floor(unit * (MAX_LEVEL_ID - 20));
  if (id !== 1 && id !== 5 && id !== 11 && id !== 15 && id !== 20) ids.add(id);
}

const failures: string[] = [];
const started = Date.now();
let slowest = 0;
let slowestId = 0;

for (const [index, id] of [...ids].sort((a, b) => a - b).entries()) {
  const tick = Date.now();
  let level: LevelDefinition;
  try {
    level = generateLevel(id);
  } catch (error) {
    failures.push(`${id}: threw — ${(error as Error).message}`);
    continue;
  }
  const elapsed = Date.now() - tick;
  if (elapsed > slowest) {
    slowest = elapsed;
    slowestId = id;
  }
  const config = getLevelConfig(id);
  const problems: string[] = [];
  if (!validateLevel(level).valid) problems.push("validateLevel invalid");
  if (level.arrows.length !== config.arrowCount) {
    problems.push(
      `relaxed density: ${level.arrows.length} != ${config.arrowCount}`,
    );
  }
  if (level.gridSize > 26) problems.push("grid over 26");
  if (level.arrows.length > 264) problems.push("arrow count over cap 264");
  const longest = Math.max(...level.arrows.map((arrow) => arrow.path.length));
  if (longest > 40) problems.push(`path over 40: ${longest}`);
  if (problems.length > 0) failures.push(`${id}: ${problems.join("; ")}`);
  if ((index + 1) % 500 === 0) {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `${index + 1}/${ids.size} sampled, ${failures.length} failures, ${seconds}s`,
    );
  }
}

console.log(`total=${ids.size} failures=${failures.length}`);
console.log(`slowest id ${slowestId} at ${slowest}ms`);
for (const line of failures.slice(0, 20)) console.log(line);
if (failures.length > 0) process.exit(1);
