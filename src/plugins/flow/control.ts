/**
 * @file flow plugin — the flow commands of the `/control` door: answer the gate, walk a route,
 * take a bookmark, restore a bookmark or a repro, export and import the save. Dev and debug
 * builds: every body starts with the inline guard of its effect (the agent guard for a read, the
 * control guard for a route or raw write), so a bundler `define` of `false` drops it, and logs
 * the `moku:dev` marker.
 */
import type { Json, Snapshot, StoreApi } from "../model/types";
import type { ScenesApi } from "../scenes/types";
import { defineCommand, inputSchema } from "./doors/define";
import { controlRefused } from "./doors/dev";
import type { ControlApp } from "./doors/types";
import { type HeadlessApp, reproBookmark } from "./headless";
import { readBookmark, readRepro, readRoute } from "./json";
import { graphHash } from "./runner/registry";
import type { Bookmark, FlowState } from "./types";

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

/** An app that may carry the screen plugins: the doors read and set its scene when it has one. */
type SceneApp = { readonly scenes?: ScenesApi };

/** What the save commands need of an app: the control app, its scenes when it has them, the store. */
type SaveApp = ControlApp &
  SceneApp & { readonly model: { readonly store: Pick<StoreApi, "snapshot" | "flush"> } };

/** The three trees of a save, as `game.saveExport` answers them and `game.saveImport` takes them. */
type SaveTrees = { player: Json; session: Json; rng: Json };

/**
 * Restores a bookmark with its `scene` expected first, so the node the restore enters mounts it.
 * A refused restore puts the record back to the mounted scene, when one is mounted: no later
 * node switches to the scene of a bookmark that was never entered. With nothing mounted the
 * record stays, as the scenes API has no way to clear it.
 *
 * @param app - The app; with `scenes`, the bookmark's scene is expected before the restore.
 * @param bookmark - The bookmark to enter.
 * @throws {Error} What `flow.restore` refused the bookmark with, unchanged.
 */
async function restoreWithScene(app: HeadlessApp & SceneApp, bookmark: Bookmark): Promise<void> {
  const mounted = app.scenes?.current();

  if (bookmark.scene !== undefined) app.scenes?.expect(bookmark.scene);

  try {
    await app.flow.restore(bookmark);
  } catch (error) {
    // The restore was refused: the record goes back to the mounted scene, which no node
    // switches to.
    if (mounted !== undefined) app.scenes?.expect(mounted);

    throw error;
  }
}

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
  const bookmarkOnly = bookmark !== undefined && repro === undefined;
  const reproOnly = repro !== undefined && bookmark === undefined;

  // A bookmark: its scene is expected first, so the node the restore enters mounts it.
  if (bookmarkOnly) {
    await restoreWithScene(app, readBookmark(bookmark));

    return app.flow.state();
  }

  // A repro: its state at its checkpoint, then its route from there.
  if (reproOnly) {
    const parsed = readRepro(repro);

    await app.flow.restore(reproBookmark(app, parsed));

    return app.flow.walk(parsed.route);
  }

  // Both or neither: the door cannot tell which position was meant.
  throw new Error(
    "[game] game.restore takes a bookmark or a repro.\n  Pass exactly one of { bookmark } and { repro }."
  );
}

/**
 * Reads the save `game.saveImport` got: an object with the three trees of `game.saveExport`.
 *
 * @param save - The JSON the editor sent.
 * @returns The player, the session and the rng.
 * @throws {Error} When it is not an object with `player`, `session` and `rng`.
 * @example
 * ```ts
 * readSave({ player: { coins: 40 }, session: {}, rng: { seed: 42, streams: {} } }).player; // { coins: 40 }
 * ```
 */
function readSave(save: Json): SaveTrees {
  if (typeof save === "object" && save !== null && !Array.isArray(save)) {
    const { player, session, rng } = save;

    if (player !== undefined && session !== undefined && rng !== undefined) {
      return { player, session, rng };
    }
  }

  throw new Error("[game] game.saveImport needs { player, session, rng } of game.saveExport.");
}

/**
 * Builds the bookmark a save is imported at: the start of the main flow with the save's trees and
 * the hash of the graph that runs now. The start may be a transit node: `flow.restore` enters
 * one of the graph it was made for and plays it, as a fresh start does, on the imported trees.
 *
 * @param app - The started app.
 * @param save - The player, the session and the rng of the save.
 * @returns The bookmark, as JSON for `restoreFrom`.
 */
function startBookmark(app: HeadlessApp, save: SaveTrees): Json {
  const graph = app.flow.describe();

  return {
    path: graph.flows[graph.main]?.start ?? "",
    input: noPayload,
    ...save,
    graph: graphHash(graph)
  };
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
  input: inputSchema(["intent", "string"], ["payload", "json?"]),
  effect: "route",
  run: (app: ControlApp, { intent, payload }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_CONTROL__ === "undefined" || !__MOKU_GAME_CONTROL__)
    ) {
      throw controlRefused();
    }

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
  input: inputSchema(["route", "json"]),
  effect: "route",
  run: (app: ControlApp, { route }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_CONTROL__ === "undefined" || !__MOKU_GAME_CONTROL__)
    ) {
      throw controlRefused();
    }

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
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_AGENT__ === "undefined" || !__MOKU_GAME_AGENT__)
    ) {
      throw controlRefused();
    }

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
  input: inputSchema(["bookmark", "json?"], ["repro", "json?"]),
  effect: "raw",
  run: (app: ControlApp & SceneApp, input) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_CONTROL__ === "undefined" || !__MOKU_GAME_CONTROL__)
    ) {
      throw controlRefused();
    }

    app.log.debug("moku:dev", { command: "game.restore" });

    return restoreFrom(app, input);
  }
});

/**
 * Answers the committed state as the save holds it: the player, the session and the rng, plain
 * JSON. A read: it runs on a `--debug=read` page too, so a tester's progress can leave the store app.
 *
 * @example
 * ```ts
 * // The editor takes the tester's progress from the store app on the phone.
 * (await run(app, commands.saveExport, {})).value; // { player: { coins: 40, … }, session: { … }, rng: { seed: 42, streams: {} } }
 * ```
 */
export const saveExportCommand = defineCommand({
  id: "game.saveExport",
  title: "Export the save",
  input: {},
  effect: "read",
  run: (app: SaveApp): Snapshot => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_AGENT__ === "undefined" || !__MOKU_GAME_AGENT__)
    ) {
      throw controlRefused();
    }

    app.log.debug("moku:dev", { command: "game.saveExport" });

    const { player, session, rng } = app.model.store.snapshot();

    return { player, session, rng };
  }
});

/**
 * Puts a save of `game.saveExport` in place and writes it, so the next start of the app reads it:
 * the trees are restored at the main flow's start, and the game lands where a fresh start with
 * them lands. A start that is a rest node is entered; a transit node runs again on the imported
 * trees, rng included, up to the first gate it opens, at a rest node or a popup. Then the store
 * flushes. Replaces the state outside the graph, so the session is tainted and the
 * command journaled. A `--debug=read` page refuses it; a `--debug` page and the dev page run it.
 *
 * @throws {Error} `[game] game.saveImport needs { player, session, rng } of game.saveExport.` for
 *   a value without the three trees.
 * @example
 * ```ts
 * // The debug app beside the store app gets the save exported from the store app. Its main
 * // flow starts at "boot", a transit node: boot runs again on the save and the game rests at home.
 * const ran = await run(app, commands.saveImport, { save: exported });
 * ran.value; // { restored: true }
 * ran.state.path; // "home"
 * ```
 */
export const saveImportCommand = defineCommand({
  id: "game.saveImport",
  title: "Import a save",
  input: inputSchema(["save", "json"]),
  effect: "raw",
  run: async (app: SaveApp, { save }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_CONTROL__ === "undefined" || !__MOKU_GAME_CONTROL__)
    ) {
      throw controlRefused();
    }

    app.log.debug("moku:dev", { command: "game.saveImport" });

    // The start of the main flow, with the save's trees, played to the gate it opens first.
    await restoreFrom(app, { bookmark: startBookmark(app, readSave(save)) });
    await app.flow.walk([]);
    await app.model.store.flush();

    return { restored: true };
  }
});
