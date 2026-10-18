/**
 * @file world plugin — the membership counter of the projections, for `ui`. Not on the API: a
 * game never needs it. `ui` hosts the views of a projection inside an element, and walks its
 * hosts again only when a view came or went since its last walk.
 */
import { worldCtxOf } from "./registry";
import type { Api } from "./types";

/**
 * The membership version of a world's projections: it moves on every time a view enters the
 * live views of a mounted projection, leaves them (an exit or a despawn), or is forgotten after
 * its despawn, and when the projections are cleared. An equal number means the same views live
 * as at the last read. Reading it allocates nothing, so `ui` asks every frame.
 *
 * @param world - The world API, `ctx.require(worldPlugin)`.
 * @returns The version; 0 for a world where no view ever came or went.
 * @example
 * ```ts
 * // ui, at the start of its hosting step: nothing to do while no view came or went.
 * const version = membershipVersion(ctx.deps.world); // 7, as on the last frame
 * if (version === state.hostedMembership) return;
 * ```
 */
export function membershipVersion(world: Api): number {
  return worldCtxOf(world)?.state.projection.membershipVersion ?? 0;
}
