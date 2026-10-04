/**
 * @file input plugin — the input commands of the `/control` door: a drag from one view onto
 * another, a trace through many views and a key press. Each goes through `app.input`, so the gate
 * decides and the session stays clean. Dev builds only: every body starts with the inline dev
 * guard, so a bundler `define` of `false` drops it, and logs the `moku:dev` marker. The targets
 * are read with `target.ts`; `readTarget` is re-exported here for the `game.tap` command of ui,
 * which taps a view by the same projection key.
 */
import { defineCommand } from "../flow/doors/define";
import { controlRefused } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";
import type { Json } from "../model/types";
import { isProjectionTarget, type ProjectionTarget, readTarget } from "./target";
import type { InputApi } from "./types";

export { readTarget } from "./target";

/** What the input commands need of an app: the control app plus the input. */
type InputApp = ControlApp & { readonly input: InputApi };

/**
 * Reads the cells of a trace out of the JSON a command got.
 *
 * @param value - The JSON: a list of `{ projection, key }`.
 * @returns The targets in list order, fresh objects.
 * @throws {Error} When the JSON is not a list, or an element is not a projection key.
 */
function readPath(value: Json | undefined): ProjectionTarget[] {
  if (Array.isArray(value) && value.every(item => isProjectionTarget(item))) {
    return value.map(target => ({ projection: target.projection, key: target.key }));
  }

  throw new Error(
    '[game] The path is not a list of projection keys.\n  Pass views like [{ projection: "board.cells", key: "b3" }, …].'
  );
}

/**
 * Drags one view onto another, both by their projection keys. Answers what `input.drag`
 * answers: whether the gate took the answer.
 *
 * @example
 * ```ts
 * // Merge two logs of level 1 on the board.
 * const from = { projection: "board.items", key: "i5" };
 * (await run(app, commands.drag, { from, to: { projection: "board.items", key: "i7" } })).value; // true
 * ```
 */
export const dragCommand = defineCommand({
  id: "game.drag",
  title: "Drag",
  input: { from: "json", to: "json" },
  effect: "route",
  run: (app: InputApp, { from, to }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.drag" });

    return app.input.drag(readTarget(from), readTarget(to));
  }
});

/**
 * Traces through views by their projection keys, in list order. Answers what `input.trace`
 * answers: whether the gate took the answer.
 *
 * @example
 * ```ts
 * // Spell the first two letters of a word on the grid.
 * const path = [{ projection: "board.cells", key: "b3" }, { projection: "board.cells", key: "c3" }];
 * (await run(app, commands.trace, { path })).value; // true
 * ```
 */
export const traceCommand = defineCommand({
  id: "game.trace",
  title: "Trace",
  input: { path: "json" },
  effect: "route",
  run: (app: InputApp, { path }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.trace" });

    return app.input.trace(readPath(path));
  }
});

/**
 * Presses a key without a keyboard, with or without Shift. Answers whether a listener handled
 * it.
 *
 * @example
 * ```ts
 * // Close the settings popup the way Escape does.
 * (await run(app, commands.key, { key: "Escape" })).value; // true
 * (await run(app, commands.key, { key: "Tab", shift: true })).value; // true: the focus moved back
 * ```
 */
export const keyCommand = defineCommand({
  id: "game.key",
  title: "Press a key",
  input: { key: "string", shift: "boolean?" },
  effect: "route",
  run: (app: InputApp, { key, shift = false }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.key", key });

    return app.input.pressKey(key, { shift });
  }
});
