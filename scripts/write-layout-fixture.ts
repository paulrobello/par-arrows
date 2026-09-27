import { writeFileSync } from "node:fs";
import { generateLevel } from "../src/content/procedural";
import { layoutFingerprint } from "../src/storage";

// Regenerates tests/fixtures/v8-layouts.json in place; the path name is kept
// so the two sweep tests that load it stay untouched across generator
// releases.
const baseline: Record<string, string> = {};
for (let id = 2; id <= 200; id += 1) {
  baseline[String(id)] = layoutFingerprint(generateLevel(id));
}
writeFileSync(
  new URL("../tests/fixtures/v8-layouts.json", import.meta.url),
  `${JSON.stringify(baseline, null, 2)}\n`,
);
