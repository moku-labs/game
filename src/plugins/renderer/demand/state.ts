/**
 * @file renderer/demand — the demand state: empty sets, no whole-frame reason yet, nothing drawn yet.
 */
import type { Entity } from "../../world/types";
import type { DemandReason, DemandState } from "./types";

/**
 * Creates an empty entity set. It lives in its own non-exported function because lint rule L5 refuses a collection
 * built inside an exported declaration.
 *
 * @returns An empty set.
 */
function emptyEntities(): Set<Entity> {
  return new Set();
}

/**
 * Creates an empty set of whole-frame reasons. Same reason as `emptyEntities`.
 *
 * @returns An empty set.
 */
function emptyReasons(): Set<DemandReason> {
  return new Set();
}

/**
 * Creates the demand state. The pixel oracle starts as `config.debug.verifyFrames` asks, in a dev or an agent build
 * only: elsewhere it stays off whatever the config says.
 *
 * @param verifyFrames - `config.debug.verifyFrames`.
 * @returns The demand branch of the plugin state.
 */
export function createDemandState(verifyFrames = false): DemandState {
  return {
    marked: emptyEntities(),
    pending: emptyEntities(),
    loose: emptyEntities(),
    wholes: emptyReasons(),
    counted: false,
    wakes: 0,
    drawnOnce: false,
    requests: 0,
    frame: { drawn: false, reason: "none", marks: 0 },
    bounds: undefined,
    sinceDraw: emptyEntities(),
    check: { warned: emptyEntities(), off: false },
    verify: {
      // Inline and positive: a production `define` folds both flags, and the oracle stays off.
      on:
        verifyFrames &&
        ((typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
          (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)),
      reference: undefined
    }
  };
}

/**
 * Empties every set, resets the scalars, drops `reference` and `bounds`. Works on the state alone, because `onStop`
 * has no context. The frame object keeps its identity.
 *
 * @param state - The demand state.
 */
export function stopDemand(state: DemandState): void {
  state.marked.clear();
  state.pending.clear();
  state.loose.clear();
  state.wholes.clear();
  state.sinceDraw.clear();
  state.check.warned.clear();
  state.check.off = false;
  state.counted = false;
  state.wakes = 0;
  state.drawnOnce = false;
  state.requests = 0;
  state.frame.drawn = false;
  state.frame.reason = "none";
  state.frame.marks = 0;
  state.bounds = undefined;
  state.verify.reference = undefined;
}
