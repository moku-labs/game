/**
 * @file ui plugin — the two ui commands of the `/control` door: a tap on a keyed element or on a
 * view, and the text typed into a field. The tap goes through `app.input`, so the gate decides;
 * the text goes through `app.ui.fill`, which writes a component's local and answers nothing. The
 * session stays clean. Dev builds only: each body starts with the inline dev guard, so a bundler
 * `define` of `false` drops it, and logs the `moku:dev` marker.
 */
import { defineCommand } from "../flow/doors/define";
import { controlRefused } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";
import { readTarget } from "../input/target";
import type { InputApi } from "../input/types";
import type { Entity } from "../world/types";
import type { UiApi } from "./types";

/** What the tap command needs of an app: the control app, the tap of input and the keys of ui. */
type TapApp = ControlApp & {
  readonly input: Pick<InputApi, "tap">;
  readonly ui: Pick<UiApi, "find">;
};

/** What the fill command needs of an app: the control app and the fill of ui. */
type FillApp = ControlApp & { readonly ui: Pick<UiApi, "fill"> };

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

/**
 * Types into a text field by its key, the way `app.ui.fill` does: the field becomes the one being
 * edited, the value cut to its `maxLength` is written into it and into the local of its
 * component. Answers what `fill` answers: false for a key that is no live `input`.
 *
 * @example
 * ```ts
 * // The Rename popup rests: type the name, then submit it with the Enter key.
 * (await run(app, commands.fill, { key: "nameField", value: "Alex" })).value; // true
 * await run(app, commands.key, { key: "Enter" }); // the gate takes { intent: "save", payload: { name: "Alex" } }
 * ```
 */
export const fillCommand = defineCommand({
  id: "game.fill",
  title: "Fill",
  input: { key: "string", value: "string" },
  effect: "route",
  run: (app: FillApp, { key, value }) => {
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();

    app.log.debug("moku:dev", { command: "game.fill", key });

    return app.ui.fill(key, value);
  }
});
