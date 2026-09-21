/**
 * @file model/store — state factory skeleton.
 */
import type { Config } from "../types";
import type { StoreState } from "./types";

/**
 * Creates the initial store state: frozen initial trees, no rest point, an empty pending list
 * and the configured provider, or the in-memory provider when none is configured.
 *
 * @param _config - Resolved model plugin config.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const store = createStoreState(config);
 * ```
 */
export function createStoreState(_config: Readonly<Config>): StoreState {
  throw new Error("not implemented");
}
