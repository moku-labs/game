/**
 * @file assets plugin — the companions that load and unload with every bundle: the lazy strings
 * of a feature travel with the bundle named like it. A companion's `load` runs next to the files
 * of a load, its `unload` after the textures of a bundle were destroyed or its load broke.
 */
import type { AssetsCtx, BundleCompanion, State } from "./types";

/**
 * Registers one companion. It is called for every later load and unload; a bundle loaded before
 * is not replayed.
 *
 * @param state - The plugin state.
 * @param companion - The `load` and `unload` pair.
 * @returns A function that removes the companion; a second call does nothing.
 */
export function addCompanion(state: State, companion: BundleCompanion): () => void {
  state.companions.push(companion);

  return () => {
    const at = state.companions.indexOf(companion);

    if (at !== -1) state.companions.splice(at, 1);
  };
}

/**
 * Runs every companion's `load` for a bundle, each wrapped so a synchronous throw becomes a
 * rejection; started before the bundle's files and awaited after them. It never rejects: what a
 * companion threw waits in its settled result.
 *
 * @param companions - The companions registered when the load started.
 * @param bundle - The bundle being loaded.
 * @returns One settled result per companion, in registration order.
 */
export function loadCompanions(
  companions: readonly BundleCompanion[],
  bundle: string
): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled(
    companions.map(companion => Promise.resolve().then(() => companion.load(bundle)))
  );
}

/**
 * Calls every companion's `unload` for a bundle; a throw is logged and the next still runs.
 *
 * @param ctx - Domain context of the assets plugin.
 * @param companions - The companions to tell.
 * @param bundle - The bundle that was released, or whose load broke.
 */
export function unloadCompanions(
  ctx: AssetsCtx,
  companions: readonly BundleCompanion[],
  bundle: string
): void {
  for (const companion of companions) {
    try {
      companion.unload(bundle);
    } catch (error) {
      ctx.log.error("assets: a companion failed to unload", { bundle, error: String(error) });
    }
  }
}
