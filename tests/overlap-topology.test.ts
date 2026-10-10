import { expect, test } from "bun:test";
import { constructOverlap } from "../src/content/overlap";
import { isAuthoredLevel, Rng } from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { overlappingArrowIds } from "../src/core/overlap";
import { cellKey } from "../src/core/topology";
import type { ArrowDefinition, LevelDefinition } from "../src/core/types";
import { validateLevel } from "../src/core/validation";
import { cachedLevel } from "./generated-levels";
import { mechanicStructure } from "./mechanic-structure";

const base: LevelDefinition = {
  id: 90,
  title: "grown shared spines",
  gridSize: 14,
  lives: 3,
  arrows: [],
};

function sharingProfile(arrows: readonly ArrowDefinition[]): string {
  const lengths: number[] = [];
  for (let first = 0; first < arrows.length; first++)
    for (let second = first + 1; second < arrows.length; second++) {
      const left = arrows[first]!.path;
      const right = arrows[second]!.path;
      let prefix = 0;
      while (
        left[prefix] &&
        right[prefix] &&
        cellKey(left[prefix]!) === cellKey(right[prefix]!)
      )
        prefix++;
      const overlap = left.filter((c) =>
        right.some((other) => cellKey(c) === cellKey(other)),
      ).length;
      expect(overlap).toBe(prefix);
      expect(prefix).toBeGreaterThanOrEqual(2);
      lengths.push(prefix);
    }
  return `${arrows.length}:${lengths.sort((a, b) => a - b).join(",")}`;
}

test("overlap topology grows distinct shared spines and staggered peel trees", () => {
  const whole = new Set<string>();
  const heads = new Set<string>();
  const sharing = new Set<string>();
  let multiFace = 0;
  let staggered = 0;
  for (let seed = 1; seed <= 64; seed++) {
    const count = seed % 2 ? 2 : 3;
    const arrows = constructOverlap(
      base,
      new Rng(Math.imul(seed, 0x9e3779b9) >>> 0),
      new Set(),
      count,
    );
    expect(arrows, `seed ${seed}`).toBeDefined();
    if (!arrows) continue;
    const level = { ...base, arrows };
    expect(validateLevel(level).errors).toEqual([]);
    expect(overlappingArrowIds(level, arrows[0]!.id)).toHaveLength(count);
    for (const member of arrows) {
      const state = createGameState(level);
      const move = simulateMove(level, state, member.id);
      expect(move.kind).toBe("exit");
      expect(move.members).toHaveLength(count);
      const cleared = applyMove(level, state, move);
      expect(cleared.status).toBe("won");
      expect(cleared.lives).toBe(level.lives);
      expect(cleared.remainingIds).toEqual([]);
    }
    const profile = sharingProfile(arrows);
    if (count === 3 && new Set(profile.split(":")[1]!.split(",")).size > 1)
      staggered++;
    sharing.add(profile);
    whole.add(mechanicStructure(level));
    heads.add(
      mechanicStructure({
        ...level,
        arrows: arrows.map((a) => ({ ...a, path: a.path.slice(-2) })),
      }),
    );
    if (new Set(arrows.flatMap((a) => a.path.map((c) => c.face))).size > 1)
      multiFace++;
  }
  console.log({
    whole: whole.size,
    heads: heads.size,
    sharingProfiles: sharing.size,
    multiFace,
    staggered,
  });
  expect(whole.size).toBeGreaterThanOrEqual(61);
  expect(heads.size).toBeGreaterThanOrEqual(61);
  expect(sharing.size).toBeGreaterThanOrEqual(10);
  expect(staggered).toBeGreaterThanOrEqual(8);
  expect(multiFace).toBeGreaterThanOrEqual(16);
});

test("overlap construction is deterministic and bounded without a leg-plan fallback", () => {
  const construct = () =>
    constructOverlap(base, new Rng(0xabcdef), new Set(), 3);
  expect(construct()).toEqual(construct());
  expect(constructOverlap(base, new Rng(1), new Set(), 2, 0)).toBeUndefined();
  const occupied = new Set<string>();
  for (const face of [
    "front",
    "back",
    "left",
    "right",
    "top",
    "bottom",
  ] as const)
    for (let x = 0; x < base.gridSize; x++)
      for (let y = 0; y < base.gridSize; y++)
        occupied.add(cellKey({ face, x, y }));
  expect(constructOverlap(base, new Rng(1), occupied, 3, 1)).toBeUndefined();
});

test("shipped shared-tail groups vary and ordinary fill controls their atomic removal", () => {
  const whole = new Set<string>();
  const heads = new Set<string>();
  const sharing = new Set<string>();
  let groups = 0;
  let blocked = 0;
  for (let id = 16; id <= 200; id++) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    const members = level.arrows.filter((a) => a.id.includes("-overlap-"));
    expect(members, `level ${id}`).toHaveLength(id % 3 === 0 ? 3 : 2);
    expect(overlappingArrowIds(level, members[0]!.id)).toHaveLength(
      members.length,
    );
    groups++;
    const geometry = { ...base, gridSize: level.gridSize, arrows: members };
    whole.add(mechanicStructure(geometry));
    heads.add(
      mechanicStructure({
        ...geometry,
        arrows: members.map((a) => ({ ...a, path: a.path.slice(-2) })),
      }),
    );
    sharing.add(sharingProfile(members));
    const state = createGameState(level);
    const move = simulateMove(level, state, members[0]!.id);
    if (move.kind !== "blocked") continue;
    const naturalContact = (move.members ?? [move]).some((member) => {
      if (member.kind !== "blocked" || member.distance !== move.distance)
        return false;
      const blocker = level.arrows.find((a) => a.id === member.blockerId);
      return blocker !== undefined && /^r\d+-\d+$/.test(blocker.id);
    });
    if (!naturalContact) continue;
    blocked++;
    // A natural fill contact on any member blocks the entire group and
    // marks every member with one shared life deduction, then rewinds it.
    const failed = applyMove(level, state, move);
    expect(failed.lives).toBe(level.lives - 1);
    expect(members.every((a) => failed.failedIds.includes(a.id))).toBe(true);
    expect(members.every((a) => failed.remainingIds.includes(a.id))).toBe(true);
    expect(members.every((a) => !failed.offsets?.[a.id])).toBe(true);
  }
  console.log({
    groups,
    whole: whole.size,
    heads: heads.size,
    sharingProfiles: sharing.size,
    naturalBlocking: blocked / groups,
  });
  expect(groups).toBeGreaterThan(150);
  expect(whole.size / groups).toBeGreaterThanOrEqual(0.95);
  expect(heads.size / groups).toBeGreaterThanOrEqual(0.95);
  expect(sharing.size).toBeGreaterThanOrEqual(10);
  expect(blocked / groups).toBeGreaterThanOrEqual(0.95);
}, 600_000);
