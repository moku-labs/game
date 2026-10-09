/**
 * @file flow plugin — the flow commands of the `/control` door: answer the gate, walk a route,
 * take a bookmark, restore a bookmark or a repro. Dev builds only: every body starts with the
 * inline dev guard, so a bundler `define` of `false` drops it, and logs the `moku:dev` marker.
 */
import type { Json } from "../model/types";
import type { ScenesApi } from "../scenes/types";
import { defineCommand } from "./doors/define";
import { controlRefused } from "./doors/dev";
import type { ControlApp } from "./doors/types";
import { type HeadlessApp, reproBookmark } from "./headless";
import { readBookmark, readRepro, readRoute } from "./json";
import type { Bookmark, FlowState } from "./types";

/** An app that may carry the screen plugins: the doors read and set its scene when it has one. */
type SceneApp = { readonly scenes?: ScenesApi };

/**
 * Enters a bookmark, or a repro's bookmark followed by its route. A bookmark's `scene` is handed
 * to `scenes.expect` first, so a node without a scene of its own mounts it: a rest node, or the
 * transit node of a bookmark taken while an effect that takes answers waited.
 *
 * @param app - The app; with `scenes`, the bookmark's scene is expected before the restore.
 * @param input - Exactly one of a bookmark and a repro, as JSON.
 * @param input.bookmark - A `flow.bookmark()` value.
 * @param input.repro - A `/testing` repro.
 * @returns The state the game rests in afterwards.
 * @throws {Error} When both or neither are given, or the JSON is not of its shape.
 */
async function restoreFrom(
  app: HeadlessApp & SceneApp,
  input: { bookmark?: Json | undefined; repro?: Json | undefined }
): Promise<FlowState> {
  const { bookmark, repro } = input;

  if (bookmark !== undefined && repro === undefined) {
    const read = readBookmark(bookmark);

    if (read.scene !== undefined) app.scenes?.expect(read.scene);

    await app.flow.restore(read);

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
 * Takes a bookmark of where the graph stands: the node plus the committed state, plain JSON. The
 * node is the last rest node, or, while a transit node waits for an effect that takes answers (a
 * `popup`, or a hand-written descriptor with `answers`), that node; `rest` then names the rest
 * point before it. An app with the screen plugins adds the mounted `scene`, so a restore in a
 * fresh page builds it again.
 *
 * @example
 * ```ts
 * // The editor keeps the position while the info popup of the mini game is open over Home.
 * const { value } = await run(app, commands.bookmark);
 * value.path; // "info/show": the node that waits for the popup's answer
 * value.scene; // "home"
 * value.rest; // { path: "home", input: null }
 * ```
 */
export const bookmarkCommand = defineCommand({
  id: "game.bookmark",
  title: "Bookmark",
  input: {},
  effect: "read",
  run: (app: ControlApp & SceneApp): Bookmark => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.bookmark" });

    const bookmark = app.flow.bookmark();
    const scene = app.scenes?.current();

    return scene === undefined ? bookmark : { ...bookmark, scene };
  }
});

/**
 * Restores a bookmark, or a repro: its state at its checkpoint, then its route. Replaces the
 * state outside the graph, so the session is tainted and the command journaled. A bookmark's
 * `scene` goes to `scenes.expect` first: a bookmark at a popup comes back with the scene under it.
 * A bookmark taken while a transit node waited for an effect that takes answers (a `popup`, or a
 * hand-written descriptor with `answers`) runs that node again, and the command answers once its
 * gate is open: the state it returns already lists the answers. The popup is drawn on the next
 * frame. A repro starts at a rest node only.
 *
 * @example
 * ```ts
 * // Load the bug report "the order stays after delivery".
 * const repro = { player: { coins: 40 }, checkpoint: "home", route: [{ at: "home", intent: "play" }] };
 * const ran = await run(app, commands.restore, { repro });
 * ran.state; // { path: "board/awaitIntent", frame: 12, tainted: true }
 *
 * // A fresh page restores the bookmark game.bookmark took at the info popup of the mini game.
 * const { value } = await run(app, commands.restore, { bookmark });
 * value.path; // "info/show"
 * value.pending.gate; // ["ok", "close"]: the popup waits for its answer again
 * app.scenes.current(); // "home": the scene the bookmark named, under the popup
 * ```
 */
export const restoreCommand = defineCommand({
  id: "game.restore",
  title: "Restore",
  input: { bookmark: "json?", repro: "json?" },
  effect: "raw",
  run: (app: ControlApp & SceneApp, input) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.restore" });

    return restoreFrom(app, input);
  }
});
