/**
 * @file flow/doors — `run`, the `/control` side: dev builds and debug builds (every command with
 * `--debug`; the read and cosmetic ones alone with `--debug=read`), a cheat taints, the envelope.
 */
import type { HeadlessApp } from "../headless";
import { controlReadOnly, controlRefused, isAgent, isControl, isDev } from "./dev";
import { inputOrEmpty } from "./input";
import { isTainted, recordCheat } from "./session";
import type { Command, Envelope, InputArguments, InputSchema, Ran } from "./types";

/**
 * Reads where the game stands after a command.
 *
 * @param app - The app.
 * @returns The graph path, the frame and the taint.
 */
function envelopeOf(app: HeadlessApp): Envelope {
  return {
    path: app.flow.state().path,
    frame: app.time.snapshot().frame,
    tainted: isTainted(app)
  };
}

/**
 * Runs a command in a dev build or a debug build. A `--debug` build and the dev page run every
 * command; a `--debug=read` build runs the read and cosmetic ones only. A `cheat` or `raw`
 * command taints the session and is journaled before it runs, so a failing one still counts.
 *
 * @param app - The app the command acts on.
 * @param command - The command.
 * @param input - Its input; left out when every field of its schema is optional.
 * @returns The command's value and the envelope read after it.
 * @throws {Error} Outside dev builds and debug builds (every command with `--debug`; the read and
 *   cosmetic ones alone with `--debug=read`), the read-only refusal of `controlReadOnly` for a
 *   `route`, `cheat` or `raw` command on a `--debug=read` page, and whatever the command throws.
 * @example
 * ```ts
 * // An e2e script: load the bug report, then tap Play.
 * await run(app, commands.restore, { repro }); // state: { path: "home", frame: 12, tainted: true }
 * const ran = await run(app, commands.answer, { intent: "play" });
 * ran.value; // true
 * ran.state; // { path: "board/awaitIntent", frame: 14, tainted: true }
 * // On a --debug=read page: await run(app, commands.tap, { key: "play" }); // throws "[game] The command game.tap changes the game: …"
 * ```
 */
export async function run<S extends InputSchema, O, App extends HeadlessApp>(
  app: App,
  command: Command<S, O, App>,
  ...input: InputArguments<S>
): Promise<Ran<O>> {
  // The dev page and a --debug page run every command; a --debug=read page the read and cosmetic ones.
  if (!isDev() && !isControl()) {
    if (!isAgent()) throw controlRefused();
    if (command.effect !== "read" && command.effect !== "cosmetic") {
      throw controlReadOnly(command.id);
    }
  }

  const given = inputOrEmpty<S>(input[0]);

  if (command.effect === "cheat" || command.effect === "raw") {
    recordCheat(app, command.id, given, app.time.snapshot().frame);
  }

  const value = await command.run(app, given);

  return { value, state: envelopeOf(app) };
}
