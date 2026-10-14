/**
 * @file assets plugin — the companions that load and unload with every bundle.
 */
import type { AssetsCtx, BundleCompanion } from "./types";

/**
 * Runs every companion's `load` for a bundle, each wrapped so a synchronous throw becomes a rejection; started before
 * the bundle's files and awaited after them.
 *
 * @param _companions - The companions registered when the load started.
 * @param _bundle - The bundle being loaded.
 */
export function loadCompanions(
  _companions: readonly BundleCompanion[],
  _bundle: string
): Promise<PromiseSettledResult<void>[]> {
  throw new Error("not implemented");
}

/**
 * Calls every companion's `unload` for a bundle; a throw is logged and the next still runs.
 *
 * @param _ctx - Domain context of the assets plugin.
 * @param _companions - The registered companions.
 * @param _bundle - The bundle that was released.
 */
export function unloadCompanions(
  _ctx: AssetsCtx,
  _companions: readonly BundleCompanion[],
  _bundle: string
): void {
  throw new Error("not implemented");
}
