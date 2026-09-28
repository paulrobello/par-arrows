import { expect, test } from "bun:test";
import { dependencyFill, type FillNode } from "../src/content/dependency-fill";
import { Rng } from "../src/content/procedural";
import { simulateMove } from "../src/core/movement";
import { arrowTrack } from "../src/core/stops";
import { cellKey, seamTransition } from "../src/core/topology";
import type {
  ArrowDefinition,
  Cell,
  EdgePolicyDefinition,
  FaceId,
  Heading,
  LevelDefinition,
} from "../src/core/types";
import { validateLevel } from "../src/core/validation";

const base = { gridSize: 10 } as const;

function run(
  seed: number,
  clearShare: number,
  extra: Partial<Parameters<typeof dependencyFill>[0]> = {},
) {
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
    maxPathLength: 40,
    uncountShape: () => {},
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
  expect(simulateMove(level, all, order[0]!.arrows[0]!.id).kind).toBe("exit");
});

test("clearShare 0 builds deeper boards than clearShare 1", () => {
  const blockedAt = (share: number): number => {
    const level = asLevel(run(7, share).order);
    const all = level.arrows.map((arrow) => arrow.id);
    return level.arrows.filter(
      (arrow) => simulateMove(level, all, arrow.id).kind === "blocked",
    ).length;
  };
  expect(blockedAt(0)).toBeGreaterThan(blockedAt(1));
});

test("reserved cells stay free of bodies and forbidden cells free of routes", () => {
  const forbiddenBody = new Set(["front:4:4", "front:5:5"]);
  const forbiddenRay = new Set(["top:3:3", "back:6:2"]);
  const { order } = run(8, 0, { forbiddenBody, forbiddenRay });
  const level = asLevel(order);
  for (const arrow of level.arrows) {
    for (const cell of arrow.path)
      expect(forbiddenBody.has(cellKey(cell))).toBe(false);
    for (const cell of arrowTrack(level, arrow).slice(arrow.path.length)) {
      expect(forbiddenRay.has(cellKey(cell))).toBe(false);
    }
  }
});

test("an existing node whose route crosses another existing body leaves after it", () => {
  const starterNode = (arrow: ArrowDefinition): FillNode => ({
    id: arrow.id,
    arrows: [arrow],
    routeKeys: new Set(
      arrowTrack(base, arrow).slice(arrow.path.length).map(cellKey),
    ),
  });
  // A's head points east along row 5, straight at B's vertical body.
  const a = starterNode({
    id: "s-a",
    path: [
      { face: "front", x: 1, y: 5 },
      { face: "front", x: 2, y: 5 },
    ],
  });
  const b = starterNode({
    id: "s-b",
    path: [
      { face: "front", x: 6, y: 4 },
      { face: "front", x: 6, y: 5 },
      { face: "front", x: 6, y: 6 },
    ],
  });
  const bBody = b.arrows[0]!.path.map(cellKey);
  expect(bBody.some((key) => a.routeKeys.has(key))).toBe(true);
  const { order } = run(9, 0, { nodes: [a, b] });
  const at = (id: string): number => order.findIndex((node) => node.id === id);
  expect(at("s-b")).toBeGreaterThanOrEqual(0);
  expect(at("s-b")).toBeLessThan(at("s-a"));
  const level = asLevel(order);
  expect(validateLevel(level).valid).toBe(true);
  let remaining = level.arrows.map((arrow) => arrow.id);
  for (const node of order) {
    for (const arrow of node.arrows) {
      expect(simulateMove(level, remaining, arrow.id).kind).toBe("exit");
    }
    const gone = new Set(node.arrows.map((arrow) => arrow.id));
    remaining = remaining.filter((id) => !gone.has(id));
  }
  expect(remaining).toEqual([]);
});

test("routes follow continuation edges and the order still replays", () => {
  const size = base.gridSize;
  const wrap = (face: FaceId, edge: Heading): EdgePolicyDefinition => {
    const boundary: Cell =
      edge === "east" || edge === "west"
        ? { face, x: edge === "east" ? size - 1 : 0, y: 0 }
        : { face, x: 0, y: edge === "south" ? size - 1 : 0 };
    const transition = seamTransition(boundary, edge, size);
    return {
      face,
      edge,
      policy: "continue",
      neighbor: { face: transition.cell.face, entering: transition.heading },
    };
  };
  const edgePolicies = [
    wrap("front", "east"),
    wrap("top", "north"),
    wrap("left", "south"),
  ];
  const { order } = run(11, 0, { level: { gridSize: size, edgePolicies } });
  const level: LevelDefinition = { ...asLevel(order), edgePolicies };
  expect(validateLevel(level).valid).toBe(true);
  const wrapped = level.arrows.filter((arrow) => {
    const head = arrow.path.at(-1)!;
    return arrowTrack(level, arrow)
      .slice(arrow.path.length)
      .some((cell) => cell.face !== head.face);
  });
  expect(wrapped.length).toBeGreaterThan(0);
  let remaining = level.arrows.map((arrow) => arrow.id);
  for (const node of order) {
    for (const arrow of node.arrows) {
      expect(simulateMove(level, remaining, arrow.id).kind).toBe("exit");
    }
    const gone = new Set(node.arrows.map((arrow) => arrow.id));
    remaining = remaining.filter((id) => !gone.has(id));
  }
  expect(remaining).toEqual([]);
});

test("is deterministic for a seed", () => {
  const first = run(10, 0.3).order.flatMap((node) => node.arrows);
  const second = run(10, 0.3).order.flatMap((node) => node.arrows);
  expect(first).toEqual(second);
});

test("tail growth covers most of the cube and keeps the order valid", () => {
  const { order } = run(11, 0);
  const level = asLevel(order);
  const cells = new Set(
    level.arrows.flatMap((arrow) => arrow.path.map(cellKey)),
  );
  expect(cells.size / (6 * base.gridSize * base.gridSize)).toBeGreaterThan(0.7);
  const bodyCells = level.arrows.reduce(
    (total, arrow) => total + arrow.path.length,
    0,
  );
  expect(cells.size).toBe(bodyCells);
  expect(
    Math.max(...level.arrows.map((arrow) => arrow.path.length)),
  ).toBeLessThanOrEqual(40);
  let remaining = level.arrows.map((arrow) => arrow.id);
  for (const node of order) {
    for (const arrow of node.arrows) {
      expect(simulateMove(level, remaining, arrow.id).kind).toBe("exit");
    }
    const gone = new Set(node.arrows.map((arrow) => arrow.id));
    remaining = remaining.filter((id) => !gone.has(id));
  }
});

test("tail growth stops exactly at the path cap", () => {
  const cap = 8;
  const { order } = run(11, 0, { maxPathLength: cap, length: () => 4 });
  const lengths = order.flatMap((node) =>
    node.arrows.map((arrow) => arrow.path.length),
  );
  expect(lengths.length).toBeGreaterThan(0);
  for (const length of lengths) expect(length).toBeLessThanOrEqual(cap);
  expect(lengths.some((length) => length === cap)).toBe(true);
});

test("growth never touches reserved cells and never grows existing nodes", () => {
  const forbiddenBody = new Set<string>();
  for (let x = 0; x < 10; x += 1) forbiddenBody.add(`front:${x}:9`);
  const starter: ArrowDefinition = {
    id: "s-0",
    path: [
      { face: "back", x: 0, y: 0 },
      { face: "back", x: 1, y: 0 },
    ],
  };
  const node: FillNode = {
    id: "s-0",
    arrows: [starter],
    routeKeys: new Set(arrowTrack(base, starter).slice(2).map(cellKey)),
  };
  const { order } = run(12, 0, { forbiddenBody, nodes: [node] });
  const level = asLevel(order);
  for (const arrow of level.arrows) {
    for (const cell of arrow.path)
      expect(forbiddenBody.has(cellKey(cell))).toBe(false);
  }
  expect(level.arrows.find((arrow) => arrow.id === "s-0")?.path).toEqual(
    starter.path,
  );
});
