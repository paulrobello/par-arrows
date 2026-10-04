import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  encounteredMechanics,
  MECHANIC_HELP,
  mechanicImagePath,
} from "../src/help";

describe("mechanics guide", () => {
  test("the catalog covers the authored introductions in meeting order", () => {
    expect(MECHANIC_HELP.map((mechanic) => mechanic.unlockLevel)).toEqual([
      1, 5, 11, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
    ]);
    expect(new Set(MECHANIC_HELP.map((mechanic) => mechanic.id)).size).toBe(
      MECHANIC_HELP.length,
    );
    for (const mechanic of MECHANIC_HELP) {
      expect(mechanic.title.length).toBeGreaterThan(0);
      expect(mechanic.description.length).toBeGreaterThan(0);
      expect(mechanicImagePath(mechanic.id)).toBe(`/help/${mechanic.id}.png`);
    }
  });

  test("a mechanic appears once its introduction cube is unlocked", () => {
    expect(encounteredMechanics(0)).toEqual([]);
    expect(encounteredMechanics(1).map((mechanic) => mechanic.id)).toEqual([
      "arrows",
    ]);
    expect(encounteredMechanics(4).map((mechanic) => mechanic.id)).toEqual([
      "arrows",
    ]);
    expect(encounteredMechanics(5).map((mechanic) => mechanic.id)).toEqual([
      "arrows",
      "stop",
    ]);
    expect(
      encounteredMechanics(34).map((mechanic) => mechanic.id),
    ).not.toContain("wormhole");
    expect(encounteredMechanics(35).map((mechanic) => mechanic.id)).toContain(
      "wormhole",
    );
    expect(encounteredMechanics(200)).toHaveLength(MECHANIC_HELP.length);
  });

  test("every thumbnail exists on disk", () => {
    for (const mechanic of MECHANIC_HELP) {
      expect(
        existsSync(
          new URL(`../public/help/${mechanic.id}.png`, import.meta.url),
        ),
      ).toBe(true);
    }
  });
});
