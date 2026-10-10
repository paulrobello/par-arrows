import { rotatedHeading } from "../core/directionals";
import { applyMove, createGameState, simulateMove } from "../core/game-state";
import { arrowTrack } from "../core/stops";
import { cellKey, headingForPath } from "../core/topology";
import type { LevelDefinition } from "../core/types";
import {
  flipHeadingProbes,
  hasStrandingState,
  solveLevelTargets,
  validateLevel,
} from "../core/validation";
import { constructParking, type ParkingConstruction } from "./parking";
import type { Rng } from "./procedural";

/** Synthesize a required quarter-turn from two phased, intersecting lanes.
 * The first arrow completely passes the rotor before parking. A later lane
 * needs its new heading: frozen, that lane bends into the still-parked body.
 * Bodies and contacts grow first; no coordinate gadgets or stamped fallback. */
export function constructRotor(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  forbiddenTracks: ReadonlySet<string>,
  attemptLimit = 128,
): ParkingConstruction | undefined {
  const reserved = new Set([...occupied, ...forbiddenTracks]);
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const core = constructParking(level, rng, reserved, 1, true);
    if (!core) continue;
    const arrows = core.arrows.map((arrow) => ({
      ...arrow,
      id: arrow.id.replace("-park-", "-rotor-"),
    }));
    const parker = arrows[0]!;
    const order = arrows.slice(1).reverse();
    const bare = { ...level, arrows, stops: core.stops, directionals: [] };
    const first = arrowTrack(bare, parker);
    const pause = simulateMove(bare, createGameState(bare), parker.id);
    if (pause.kind !== "paused") continue;
    const offset = applyMove(bare, createGameState(bare), pause).offsets?.[
      parker.id
    ];
    if (!offset) continue;
    const bodies = new Set(
      [...arrows.flatMap((arrow) => arrow.path), ...core.stops].map(cellKey),
    );
    for (const follower of order) {
      const later = arrowTrack(bare, follower);
      // Track index < parked tail offset means the rotor has fully cleared.
      for (let index = parker.path.length; index < offset; index += 1) {
        const cell = first[index]!;
        const key = cellKey(cell);
        if (bodies.has(key) || occupied.has(key) || forbiddenTracks.has(key))
          continue;
        const contact = later.findIndex(
          (next, at) => at >= follower.path.length && cellKey(next) === key,
        );
        if (contact < 0) continue;
        const heading = headingForPath(
          first.slice(index - 1, index + 1),
          level.gridSize,
        );
        const nextHeading = headingForPath(
          later.slice(contact - 1, contact + 1),
          level.gridSize,
        );
        if (!heading || rotatedHeading(heading) !== nextHeading) continue;
        const spots = [{ cell, heading, kind: "rotor" as const }];
        const board = { ...bare, directionals: spots };
        // Every heading's reach remains closed against earlier mechanics.
        let fits = true;
        for (const probe of flipHeadingProbes(board)) {
          for (const arrow of arrows) {
            const keys = arrowTrack(probe, arrow).map(cellKey);
            if (
              keys.filter((candidate) => candidate === key).length > 1 ||
              keys.some(
                (candidate) =>
                  occupied.has(candidate) || forbiddenTracks.has(candidate),
              )
            )
              fits = false;
          }
        }
        if (!fits) continue;
        if (!validateLevel(board).valid) continue;
        let state = createGameState(board);
        const park = simulateMove(board, state, parker.id);
        if (park.kind !== "paused") continue;
        state = applyMove(board, state, park);
        let clears = true;
        for (const arrow of [...order, parker]) {
          const move = simulateMove(board, state, arrow.id);
          if (move.kind !== "exit") {
            clears = false;
            break;
          }
          state = applyMove(board, state, move);
        }
        if (!clears) continue;
        if (solveLevelTargets({ ...board, directionals: [{ cell, heading }] }))
          continue;
        const stripped = { ...board, stops: [] };
        if (
          !arrows.every(
            (arrow) =>
              simulateMove(stripped, createGameState(stripped), arrow.id)
                .kind === "blocked",
          )
        )
          continue;
        if (hasStrandingState(board) !== false) continue;
        return {
          arrows,
          stops: core.stops,
          spots,
          parkLegs: [`park:${parker.id}`],
        };
      }
    }
  }
  return undefined;
}
