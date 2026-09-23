/**
 * @file flow/doors — `run`, the `/control` side: dev builds only, a cheat taints, the envelope.
 */
import type { HeadlessApp } from "../headless";
import { controlRefused, isDev } from "./dev";
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
 * Runs a command in a dev build. A `cheat` or `raw` command taints the session and is journaled
 * before it runs, so a failing one still counts.
 *
 * @param app - The app the command acts on.
 * @param command - The command.
 * @param input - Its input; left out when every field of its schema is optional.
 * @returns The command's value and the envelope read after it.
 * @throws {Error} Outside a dev build, and whatever the command throws.
 * @example
 * ```ts
 * // An e2e script: load the bug report, then tap Play.
 * await run(app, commands.restore, { repro }); // state: { path: "home", frame: 12, tainted: true }
 * const ran = await run(app, commands.answer, { intent: "play" });
 * ran.value; // true
 * ran.state; // { path: "board/awaitIntent", frame: 14, tainted: true }
 * ```
 */
export async function run<S extends InputSchema, O, App extends HeadlessApp>(
  app: App,
  command: Command<S, O, App>,
  ...input: InputArguments<S>
): Promise<Ran<O>> {
  if (!isDev()) throw controlRefused();

  const given = inputOrEmpty<S>(input[0]);

  if (command.effect === "cheat" || command.effect === "raw") {
    recordCheat(app, command.id, given, app.time.snapshot().frame);
  }

  const value = await command.run(app, given);

  return { value, state: envelopeOf(app) };
}
