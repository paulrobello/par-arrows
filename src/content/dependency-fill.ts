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

const FACES: readonly FaceId[] = [
  "front",
  "back",
  "right",
  "left",
  "top",
  "bottom",
];
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
  readonly uncountShape: (path: readonly Cell[]) => void;
  readonly maxPathLength: number;
}

export interface FillResult {
  readonly order: readonly FillNode[];
  readonly placed: number;
}

/**
 * Cells past `head` until the route leaves the cube; undefined on a loop, at
 * the step cap, or when a step yields no next cell.
 */
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
    const index =
      nodes.indexOf(node) >= 0 ? nodes.indexOf(node) : nodes.push(node) - 1;
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
  const reaches = (
    from: Iterable<number>,
    targets: ReadonlySet<number>,
  ): boolean => {
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

  const fillIndices: number[] = [];
  let placed = 0;
  for (
    let attempt = 0;
    attempt < input.attempts && placed < input.target;
    attempt += 1
  ) {
    const mustClear = rng.next() < input.clearShare;
    const head: Cell = {
      face: rng.pick(FACES),
      x: rng.int(size),
      y: rng.int(size),
    };
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
        .map((next) => ({
          heading: next,
          cell: stepSurface(current, next, size),
        }))
        .filter(
          ({ cell }) => !blocked(cellKey(cell)) && !used.has(cellKey(cell)),
        );
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
      for (const crosser of crossers.get(cellKey(cell)) ?? [])
        after.add(crosser);
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
    fillIndices.push(index);
    placed += 1;
  }
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
        if (key === cellKey(second) || blocked(key) || node.routeKeys.has(key))
          continue;
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
    throw new Error("Dependency fill input nodes contain a cycle.");
  }
  return order;
}
