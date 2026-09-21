/**
 * @file model/store — state factory.
 */
import type { Config } from "../types";
import { deepFreeze, enableDraftPatches } from "./drafts";
import { memory } from "./providers/memory";
import type { StoreState } from "./types";

/** Seed of the trees that exist before `load()` ran. A save or a new player replaces it. */
const preloadSeed = 0;

/**
 * Creates the initial store state: frozen initial trees, no rest point, an empty pending list and
 * the configured provider, or the in-memory provider when none is configured.
 *
 * The document here is a placeholder for the time between `createApp` and `load()`: a snapshot
 * taken that early shows the initial player, never a half-read save.
 *
 * @param config - Resolved model plugin config.
 * @returns The store branch of the plugin state.
 */
export function createStoreState(config: Readonly<Config>): StoreState {
  // Immer records patches only after this call, and a state factory runs once per app.
  enableDraftPatches();

  const seed = typeof config.seed === "number" ? config.seed : preloadSeed;

  return {
    doc: deepFreeze({
      player: structuredClone(config.initialPlayer),
      rng: { seed, streams: {} }
    }),
    session: deepFreeze(structuredClone(config.initialSession)),
    restPoint: undefined,
    pending: [],
    transaction: undefined,
    loaded: false,
    provider: config.playerProvider ?? memory()
  };
}
