/**
 * @file input plugin — the input commands of the `/control` door: a drag from one view onto
 * another and a key press. Each goes through `app.input`, so the gate decides and the session
 * stays clean. Dev builds only: every body starts with the inline dev guard, so a bundler
 * `define` of `false` drops it, and logs the `moku:dev` marker. `readTarget` is shared with the
 * `game.tap` command of ui, which taps a view by the same projection key.
 */
import { defineCommand } from "../flow/doors/define";
import { controlRefused } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";
import type { Json } from "../model/types";
import type { InputApi } from "./types";

/** What the input commands need of an app: the control app plus the input. */
type InputApp = ControlApp & { readonly input: InputApi };

/** A projection key, the target the JSON of a command names. */
type ProjectionTarget = { projection: string; key: string };

/**
 * Tells whether the JSON a command got names a view by its projection key.
 *
 * @param value - The JSON.
 * @returns True for an object with a string `projection` and a string `key`.
 * @example
 * ```ts
 * isProjectionTarget({ projection: "board.items", key: "i5" }); // true
 * ```
 */
function isProjectionTarget(value: Json | undefined): value is ProjectionTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.projection === "string" &&
    typeof value.key === "string"
  );
}

/**
 * Reads the projection key of a view out of the JSON a command got.
 *
 * @param value - The JSON: `{ projection, key }`.
 * @returns The target, a fresh object.
 * @throws {Error} When the JSON is not an object with a string `projection` and a string `key`.
 */
export function readTarget(value: Json | undefined): ProjectionTarget {
  if (isProjectionTarget(value)) return { projection: value.projection, key: value.key };

  throw new Error(
    '[game] The target is not a projection key.\n  Pass a view like { projection: "board.items", key: "i5" }.'
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
