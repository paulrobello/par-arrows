import {
  getStopCount,
  getWrappingEdgePolicies,
  hasDirectionalCore,
  MAX_LEVEL_ID,
} from "./procedural";

export interface LevelPreview {
  readonly active: boolean;
  readonly requestedLevelId?: number;
  readonly feature?:
    | "wrap"
    | "overlap"
    | "stop"
    | "directional"
    | "double"
    | "flip"
    | "wormhole";
  readonly wraps?: number;
  readonly resolvedLevelId?: number;
  readonly error?: string;
}

const SELECTOR_KEYS = ["level", "feature", "wraps"] as const;
const MAX_SEARCH_LEVELS = 1_000;

function parsePositiveInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_LEVEL_ID
    ? parsed
    : undefined;
}

export function parseLevelPreview(search: string): LevelPreview {
  const params = new URLSearchParams(search);
  if (!SELECTOR_KEYS.some((key) => params.has(key))) return { active: false };

  for (const key of SELECTOR_KEYS) {
    if (params.getAll(key).length > 1) {
      return {
        active: true,
        error: "Use each test selector only once.",
      };
    }
  }

  const rawLevel = params.get("level");
  const requestedLevelId = rawLevel
    ? parsePositiveInteger(rawLevel)
    : undefined;
  if (rawLevel !== null && requestedLevelId === undefined) {
    return {
      active: true,
      error: `Level must be a whole number from 1 through ${MAX_LEVEL_ID}.`,
    };
  }

  const rawFeature = params.get("feature");
  let feature:
    | "wrap"
    | "overlap"
    | "stop"
    | "directional"
    | "double"
    | "flip"
    | "wormhole"
    | undefined;
  if (rawFeature !== null) {
    const normalized = rawFeature.toLowerCase();
    if (["wrap", "wrapping", "wraparound"].includes(normalized)) {
      feature = "wrap";
    } else if (["overlap", "overlapping"].includes(normalized)) {
      feature = "overlap";
    } else if (["stop", "stops", "stopcircle"].includes(normalized)) {
      feature = "stop";
    } else if (["directional", "directionals"].includes(normalized)) {
      feature = "directional";
    } else if (["double", "twoheaded", "two-headed"].includes(normalized)) {
      feature = "double";
    } else if (["flip", "flips", "flipspot"].includes(normalized)) {
      feature = "flip";
    } else if (["wormhole", "portal", "wormholes"].includes(normalized)) {
      feature = "wormhole";
    } else {
      return { active: true, error: `Unknown test feature: ${rawFeature}.` };
    }
  }

  const rawWraps = params.get("wraps");
  let wraps: number | undefined;
  if (rawWraps !== null) {
    if (!/^\d+$/.test(rawWraps)) {
      return { active: true, error: "Wrap count must be 0, 1, 2, or 3." };
    }
    wraps = Number(rawWraps);
    if (!Number.isSafeInteger(wraps) || wraps < 0 || wraps > 3) {
      return { active: true, error: "Wrap count must be 0, 1, 2, or 3." };
    }
  }

  if (feature === "wrap" && wraps === 0) {
    return {
      active: true,
      error: "The wrap feature requires at least one physical wrapped edge.",
    };
  }

  return {
    active: true,
    ...(requestedLevelId === undefined ? {} : { requestedLevelId }),
    ...(feature ? { feature } : {}),
    ...(wraps === undefined ? {} : { wraps }),
  };
}

export function resolveLevelPreview(
  preview: LevelPreview,
  fromLevelId = preview.requestedLevelId ?? 1,
  getPolicies: typeof getWrappingEdgePolicies = getWrappingEdgePolicies,
): LevelPreview {
  if (!preview.active || preview.error) return preview;
  if (
    !Number.isSafeInteger(fromLevelId) ||
    fromLevelId < 1 ||
    fromLevelId > MAX_LEVEL_ID
  ) {
    return {
      ...preview,
      error: `Level must be a whole number from 1 through ${MAX_LEVEL_ID}.`,
    };
  }

  const hasFilter =
    preview.feature !== undefined || preview.wraps !== undefined;
  if (!hasFilter) {
    return { ...preview, resolvedLevelId: fromLevelId };
  }

  const requiresWrap = preview.feature === "wrap" || (preview.wraps ?? 0) > 0;
  if (preview.feature === "double") {
    return { ...preview, resolvedLevelId: 25 };
  }
  if (preview.feature === "flip") {
    return { ...preview, resolvedLevelId: 30 };
  }
  if (preview.feature === "wormhole") {
    return { ...preview, resolvedLevelId: 35 };
  }
  const startLevelId =
    preview.feature === "overlap"
      ? Math.max(15, fromLevelId)
      : preview.feature === "stop"
        ? Math.max(5, fromLevelId)
        : preview.feature === "directional"
          ? Math.max(20, fromLevelId)
          : requiresWrap
            ? Math.max(11, fromLevelId)
            : fromLevelId;
  const finalLevelId = Math.min(
    MAX_LEVEL_ID,
    startLevelId + Math.min(MAX_SEARCH_LEVELS - 1, MAX_LEVEL_ID - startLevelId),
  );
  for (let levelId = startLevelId; levelId <= finalLevelId; levelId += 1) {
    const physicalWraps =
      preview.feature === "wrap" || preview.wraps !== undefined
        ? getPolicies(levelId).length / 2
        : 0;
    if (
      (preview.feature !== "wrap" || physicalWraps >= 1) &&
      (preview.feature !== "stop" || getStopCount(levelId) >= 1) &&
      (preview.feature !== "directional" || hasDirectionalCore(levelId)) &&
      (preview.wraps === undefined || physicalWraps === preview.wraps)
    ) {
      return { ...preview, resolvedLevelId: levelId };
    }
  }
  return {
    ...preview,
    error: `No matching cube was found within ${MAX_SEARCH_LEVELS} levels.`,
  };
}
