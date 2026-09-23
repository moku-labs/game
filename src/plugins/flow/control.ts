/**
 * @file flow plugin — the flow commands of the `/control` door: answer the gate, walk a route,
 * take a bookmark, restore a bookmark or a repro. Dev builds only: every body starts with the
 * inline dev guard, so a bundler `define` of `false` drops it, and logs the `moku:dev` marker.
 */
import type { Json } from "../model/types";
import { defineCommand } from "./doors/define";
import { controlRefused } from "./doors/dev";
import type { ControlApp } from "./doors/types";
import { type HeadlessApp, reproBookmark } from "./headless";
import { readBookmark, readRepro, readRoute } from "./json";
import type { FlowState } from "./types";

/**
 * Enters a bookmark, or a repro's bookmark followed by its route.
 *
 * @param app - The app.
 * @param input - Exactly one of a bookmark and a repro, as JSON.
 * @param input.bookmark - A `flow.bookmark()` value.
 * @param input.repro - A `/testing` repro.
 * @returns The state the game rests in afterwards.
 * @throws {Error} When both or neither are given, or the JSON is not of its shape.
 */
async function restoreFrom(
  app: HeadlessApp,
  input: { bookmark?: Json | undefined; repro?: Json | undefined }
): Promise<FlowState> {
  const { bookmark, repro } = input;

  if (bookmark !== undefined && repro === undefined) {
    await app.flow.restore(readBookmark(bookmark));

    return app.flow.state();
  }

  if (repro !== undefined && bookmark === undefined) {
    const parsed = readRepro(repro);

    await app.flow.restore(reproBookmark(app, parsed));

    return app.flow.walk(parsed.route);
  }

  throw new Error(
    "[game] game.restore takes a bookmark or a repro.\n  Pass exactly one of { bookmark } and { repro }."
  );
}

/**
 * Answers the gate, the way a tap on a button does. Goes through the graph: the session stays
 * clean.
 *
 * @example
 * ```ts
 * // The home screen rests: tap Play without touching the screen.
 * const ran = await run(app, commands.answer, { intent: "play" });
 * ran.value; // true: "home" waits for "play"
 * ran.state.tainted; // false
 * ```
 */
export const answerCommand = defineCommand({
  id: "game.answer",
  title: "Answer",
  input: { intent: "string", payload: "json?" },
  effect: "route",
  run: (app: ControlApp, { intent, payload }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.answer", intent });

    return app.flow.gate.answer(payload === undefined ? { intent } : { intent, payload });
  }
});

/**
 * Walks a route in fast mode through the graph. The session stays clean.
 *
 * @example
 * ```ts
 * // Skip the menu and stand on the board.
 * const ran = await run(app, commands.walk, { route: [{ at: "home", intent: "play" }] });
 * ran.value.path; // "board/awaitIntent"
 * ```
 */
export const walkCommand = defineCommand({
  id: "game.walk",
  title: "Walk a route",
  input: { route: "json" },
  effect: "route",
  run: (app: ControlApp, { route }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.walk" });

    return app.flow.walk(readRoute(route));
  }
});

/**
 * Takes a bookmark of the rest point: the node plus the committed state, plain JSON.
 *
 * @example
 * ```ts
 * // The editor keeps the position before a risky test.
 * const { value } = await run(app, commands.bookmark);
 * value.path; // "board/awaitIntent"
 * ```
 */
export const bookmarkCommand = defineCommand({
  id: "game.bookmark",
  title: "Bookmark",
  input: {},
  effect: "read",
  run: (app: ControlApp) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.bookmark" });

    return app.flow.bookmark();
  }
});

/**
 * Restores a bookmark, or a repro: its state at its checkpoint, then its route. Replaces the
 * state outside the graph, so the session is tainted and the command journaled.
 *
 * @example
 * ```ts
 * // Load the bug report "the order stays after delivery".
 * const repro = { player: { coins: 40 }, checkpoint: "home", route: [{ at: "home", intent: "play" }] };
 * const ran = await run(app, commands.restore, { repro });
 * ran.state; // { path: "board/awaitIntent", frame: 12, tainted: true }
 * ```
 */
export const restoreCommand = defineCommand({
  id: "game.restore",
  title: "Restore",
  input: { bookmark: "json?", repro: "json?" },
  effect: "raw",
  run: (app: ControlApp, input) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.restore" });

    return restoreFrom(app, input);
  }
});
