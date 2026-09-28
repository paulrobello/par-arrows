import { expect, test } from "bun:test";
import { isAuthoredLevel } from "../src/content/procedural";
import { overlappingArrowIds } from "../src/core/overlap";
import { headingForPath } from "../src/core/topology";
import type { ArrowDefinition } from "../src/core/types";
import { cachedLevel } from "./generated-levels";

test("most shared-tail groups send heads different ways", () => {
  let groups = 0;
  let parallel = 0;
  for (let id = 16; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    const first = level.arrows.find((arrow) => arrow.id.includes("-overlap-"));
    if (!first) continue;
    const members = overlappingArrowIds(level, first.id).map(
      (memberId) =>
        level.arrows.find((arrow) => arrow.id === memberId) as ArrowDefinition,
    );
    groups += 1;
    const keys = new Set(
      members.map(
        (member) =>
          `${member.path.at(-1)?.face}:${headingForPath(member.path, level.gridSize)}`,
      ),
    );
    if (keys.size === 1) parallel += 1;
  }
  expect(groups).toBeGreaterThan(150);
  expect(parallel / groups).toBeLessThanOrEqual(0.3);
}, 900_000);
