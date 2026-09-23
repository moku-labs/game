/**
 * @file flow/doors — the dev flag. `__MOKU_GAME_DEV__` is a global the engine never replaces: a
 * game's dev build defines it `true` (bundler `define`) or sets `globalThis.__MOKU_GAME_DEV__`
 * before the engine runs; undefined means a production build.
 *
 * Bun does not inline `isDev()` across modules (checked on Bun 1.3.14), so a branch that must
 * vanish from a production bundle writes the guard inline:
 * `if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();`.
 * A `define` of `false` folds that condition, and the minifier drops the code behind it.
 */

declare global {
  /**
   * The dev flag of a game. A game never re-declares it: it defines it in the bundler, or sets
   * `globalThis.__MOKU_GAME_DEV__ = true` in its dev entry.
   *
   * @example
   * ```ts
   * // web/dev.ts, imported first by the dev page: /control commands run from here on.
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
 * // The dev page set the flag in web/dev.ts before the engine started.
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
