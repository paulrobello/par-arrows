import {
  GENERATOR_VERSION,
  MAX_LEVEL_ID,
  seedForLevel,
} from "./content/procedural";
import { hasFlipSpots } from "./core/directionals";
import { createGameState } from "./core/game-state";
import { overlappingArrowIds } from "./core/overlap";
import {
  arrowTrack,
  maximumOffset,
  settledPathOf,
  stopKeys,
} from "./core/stops";
import { cellKey, headingForPath, oppositeHeading } from "./core/topology";
import type { Cell, GameState, LevelDefinition } from "./core/types";

const STORAGE_KEY = "par-arrows:campaign:v1";
const SETTINGS_KEY = "par-arrows:settings:v1";
const CONTENT_VERSION = 12;

export interface CampaignSave {
  readonly currentLevelId: number;
  readonly unlockedLevelId: number;
  readonly state: GameState;
  readonly tutorialComplete: boolean;
  /** `layoutFingerprint` of the current level; a current save resumes only on a match. */
  readonly layout?: string;
}

export interface LoadedCampaign extends CampaignSave {
  /** Resolved for this session only. It is never written to local storage. */
  readonly level: LevelDefinition;
}

export interface PlayerSettings {
  readonly gridLines: boolean;
  readonly reducedMotion: boolean;
  readonly theme: "system" | "light" | "dark";
  /** Intro levels whose interactive walkthrough has already been shown. */
  readonly tutorialSeenLevels: readonly number[];
}

export interface StorageResult<T> {
  readonly value: T | undefined;
  readonly recovered: boolean;
  readonly contentUpdated: boolean;
}

type StoredCampaign = Omit<Partial<CampaignSave>, "layout"> & {
  readonly contentVersion?: unknown;
  readonly seed?: unknown;
  readonly layout?: unknown;
};

const DEFAULT_SETTINGS: PlayerSettings = {
  gridLines: true,
  reducedMotion: false,
  theme: "system",
  tutorialSeenLevels: [],
};

function getStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isLevelId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_LEVEL_ID
  );
}

function sha1Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const words: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >> 2] =
      (words[index >> 2] ?? 0) |
      ((bytes[index] as number) << (24 - (index % 4) * 8));
  }
  const bitLength = bytes.length * 8;
  words[bitLength >> 5] =
    (words[bitLength >> 5] ?? 0) | (0x80 << (24 - (bitLength % 32)));
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  let e = 0xc3d2e1f0;
  const w = new Int32Array(80);
  for (let block = 0; block < words.length; block += 16) {
    for (let t = 0; t < 80; t += 1) {
      if (t < 16) {
        w[t] = words[block + t] ?? 0;
      } else {
        const x =
          (w[t - 3] as number) ^
          (w[t - 8] as number) ^
          (w[t - 14] as number) ^
          (w[t - 16] as number);
        w[t] = (x << 1) | (x >>> 31);
      }
    }
    let aa = a;
    let bb = b;
    let cc = c;
    let dd = d;
    let ee = e;
    for (let t = 0; t < 80; t += 1) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = (bb & cc) | (~bb & dd);
        k = 0x5a827999;
      } else if (t < 40) {
        f = bb ^ cc ^ dd;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (bb & cc) | (bb & dd) | (cc & dd);
        k = 0x8f1bbcdc;
      } else {
        f = bb ^ cc ^ dd;
        k = 0xca62c1d6;
      }
      const temp =
        (((aa << 5) | (aa >>> 27)) + f + ee + k + (w[t] as number)) | 0;
      ee = dd;
      dd = cc;
      cc = (bb << 30) | (bb >>> 2);
      bb = aa;
      aa = temp;
    }
    a = (a + aa) | 0;
    b = (b + bb) | 0;
    c = (c + cc) | 0;
    d = (d + dd) | 0;
    e = (e + ee) | 0;
  }
  return [a, b, c, d, e]
    .map((word) => (word >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

/** Level definitions are never mutated, so a level's fingerprint is fixed. */
const FINGERPRINTS = new WeakMap<LevelDefinition, string>();

/** A short identity for a resolved level's exact layout. */
export function layoutFingerprint(level: LevelDefinition): string {
  let fingerprint = FINGERPRINTS.get(level);
  if (fingerprint === undefined) {
    fingerprint = sha1Hex(JSON.stringify(level)).slice(0, 16);
    FINGERPRINTS.set(level, fingerprint);
  }
  return fingerprint;
}

/**
 * Parked offsets must name remaining arrows only, stay inside each arrow's
 * track, and move a shared-tail group as one.
 */
function hasValidOffsets(
  value: unknown,
  level: LevelDefinition,
  remainingIds: ReadonlySet<string>,
  overlapGroups: ReadonlyMap<string, readonly string[]>,
): value is Readonly<Record<string, number>> {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const offsets = value as Record<string, unknown>;
  for (const [id, offset] of Object.entries(offsets)) {
    const arrow = level.arrows.find((candidate) => candidate.id === id);
    if (
      !arrow ||
      !remainingIds.has(id) ||
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > maximumOffset(level, arrow)
    ) {
      return false;
    }
  }
  const at = (id: string): number => {
    const offset = offsets[id];
    return typeof offset === "number" ? offset : 0;
  };
  for (const group of overlapGroups.values()) {
    if (group.some((id) => at(id) !== at(group[0] as string))) return false;
  }
  return true;
}

/**
 * No two remaining arrows may settle onto the same cell, whether an arrow is
 * parked by offset or by an exact settled path.
 */
function hasDisjointSettledArrows(
  level: LevelDefinition,
  remainingIds: ReadonlySet<string>,
  offsets: Readonly<Record<string, number>>,
  settledPaths: Readonly<Record<string, readonly Cell[]>>,
): boolean {
  // Shared-tail group members legitimately share cells; anyone else may not.
  const occupied = new Map<string, string>();
  for (const arrow of level.arrows) {
    if (!remainingIds.has(arrow.id)) continue;
    const group = overlappingArrowIds(level, arrow.id);
    for (const cell of settledPathOf(level, { offsets, settledPaths }, arrow)) {
      const key = cellKey(cell);
      const owner = occupied.get(key);
      if (owner !== undefined && !group.includes(owner)) return false;
      occupied.set(key, arrow.id);
    }
  }
  return true;
}

function isCell(value: unknown, gridSize: number): value is Cell {
  if (!value || typeof value !== "object") return false;
  const cell = value as Partial<Cell>;
  return (
    ["front", "back", "right", "left", "top", "bottom"].includes(
      cell.face ?? "",
    ) &&
    Number.isSafeInteger(cell.x) &&
    Number.isSafeInteger(cell.y) &&
    (cell.x ?? -1) >= 0 &&
    (cell.y ?? -1) >= 0 &&
    (cell.x ?? gridSize) < gridSize &&
    (cell.y ?? gridSize) < gridSize
  );
}

function reachableSettledPath(
  level: LevelDefinition,
  arrowId: string,
  expected: readonly Cell[],
): boolean {
  const arrow = level.arrows.find((candidate) => candidate.id === arrowId);
  if (!arrow || arrow.kind !== "double") return false;
  const wanted = expected.map(cellKey).join("|");
  const tracks = [
    arrowTrack(level, arrow),
    arrowTrack(level, { ...arrow, path: [...arrow.path].reverse() }),
  ];
  return tracks.some((track) =>
    Array.from(
      { length: Math.max(0, track.length - arrow.path.length + 1) },
      (_, start) => track.slice(start, start + arrow.path.length),
    ).some((path) => path.map(cellKey).join("|") === wanted),
  );
}

function hasValidSettledPaths(
  value: unknown,
  level: LevelDefinition,
  remainingIds: ReadonlySet<string>,
  groupedIds: ReadonlySet<string>,
): value is Readonly<Record<string, readonly Cell[]>> {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const flipLevel = hasFlipSpots(level);
  for (const [id, pathValue] of Object.entries(value)) {
    const arrow = level.arrows.find((candidate) => candidate.id === id);
    // A shared-tail group parks by one offset shared across its members.
    if (
      !arrow ||
      groupedIds.has(id) ||
      (arrow.kind !== "double" && !flipLevel) ||
      !remainingIds.has(id) ||
      !Array.isArray(pathValue) ||
      pathValue.length !== arrow.path.length ||
      !pathValue.every((cell) => isCell(cell, level.gridSize))
    ) {
      return false;
    }
    const path = pathValue as readonly Cell[];
    if (new Set(path.map(cellKey)).size !== path.length) return false;
    for (let index = 1; index < path.length; index += 1) {
      const previous = path[index - 1];
      const current = path[index];
      if (
        !previous ||
        !current ||
        !headingForPath([previous, current], level.gridSize)
      ) {
        return false;
      }
    }
    if (arrow.kind === "double") {
      if (!reachableSettledPath(level, id, path)) return false;
    } else {
      // Flip-level tracks depend on spot state, so a parked single is checked structurally and must rest on a stop.
      const head = path[path.length - 1];
      if (!head || !stopKeys(level).has(cellKey(head))) return false;
    }
  }
  return true;
}

/** Stored spot directions may name only flip spots, on the spot's own axis. */
function hasValidSpotHeadings(value: unknown, level: LevelDefinition): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [key, heading] of Object.entries(value)) {
    const spot = (level.directionals ?? []).find(
      (entry) => cellKey(entry.cell) === key,
    );
    if (spot?.kind !== "flip") return false;
    if (heading !== spot.heading && heading !== oppositeHeading(spot.heading))
      return false;
  }
  return true;
}

function hasValidFailedPositions(
  value: unknown,
  level: LevelDefinition,
): value is readonly string[] {
  if (value === undefined) return true;
  if (!Array.isArray(value) || new Set(value).size !== value.length)
    return false;
  const doubles = level.arrows
    .filter((arrow) => arrow.kind === "double")
    .sort((left, right) => right.id.length - left.id.length);
  return value.every((key) => {
    if (typeof key !== "string") return false;
    const arrow = doubles.find((candidate) =>
      key.startsWith(`${candidate.id}:`),
    );
    if (!arrow) return false;
    const encoded = key.slice(arrow.id.length + 1);
    const path = encoded.split("|").map((part): Cell | undefined => {
      const [face, x, y] = part.split(":");
      const candidate = { face, x: Number(x), y: Number(y) };
      return isCell(candidate, level.gridSize) ? candidate : undefined;
    });
    return (
      path.length === arrow.path.length &&
      path.every((cell): cell is Cell => cell !== undefined) &&
      reachableSettledPath(level, arrow.id, path)
    );
  });
}

function isState(value: unknown, level: LevelDefinition): value is GameState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameState>;
  const ids = level.arrows.map((arrow) => arrow.id);
  const remaining = candidate.remainingIds;
  const failed = candidate.failedIds;
  const lives = candidate.lives;
  const revision = candidate.revision;
  if (typeof lives !== "number" || typeof revision !== "number") return false;
  if (
    !Array.isArray(remaining) ||
    !Array.isArray(failed) ||
    remaining.length > level.arrows.length ||
    failed.length > level.arrows.length
  ) {
    return false;
  }
  const validIds = (values: unknown[]): boolean =>
    values.every((id) => typeof id === "string" && ids.includes(id));
  const unique = (values: unknown[]): boolean =>
    new Set(values).size === values.length;
  const remainingIds = new Set(remaining as string[]);
  const failedIds = new Set(failed as string[]);
  const overlapGroups = new Map<string, readonly string[]>();
  for (const id of ids) {
    const group = overlappingArrowIds(level, id);
    if (group.length > 1) overlapGroups.set(group[0] as string, group);
  }
  const completeForGroups = (values: ReadonlySet<string>): boolean =>
    [...overlapGroups.values()].every((group) => {
      const membersPresent = group.filter((id) => values.has(id)).length;
      return membersPresent === 0 || membersPresent === group.length;
    });
  if (!completeForGroups(remainingIds) || !completeForGroups(failedIds))
    return false;
  const groupedIds = new Set([...overlapGroups.values()].flat());
  const removedLogicalCount =
    ids.filter((id) => !groupedIds.has(id) && !remainingIds.has(id)).length +
    [...overlapGroups.values()].filter(
      (group) => !remainingIds.has(group[0] as string),
    ).length;
  const failedLogicalCount =
    (failed as string[]).filter((id) => !groupedIds.has(id)).length +
    [...overlapGroups.values()].filter((group) =>
      failedIds.has(group[0] as string),
    ).length +
    (candidate.failedPositions?.length ?? 0);
  const offsets = candidate.offsets;
  if (!hasValidOffsets(offsets, level, remainingIds, overlapGroups)) {
    return false;
  }
  const settledPaths = candidate.settledPaths;
  if (!hasValidSettledPaths(settledPaths, level, remainingIds, groupedIds)) {
    return false;
  }
  if (
    !hasDisjointSettledArrows(
      level,
      remainingIds,
      offsets ?? {},
      settledPaths ?? {},
    )
  ) {
    return false;
  }
  if (!hasValidFailedPositions(candidate.failedPositions, level)) {
    return false;
  }
  if (!hasValidSpotHeadings(candidate.spotHeadings, level)) {
    return false;
  }
  const expectedStatus =
    remaining?.length === 0 ? "won" : lives === 0 ? "lost" : "playing";
  return (
    candidate.levelId === level.id &&
    validIds(remaining) &&
    validIds(failed) &&
    unique(remaining) &&
    unique(failed) &&
    Number.isSafeInteger(lives) &&
    lives >= 0 &&
    lives <= level.lives &&
    lives === level.lives - failedLogicalCount &&
    !(remaining.length === 0 && lives === 0) &&
    Number.isSafeInteger(revision) &&
    revision >= removedLogicalCount + failedLogicalCount &&
    candidate.status === expectedStatus
  );
}

function removeStoredCampaign(store: Storage): void {
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}

/**
 * Restores persisted metadata then resolves the level. This does not write after
 * awaiting the resolver, so callers can discard stale results before persisting.
 */
export async function loadCampaign(
  resolveLevel: (id: number) => Promise<LevelDefinition>,
): Promise<StorageResult<LoadedCampaign>> {
  const store = getStore();
  if (!store) {
    return { value: undefined, recovered: true, contentUpdated: false };
  }

  let parsed: StoredCampaign | undefined;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) {
      return { value: undefined, recovered: false, contentUpdated: false };
    }
    const decoded: unknown = JSON.parse(raw);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      removeStoredCampaign(store);
      return { value: undefined, recovered: true, contentUpdated: false };
    }
    parsed = decoded as StoredCampaign;
  } catch {
    removeStoredCampaign(store);
    return { value: undefined, recovered: true, contentUpdated: false };
  }

  const { currentLevelId, unlockedLevelId } = parsed;
  if (
    !isLevelId(currentLevelId) ||
    !isLevelId(unlockedLevelId) ||
    unlockedLevelId < currentLevelId
  ) {
    removeStoredCampaign(store);
    return { value: undefined, recovered: true, contentUpdated: false };
  }

  const level = await resolveLevel(currentLevelId);
  if (level.id !== currentLevelId) {
    throw new Error(
      `Resolved level ${level.id} does not match ${currentLevelId}`,
    );
  }

  const layout = layoutFingerprint(level);
  const storedLayout = parsed.layout;
  const sameContent =
    parsed.contentVersion === CONTENT_VERSION &&
    typeof storedLayout === "string" &&
    storedLayout === layout &&
    parsed.seed === seedForLevel(currentLevelId);
  const compatible = sameContent && isState(parsed.state, level);
  const restored = parsed.state as GameState | undefined;
  const value: LoadedCampaign = compatible
    ? {
        currentLevelId,
        unlockedLevelId,
        state: {
          ...(restored as GameState),
          offsets: restored?.offsets ?? {},
          settledPaths: restored?.settledPaths ?? {},
          failedPositions: restored?.failedPositions ?? [],
          spotHeadings: restored?.spotHeadings ?? {},
        },
        tutorialComplete: parsed.tutorialComplete === true,
        layout,
        level,
      }
    : {
        currentLevelId,
        unlockedLevelId,
        state: createGameState(level),
        tutorialComplete: parsed.tutorialComplete === true,
        layout,
        level,
      };

  return {
    value,
    recovered: !compatible,
    contentUpdated: !sameContent,
  };
}

/**
 * Persists the campaign with the concurrent-tab conflict policy: the writing
 * tab's attempt (current level, state, tutorial completion) becomes the
 * selected resume state — last writer wins — while unlockedLevelId merges
 * monotonically, so no tab can regress progress another tab already earned.
 * The merge only adopts a stored unlock from a structurally consistent save
 * (both ids valid, unlocked >= current), so a corrupt stored row can never
 * promote progress the player has not earned.
 */
export function saveCampaign(value: CampaignSave): boolean {
  try {
    const store = getStore();
    if (
      !store ||
      !isLevelId(value.currentLevelId) ||
      !isLevelId(value.unlockedLevelId) ||
      value.unlockedLevelId < value.currentLevelId
    ) {
      return false;
    }
    let unlockedLevelId = value.unlockedLevelId;
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<CampaignSave>;
        const storedCurrent = stored.currentLevelId;
        const storedUnlock = stored.unlockedLevelId;
        if (
          isLevelId(storedCurrent) &&
          isLevelId(storedUnlock) &&
          storedUnlock >= storedCurrent &&
          storedUnlock > unlockedLevelId
        ) {
          unlockedLevelId = storedUnlock;
        }
      }
    } catch {
      // An unreadable stored save cannot block this write or contribute a merge.
    }
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({
        currentLevelId: value.currentLevelId,
        unlockedLevelId,
        state: value.state,
        tutorialComplete: value.tutorialComplete,
        contentVersion: CONTENT_VERSION,
        generatorVersion: GENERATOR_VERSION,
        seed: seedForLevel(value.currentLevelId),
        layout: value.layout,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(): PlayerSettings {
  try {
    const raw = getStore()?.getItem(SETTINGS_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Partial<PlayerSettings>)
      : undefined;
    const theme = parsed?.theme;
    const seen = Array.isArray(parsed?.tutorialSeenLevels)
      ? parsed.tutorialSeenLevels
      : [];
    const tutorialSeenLevels: number[] = [];
    for (const levelId of seen)
      if (isLevelId(levelId) && !tutorialSeenLevels.includes(levelId))
        tutorialSeenLevels.push(levelId);
    return {
      gridLines: parsed?.gridLines !== false,
      reducedMotion: parsed?.reducedMotion === true,
      theme:
        theme === "light" || theme === "dark" || theme === "system"
          ? theme
          : "system",
      tutorialSeenLevels,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: PlayerSettings): boolean {
  try {
    getStore()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return Boolean(getStore());
  } catch {
    return false;
  }
}

export function clearCampaign(): void {
  try {
    getStore()?.removeItem(STORAGE_KEY);
  } catch {
    // No recovery action is available when storage is denied.
  }
}
