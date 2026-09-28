# Dense Dependency Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace reverse-construction fill with dependency-graph insertion so every generated cube is dense (≥0.80 coverage), keeps heads off edges, and ramps to a median of ~30 prerequisite removals by level 60.

**Architecture:** A new pure module `src/content/dependency-fill.ts` places fill arrows whose exit routes may cross other bodies, recording "must leave first" edges in an acyclic graph and growing tails into leftover cells. A new metric `closureStats` in `src/content/difficulty.ts` replaces the chain/forced-share and blocked-share gates. `generateLevel` keeps every core exactly as today, then calls the fill, then emits `level.arrows` so reversing the array is a valid removal order.

**Tech Stack:** TypeScript, Bun test runner, Biome, Vite, Playwright (headed browser suite).

**Spec:** `docs/superpowers/specs/2026-09-27-dense-dependency-boards-design.md`

## Global Constraints

- Bun is the toolchain: `bun test`, `make checkall`. Never `npm`/`node`.
- Worktree: `/Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards`. Run every command from it with absolute paths.
- `GENERATOR_VERSION` becomes 10. Every generated id, including 2–4 and 6–10, uses the seed `par-arrows:runtime:10:level:<id>`. Authored ids 1, 5, 11, 15, 20, 25, 30, 35 keep their seed strings and definitions.
- `CONTENT_VERSION` stays 13.
- Grid size and `arrowScale` stay unchanged.
- Arrow count: the current curve through 57 (170 at 57), then +2 per level to a cap of 200. `MAX_GENERATED_ARROWS` = 200.
- Fill arrows need at least one route cell before they exit.
- Paths stay at 40 cells or fewer.
- The shape cap (`shapeCap`) applies to fill and tail growth.
- Generation stays at or under 1 s per level.
- Mechanic counts over generated ids 2–200 stay within 10% of the v9 totals: 707 static spots, 112 flip spots, 279 of 279 budgeted stop circles, 98 wormholes, 72 double arrows, a group on 181 levels. v9 plan-to-placement ratios: static spots 707/845, flip cores 94/97 levels, wormholes 98/105, doubles 72/72, circles 279/279, groups 181/181.
- Winnability rule: no collision-free move may make a level unwinnable. Only collisions cost lives.
- Optional-mechanics rule: every placed mechanic must be functional. Never place a non-interacting one.
- Each commit touches at most 5 files and follows a green `make checkall`. **One exception, Task 4 (cutover):** it touches about 10 files in one commit, because the layout fixture and every unit-test pin must change in the same commit as the generator for the gate to be green.
- No `Co-Authored-By` trailer on commits.
- Sub-agents never run any `kanban` command.
- Comments state constraints only, and a comment made false by this change gets rewritten in the same task.

## Review Focus

- **Stop circle on a fill route strands a board.** Decorative circles land on fill routes after the fill. A park on a dense board can move a body onto another arrow's track, so `strandSafeCircle` must still gate every circle. Pinned by Task 4 Step 6, which asserts `crossingParks(level)` is empty over a 2–200 sample.
- **Post-fill spots bend a route through a body that clears later.** `extraDirectionalSpots` and `reversalBlockers` vet against `cellsBefore`, which stays correct only because Task 4 emits arrows in reverse removal order. Pinned by Task 4 Step 6's certificate replay over every generated id.
- **A wormhole end lands on a fill route.** A fill arrow whose route enters a portal teleports and can unlock the wormhole core's deadlock. Portal ends must be forbidden ray cells. Pinned by Task 4 Step 6, which asserts no non-core arrow's track touches a wormhole end on levels carrying a core.
- **A starter or group body sits on a park-core track.** Starters and groups now clear after the park core. A body on its track deadlocks the core forever. Pinned by Task 2's `forbiddenBody` unit test and the full-sweep replay.
- **The closure metric loops on a cycle.** The park-core deadlock is a real cycle on the assembled board. A Kahn-style pass would drop or miscount it. Pinned by Task 1's cycle test.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/content/dependency-fill.ts` (new) | Dependency-graph fill and tail growth over a partially built board. Pure: no DOM, no storage. | 2, 3 |
| `src/content/difficulty.ts` (rewrite) | `closureStats`, curve functions `clearShare`/`medianTarget`/`deepShare`/`freeCap`, gate tolerance. | 1, 6 |
| `src/content/procedural.ts` | Seeds, config, cores (unchanged), cutover call site, certificate, arrow emission order, group catalog. | 4, 6, 8 |
| `tests/closure.test.ts` (new) | Metric unit tests. | 1 |
| `tests/dependency-fill.test.ts` (new) | Fill unit tests on small cubes. | 2, 3 |
| `tests/depth-generation.test.ts` | 2–200 sweep: closure gate, coverage floor, edge heads, time. | 6 |
| `tests/mechanic-counts.test.ts` (new) | 2–200 mechanic totals against the v9 baseline. | 7 |
| `tests/group-divergence.test.ts` (new) | 16–200 group-head divergence. | 8 |
| `tests/fixtures/v8-layouts.json` | Regenerated fingerprints. | 4, 6, 8 |
| Unit tests with layout pins | `procedural`, `generator-variety`, `difficulty`, `stop-content`, `storage`, `directional-content`, `overlap-content` | 4 |
| Browser suites with layout pins | `motion`, `tap`, `runtime`, `preview`, `hints`, `wrap-intro`, `flip`, `wrapping`, `pick`, `seam-fill`, `wormhole`, `overlap` | 10 |
| `README.md`, `CLAUDE.md` | v10 generation and depth-gate prose. | 11 |

---

### Task 1: Closure metric

**Files:**
- Modify: `src/content/difficulty.ts` (add, do not delete the v9 exports yet)
- Create: `tests/closure.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ClosureStats {
    readonly median: number;     // median closure size over tap units
    readonly deepShare: number;  // share of units with closure >= 15
    readonly freeShare: number;  // share of units with closure 0
  }
  export function closureStats(level: LevelDefinition): ClosureStats;
  ```

Definition, fixed here and nowhere else:
- **Units** are `overlappingArrowIds` groups, exactly as `units()` builds them today.
- **Direct prerequisites** of a unit: the set of other units owning a body cell on the unit's route. Each member's route is `arrowTrack(level, member).slice(member.path.length)` (spots, wraps and portals included). A double arrow has two endpoint routes: the head route, and the reversed path's route.
- **Closure** of a single-route unit is the set of units reachable from it through direct-prerequisite edges, found by DFS with a visited set, excluding the unit itself. Cycles are allowed and must terminate.
- A double's closure is the **smaller** of its two endpoint closures, computed separately (endpoint A's direct prerequisites, then DFS over the ordinary graph).
- A group unit's route set is the union of its members' routes.

- [ ] **Step 1: Write the failing tests**

Create `tests/closure.test.ts`:

```ts
import { expect, test } from "bun:test";
import { closureStats } from "../src/content/difficulty";
import type { ArrowDefinition, LevelDefinition } from "../src/core/types";

const cell = (x: number, y: number) => ({ face: "front" as const, x, y });
const board = (arrows: ArrowDefinition[]): LevelDefinition => ({
  id: 9999,
  title: "closure test",
  gridSize: 6,
  lives: 3,
  arrows,
});

test("free arrows have empty closures", () => {
  const stats = closureStats(
    board([
      { id: "a", path: [cell(0, 0), cell(1, 0)] },
      { id: "b", path: [cell(0, 5), cell(1, 5)] },
    ]),
  );
  expect(stats).toEqual({ median: 0, deepShare: 0, freeShare: 1 });
});

test("a straight chain counts every arrow behind it", () => {
  // c1 east into c2's body, c2 north into c3's body, c3 exits west.
  const stats = closureStats(
    board([
      { id: "c1", path: [cell(0, 0), cell(1, 0), cell(2, 0)] },
      { id: "c2", path: [cell(3, 0), cell(3, 1)] },
      { id: "c3", path: [cell(3, 2), cell(2, 2)] },
    ]),
  );
  // closures: c1 -> {c2, c3} = 2, c2 -> {c3} = 1, c3 -> {} = 0
  expect(stats.median).toBe(1);
  expect(stats.freeShare).toBeCloseTo(1 / 3);
});

test("every body on the route counts, not just the first blocker", () => {
  // r heads east along row 0 through b1 at (2,0) and b2 at (4,0).
  const stats = closureStats(
    board([
      { id: "r", path: [cell(0, 0), cell(1, 0)] },
      { id: "b1", path: [cell(2, 1), cell(2, 0)] },
      { id: "b2", path: [cell(4, 1), cell(4, 0)] },
    ]),
  );
  // r's closure is {b1, b2}; b1 and b2 head north off the board, free.
  expect(stats.median).toBe(0);
  expect(stats.freeShare).toBeCloseTo(2 / 3);
  const deep = closureStats(
    board([
      { id: "r", path: [cell(0, 0), cell(1, 0)] },
      { id: "b1", path: [cell(2, 1), cell(2, 0)] },
      { id: "b2", path: [cell(4, 1), cell(4, 0)] },
      { id: "x", path: [cell(0, 1), cell(1, 1)] },
    ]),
  );
  // x heads east along row 1 through b1's tail (2,1) and b2's tail (4,1).
  expect(deep.freeShare).toBeCloseTo(2 / 4);
});

test("a cycle terminates and each member counts the other", () => {
  // a heads east into b's body; b heads west into a's body.
  const stats = closureStats(
    board([
      { id: "a", path: [cell(0, 2), cell(1, 2)] },
      { id: "b", path: [cell(4, 2), cell(3, 2)] },
    ]),
  );
  expect(stats.median).toBe(1);
  expect(stats.freeShare).toBe(0);
});

test("a shared-tail group is one unit whose routes union", () => {
  const stats = closureStats(
    board([
      { id: "g1", path: [cell(0, 3), cell(1, 3), cell(1, 2)] },
      { id: "g2", path: [cell(0, 3), cell(1, 3), cell(1, 4)] },
      { id: "top", path: [cell(0, 0), cell(1, 0)] },
    ]),
  );
  // g1 heads north through (1,1),(1,0): top's body at (1,0). g2 heads south, free.
  // Units: {g1,g2} closure {top} = 1, top closure 0.
  expect(stats.median).toBe(0.5);
  expect(stats.freeShare).toBeCloseTo(1 / 2);
});

test("a double takes its smaller endpoint closure", () => {
  const stats = closureStats(
    board([
      // head end east hits wall at (3,0); tail end west is clear.
      { id: "d", kind: "double", path: [cell(1, 0), cell(2, 0)] },
      { id: "wall", path: [cell(3, 1), cell(3, 0)] },
    ]),
  );
  expect(stats.freeShare).toBe(1);
});

test("deepShare counts closures of fifteen or more", () => {
  // k_i heads east along row 5 through every later k's body, so the
  // closure of k_i is 16 - i: k0 (16) and k1 (15) are deep.
  const chain: ArrowDefinition[] = Array.from({ length: 17 }, (_, index) => ({
    id: `k${index}`,
    path: [
      { face: "front", x: 2 * index, y: 5 },
      { face: "front", x: 2 * index + 1, y: 5 },
    ],
  }));
  const stats = closureStats({ ...board(chain), gridSize: 40 });
  expect(stats.deepShare).toBeCloseTo(2 / 17);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/tests/closure.test.ts`
Expected: FAIL with `closureStats` not exported.

- [ ] **Step 3: Implement `closureStats`**

Append to `src/content/difficulty.ts` (keep the existing v9 exports until Task 4 deletes them). Add `arrowTrack` from `../core/stops` to the imports.

```ts
export interface ClosureStats {
  readonly median: number;
  readonly deepShare: number;
  readonly freeShare: number;
}

/** Closure size at which a unit counts as deep. */
export const DEEP_CLOSURE = 15;

/**
 * Units whose bodies sit on each route of each unit. A double contributes
 * two routes (head and reversed path) that are kept apart, because its
 * closure is the smaller of the two.
 */
function unitRoutes(level: LevelDefinition): {
  list: readonly Unit[];
  owner: ReadonlyMap<string, number>;
  routes: ReadonlyArray<ReadonlyArray<ReadonlySet<number>>>;
} {
  const list = units(level);
  const owner = new Map<string, number>();
  list.forEach((unit, index) => {
    for (const id of unit.memberIds) {
      const arrow = level.arrows.find((entry) => entry.id === id);
      for (const cell of arrow?.path ?? []) owner.set(cellKey(cell), index);
    }
  });
  const onRoute = (arrow: ArrowDefinition, self: number): Set<number> => {
    const found = new Set<number>();
    for (const cell of arrowTrack(level, arrow).slice(arrow.path.length)) {
      const unit = owner.get(cellKey(cell));
      if (unit !== undefined && unit !== self) found.add(unit);
    }
    return found;
  };
  const routes = list.map((unit, index) => {
    const members = unit.memberIds
      .map((id) => level.arrows.find((entry) => entry.id === id))
      .filter((arrow): arrow is ArrowDefinition => arrow !== undefined);
    const lead = members[0];
    if (members.length === 1 && lead?.kind === "double") {
      return [
        onRoute(lead, index),
        onRoute({ ...lead, path: [...lead.path].reverse() }, index),
      ];
    }
    const union = new Set<number>();
    for (const member of members) {
      for (const blocker of onRoute(member, index)) union.add(blocker);
    }
    return [union];
  });
  return { list, owner, routes };
}

export function closureStats(level: LevelDefinition): ClosureStats {
  const { list, routes } = unitRoutes(level);
  // A unit's graph edges are the union of its routes' prerequisites: every
  // route a double might take needs its bodies gone eventually from the
  // perspective of anything waiting on the double.
  const edges = routes.map((sets) => {
    const all = new Set<number>();
    for (const set of sets) for (const unit of set) all.add(unit);
    return all;
  });
  const reach = (start: ReadonlySet<number>, self: number): number => {
    const seen = new Set<number>();
    const stack = [...start];
    while (stack.length > 0) {
      const next = stack.pop() as number;
      if (next === self || seen.has(next)) continue;
      seen.add(next);
      for (const more of edges[next] ?? []) stack.push(more);
    }
    return seen.size;
  };
  const sizes = routes.map((sets, index) =>
    Math.min(...sets.map((set) => reach(set, index))),
  );
  const n = list.length;
  if (n === 0) return { median: 0, deepShare: 0, freeShare: 0 };
  const sorted = [...sizes].sort((a, b) => a - b);
  const middle = Math.floor(n / 2);
  const median =
    n % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return {
    median,
    deepShare: sizes.filter((size) => size >= DEEP_CLOSURE).length / n,
    freeShare: sizes.filter((size) => size === 0).length / n,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/tests/closure.test.ts`
Expected: 7 pass. If "a straight chain" or "a shared-tail group" fails on a geometry detail, fix the test board so each arrow's route is the one described in its comment (draw it on a 6×6 grid). Do not change the metric definition above.

- [ ] **Step 5: Gate and commit**

Run: `make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards checkall`
Expected: exit 0.

```bash
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards add src/content/difficulty.ts tests/closure.test.ts
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards commit -m "feat(difficulty): closure metric over full routes"
```

---

### Task 2: Dependency fill (insertion)

**Files:**
- Create: `src/content/dependency-fill.ts`
- Create: `tests/dependency-fill.test.ts`

**Interfaces:**
- Consumes: `Rng` (export from `procedural.ts` already exists), `advanceHead` from `../core/topology`, `stepSurface`, `oppositeHeading`, `cellKey` from `../core/topology`.
- Produces:
  ```ts
  export interface FillNode {
    readonly id: string;
    readonly arrows: readonly ArrowDefinition[]; // one arrow, or a group's members
    /** Cells past each member's head until it leaves the cube. */
    readonly routeKeys: ReadonlySet<string>;
  }
  export interface FillInput {
    readonly level: Pick<LevelDefinition, "gridSize" | "edgePolicies">;
    readonly rng: Rng;
    readonly idPrefix: string;          // e.g. "r44-"; fill ids are `${idPrefix}${n}`
    readonly firstIndex: number;        // n of the first fill arrow
    readonly target: number;            // fill arrows to place
    readonly attempts: number;          // insertion attempt bound
    readonly clearShare: number;        // probability an attempt must have an empty before-set
    readonly length: () => number;      // body length draw per attempt
    readonly nodes: readonly FillNode[];    // existing graph nodes (group, starters, wrap arrows)
    readonly leadBodies: ReadonlySet<string>;   // lead-core bodies: never a body cell, ray may cross
    readonly forbiddenBody: ReadonlySet<string>; // reserved: no fill body may use
    readonly forbiddenRay: ReadonlySet<string>;  // no fill route may cross
    readonly shapeFull: (path: readonly Cell[]) => boolean;
    readonly countShape: (path: readonly Cell[]) => void;
  }
  export interface FillResult {
    /** Every graph node in removal order: index 0 leaves first. */
    readonly order: readonly FillNode[];
    readonly placed: number;
  }
  export function dependencyFill(input: FillInput): FillResult;
  ```

Rules the implementation must follow (spec §1.2–1.4):
1. A candidate draws a head on any face, a heading, and a body walked backwards with the same turn and seam probabilities as `candidate` in `procedural.ts` (seam 0.38, turn 0.7). Its route comes from `advanceHead`, following wrap edges. A route that loops, or has zero cells, rejects.
2. The body may not touch any existing body, `leadBodies`, `forbiddenBody`, or its own route.
3. The route may not touch `forbiddenRay`.
4. Before-set: nodes owning a body cell on the route (lead bodies are ignored, since leads clear first). After-set: nodes whose `routeKeys` contain a body cell. The two sets must be disjoint, and no after-node may reach a before-node through successor edges.
5. With probability `clearShare` the before-set must be empty.
6. `shapeFull(path)` rejects. On acceptance, call `countShape(path)`.
7. The emitted order is a topological sort, with ties broken by insertion index (a stable Kahn over the final graph). Existing `nodes` take part in the graph like fill nodes.

- [ ] **Step 1: Write the failing tests**

Create `tests/dependency-fill.test.ts`:

```ts
import { expect, test } from "bun:test";
import { dependencyFill, type FillNode } from "../src/content/dependency-fill";
import { Rng } from "../src/content/procedural";
import { simulateMove } from "../src/core/movement";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type { ArrowDefinition, LevelDefinition } from "../src/core/types";
import { validateLevel } from "../src/core/validation";

const base = { gridSize: 10 } as const;

function run(seed: number, clearShare: number, extra: Partial<Parameters<typeof dependencyFill>[0]> = {}) {
  return dependencyFill({
    level: base,
    rng: new Rng(seed),
    idPrefix: "t-",
    firstIndex: 0,
    target: 40,
    attempts: 40 * 400,
    clearShare,
    length: () => 6,
    nodes: [],
    leadBodies: new Set(),
    forbiddenBody: new Set(),
    forbiddenRay: new Set(),
    shapeFull: () => false,
    countShape: () => {},
    ...extra,
  });
}

function asLevel(order: readonly FillNode[]): LevelDefinition {
  return {
    id: 999,
    title: "fill",
    gridSize: base.gridSize,
    lives: 3,
    arrows: order.flatMap((node) => node.arrows),
  };
}

test("the removal order clears the board move by move", () => {
  for (const seed of [1, 2, 3, 4]) {
    const { order } = run(seed, 0);
    const level = asLevel(order);
    expect(validateLevel(level).valid).toBe(true);
    let remaining = level.arrows.map((arrow) => arrow.id);
    for (const node of order) {
      for (const arrow of node.arrows) {
        const result = simulateMove(level, remaining, arrow.id);
        expect(result.kind).toBe("exit");
      }
      const gone = new Set(node.arrows.map((arrow) => arrow.id));
      remaining = remaining.filter((id) => !gone.has(id));
    }
    expect(remaining).toEqual([]);
  }
});

test("fill heads never sit on their exit edge", () => {
  const { order } = run(5, 0);
  const level = asLevel(order);
  for (const arrow of level.arrows) {
    expect(arrowTrack(level, arrow).length).toBeGreaterThan(arrow.path.length);
  }
});

test("clearShare 1 reproduces clear-ray placement", () => {
  const { order } = run(6, 1);
  const level = asLevel(order);
  const all = level.arrows.map((arrow) => arrow.id);
  for (const arrow of level.arrows) {
    // With every route clear at placement, the last-placed arrow is free now.
    expect(["exit", "blocked"]).toContain(simulateMove(level, all, arrow.id).kind);
  }
  expect(simulateMove(level, all, order.at(-1)!.arrows[0]!.id).kind).toBe("exit");
});

test("clearShare 0 builds deeper boards than clearShare 1", () => {
  const blockedAt = (share: number): number => {
    const level = asLevel(run(7, share).order);
    const all = level.arrows.map((arrow) => arrow.id);
    return level.arrows.filter((arrow) => simulateMove(level, all, arrow.id).kind === "blocked").length;
  };
  expect(blockedAt(0)).toBeGreaterThan(blockedAt(1));
});

test("reserved cells stay free of bodies and forbidden cells free of routes", () => {
  const forbiddenBody = new Set(["front:4:4", "front:5:5"]);
  const forbiddenRay = new Set(["top:3:3", "back:6:2"]);
  const { order } = run(8, 0, { forbiddenBody, forbiddenRay });
  const level = asLevel(order);
  for (const arrow of level.arrows) {
    for (const cell of arrow.path) expect(forbiddenBody.has(cellKey(cell))).toBe(false);
    for (const cell of arrowTrack(level, arrow).slice(arrow.path.length)) {
      expect(forbiddenRay.has(cellKey(cell))).toBe(false);
    }
  }
});

test("existing nodes join the graph and appear in the order", () => {
  const starter: ArrowDefinition = {
    id: "s-0",
    path: [
      { face: "front", x: 0, y: 0 },
      { face: "front", x: 1, y: 0 },
    ],
  };
  const node: FillNode = {
    id: "s-0",
    arrows: [starter],
    routeKeys: new Set(arrowTrack(base, starter).slice(2).map(cellKey)),
  };
  const { order } = run(9, 0, { nodes: [node] });
  expect(order.some((entry) => entry.id === "s-0")).toBe(true);
});

test("is deterministic for a seed", () => {
  const first = run(10, 0.3).order.flatMap((node) => node.arrows);
  const second = run(10, 0.3).order.flatMap((node) => node.arrows);
  expect(first).toEqual(second);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/tests/dependency-fill.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the fill**

Create `src/content/dependency-fill.ts`:

```ts
import {
  advanceHead,
  cellKey,
  oppositeHeading,
  stepSurface,
} from "../core/topology";
import type {
  ArrowDefinition,
  Cell,
  FaceId,
  Heading,
  LevelDefinition,
} from "../core/types";
import type { Rng } from "./procedural";

const FACES: readonly FaceId[] = ["front", "back", "right", "left", "top", "bottom"];
const HEADINGS: readonly Heading[] = ["east", "west", "south", "north"];

export interface FillNode {
  readonly id: string;
  readonly arrows: readonly ArrowDefinition[];
  readonly routeKeys: ReadonlySet<string>;
}

export interface FillInput {
  readonly level: Pick<LevelDefinition, "gridSize" | "edgePolicies">;
  readonly rng: Rng;
  readonly idPrefix: string;
  readonly firstIndex: number;
  readonly target: number;
  readonly attempts: number;
  readonly clearShare: number;
  readonly length: () => number;
  readonly nodes: readonly FillNode[];
  readonly leadBodies: ReadonlySet<string>;
  readonly forbiddenBody: ReadonlySet<string>;
  readonly forbiddenRay: ReadonlySet<string>;
  readonly shapeFull: (path: readonly Cell[]) => boolean;
  readonly countShape: (path: readonly Cell[]) => void;
}

export interface FillResult {
  readonly order: readonly FillNode[];
  readonly placed: number;
}

/** Cells past `head` until the route leaves the cube; undefined on a loop. */
export function routeFrom(
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies">,
  head: Cell,
  heading: Heading,
): readonly Cell[] | undefined {
  const route: Cell[] = [];
  const seen = new Set<string>();
  let current = head;
  let direction = heading;
  for (let step = 0; step <= level.gridSize * 24; step += 1) {
    const forward = advanceHead(level, current, direction);
    if (forward.exits) return route;
    if (!forward.next) return undefined;
    const state = `${cellKey(forward.next)}:${forward.heading}`;
    if (seen.has(state)) return undefined;
    seen.add(state);
    route.push(forward.next);
    current = forward.next;
    direction = forward.heading;
  }
  return undefined;
}

/**
 * Place fill arrows whose routes may run through other bodies. Every body
 * on a new arrow's route must leave before it; every node whose route
 * crosses the new body must leave after it. The graph stays acyclic, so a
 * topological order clears the board.
 */
export function dependencyFill(input: FillInput): FillResult {
  const { level, rng } = input;
  const size = level.gridSize;
  const nodes: FillNode[] = [...input.nodes];
  const owner = new Map<string, number>();
  const crossers = new Map<string, Set<number>>();
  const succ: Set<number>[] = [];
  const addNode = (node: FillNode): number => {
    const index = nodes.indexOf(node) >= 0 ? nodes.indexOf(node) : nodes.push(node) - 1;
    succ[index] = succ[index] ?? new Set();
    for (const arrow of node.arrows) {
      for (const cell of arrow.path) owner.set(cellKey(cell), index);
    }
    for (const key of node.routeKeys) {
      const set = crossers.get(key) ?? new Set<number>();
      set.add(index);
      crossers.set(key, set);
    }
    return index;
  };
  for (const node of input.nodes) addNode(node);
  // Edges among pre-existing nodes: a body on another node's route.
  input.nodes.forEach((node, index) => {
    for (const key of node.routeKeys) {
      const blocker = owner.get(key);
      if (blocker !== undefined && blocker !== index) succ[blocker]!.add(index);
    }
  });
  const reaches = (from: Iterable<number>, targets: ReadonlySet<number>): boolean => {
    const seen = new Set<number>();
    const stack = [...from];
    while (stack.length > 0) {
      const next = stack.pop() as number;
      if (targets.has(next)) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      for (const more of succ[next] ?? []) stack.push(more);
    }
    return false;
  };
  const blocked = (key: string): boolean =>
    owner.has(key) || input.leadBodies.has(key) || input.forbiddenBody.has(key);

  let placed = 0;
  for (
    let attempt = 0;
    attempt < input.attempts && placed < input.target;
    attempt += 1
  ) {
    const mustClear = rng.next() < input.clearShare;
    const head: Cell = { face: rng.pick(FACES), x: rng.int(size), y: rng.int(size) };
    const heading = rng.pick(HEADINGS);
    const length = input.length();
    if (blocked(cellKey(head))) continue;
    const route = routeFrom(level, head, heading);
    if (!route || route.length === 0) continue;
    const routeKeys = new Set(route.map(cellKey));
    if (routeKeys.has(cellKey(head))) continue;
    if (route.some((cell) => input.forbiddenRay.has(cellKey(cell)))) continue;
    const used = new Set(routeKeys);
    used.add(cellKey(head));
    const backwards: Cell[] = [head];
    let current = head;
    let previous = oppositeHeading(heading);
    for (let step = 1; step < length; step += 1) {
      const allowed =
        step === 1
          ? [previous]
          : HEADINGS.filter((next) => next !== oppositeHeading(previous));
      const options = allowed
        .map((next) => ({ heading: next, cell: stepSurface(current, next, size) }))
        .filter(({ cell }) => !blocked(cellKey(cell)) && !used.has(cellKey(cell)));
      if (options.length === 0) break;
      const seams = options.filter(({ cell }) => cell.face !== current.face);
      const turn = options.filter(({ heading: next }) => next !== previous);
      const pool =
        seams.length > 0 && rng.next() < 0.38
          ? seams
          : turn.length > 0 && rng.next() < 0.7
            ? turn
            : options;
      const choice = rng.pick(pool);
      backwards.push(choice.cell);
      used.add(cellKey(choice.cell));
      current = choice.cell;
      previous = choice.heading;
    }
    if (backwards.length < 2) continue;
    const path = backwards.reverse();
    if (input.shapeFull(path)) continue;
    const before = new Set<number>();
    for (const key of routeKeys) {
      const blocker = owner.get(key);
      if (blocker !== undefined) before.add(blocker);
    }
    if (mustClear && before.size > 0) continue;
    const after = new Set<number>();
    for (const cell of path) {
      for (const crosser of crossers.get(cellKey(cell)) ?? []) after.add(crosser);
    }
    if ([...after].some((node) => before.has(node))) continue;
    if (before.size > 0 && after.size > 0 && reaches(after, before)) continue;
    const arrow: ArrowDefinition = {
      id: `${input.idPrefix}${input.firstIndex + placed}`,
      path,
    };
    const index = addNode({ id: arrow.id, arrows: [arrow], routeKeys });
    for (const blocker of before) succ[blocker]!.add(index);
    for (const later of after) succ[index]!.add(later);
    input.countShape(path);
    placed += 1;
  }
  return { order: topological(nodes, succ), placed };
}

/** Stable Kahn: ready nodes leave in insertion order. */
function topological(
  nodes: readonly FillNode[],
  succ: readonly Set<number>[],
): readonly FillNode[] {
  const inDegree = nodes.map(() => 0);
  succ.forEach((set) => {
    for (const next of set ?? []) inDegree[next] = (inDegree[next] ?? 0) + 1;
  });
  const ready: number[] = [];
  inDegree.forEach((degree, index) => {
    if (degree === 0) ready.push(index);
  });
  const order: FillNode[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    const next = ready.shift() as number;
    order.push(nodes[next] as FillNode);
    for (const later of succ[next] ?? []) {
      inDegree[later] = (inDegree[later] ?? 0) - 1;
      if (inDegree[later] === 0) ready.push(later);
    }
  }
  if (order.length !== nodes.length) {
    throw new Error("Dependency fill produced a cycle.");
  }
  return order;
}
```

Notes for the implementer:
- `Rng` is imported as a type to avoid a runtime import cycle with `procedural.ts`. `procedural.ts` will import `dependencyFill` in Task 4.
- Existing nodes' before-relations from routes crossing other existing bodies are seeded in the "Edges among pre-existing nodes" loop. A pre-existing cycle there would be a construction bug upstream. `topological` throws, and Task 4 treats a throw as a restart.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/tests/dependency-fill.test.ts`
Expected: 7 pass.

- [ ] **Step 5: Gate and commit**

Run: `make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards checkall`
Expected: exit 0.

```bash
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards add src/content/dependency-fill.ts tests/dependency-fill.test.ts
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards commit -m "feat(generator): dependency-graph fill"
```

---

### Task 3: Tail growth

**Files:**
- Modify: `src/content/dependency-fill.ts`
- Modify: `tests/dependency-fill.test.ts`

**Interfaces:**
- Produces: `dependencyFill` now also grows tails before sorting. `FillInput` gains `readonly maxPathLength: number;` (callers pass 40). Only fill arrows grow (never pre-existing `nodes`).

Growth rule (spec §1.4): repeat sweeps over the fill arrows in insertion order. For each arrow, try its tail's four neighbours in `HEADINGS` order, skipping the second path cell. The first neighbour `c` that satisfies all of these is taken:
- `c` is not blocked (body, lead body or reserved) and not on the arrow's own route;
- the grown path is not `shapeFull`;
- the path stays at `maxPathLength` or fewer;
- the arrow is not reachable from any node whose route crosses `c`, which keeps the graph acyclic.

Taking `c` means prepending it to the path, recording the owner, and adding edges from the arrow to every crosser of `c`. Shape counting: call a new `input.uncountShape(oldPath)` before `countShape(newPath)`. `FillInput` gains `readonly uncountShape: (path: readonly Cell[]) => void;`. Stop when a sweep grows nothing.

- [ ] **Step 1: Write the failing tests**

Append to `tests/dependency-fill.test.ts`, and add `maxPathLength: 40, uncountShape: () => {},` to `run`'s defaults:

```ts
test("tail growth covers most of the cube and keeps the order valid", () => {
  const { order } = run(11, 0);
  const level = asLevel(order);
  const cells = new Set(level.arrows.flatMap((arrow) => arrow.path.map(cellKey)));
  expect(cells.size / (6 * base.gridSize * base.gridSize)).toBeGreaterThan(0.7);
  expect(Math.max(...level.arrows.map((arrow) => arrow.path.length))).toBeLessThanOrEqual(40);
  let remaining = level.arrows.map((arrow) => arrow.id);
  for (const node of order) {
    for (const arrow of node.arrows) {
      expect(simulateMove(level, remaining, arrow.id).kind).toBe("exit");
    }
    const gone = new Set(node.arrows.map((arrow) => arrow.id));
    remaining = remaining.filter((id) => !gone.has(id));
  }
});

test("growth never touches reserved cells and never grows existing nodes", () => {
  const forbiddenBody = new Set<string>();
  for (let x = 0; x < 10; x += 1) forbiddenBody.add(`front:${x}:9`);
  const starter: ArrowDefinition = {
    id: "s-0",
    path: [{ face: "back", x: 0, y: 0 }, { face: "back", x: 1, y: 0 }],
  };
  const node: FillNode = {
    id: "s-0",
    arrows: [starter],
    routeKeys: new Set(arrowTrack(base, starter).slice(2).map(cellKey)),
  };
  const { order } = run(12, 0, { forbiddenBody, nodes: [node] });
  const level = asLevel(order);
  for (const arrow of level.arrows) {
    for (const cell of arrow.path) expect(forbiddenBody.has(cellKey(cell))).toBe(false);
  }
  expect(level.arrows.find((arrow) => arrow.id === "s-0")?.path).toEqual(starter.path);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/tests/dependency-fill.test.ts`
Expected: the coverage test FAILS (coverage near 0.5 without growth), or the file fails to typecheck on the new fields.

- [ ] **Step 3: Implement growth**

In `dependency-fill.ts`: add `maxPathLength` and `uncountShape` to `FillInput`. Record fill node indices in a `fillIndices: number[]` list as they are added. After the placement loop, before `topological`, insert:

```ts
  // Fill nodes hold exactly one arrow; paths are rebuilt, never mutated.
  let grew = true;
  while (grew) {
    grew = false;
    for (const index of fillIndices) {
      const node = nodes[index] as FillNode;
      const arrow = node.arrows[0] as ArrowDefinition;
      if (arrow.path.length >= input.maxPathLength) continue;
      const tail = arrow.path[0] as Cell;
      const second = arrow.path[1] as Cell;
      for (const heading of HEADINGS) {
        const cell = stepSurface(tail, heading, size);
        const key = cellKey(cell);
        if (key === cellKey(second) || blocked(key) || node.routeKeys.has(key)) continue;
        const grownPath = [cell, ...arrow.path];
        if (input.shapeFull(grownPath)) continue;
        const later = crossers.get(key) ?? new Set<number>();
        if (later.has(index) || reaches(later, new Set([index]))) continue;
        input.uncountShape(arrow.path);
        input.countShape(grownPath);
        const next: FillNode = {
          id: node.id,
          arrows: [{ ...arrow, path: grownPath }],
          routeKeys: node.routeKeys,
        };
        nodes[index] = next;
        owner.set(key, index);
        for (const crosser of later) succ[index]!.add(crosser);
        grew = true;
        break;
      }
    }
  }
```

Push each accepted fill node's index into `fillIndices` in the placement loop.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/tests/dependency-fill.test.ts`
Expected: 9 pass.

- [ ] **Step 5: Gate and commit**

Run: `make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards checkall`
Expected: exit 0.

```bash
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards add src/content/dependency-fill.ts tests/dependency-fill.test.ts
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards commit -m "feat(generator): grow fill tails into empty cells"
```

---

### Task 4: Cutover — wire the fill into `generateLevel`

This is the one task allowed past five files (see Global Constraints).

**Files:**
- Modify: `src/content/procedural.ts`
- Modify: `src/content/difficulty.ts` (delete v9 exports)
- Modify: `tests/procedural.test.ts`, `tests/generator-variety.test.ts`, `tests/difficulty.test.ts` (delete), `tests/depth-generation.test.ts`, `tests/stop-content.test.ts`, `tests/storage.test.ts`, `tests/directional-content.test.ts`, `tests/overlap-content.test.ts`
- Modify: `tests/fixtures/v8-layouts.json` (regenerated)

**Interfaces:**
- Consumes: `dependencyFill`, `FillNode`, `routeFrom` (Tasks 2–3), `closureStats` (Task 1).
- Produces:
  - `clearShare(id: number): number` exported from `difficulty.ts`, with provisional waypoints: 1.0 for ids ≤ 4, 0.95 at 6, linear to 0 at 60, then 0. Task 6 re-tunes it.
  - `GENERATOR_VERSION = 10`.
  - `MAX_GENERATED_ARROWS = 200`.
  - `getLevelConfig(id).arrowCount = Math.min(200, id <= 42 ? 36 + 2 * id : id <= 57 ? 150 + 2 * (id - 43) : 178 + 2 * (id - 57))`. Check: 57 → 178. The spec says 170 at 57, but the existing curve gives `150 + 2·14 = 178`. **Use the existing curve unchanged through 57 and keep rising by 2 to the 200 cap** (reached at 68). Record this correction in the spec in Step 9.
  - `level.arrows` order: every graph node's arrows in **reverse** removal order, then lead arrows exactly as they are pushed today.

- [ ] **Step 1: Seeds, version, config, counts**

In `procedural.ts`:
- Set `GENERATOR_VERSION = 10` and `MAX_GENERATED_ARROWS = 200`.
- Rewrite `seedForLevel`: keep the authored ids 5, 11, 15, 20, 25, 30 and 35 exactly as they are. Delete the `id <= 4` and `id <= 10` legacy branches. Every other id returns `` `par-arrows:runtime:${GENERATOR_VERSION}:level:${id}` ``. Delete the comment about "Cubes this release leaves byte-identical".
- Rewrite `getLevelConfig`'s `arrowCount` as above.
- Delete `LEGACY_PARK_PATTERN_COUNT`. In `parkingCore`, use the full `PARK_PATTERNS` for every id: nothing is byte-identical any more.
- Set `FIRST_SHAPE_CAPPED_LEVEL = 2` and rewrite its doc comment to "First generated id whose fill caps repeated shapes."

- [ ] **Step 2: Split reservations**

Inside the construction loop of `generateLevel`, after all cores, starters and wrap arrows are placed (right before the current `// Fill and blocker arrows may not push any canonical shape past...` block), build:

```ts
        // Lead arrows clear first, in certificate order; they are not graph
        // nodes. Their bodies are never fill cells, but a fill route may
        // cross them because they are gone before the fill moves.
        const leadIds = new Set<string>([
          ...(core?.arrows ?? []).map((arrow) => arrow.id),
          ...(directionalSpot?.arrows ?? []).map((arrow) => arrow.id),
          ...(double?.arrows ?? []).map((arrow) => arrow.id),
          ...wormholes.flatMap((entry) => entry.arrows.map((arrow) => arrow.id)),
          ...(flip?.arrows ?? []).map((arrow) => arrow.id),
        ]);
        const leadBodies = new Set(
          arrows
            .filter((arrow) => leadIds.has(arrow.id))
            .flatMap((arrow) => arrow.path.map(cellKey)),
        );
        // Reserved cells no fill body may use: everything `occupied` holds
        // that is not a placed body, plus the parking core's tracks, which
        // must stay clear because the park core leaves before any fill.
        const bodyKeys = new Set(arrows.flatMap((arrow) => arrow.path.map(cellKey)));
        const forbiddenBody = new Set<string>([
          ...[...occupied].filter((key) => !bodyKeys.has(key)),
          ...parkTrackKeys,
        ]);
        // Cells no fill route may cross: circles, spots, flip region cells,
        // portal ends and wormhole core tracks. `rayExemptCells` stays
        // crossable (the directional corridor and wormhole core tracks
        // vacated before the fill moves), so only portal ends remain
        // forbidden from the wormhole reservation.
        const forbiddenRay = new Set<string>(
          [...forbiddenBody].filter((key) => !rayExemptCells?.has(key)),
        );
        for (const key of portalKeys) forbiddenRay.add(key);
```

Graph nodes before the fill: the group (one node), each straight starter, each wrap arrow. Build them with `routeKeys` from `arrowTrack(candidateLevelWithSpots, arrow).slice(arrow.path.length)`, taken over every member for the group. Here `candidateLevelWithSpots` is `candidateLevel` plus the directional core, park spots and flip spots known at this point.

The park-core tracks must not already hold a starter, wrap or group body. The group is placed before the park core and the starters after it, so check it: if any starter, wrap or group body key is in `parkTrackKeys`, set `skip = "park-track"` and `continue construction`. Also pass `parkTrackKeys` into the straight-starter and wrap-arrow placement so they redraw a lane that touches it. Add `|| parkTrackKeys.has(cellKey(cell))` to `straightCandidate`'s occupied check by passing `new Set([...occupied, ...parkTrackKeys])` at both call sites.

- [ ] **Step 3: Replace the fill, blocker and relay passes**

Delete, in `generateLevel`:
- the ordinary fill loop (`for (let attempt = 0; arrows.length < config.arrowCount ...)`);
- `blockerScaffold`, `ensureBlockerScaffold` and `runBlockerPass`;
- the `naturalStats` block and the assembled-board top-up block;
- the whole depth pass (`depthGate`, `chainIds`, `chainLaneKeys`, `aimedCandidate` use);
- the `"blockers"` and `"depth"` skip gates (Task 6 re-adds the gate);
- `...chainIds, ...chainIds` in the certificate.

Delete the now-unused module functions and constants: `aimedCandidate`, `AIM_VECTORS`, `blockedStats`, `BlockedStats`, `blockedTarget` and `blockerReserve`. Delete the `tiers` entry `minArrows: config.arrowCount - 12` for both certificate modes, because density no longer relaxes. Keep three tiers with `minArrows: config.arrowCount`, and certificates `true`, `true`, `false`. (Two certificate tiers keep the restart budget.)

Insert in place of the fill loop:

```ts
        const graphNodes: FillNode[] = [
          ...(groupArrows.length > 0
            ? [
                {
                  id: groupArrows[0]!.id,
                  arrows: groupArrows,
                  routeKeys: new Set(
                    groupArrows.flatMap((arrow) =>
                      arrowTrack(nodeBoard, arrow).slice(arrow.path.length).map(cellKey),
                    ),
                  ),
                },
              ]
            : []),
          ...starterArrows.map((arrow) => ({
            id: arrow.id,
            arrows: [arrow],
            routeKeys: new Set(
              arrowTrack(nodeBoard, arrow).slice(arrow.path.length).map(cellKey),
            ),
          })),
        ];
        const fill = dependencyFill({
          level: candidateLevel,
          rng,
          idPrefix: `r${id}-`,
          firstIndex: arrows.length,
          target: config.arrowCount - arrows.length,
          attempts: config.arrowCount * (900 + 400 * wormholes.length),
          clearShare: clearShare(id),
          length: () =>
            Math.max(
              2,
              Math.floor(targetLength(rng, id, config) * (1 - edgePolicies.length * 0.05)),
            ),
          nodes: graphNodes,
          leadBodies,
          forbiddenBody,
          forbiddenRay,
          maxPathLength: 40,
          shapeFull,
          countShape,
          uncountShape,
        });
        // Emit graph nodes in reverse removal order, then the leads: the
        // certificate's reversed array is then a valid removal order, and
        // `cellsBefore` in the spot passes means "bodies still present when
        // this arrow moves".
        const leads = arrows.filter((arrow) => leadIds.has(arrow.id));
        arrows.length = 0;
        for (const node of [...fill.order].reverse()) arrows.push(...node.arrows);
        arrows.push(...leads);
        for (const arrow of arrows) {
          for (const cell of arrow.path) occupied.add(cellKey(cell));
        }
```

Supporting edits:
- `groupArrows` is the `group` local from the overlap block (hoist it with `let groupArrows: readonly ArrowDefinition[] = []`).
- `starterArrows` collects the straight and wrap arrows as they are pushed.
- `nodeBoard` is `{ ...candidateLevel, directionals: [...(directionalSpot ? [directionalSpot.spot] : []), ...parkSpots, ...(flip ? flip.spots : [])] }`.
- `uncountShape` decrements `shapeCounts` like `countShape` increments it.
- Wrap `dependencyFill` in `try`/`catch`: on a throw, set `skip = "fill-cycle"` and `continue construction`.
- `fill.placed < config.arrowCount - (arrows count before fill)` sets `skip = "count"` and `continue`, exactly as the current `tier.minArrows` check does.

In the certificate, the lead order must be: flip lead, wormhole cores, double core, park legs, **park core arrows**, directional core arrows, then the reversed graph section. Park-core arrows used to unwind inside the reversed section, so add them explicitly after `core.parkLegs`, in the same reverse-placement order `parkingCore` proves: `...(core ? [...core.arrows].reverse().map((arrow) => arrow.id) : [])`. Exclude every lead id from the reversed section:

```ts
          ...[...arrows]
            .reverse()
            .filter((arrow) => !leadIds.has(arrow.id))
            .map((arrow) => arrow.id),
```

`replayCertificate` skips ids already gone, so the doubled directional/park ids are harmless.

- [ ] **Step 4: Delete the v9 metric**

In `difficulty.ts`, delete `CHAIN_TOLERANCE`, `SHARE_TOLERANCE`, `DepthStats`, `depthTarget`, `chainStats`, `blockingEdges`, `longestDepths`, `deepestUnit`, `peelLayers`, `depthStats` and `probeUnit`. Keep `units`, `Unit`, `closureStats`, `DEEP_CLOSURE`, `ClosureStats`.

Add the provisional `clearShare`:

```ts
/** Share of fill placements that must have a clear route: the depth dial. */
export function clearShare(id: number): number {
  if (id <= 4) return 1;
  if (id >= 60) return 0;
  return 0.95 * (1 - Math.max(0, id - 6) / 54);
}
```

Delete `tests/difficulty.test.ts`: its subjects are gone, and `tests/closure.test.ts` replaces it.

- [ ] **Step 5: Regenerate the fixture**

Run: `bun /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/scripts/write-layout-fixture.ts`
Expected: exit 0. `git diff --stat tests/fixtures/v8-layouts.json` shows all 192 generated ids changed, and none of 5, 11, 15, 20, 25, 30, 35 changed.

- [ ] **Step 6: Update unit-test pins**

Make each of these edits. Never loosen a property assertion to make it pass. If a property fails, it is a generator bug, and you stop and report it.

- `tests/procedural.test.ts`:
  - Expect `GENERATOR_VERSION` to be 10.
  - Replace the seed ternary `id <= 4 ? 1 : id <= 10 ? 4 : GENERATOR_VERSION` with `GENERATOR_VERSION`.
  - Regenerate the geometry hashes for levels 2, 3, 4, 10, 12, 13 and 14 by printing `geometryHash(generateLevel(n))` in a scratch run, and replace the comment with `// Re-rolled for generator v10.`
  - Expect `getLevelConfig(1_000_000).arrowCount` to be 200.
  - Rewrite the "v9 config curves" and "keeps the intended v9 curve" expectations for the new count formula (2 → 40, 12 → 60, 40 → 116, 43 → 150, 52 → 168, 57 → 178, 68 → 200).
  - Remove the `blockerReserve` import.
  - The "reverse construction certificate" test replays `[...level.arrows].reverse()` on mechanic-free levels. That stays valid by construction (Step 3), so keep it.
  - In the sweep, the `arrows.length >= arrowCount` assertion stays, and `<= MAX_GENERATED_ARROWS` now means 200.
- `tests/generator-variety.test.ts`:
  - Delete the `blockedTarget`, `blockerReserve` and `blockedStats` tests and the "blocked push" describe block.
  - Keep `chainDepthLimit`, the park pattern tests and the spot chain tests.
- `tests/depth-generation.test.ts`: replace the sweep with a temporary one that asserts only validity and replay, which Task 6 replaces:
  ```ts
  test("every generated id 2-200 validates", () => {
    for (let id = 2; id <= 200; id += 1) {
      if (isAuthoredLevel(id)) continue;
      expect(validateLevel(cachedLevel(id)).valid).toBe(true);
    }
  }, 600_000);
  ```
  Keep the determinism test.
- `tests/stop-content.test.ts`:
  - Rederive the "cube 13 can never park an arrow into a permanent deadlock" test with a scratchpad probe. Scan generated ids 6–30 for a cell on some non-core arrow's route where `crossingParks({ ...level, stops: [...stops, cell] })` is non-empty and `hasStrandingState(endgameOf(...))` is true. Pin the first hit (id, cell, arrow pair), and update the comment to `// Re-rolled for generator v10.`
  - If no id in 2–200 yields a biting trap, replace the pin with the synthetic "stranding check finds a park that deadlocks two arrows" test already in the file. Delete the level-pinned test and say so in the commit message.
  - Keep the "parking never moves an arrow onto another arrow's route" sweep ids unchanged. Those are Review Focus 1.
- `tests/storage.test.ts`, "a fingerprinted save ignores its generator stamp": the level-8 save seeded `par-arrows:runtime:4:level:8` is now a seed mismatch. Change its seed to `seedForLevel(8)` and keep `generatorVersion: 4`, so the test still proves the generator stamp is ignored.
- `tests/directional-content.test.ts`: recount `carriers` over 21–60 with a scratch run and update the literal (comment `// Re-rolled for generator v10.`). Re-check `hasDirectionalCore(19)` and `(16)`: `directionalFaceCount` returns 0 below 21, so these stay false.
- `tests/overlap-content.test.ts`: the "generated cubes wrap group members" test replays `[...level.arrows].reverse()` on cubes without stops or spots. That remains valid. If `wrappedCubes` or `staggeredCubes` falls below 2 over its fixed id list, extend the id list with more ids from 16–200. Do not lower the bound.

Add Review Focus pins to `tests/depth-generation.test.ts`:

```ts
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";

test("no fill route enters a wormhole end", () => {
  for (let id = 36; id <= 200; id += 1) {
    const level = cachedLevel(id);
    const ends = new Set((level.wormholes ?? []).flatMap((hole) => [cellKey(hole.a), cellKey(hole.b)]));
    if (ends.size === 0) continue;
    for (const arrow of level.arrows) {
      if (arrow.id.includes("-wormhole-")) continue;
      const route = arrowTrack({ ...level, wormholes: [] }, arrow).slice(arrow.path.length);
      for (const cell of route) expect(ends.has(cellKey(cell))).toBe(false);
    }
  }
}, 600_000);
```

- [ ] **Step 7: Run the full unit suite**

Run: `bun test --timeout 900000` in the worktree, as `bun test --cwd /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards` if supported, otherwise via `make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards test`.
Expected: all pass.

If a generation sweep throws `Could not deterministically construct runtime level N (last skip: X)`, diagnose by skip reason. `park-track` means redraw starters more times: raise the starter redraw bound to 32. `count` means the fill undershoots: raise `attempts` to `config.arrowCount * 1500`. `replay` means a certificate-order bug: print the failing entry with a scratch replay before changing anything. Never catch-and-ignore.

- [ ] **Step 8: Gate**

Run: `make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards checkall`
Expected: exit 0.

- [ ] **Step 9: Correct the spec's count curve and commit**

Edit spec §2.2 to read: "`getLevelConfig` keeps its current curve through level 57 (178 at 57), then rises by 2 per level to a cap of 200 at level 68."

```bash
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards add -A src tests docs
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards commit -m "feat(generator): v10 dependency-graph construction replaces blocker and relay passes"
```

---

### Task 5: Measure assembled boards

**Files:**
- Create: `scripts/measure-boards.ts`

**Interfaces:**
- Consumes: `generateLevel`, `closureStats`, `arrowTrack`.
- Produces: a table on stdout, one row per id: `id, grid, arrows, coverage, edgeHeads, median, deepShare, freeShare, ms`. Here `edgeHeads` is the share of non-lead arrows whose route is empty.

- [ ] **Step 1: Write the script**

```ts
import { closureStats } from "../src/content/difficulty";
import { generateLevel, isAuthoredLevel } from "../src/content/procedural";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";

const LEAD = /-(park|dir|double|wormhole|flip)-/;
const ids = process.argv.slice(2).map(Number);
for (const id of ids.length > 0 ? ids : Array.from({ length: 199 }, (_, i) => i + 2)) {
  if (isAuthoredLevel(id)) continue;
  const started = performance.now();
  const level = generateLevel(id);
  const ms = Math.round(performance.now() - started);
  const stats = closureStats(level.wormholes ? { ...level, wormholes: [] } : level);
  const covered = new Set(level.arrows.flatMap((arrow) => arrow.path.map(cellKey))).size;
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
```

- [ ] **Step 2: Run it over 2–200**

Run: `bun /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/scripts/measure-boards.ts > /private/tmp/claude-501/-Users-probello-Repos-par-arrows/5f82bb41-d666-4257-8c79-eee9d1f5b453/scratchpad/v10-measure.tsv`
Expected: exit 0, 192 rows. Report these, grouped into bands 2–10, 12–20, 21–40, 41–60 and 61–200:
- minimum and median coverage;
- maximum edge-head share among plain arrows (straight starters are plain and may sit at an edge, so expect a small non-zero value);
- median of `median`, `deepShare` and `freeShare`;
- maximum ms.

- [ ] **Step 3: Commit**

Run `make checkall`, then:

```bash
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards add scripts/measure-boards.ts
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards commit -m "chore(scripts): measure assembled board density and closure"
```

---

### Task 6: Curve waypoints and the closure gate

**Files:**
- Modify: `src/content/difficulty.ts`
- Modify: `src/content/procedural.ts`
- Modify: `tests/closure.test.ts`
- Modify: `tests/depth-generation.test.ts`
- Modify: `tests/fixtures/v8-layouts.json`

**Interfaces:**
- Consumes: the Task 5 measurement table.
- Produces:
  ```ts
  export function medianTarget(id: number): number;
  export function deepShareTarget(id: number): number;
  export function freeCap(id: number): number;
  export const GATE_TOLERANCE = 0.1; // relative: a board passes at 90% of target
  export function meetsDepthGate(id: number, stats: ClosureStats): boolean;
  ```

Waypoint rule: from the Task 5 table, take each band's 10th-percentile value of `median` and `deepShare`, and the 90th-percentile `freeShare`. Place each piecewise-linear waypoint at or inside those percentiles, so about 90% of boards pass on the first construction. Starting waypoints from the spec, to be adjusted only toward the measured percentiles and never past them:
- `medianTarget`: 0 through 11, then 2 at 12 rising to 30 at 60.
- `deepShareTarget`: 0 through 12, then rising to 0.55 at 60.
- `freeCap`: 0.40 through 10, then falling to 0.12 at 60.

`clearShare` is also re-tuned, if needed, so the 41–60 band's median `median` climbs monotonically across the band.

`meetsDepthGate(id, s)` is true when all three hold:
- `s.median >= medianTarget(id) * (1 - GATE_TOLERANCE)`;
- `s.deepShare >= deepShareTarget(id) * (1 - GATE_TOLERANCE)`;
- `s.freeShare <= freeCap(id) * (1 + GATE_TOLERANCE)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/closure.test.ts`, replacing the waypoint numbers with the ones chosen above:

```ts
import { clearShare, deepShareTarget, freeCap, meetsDepthGate, medianTarget } from "../src/content/difficulty";

test("curve waypoints", () => {
  expect(clearShare(2)).toBe(1);
  expect(clearShare(60)).toBe(0);
  expect(clearShare(200)).toBe(0);
  expect(medianTarget(11)).toBe(0);
  expect(medianTarget(12)).toBe(2);
  expect(medianTarget(60)).toBe(30);
  expect(medianTarget(200)).toBe(30);
  expect(deepShareTarget(12)).toBe(0);
  expect(deepShareTarget(60)).toBeCloseTo(0.55);
  expect(freeCap(10)).toBeCloseTo(0.4);
  expect(freeCap(60)).toBeCloseTo(0.12);
});

test("the gate applies a relative tolerance", () => {
  expect(meetsDepthGate(60, { median: 27, deepShare: 0.5, freeShare: 0.13 })).toBe(true);
  expect(meetsDepthGate(60, { median: 26, deepShare: 0.5, freeShare: 0.13 })).toBe(false);
  expect(meetsDepthGate(60, { median: 30, deepShare: 0.55, freeShare: 0.14 })).toBe(false);
});
```

Replace the temporary sweep in `tests/depth-generation.test.ts`:

```ts
import { closureStats, meetsDepthGate } from "../src/content/difficulty";

test("every generated id 2-200 meets its depth gate and density floor", () => {
  const misses: number[] = [];
  for (let id = 2; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    const board = level.wormholes ? { ...level, wormholes: [] } : level;
    if (!meetsDepthGate(id, closureStats(board))) misses.push(id);
    const covered = new Set(level.arrows.flatMap((arrow) => arrow.path.map(cellKey))).size;
    if (level.gridSize >= 13) {
      expect(covered / (6 * level.gridSize ** 2)).toBeGreaterThanOrEqual(0.78);
    }
    for (const arrow of level.arrows) {
      if (!/^r\d+-\d+$/.test(arrow.id)) continue;
      expect(arrowTrack(level, arrow).length).toBeGreaterThan(arrow.path.length);
    }
  }
  // The final tier may ship a short board; allow at most 3% of ids.
  expect(misses.length).toBeLessThanOrEqual(6);
}, 900_000);

test("generation stays under one second per level", () => {
  for (const id of [12, 44, 60, 100, 150, 200]) {
    const started = performance.now();
    generateLevel(id);
    expect(performance.now() - started).toBeLessThan(1000);
  }
}, 60_000);
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/tests/closure.test.ts`
Expected: FAIL (`medianTarget` not exported).

- [ ] **Step 3: Implement the curves and the gate**

In `difficulty.ts`:

```ts
const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * Math.min(1, Math.max(0, t));

export const GATE_TOLERANCE = 0.1;

export function medianTarget(id: number): number {
  if (id < 12) return 0;
  return Math.round(lerp(2, 30, (id - 12) / 48));
}

export function deepShareTarget(id: number): number {
  if (id <= 12) return 0;
  return lerp(0, 0.55, (id - 12) / 48);
}

export function freeCap(id: number): number {
  if (id <= 10) return 0.4;
  return lerp(0.4, 0.12, (id - 10) / 50);
}

export function meetsDepthGate(id: number, stats: ClosureStats): boolean {
  return (
    stats.median >= medianTarget(id) * (1 - GATE_TOLERANCE) &&
    stats.deepShare >= deepShareTarget(id) * (1 - GATE_TOLERANCE) &&
    stats.freeShare <= freeCap(id) * (1 + GATE_TOLERANCE)
  );
}
```

In `procedural.ts`, after the certificate tiers' existing `strand` check and before the certificate is built, add:

```ts
        const statsBoard = wormholes.length > 0 ? { ...level, wormholes: [] } : level;
        if (tier.certificate && !meetsDepthGate(id, closureStats(statsBoard))) {
          skip = "depth";
          continue;
        }
```

- [ ] **Step 4: Regenerate the fixture and run**

Gate-driven restarts change some layouts, so regenerate the fixture: `bun /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/scripts/write-layout-fixture.ts`. Then run `make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards test`.
Expected: all pass. Then re-run the Task 4 Step 6 pins that depend on layout (geometry hashes, `carriers`, the cube-13 trap) and update them. The same five-file limit does not apply to pin refreshes caused by re-rolls, but list every file in the commit message.

- [ ] **Step 5: Gate and commit**

Run: `make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards checkall`
Expected: exit 0.

```bash
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards add -A src tests
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards commit -m "feat(difficulty): closure gate with measured curve waypoints"
```

---

### Task 7: Mechanic-count sweep

**Files:**
- Create: `tests/mechanic-counts.test.ts`

**Interfaces:**
- Consumes: `cachedLevel`, the plan functions (`directionalFacePlan`, `wormholePlan`, `getStopCount`, `flipCoreFrequency`, `doubleArrowFrequency`), `isAuthoredLevel`.

Because the v10 seeds re-roll every plan, compare **placement ratios** (placed ÷ planned) against v9, not raw totals. v9 ratios: static spots 707/845 = 0.837, flip cores 94/97 = 0.969, wormholes 98/105 = 0.933, doubles 72/72 = 1.0, circles 279/279 = 1.0, groups 181/181 = 1.0.

- [ ] **Step 1: Write the test**

```ts
import { expect, test } from "bun:test";
import {
  directionalFacePlan,
  getStopCount,
  isAuthoredLevel,
  wormholePlan,
} from "../src/content/procedural";
import { cachedLevel } from "./generated-levels";

test("mechanic placement ratios stay within 10% of v9", () => {
  const totals = { staticPlanned: 0, staticPlaced: 0, holesPlanned: 0, holesPlaced: 0, stopBudget: 0, stops: 0, groupEligible: 0, groups: 0, flipLevels: 0, doubleLevels: 0 };
  for (let id = 2; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    totals.staticPlanned += directionalFacePlan(id).reduce((sum, count) => sum + count, 0);
    totals.staticPlaced += (level.directionals ?? []).filter((spot) => spot.kind !== "flip").length;
    totals.holesPlanned += wormholePlan(id);
    totals.holesPlaced += level.wormholes?.length ?? 0;
    totals.stopBudget += getStopCount(id);
    totals.stops += level.stops?.length ?? 0;
    if (id >= 16) totals.groupEligible += 1;
    if (level.arrows.some((arrow) => arrow.id.includes("-overlap-"))) totals.groups += 1;
    if ((level.directionals ?? []).some((spot) => spot.kind === "flip")) totals.flipLevels += 1;
    if (level.arrows.some((arrow) => arrow.kind === "double")) totals.doubleLevels += 1;
  }
  expect(totals.staticPlaced / totals.staticPlanned).toBeGreaterThanOrEqual(0.837 * 0.9);
  expect(totals.holesPlaced / totals.holesPlanned).toBeGreaterThanOrEqual(0.933 * 0.9);
  expect(totals.stops).toBe(totals.stopBudget);
  expect(totals.groups).toBe(totals.groupEligible);
  expect(totals.flipLevels).toBeGreaterThanOrEqual(Math.floor(112 / 1.2 * 0.9));
  expect(totals.doubleLevels).toBeGreaterThanOrEqual(Math.floor(72 * 0.9));
}, 900_000);
```

The flip and double thresholds are floors, because their plan draws are not exposed as plain functions. `flipCoreFrequency` and `doubleArrowFrequency` return probabilities, and the draws hash the seed. That is acceptable because v9 placed 97% and 100% of their plans.

- [ ] **Step 2: Run it**

Run: `bun test /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/tests/mechanic-counts.test.ts`

- If it passes, go to Step 4.
- If it fails, **go to Step 3** and report which ratio dropped, by how much, with the Task 5 table beside it.

- [ ] **Step 3 (contingency): Restore mechanic placement**

Only if Step 2 fails. Report to the orchestrator before editing: which mechanic, by how much, and a sample of rejected-candidate reasons from a scratch probe that counts each `continue` in `extraDirectionalSpots`, `reversalBlockers` or `decorativeWormhole`.

Candidate fixes, applied one at a time with the sweep re-run after each:
1. **Spots:** in `extraDirectionalSpots` and `reversalBlockers`, test a traverser's bent route against `cellsBefore` only for cells whose owner is **not** a graph descendant of the traverser. That needs the fill graph passed in, so export `succ` and index maps from `FillResult` as `readonly successors: ReadonlyMap<string, ReadonlySet<string>>` keyed by arrow id. A route body owned by a later-removed node is only a problem if that node cannot move first.
2. **Reversal blockers:** relax "meets exactly one other track" to "meets one to three other tracks". Every placed spot must still be functional, which the optional-mechanics rule requires.
3. **Wormholes:** before the fill, reserve up to 6 candidate end cells per planned decorative hole on the `:wormhole-deco` stream, from cells not on any lead track, and add them to `forbiddenBody`. The decorative pass then draws from those.

Regenerate the fixture after any fix that changes layouts, then re-run Task 6's sweep.

- [ ] **Step 4: Gate and commit**

Run: `make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards checkall`
Expected: exit 0.

```bash
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards add -A src tests
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards commit -m "test(generator): mechanic placement ratios against v9"
```

---

### Task 8: Diverging group heads (F4)

**Files:**
- Modify: `src/content/procedural.ts` (`PAIR_PATTERNS`, `TRIO_PATTERNS`)
- Create: `tests/group-divergence.test.ts`
- Modify: `tests/fixtures/v8-layouts.json`

**Interfaces:**
- Consumes: `overlapStarter` (unchanged), `walkOverlapMember`.
- Produces: new catalog entries named `fork`, `trident` and `seam-fork`.

- [ ] **Step 1: Probe per-pattern acceptance**

Write a scratchpad script: for ids 16–200, record which pattern `overlapStarter` returned, by matching the placed members against each pattern's walk. Also record whether every head shares one face and heading. Report the table: pattern → count → parallel count.

Expected shape: `classic` and `lanes` members end parallel by construction (both final legs are `east`). This drives the 71%.

- [ ] **Step 2: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { isAuthoredLevel } from "../src/content/procedural";
import { overlappingArrowIds } from "../src/core/overlap";
import { headingForPath } from "../src/core/topology";
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
      (memberId) => level.arrows.find((arrow) => arrow.id === memberId)!,
    );
    groups += 1;
    const keys = new Set(
      members.map((member) => `${member.path.at(-1)!.face}:${headingForPath(member.path, level.gridSize)}`),
    );
    if (keys.size === 1) parallel += 1;
  }
  expect(groups).toBeGreaterThan(150);
  expect(parallel / groups).toBeLessThanOrEqual(0.3);
}, 900_000);
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards/tests/group-divergence.test.ts`
Expected: FAIL at about 0.7.

- [ ] **Step 4: Add fork patterns and turn parallel finals**

Add to `PAIR_PATTERNS`:

```ts
  {
    name: "fork",
    lead: false,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 3 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "south", steps: 3 },
      ],
    ],
  },
  {
    name: "seam-fork",
    lead: true,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 3 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "east", untilSeam: true, extra: 1, maxToSeam: 6 },
        { heading: "south", steps: 2 },
      ],
    ],
  },
```

Add to `TRIO_PATTERNS`:

```ts
  {
    name: "trident",
    lead: false,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 3 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "south", steps: 3 },
      ],
      [{ heading: "east", steps: 5 }],
    ],
  },
```

Change `classic`'s members so its heads diverge. The pair keeps its north and south jogs, but each final leg turns outward. Replace the pair's final `{ heading: "east", steps: 1 }` legs with `{ heading: "north", steps: 1 }` and `{ heading: "south", steps: 1 }` respectively. `TRIO_PATTERNS.classic` reuses `PAIR_PATTERNS[0].members` and inherits this.

`walkOverlapMember` rejects a walk that revisits a cell, and `overlapStarter` rejects crossing routes. Re-run Step 1's probe and confirm each new pattern is accepted at least 10 times over 16–200. If a pattern is never accepted, lengthen its outward leg by one step, or drop it. Do not relax the checks.

- [ ] **Step 5: Regenerate the fixture, run, update pins**

Run `bun scripts/write-layout-fixture.ts`, then `make -C … test`. Update layout pins exactly as in Task 6 Step 4. `tests/overlap-content.test.ts` requires `staggeredCubes >= 2`: `staggered` stays in the catalog, so extend the id list if the count falls.

- [ ] **Step 6: Gate and commit**

Run: `make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards checkall`
Expected: exit 0.

```bash
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards add -A src tests
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards commit -m "feat(generator): fork patterns so group heads diverge"
```

---

### Task 9: Owner playtest checkpoint

Not a code task. The orchestrator runs it directly.

- [ ] **Step 1:** Start the dev server in a Herdr pane from the worktree: `make dev` (port 8057).
- [ ] **Step 2:** Give the owner these preview URLs, which never write saves:
  - `http://localhost:8057/?level=12`
  - `http://localhost:8057/?level=44`
  - `http://localhost:8057/?level=100`
  - `http://localhost:8057/?level=6` (early density check)
- [ ] **Step 3:** Stop and wait for the owner's verdict. If the owner says it is still too easy, or too dense to read, re-tune `clearShare` and the Task 6 waypoints or the arrow cap from their feedback. Re-run Tasks 5–7 and ask again. Do not start Task 10 until the owner approves.

---

### Task 10: Browser pins and the full sweep

**Files (at most 5 per commit; split into two commits if needed):**
- Modify: `tests/motion-browser.ts`, `tests/tap-browser.ts`, `tests/runtime-browser.ts`, `tests/preview-browser.ts`, `tests/hints-browser.ts`
- Modify: `tests/wrap-intro-browser.ts`, `tests/flip-browser.ts`, `tests/wrapping-browser.ts`, `tests/pick-browser.ts`, `tests/seam-fill-browser.ts`, plus `tests/wormhole-browser.ts` and `tests/overlap-browser.ts` if they fail

For each pin, re-derive it with a scratchpad probe that searches for the property the test needs. Never loosen an assertion.

- [ ] **Step 1: Re-derive each known pin**
  - `wrap-intro-browser.ts`: `levelTen.arrows.length` becomes `getLevelConfig(10).arrowCount` (56). Keep the assert but use the config value.
  - `motion-browser.ts`: the level-14 `r14-wrap-0`. Probe for the first generated id whose `wrap-0` arrow exists, and pin that id and arrow id. The level-2 blocked-distance search and the level-10 front-face search are computed at runtime: keep them, and confirm they still find an arrow.
  - `flip-browser.ts`: the pending-flip park at level 44. Re-derive with a scratch scan over 31–200. Find an in-region circle where a flip-core arrow parks with a body on a flip spot (pending), the other region arrows clear, and the resume exits with `spotFlips`. Pin the new id, arrow ids, circle cell and spot cell, and update the comment.
  - `flip-browser.ts`: the generated U-turn scan searches 31–200 at runtime. Confirm it still finds one.
  - `wrapping-browser.ts`: `movementLevelId` and `reboundLevelId` are both the literal 54 in `tests/browser-runner.ts:1548-1549`. Re-derive both with a probe for what `crossingArrow` needs: an arrow whose route crosses a wrapping seam, with one `exit` and one `blocked` case.
  - `pick-browser.ts`: `LEVEL_IDS = [2, 44]` at line 9. Keep 2, and re-derive 44 with the probe the file's header comment documents.
  - `seam-fill-browser.ts`: ids `[10, 50]` at line 49 are checked by behaviour (seam pixel gaps). Run them first, and change them only if a level no longer has arrows crossing the seams under test.
  - `runtime-browser.ts`, `preview-browser.ts`, `hints-browser.ts` and `tap-browser.ts` use levels 2, 10, 12 and 1000. Their assertions are behavioural, so run them first and fix only what fails.
- [ ] **Step 2: Build and run the full headed suite**

Run: `make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards browser-test`
Expected: exit 0. Read the log for every suite, not just the tail. A failing pin gets re-derived, then re-run.

- [ ] **Step 3: Run the focused suites**

Run each and confirm exit 0:
```bash
STOP_ONLY=1 make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards browser-test
FLIP_ONLY=1 make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards browser-test
WORMHOLE_ONLY=1 make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards browser-test
OVERLAP_ONLY=1 make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards browser-test
DIRECTIONAL_ONLY=1 make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards browser-test
DOUBLE_ONLY=1 make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards browser-test
PWA_ONLY=1 make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards browser-test
```

- [ ] **Step 4: Gate and commit** (per batch of at most 5 files)

```bash
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards add tests/<files>
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards commit -m "test(browser): re-derive v10 layout pins"
```

---

### Task 11: Documentation, memory, merge

**Files:**
- Modify: `README.md`, `CLAUDE.md`
- Memory: `/Users/probello/.claude/projects/-Users-probello-Repos-par-arrows/memory/` (outside the repo)

- [ ] **Step 1: Rewrite the docs**

In `CLAUDE.md`, edit the "Generation and seeds" and "Depth gate" sections:
- Seeds: every generated id uses the v10 seed `par-arrows:runtime:10:level:<id>`, and authored ids keep theirs.
- Construction: cores first, then dependency-graph fill with tail growth. Arrows are emitted in reverse removal order, and the certificate order is flip lead, wormhole cores, double core, park legs, park core, directional core, then the reversed graph.
- Gate: `closureStats` with `medianTarget`, `deepShareTarget` and `freeCap`, and `clearShare` as the dial.
- Density: coverage floor 0.78; the arrow count curve reaches its 200 cap at level 68; `MAX_GENERATED_ARROWS` is 200.
- Delete every sentence about the blocker top-up, `blockedTarget`, `blockerReserve`, the relay and `aimedCandidate`, and "levels 2–10 keep legacy seeds".
- Update the Tests section: `tests/closure.test.ts`, `tests/dependency-fill.test.ts`, `tests/mechanic-counts.test.ts`, `tests/group-divergence.test.ts` and the depth sweep's new assertions.

In `README.md`, update the density and difficulty line to match.

- [ ] **Step 2: Gate and commit**

Run: `make -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards checkall`
Expected: exit 0.

```bash
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards add README.md CLAUDE.md
git -C /Users/probello/Repos/par-arrows/.claude/worktrees/dense-dependency-boards commit -m "docs: generator v10 dense dependency boards"
```

- [ ] **Step 3: Memory**

The orchestrator writes `par-arrows-generator-v10-shipped.md`, replaces the v9 and density-bump index lines in `MEMORY.md`, and marks those two notes as superseded (a first-line pointer to the v10 note).

- [ ] **Step 4: Rebase, squash-merge, push, clean up**

Following `~/.claude/guides/git-ci.md` (Worktrees):
1. rebase onto `main`;
2. squash-merge into `main` with the message `feat(generator): v10 dense dependency boards`;
3. `make checkall` on `main`;
4. push `main` (standing authorization; a push to `main` deploys);
5. confirm the CI and Pages runs pass;
6. delete the branch, remove the worktree, and confirm `git worktree list` no longer shows it.
