/**
 * @file world/projection — the authoring helper. Pure: it returns the spec and does the work in
 * the type, where `Item` comes from `from` and `layer` and `lift` keep their literal types.
 */
import type { Json } from "../../model/types";
import type { ProjectionSpec } from "./types";

/**
 * Types a projection: keyed items of the model turned into entities. `Item` is inferred from the
 * return of `from` and reaches `key`, `view` and every motion hook; `layer` and `lift` stay
 * literal, so `defineScene` can check them against the layers of the scene.
 *
 * @param spec - Name, layer, optional lift layer, `from`, `key`, `view` and the motion hooks.
 * @returns The same spec, typed.
 * @example
 * ```ts
 * const boardItems = projection({
 *   name: "board.items",
 *   layer: "items",
 *   from: (player: { items: { id: string }[] }) => player.items,
 *   key: item => item.id,
 *   view: () => []
 * });
 * boardItems.layer; // "items", the literal type, not string
 * ```
 */
export function projection<
  const LayerName extends string,
  const LiftName extends string,
  Item,
  Player = Json,
  Session = Json
>(
  spec: ProjectionSpec<Item, LayerName, LiftName, Player, Session>
): ProjectionSpec<Item, LayerName, LiftName, Player, Session> {
  return spec;
}

/**
 * The projection helper bound to one game's `player` and `session`.
 *
 * @example
 * ```ts
 * const bound: ProjectionFor<{ coins: number }, {}> = projection;
 * ```
 */
export type ProjectionFor<Player, Session> = <
  const LayerName extends string,
  const LiftName extends string,
  Item
>(
  spec: ProjectionSpec<Item, LayerName, LiftName, Player, Session>
) => ProjectionSpec<Item, LayerName, LiftName, Player, Session>;

/**
 * Binds `projection` to one game's `player` and `session`. Type-only: the same function.
 *
 * @returns `{ projection }` whose `from` reads the game's state types.
 * @example
 * ```ts
 * const { projection } = projectionFor<{ board: { items: Item[] } }, {}>();
 * projection({ name: "board.items", layer: "items", from: player => player.board.items, key: item => item.id, view: () => [] });
 * ```
 */
export function projectionFor<Player, Session>(): { projection: ProjectionFor<Player, Session> } {
  return { projection };
}
