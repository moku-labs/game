/**
 * @file flow/doors — `defineSource` and `defineCommand`: check the id, freeze the descriptor.
 * Imports no plugin: a descriptor is data.
 */
import type { HeadlessApp } from "../headless";
import type { Command, InputSchema, Source } from "./types";

/** Lowercase-first camelCase words joined by dots, at least two: `game.position`. */
const idPattern = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/**
 * Refuses an id that is not a dotted name.
 *
 * @param kind - `"source"` or `"command"`, for the message.
 * @param id - The id to check.
 * @throws {Error} When the id is not camelCase words joined by dots.
 */
function checkId(kind: "source" | "command", id: string): void {
  if (idPattern.test(id)) return;

  throw new Error(
    `[game] The ${kind} id "${id}" is not a dotted name.\n  Name it like "game.position": camelCase words joined by dots.`
  );
}

/**
 * Declares a source: a read-only view the editor lists, reads and watches. The types flow from
 * the object: the input from `input`, the app from the `read` parameter, the output from its
 * result.
 *
 * @param source - The descriptor.
 * @returns The same descriptor, frozen.
 * @throws {Error} When the id is not a dotted name such as `"game.position"`.
 * @example
 * ```ts
 * // A game's .dev module: the orders on the board, re-read after every edge.
 * export const orders = defineSource({
 *   id: "timber.orders",
 *   title: "Orders",
 *   input: {},
 *   changes: "edge",
 *   read: app => app.flow.state().path
 * });
 * read(app, orders); // "board/awaitIntent"
 * ```
 */
export function defineSource<S extends InputSchema, O, App = HeadlessApp>(
  source: Source<S, O, App>
): Source<S, O, App> {
  checkId("source", source.id);
  Object.freeze(source.input);

  return Object.freeze(source);
}

/**
 * Declares a command: a dev-only action the editor lists and runs. Its body starts with the
 * inline dev guard, so a production build drops it.
 *
 * @param command - The descriptor.
 * @returns The same descriptor, frozen.
 * @throws {Error} When the id is not a dotted name such as `"game.answer"`.
 * @example
 * ```ts
 * // A game's .dev module: open the shop from anywhere, through the graph.
 * export const openShop = defineCommand({
 *   id: "timber.openShop",
 *   title: "Open the shop",
 *   input: {},
 *   effect: "route",
 *   run: app => {
 *     if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();
 *     return app.flow.walk([{ at: "home", intent: "shop" }]);
 *   }
 * });
 * (await run(app, openShop)).state.path; // "shop"
 * ```
 */
export function defineCommand<S extends InputSchema, O, App = HeadlessApp>(
  command: Command<S, O, App>
): Command<S, O, App> {
  checkId("command", command.id);
  Object.freeze(command.input);

  return Object.freeze(command);
}
