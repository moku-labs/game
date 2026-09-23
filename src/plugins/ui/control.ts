/**
 * @file ui plugin — the ui command of the `/control` door: a tap on a keyed element or on a
 * view. It goes through `app.input`, so the gate decides and the session stays clean. Dev builds
 * only: the body starts with the inline dev guard, so a bundler `define` of `false` drops it,
 * and logs the `moku:dev` marker.
 */
import { defineCommand } from "../flow/doors/define";
import { controlRefused } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";
import { readTarget } from "../input/control";
import type { InputApi } from "../input/types";
import type { Entity } from "../world/types";
import type { UiApi } from "./types";

/** What the tap command needs of an app: the control app, the tap of input and the keys of ui. */
type TapApp = ControlApp & {
  readonly input: Pick<InputApi, "tap">;
  readonly ui: Pick<UiApi, "find">;
};

/**
 * Finds the entity of a keyed ui element on screen.
 *
 * @param ui - The ui API.
 * @param key - The `key` prop of the element.
 * @returns The entity.
 * @throws {Error} When no element with the key is on screen.
 */
function elementOf(ui: Pick<UiApi, "find">, key: string): Entity {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = ui.find(key);

  if (entity !== undefined) return entity;

  throw new Error(
    `[game] No element with the key "${key}" is on screen.\n  Read sources.ui for the keys on screen.`
  );
}

/**
 * Taps a ui element by its key, or a view by its projection key: exactly one of the two. Answers
 * what `input.tap` answers: whether the gate took the answer.
 *
 * @example
 * ```ts
 * // Home rests: tap the Play plank, then the first generator of the board.
 * (await run(app, commands.tap, { key: "play" })).value; // true
 * await run(app, commands.tap, { target: { projection: "board.generators", key: "g1" } });
 * ```
 */
export const tapCommand = defineCommand({
  id: "game.tap",
  title: "Tap",
  input: { key: "string?", target: "json?" },
  effect: "route",
  run: (app: TapApp, { key, target }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.tap", key });

    if (key !== undefined && target === undefined) return app.input.tap(elementOf(app.ui, key));
    if (target !== undefined && key === undefined) return app.input.tap(readTarget(target));

    throw new Error(
      "[game] game.tap takes a key or a target.\n  Pass exactly one of { key } and { target }."
    );
  }
});
