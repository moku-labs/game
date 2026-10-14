/**
 * @file The ward: the room of the episode the session names, in the frame every episode shares.
 */
import { projection } from "@core/kit";
import type { Episode } from "@core/types";

/** The room picture of each episode, a key of the episode's own bundle. */
const roomOf = { ep01: "ep01.ward.room", ep02: "ep02.ward.room" } as const;

/**
 * The ward as the view reads it: the episode whose room it shows.
 *
 * @example
 * ```ts
 * const view: WardView = { episode: "ep01" };
 * ```
 */
export type WardView = { episode: Episode };

/** The ward screen: one item, so the projection needs no key. */
export const wardRoom = projection({
  name: "ward.room",
  layer: "ui",
  from: (_player, session): WardView => ({ episode: session.episode }),
  view: item => (
    <screen key="ward">
      <image key="wardRoom" texture={roomOf[item.episode]} />
      <image key="wardFrame" texture="episodes-kit.frame" />
    </screen>
  )
});
