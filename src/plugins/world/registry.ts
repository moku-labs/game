/**
 * @file world plugin — the domain context behind each world API object, for the internal reader
 * other plugins call with the API they hold (`membershipVersion`). Not on the API: a game never
 * needs it.
 */
import type { Api, WorldCtx } from "./types";

/** The domain context behind each world API object. */
// eslint-disable-next-line no-restricted-syntax -- keyed by the world API: each app has its own entry, which is what L5 protects.
const WORLDS = new WeakMap<Api, WorldCtx>();

/**
 * Records the domain context behind one world API object. `createWorldApi` calls it once.
 *
 * @param api - The world API the kernel hands to `ctx.require(worldPlugin)`.
 * @param ctx - The domain context of that world.
 */
export function trackWorld(api: Api, ctx: WorldCtx): void {
  WORLDS.set(api, ctx);
}

/**
 * The domain context behind a world API object.
 *
 * @param world - The world API, `ctx.require(worldPlugin)`.
 * @returns The context, or `undefined` for an object `createWorldApi` never made.
 */
export function worldCtxOf(world: Api): WorldCtx | undefined {
  return WORLDS.get(world);
}
