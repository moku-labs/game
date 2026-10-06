/**
 * @file flow/doors — the dev flag and the errors a door throws. `__MOKU_GAME_DEV__` is a global
 * the engine never replaces: `moku-game dev` defines it `true` (bunfig `define`) and sets
 * `globalThis.__MOKU_GAME_DEV__` in `.moku/dev.ts` before the engine runs; `moku-game build`
 * defines it `false`; undefined means a production build.
 *
 * Bun does not inline `isDev()` across modules (checked on Bun 1.3.14), so a branch that must
 * vanish from a production bundle writes the guard inline:
 * `if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();`.
 * A `define` of `false` folds that condition, and the minifier drops the code behind it.
 */

declare global {
  /**
   * The dev flag of a game. A game never re-declares it: `moku-game dev` sets it, `moku-game
   * build` defines it `false`, and a test stubs it.
   *
   * @example
   * ```ts
   * // .moku/dev.ts, written by moku-game dev, the first import of the dev page: /control commands run from here on.
   * globalThis.__MOKU_GAME_DEV__ = true;
   * ```
   */
  var __MOKU_GAME_DEV__: boolean | undefined;
}

/**
 * Reads the dev flag at call time. Undefined means off: production is the default.
 *
 * @returns True only when `__MOKU_GAME_DEV__` is exactly `true`.
 * @example
 * ```ts
 * // The dev page set the flag in .moku/dev.ts before the engine started.
 * globalThis.__MOKU_GAME_DEV__ = true;
 * isDev(); // true
 * ```
 */
export function isDev(): boolean {
  return typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__ === true;
}

/**
 * Builds the error a control command throws outside a dev build.
 *
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * // A production build called a /control command.
 * controlRefused().message; // "[game] Control commands run in dev builds only.\n  Define __MOKU_GAME_DEV__ as true in the dev build."
 * ```
 */
export function controlRefused(): Error {
  return new Error(
    "[game] Control commands run in dev builds only.\n  Define __MOKU_GAME_DEV__ as true in the dev build."
  );
}

/**
 * Builds the error a door source or command throws when the opt-in plugin it uses is not
 * installed.
 *
 * @param id - The id of the source or the command.
 * @param plugin - The export name of the plugin it uses.
 * @param kind - What the door descriptor is. A source by default.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * notInstalled("game.sounds", "audioPlugin").message; // "[game] The source game.sounds needs audioPlugin.\n  Add audioPlugin to createApp({ plugins })."
 * notInstalled("game.mute", "audioPlugin", "command").message; // "[game] The command game.mute needs audioPlugin.\n  Add audioPlugin to createApp({ plugins })."
 * ```
 */
export function notInstalled(
  id: string,
  plugin: string,
  kind: "source" | "command" = "source"
): Error {
  return new Error(
    `[game] The ${kind} ${id} needs ${plugin}.\n  Add ${plugin} to createApp({ plugins }).`
  );
}
