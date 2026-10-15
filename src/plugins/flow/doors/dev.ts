/**
 * @file flow/doors — the flags of a page and the errors a door throws. `__MOKU_GAME_DEV__` is a
 * global the engine never replaces: `moku-game dev` defines it `true` (bunfig `define`) and sets
 * `globalThis.__MOKU_GAME_DEV__` in `.moku/dev.ts` before the engine runs; `moku-game build`
 * defines it `false`; undefined means a production build.
 *
 * Bun does not inline `isDev()` across modules (checked on Bun 1.3.14), so a branch that must
 * vanish from a production bundle writes the guard inline:
 * `if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) throw controlRefused();`.
 * A `define` of `false` folds that condition, and the minifier drops the code behind it.
 * `__MOKU_GAME_AGENT__` and `__MOKU_GAME_CONTROL__` follow the same rules: a define of `false`
 * folds their guard.
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

  /**
   * The agent flag: the editor's page agent is on the page, and measurement code runs. `moku-game dev` and
   * `moku-game build --debug` set it, `moku-game build` defines it `false`. A game never re-declares it.
   *
   * @example
   * ```ts
   * // The in-memory agent.ts of `moku-game build --debug`, the first import of its main.ts.
   * globalThis.__MOKU_GAME_AGENT__ = true;
   * ```
   */
  var __MOKU_GAME_AGENT__: boolean | undefined;

  /**
   * The control flag: every /control command runs, the state-changing ones too (`route`, `cheat`, `raw`).
   * `moku-game dev` and `moku-game build --debug=full` set it; `--debug` and `moku-game build` define it `false`.
   *
   * @example
   * ```ts
   * // The in-memory agent.ts of `moku-game build --debug=full`.
   * globalThis.__MOKU_GAME_CONTROL__ = true;
   * ```
   */
  var __MOKU_GAME_CONTROL__: boolean | undefined;

  /**
   * The id of the build the page came from: `"dev"` on the dev page, `"debug-20261014T153012Z"` or
   * `"debug-full-20261014T153012Z"` on a debug build, undefined on a release build.
   *
   * @example
   * ```ts
   * // The overlay shows which build runs on the phone.
   * globalThis.__MOKU_GAME_BUILD__; // "debug-20261014T153012Z"
   * ```
   */
  var __MOKU_GAME_BUILD__: string | undefined;

  /**
   * The engine the page runs: the id of `engineFingerprint` (E), its version plus a hash of its bundled `dist` and of
   * any patch of that version. Set on the dev page and on a debug build; undefined on a release build. The editor's
   * overlay and the header of the performance log (spec 11) read it; the engine's plugins never do.
   *
   * @example
   * ```ts
   * // The overlay names the engine the phone runs.
   * globalThis.__MOKU_GAME_ENGINE__; // "0.14.12+9c41e0.patch.3f2a7b"
   * ```
   */
  var __MOKU_GAME_ENGINE__: string | undefined;

  /**
   * Where the page agent of a debug build finds the editor: `host:port`, written by `--editor` (default
   * `"127.0.0.1:47600"`). Undefined on the dev page, whose agent talks to the server that served it, and on a release
   * build.
   *
   * @example
   * ```ts
   * // moku-game build --debug --editor 192.168.1.20:47600
   * globalThis.__MOKU_GAME_EDITOR__; // "192.168.1.20:47600"
   * ```
   */
  var __MOKU_GAME_EDITOR__: string | undefined;

  /**
   * The overlay channel of the page agent: the editor's page agent sets it when it starts and deletes it when it stops.
   * `open()` shows the card; `open({ mode: "pill" })` the small pill; `toggle()` switches between hidden and the last
   * visible mode; `isOpen()` is true for the pill or the card. A game never sets it: it calls `app.debug.overlay`.
   *
   * @example
   * ```ts
   * // The editor's page agent, at start:
   * globalThis.__MOKU_GAME_OVERLAY__ = { open: options => overlay.show(options?.mode ?? "card"), close, toggle, isOpen };
   * ```
   */
  var __MOKU_GAME_OVERLAY__:
    | {
        open(options?: { mode?: "pill" | "card" }): void;
        close(): void;
        toggle(): void;
        isOpen(): boolean;
      }
    | undefined;
}

/**
 * The error `run` throws on a `--debug` page for a command that changes the game: its `reason`
 * tells it apart from any other failure.
 *
 * @example
 * ```ts
 * // The editor greys the command out instead of reporting a failure.
 * const refused: ControlReadOnlyError = controlReadOnly("game.tap");
 * refused.reason; // "read-only"
 * ```
 */
export type ControlReadOnlyError = Error & { readonly reason: "read-only" };

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
 * Reads the agent flag at call time, for a runtime check; a branch that must leave a bundle
 * writes the inline guard instead.
 *
 * @returns True only when `__MOKU_GAME_AGENT__` is exactly `true`.
 * @example
 * ```ts
 * isAgent(); // true on the page of moku-game build --debug, false on a release page
 * ```
 */
export function isAgent(): boolean {
  return typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ === true;
}

/**
 * Reads the control flag at call time, for a runtime check; a branch that must leave a bundle
 * writes the inline guard instead.
 *
 * @returns True only when `__MOKU_GAME_CONTROL__` is exactly `true`.
 * @example
 * ```ts
 * isControl(); // true on the page of moku-game build --debug=full, false on a --debug page
 * ```
 */
export function isControl(): boolean {
  return typeof __MOKU_GAME_CONTROL__ !== "undefined" && __MOKU_GAME_CONTROL__ === true;
}

/**
 * The error a control command throws when its body runs outside the builds its guard allows. It
 * carries `reason: "dev-only"`, so an editor tells a refusal by the body's guard apart from a
 * failure, as `reason: "read-only"` tells the refusal of `run` on a `--debug` page.
 *
 * @example
 * ```ts
 * const refused: ControlRefusedError = controlRefused();
 * refused.reason; // "dev-only"
 * ```
 */
export type ControlRefusedError = Error & { readonly reason: "dev-only" };

/**
 * Builds the error a control command throws outside a dev build. It carries `reason: "dev-only"`.
 *
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * // A production build called a /control command.
 * controlRefused().message; // "[game] Control commands run in dev builds only.\n  Define __MOKU_GAME_DEV__ as true in the dev build."
 * controlRefused().reason; // "dev-only"
 * ```
 */
export function controlRefused(): ControlRefusedError {
  return Object.assign(
    new Error(
      "[game] Control commands run in dev builds only.\n  Define __MOKU_GAME_DEV__ as true in the dev build."
    ),
    { reason: "dev-only" as const }
  );
}

/**
 * Builds the error `run` throws on a `--debug` page for a command whose effect is `route`,
 * `cheat` or `raw`. It carries `reason: "read-only"`, so an editor tells it apart from a failure.
 *
 * @param id - The id of the refused command.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * // The editor on a --debug page.
 * try { await run(app, commands.tap, { key: "play" }); } catch (error) { Reflect.get(Object(error), "reason"); // "read-only" }
 * ```
 */
export function controlReadOnly(id: string): ControlReadOnlyError {
  return Object.assign(
    new Error(
      `[game] The command ${id} changes the game: this debug build runs read and cosmetic commands only.\n  Build with moku-game build --debug=full to run it.`
    ),
    { reason: "read-only" as const }
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
