/**
 * @file ui plugin — the three ui commands of the `/control` door: a tap on a keyed element or on a
 * view, the text typed into a field, and a scroll put at an offset. The tap goes through
 * `app.input`, so the gate decides; the text goes through `app.ui.fill`, which writes a
 * component's local and answers nothing, and the offset through `app.ui.scroll`. The session
 * stays clean. Dev builds and `--debug` builds (not `--debug=read`): each body starts with the inline
 * control guard of a route command, so a bundler `define` of `false` drops it, and logs the
 * `moku:dev` marker.
 */
import { defineCommand, inputSchema } from "../flow/doors/define";
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

/** What the scroll command needs of an app: the control app and the scroll of ui. */
type ScrollApp = ControlApp & { readonly ui: Pick<UiApi, "scroll"> };

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
  input: inputSchema(["key", "string?"], ["target", "json?"]),
  effect: "route",
  run: (app: TapApp, { key, target }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_CONTROL__ === "undefined" || !__MOKU_GAME_CONTROL__)
    ) {
      throw controlRefused();
    }

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
  input: inputSchema(["key", "string"], ["value", "string"]),
  effect: "route",
  run: (app: FillApp, { key, value }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_CONTROL__ === "undefined" || !__MOKU_GAME_CONTROL__)
    ) {
      throw controlRefused();
    }

    app.log.debug("moku:dev", { command: "game.fill", key });

    return app.ui.fill(key, value);
  }
});

/**
 * Scrolls a `scroll` element by its key to an offset from its start, the way `app.ui.scroll`
 * does: at once, kept inside its range, a fling or a glide stopped. Answers what `scroll`
 * answers: false for a key that is no live `scroll`. A visual test writes it as the step
 * `{ scroll: { key, to } }`.
 *
 * @example
 * ```ts
 * // The board rests: show the order strip on its events before the checkpoint.
 * (await run(app, commands.scroll, { key: "strip", to: 0 })).value; // true
 * (await run(app, commands.scroll, { key: "nothing", to: 0 })).value; // false
 * ```
 */
export const scrollCommand = defineCommand({
  id: "game.scroll",
  title: "Scroll",
  input: inputSchema(["key", "string"], ["to", "number"]),
  effect: "route",
  run: (app: ScrollApp, { key, to }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_CONTROL__ === "undefined" || !__MOKU_GAME_CONTROL__)
    ) {
      throw controlRefused();
    }

    app.log.debug("moku:dev", { command: "game.scroll", key });

    return app.ui.scroll(key, to);
  }
});
