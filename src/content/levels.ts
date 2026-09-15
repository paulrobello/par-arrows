import { forwardInfo, oppositeHeading, seamTransition } from "../core/topology";
import type {
  ArrowDefinition,
  Cell,
  FaceId,
  Heading,
  LevelDefinition,
} from "../core/types";
import { CAMPAIGN_LAYOUTS } from "./campaign-layouts";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

function boundaryCell(
  face: FaceId,
  heading: Heading,
  lane: number,
  gridSize: number,
): Cell {
  switch (heading) {
    case "east":
      return cell(face, gridSize - 1, lane);
    case "west":
      return cell(face, 0, lane);
    case "south":
      return cell(face, lane, gridSize - 1);
    case "north":
      return cell(face, lane, 0);
  }
}

function straightPath(
  face: FaceId,
  heading: Heading,
  lane: number,
  length: number,
  gridSize: number,
): readonly Cell[] {
  const path: Cell[] = [boundaryCell(face, heading, lane, gridSize)];
  let current = path[0];
  if (!current) throw new Error("Static straight route has no boundary cell.");
  for (let index = 1; index < length; index += 1) {
    const behind: Cell | undefined = forwardInfo(
      current,
      oppositeHeading(heading),
      gridSize,
    ).next;
    if (!behind)
      throw new Error("Static straight route extends beyond its face.");
    path.push(behind);
    current = behind;
  }
  return path.reverse();
}

function bentPath(
  face: FaceId,
  heading: Heading,
  lane: number,
  gridSize: number,
): readonly Cell[] {
  const path = [...straightPath(face, heading, lane, 3, gridSize)];
  const tail = path[0];
  if (!tail) throw new Error("Static bent route has no tail.");
  const turns: readonly Heading[] =
    heading === "east" || heading === "west"
      ? ["north", "south"]
      : ["east", "west"];
  const corner = turns
    .map((turn) => forwardInfo(tail, turn, gridSize).next)
    .find(Boolean);
  if (!corner) throw new Error("Static bent route has no corner.");
  return [corner, ...path];
}

function wrappedPath(
  face: FaceId,
  heading: Heading,
  lane: number,
  crossings: number,
  gridSize: number,
): readonly Cell[] {
  if (!Number.isInteger(crossings) || crossings < 1 || crossings > 3) {
    throw new Error(
      `Static wrapped route requires 1-3 seam crossings, received ${crossings}.`,
    );
  }
  const boundary = boundaryCell(face, heading, lane, gridSize);
  const tail = forwardInfo(boundary, oppositeHeading(heading), gridSize).next;
  if (!tail) throw new Error("Static wrapped route has no source tail.");
  const path: Cell[] = [tail, boundary];
  let transition = seamTransition(boundary, heading, gridSize);
  path.push(transition.cell);
  let current = transition.cell;
  let currentHeading = transition.heading;
  let crossed = 1;
  const maximumSteps = crossings * (gridSize + 1);
  for (let step = 0; step < maximumSteps; step += 1) {
    const forward = forwardInfo(current, currentHeading, gridSize);
    if (forward.exits) {
      if (crossed === crossings) return path;
      transition = seamTransition(current, currentHeading, gridSize);
      path.push(transition.cell);
      current = transition.cell;
      currentHeading = transition.heading;
      crossed += 1;
    } else if (forward.next) {
      path.push(forward.next);
      current = forward.next;
    }
  }
  throw new Error(
    `Static wrapped route did not reach its ${crossings}-seam exit within ${maximumSteps} steps.`,
  );
}

function dependencyPath(face: FaceId, role: string): readonly Cell[] {
  switch (role) {
    case "blocked":
      return [cell(face, 1, 0), cell(face, 2, 0)];
    case "clear":
      return [cell(face, 3, 1), cell(face, 3, 0)];
    case "a":
      return [cell(face, 0, 0), cell(face, 1, 0)];
    case "b":
      return [cell(face, 2, 0), cell(face, 3, 0)];
    case "c":
      return [cell(face, 4, 1), cell(face, 4, 0)];
    default:
      throw new Error(`Unknown static dependency role ${role}.`);
  }
}

export function decodeCampaignArrow(
  id: string,
  gridSize: number,
): ArrowDefinition {
  const dependency =
    /^l\d+-(front|back|right|left|top|bottom)-dependency-(blocked|clear|a|b|c)$/.exec(
      id,
    );
  if (dependency?.[1] && dependency[2])
    return { id, path: dependencyPath(dependency[1] as FaceId, dependency[2]) };
  const route =
    /^l\d+-(straight|bend|wrap)-(front|back|right|left|top|bottom)-(east|west|south|north)-(\d+)(?:-(\d+))?$/.exec(
      id,
    );
  if (!route?.[1] || !route[2] || !route[3] || !route[4])
    throw new Error(`Unknown static campaign route ${id}.`);
  const [, type, faceValue, headingValue, laneValue, lengthValue] = route;
  const face = faceValue as FaceId;
  const heading = headingValue as Heading;
  const lane = Number(laneValue);
  if (type === "straight") {
    if (!lengthValue)
      throw new Error(`Static straight route ${id} lacks a length.`);
    return {
      id,
      path: straightPath(face, heading, lane, Number(lengthValue), gridSize),
    };
  }
  if (type === "bend")
    return { id, path: bentPath(face, heading, lane, gridSize) };
  if (!lengthValue)
    throw new Error(`Static wrapped route ${id} lacks a seam count.`);
  return {
    id,
    path: wrappedPath(face, heading, lane, Number(lengthValue), gridSize),
  };
}

// Kept as the original authored data so existing first-level progress remains exact.
const LEVEL_ONE: LevelDefinition = {
  id: 1,
  title: "Cube 1",
  gridSize: 4,
  lives: 5,
  arrows: [
    { id: "l1-front-clear", path: [cell("front", 2, 0), cell("front", 3, 0)] },
    { id: "l1-back-clear", path: [cell("back", 2, 0), cell("back", 3, 0)] },
    { id: "l1-right-clear", path: [cell("right", 2, 0), cell("right", 3, 0)] },
    { id: "l1-left-clear", path: [cell("left", 2, 0), cell("left", 3, 0)] },
    { id: "l1-top-clear", path: [cell("top", 2, 0), cell("top", 3, 0)] },
    {
      id: "l1-bottom-clear",
      path: [cell("bottom", 2, 0), cell("bottom", 3, 0)],
    },
  ],
};

export const LEVELS: readonly LevelDefinition[] = [
  LEVEL_ONE,
  ...CAMPAIGN_LAYOUTS.map((layout) => ({
    ...layout,
    arrows: layout.arrowIds.map((id) =>
      decodeCampaignArrow(id, layout.gridSize),
    ),
  })),
];

export const DEMO_BLOCKED_ID = "demo-blocked";
export const DEMO_SUCCESS_ID = "demo-success";

/** Small independent onboarding fixture: fail visibly, then remove its blocker. */
export const DEMO_LEVEL: LevelDefinition = {
  id: 0,
  title: "First Flight",
  gridSize: 4,
  lives: 2,
  arrows: [
    { id: DEMO_BLOCKED_ID, path: [cell("front", 0, 1), cell("front", 1, 1)] },
    { id: DEMO_SUCCESS_ID, path: [cell("front", 2, 1), cell("front", 3, 1)] },
    { id: "demo-clear", path: [cell("front", 0, 2), cell("front", 1, 2)] },
  ],
};
