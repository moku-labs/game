/**
 * @file effects plugin — the filter command of the `/control` door: turn one filter kind off or on through
 * `effects.diagnostics`. Dev and debug builds: the body starts with the inline guard of a cosmetic command, so a
 * bundler `define` of `false` drops it, and logs the `moku:dev` marker.
 */
import { defineCommand, inputSchema } from "../flow/doors/define";
import { controlRefused, notInstalled } from "../flow/doors/dev";
import type { ControlApp } from "../flow/doors/types";
import type { EffectsApi } from "./types";

/**
 * Turns one filter kind off or on, through `effects.diagnostics`. Answers the kinds that are off afterwards.
 * Cosmetic: it runs on every debug page, `--debug=read` too. A door for the MCP and the tools page; it carries no
 * `overlay` marker.
 *
 * @throws {Error} `[game] No filter kind "fx.nope".` naming every known kind, and `notInstalled` without
 *   `effectsPlugin`.
 * @example
 * ```ts
 * // The editor's MCP turns the glow off on the phone, then on again.
 * (await run(app, commands.filter, { kind: "effects.glow", on: false })).value; // ["effects.glow"]
 * (await run(app, commands.filter, { kind: "effects.glow", on: true })).value; // []
 * ```
 */
export const filterCommand = defineCommand({
  id: "game.filter",
  title: "Filter kind on or off",
  input: inputSchema(["kind", "string"], ["on", "boolean"]),
  effect: "cosmetic",
  run: (app: ControlApp & { readonly effects?: EffectsApi }, { kind, on }) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_AGENT__ === "undefined" || !__MOKU_GAME_AGENT__)
    ) {
      throw controlRefused();
    }

    app.log.debug("moku:dev", { command: "game.filter", kind, on });

    if (app.effects === undefined) throw notInstalled("game.filter", "effectsPlugin", "command");

    const { diagnostics } = app.effects;
    const switched = on ? diagnostics.enable(kind) : diagnostics.disable(kind);

    if (!switched) {
      throw new Error(
        `[game] No filter kind "${kind}".\n  Known: ${diagnostics.kinds().join(", ")}.`
      );
    }

    return diagnostics.disabled();
  }
});
