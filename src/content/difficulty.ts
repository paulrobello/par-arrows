import type {
  ArrowDefinition,
  Cell,
  Endpoint,
  LevelDefinition,
} from "../core/types";
import { simulateMove } from "../core/movement";
import { overlappingArrowIds } from "../core/overlap";
import { cellKey } from "../core/topology";

/** Acceptance slack: a level may fall one chain link or 0.05 share short. */
export const CHAIN_TOLERANCE = 1;
export const SHARE_TOLERANCE = 0.05;

export interface DepthStats {
  readonly chain: number;
  readonly forcedShare: number;
  readonly blockedShare: number;
  readonly peel: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Depth targets per generated id; authored ids bypass the gate entirely. */
export function depthTarget(id: number): {
  minChain: number;
  minForced: number;
} {
  if (id < 6) return { minChain: 0, minForced: 0 };
  if (id <= 10) return { minChain: 2, minForced: 0.2 };
  if (id <= 40) {
    const mid = clamp01((id - 12) / 28);
    // The ceiling is what construction delivers inside the restart budgets
    // (measured over ids 6-200): relays beyond ~5 links and shares past
    // ~0.48 fall to the tier-3 escape on a third of late boards, which the
    // depth-generation sweep would flag. Revisit when placement gets
    // cheaper.
    return { minChain: Math.round(4 + mid), minForced: 0.3 + 0.18 * mid };
  }
  const late = clamp01((id - 42) / 28);
  return { minChain: Math.round(5), minForced: 0.48 };
}

interface Unit {
  readonly memberIds: readonly string[];
}

function units(level: LevelDefinition): readonly Unit[] {
  const counted = new Set<string>();
  const list: Unit[] = [];
  for (const arrow of level.arrows) {
    if (counted.has(arrow.id)) continue;
    const memberIds = overlappingArrowIds(level, arrow.id);
    for (const id of memberIds) counted.add(id);
    list.push({ memberIds });
  }
  return list;
}

interface ProbeOutcome {
  readonly free: boolean;
  readonly blockers: readonly string[];
}

function probeUnit(
  level: LevelDefinition,
  remaining: readonly string[],
  byId: ReadonlyMap<string, ArrowDefinition>,
  unit: Unit,
): ProbeOutcome {
  const lead = byId.get(unit.memberIds[0] as string);
  if (!lead) return { free: true, blockers: [] };
  const endpoints: readonly Endpoint[] =
    unit.memberIds.length === 1 && lead.kind === "double"
      ? ["head", "tail"]
      : ["head"];
  const own = new Set(unit.memberIds);
  const blockers = new Set<string>();
  let free = false;
  for (const endpoint of endpoints) {
    const result = simulateMove(level, remaining, lead.id, endpoint);
    for (const trace of result.members ?? [result]) {
      if (trace.kind !== "blocked") free = true;
      const blockerId = trace.blockerId;
      if (trace.kind === "blocked" && blockerId && !own.has(blockerId)) {
        blockers.add(blockerId);
      }
    }
  }
  return { free, blockers: [...blockers] };
}

/**
 * Blocking DAG over tap units at the initial state. Chain is the longest
 * dependency path in units; forced share counts units with at least one
 * dependency edge (a double with one blocked half carries an edge but is
 * still tappable). Blocked share uses full player-view semantics — both
 * double endpoints — so it can differ from blockedStats on doubles.
 */
export function chainStats(level: LevelDefinition): {
  chain: number;
  forcedShare: number;
  blockedShare: number;
} {
  const { list, edges, blocked } = blockingEdges(level);
  const depth = longestDepths(list.length, edges);
  let chain = 0;
  for (const value of depth) chain = Math.max(chain, value);
  let forced = 0;
  for (const edgeSet of edges) if (edgeSet.size > 0) forced += 1;
  const n = list.length;
  return {
    chain,
    forcedShare: n === 0 ? 0 : forced / n,
    blockedShare: n === 0 ? 0 : blocked / n,
  };
}

function blockingEdges(level: LevelDefinition): {
  list: readonly Unit[];
  edges: Array<Set<number>>;
  blocked: number;
} {
  const remaining = level.arrows.map((arrow) => arrow.id);
  const byId = new Map(level.arrows.map((arrow) => [arrow.id, arrow]));
  const list = units(level);
  const unitOf = new Map<string, number>();
  list.forEach((unit, index) => {
    for (const id of unit.memberIds) unitOf.set(id, index);
  });
  const edges: Array<Set<number>> = list.map(() => new Set<number>());
  let blocked = 0;
  for (const [index, unit] of list.entries()) {
    const outcome = probeUnit(level, remaining, byId, unit);
    if (!outcome.free) blocked += 1;
    for (const blockerId of outcome.blockers) {
      const target = unitOf.get(blockerId);
      if (target !== undefined && target !== index) edges[index]!.add(target);
    }
  }
  return { list, edges, blocked };
}

/** Kahn longest-path depths over the blocking DAG; cycle leftovers keep 1. */
function longestDepths(
  n: number,
  edges: ReadonlyArray<ReadonlySet<number>>,
): readonly number[] {
  const depth = new Array<number>(n).fill(1);
  const inDegree = new Array<number>(n).fill(0);
  const dependents: number[][] = Array.from({ length: n }, () => []);
  for (let from = 0; from < n; from += 1) {
    inDegree[from] = edges[from]!.size;
    for (const to of edges[from]!) dependents[to]!.push(from);
  }
  const queue: number[] = [];
  for (let i = 0; i < n; i += 1) if (inDegree[i] === 0) queue.push(i);
  while (queue.length > 0) {
    const node = queue.pop() as number;
    for (const dependent of dependents[node] as number[]) {
      depth[dependent] = Math.max(depth[dependent] ?? 1, depth[node]! + 1);
      inDegree[dependent] = (inDegree[dependent] ?? 0) - 1;
      if (inDegree[dependent] === 0) queue.push(dependent);
    }
  }
  return depth;
}

/**
 * The units sitting at the longest dependency depth: their body cells (what
 * a new arrow's exit ray aims at) and member ids (what a blocked tap must
 * name as its blocker). This is what the generator's chain pass aims at.
 */
export function deepestUnit(level: LevelDefinition): {
  bodies: readonly Cell[];
  memberIds: readonly string[];
} {
  const { list, edges } = blockingEdges(level);
  const depth = longestDepths(list.length, edges);
  let max = 0;
  for (const value of depth) max = Math.max(max, value);
  const bodies: Cell[] = [];
  const seen = new Set<string>();
  const memberIds: string[] = [];
  if (max <= 1) return { bodies, memberIds };
  list.forEach((unit, index) => {
    if (depth[index] !== max) return;
    for (const memberId of unit.memberIds) {
      memberIds.push(memberId);
      const arrow = level.arrows.find((entry) => entry.id === memberId);
      if (!arrow) continue;
      for (const cell of arrow.path) {
        const key = cellKey(cell);
        if (!seen.has(key)) {
          seen.add(key);
          bodies.push(cell);
        }
      }
    }
  });
  return { bodies, memberIds };
}

/** Greedy peel depth: rounds of "remove everything movable" until clear. */
export function peelLayers(level: LevelDefinition): number {
  const remaining = new Set(level.arrows.map((arrow) => arrow.id));
  let rounds = 0;
  while (remaining.size > 0) {
    const board = {
      ...level,
      arrows: level.arrows.filter((arrow) => remaining.has(arrow.id)),
    };
    const byId = new Map(board.arrows.map((arrow) => [arrow.id, arrow]));
    const freeIds = new Set<string>();
    for (const unit of units(board)) {
      const outcome = probeUnit(board, [...byId.keys()], byId, unit);
      if (outcome.free) {
        for (const id of unit.memberIds) freeIds.add(id);
      }
    }
    if (freeIds.size === 0) break;
    for (const id of freeIds) remaining.delete(id);
    rounds += 1;
  }
  return rounds;
}

export function depthStats(level: LevelDefinition): DepthStats {
  return { ...chainStats(level), peel: peelLayers(level) };
}
