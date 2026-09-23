/**
 * @file flow/doors — the base commands: every command of the engine, keyed by a short name. Each
 * descriptor lives with the plugin that owns its data; this module only gathers them. Imported
 * by the door `src/control.ts` only, so no plugin reaches it and no import cycle forms.
 */
import { reducedMotionCommand } from "../../anim/control";
import { dragCommand, keyCommand, tapCommand } from "../../input/control";
import { pauseCommand, resumeCommand } from "../../lifecycle/control";
import { captureCommand, debugCommand } from "../../renderer/control";
import { stepCommand } from "../../time/control";
import { answerCommand, bookmarkCommand, restoreCommand, walkCommand } from "../control";

/**
 * Every command of the engine, keyed by its short name: what an editor lists as buttons and MCP
 * tools. Frozen. Each runs in dev builds only.
 *
 * @example
 * ```ts
 * // An e2e script taps Play, and the editor registers every command.
 * (await run(app, commands.tap, { key: "play" })).state.path; // "board/awaitIntent"
 * for (const command of Object.values(commands)) registry.add(command);
 * ```
 */
export const commands = Object.freeze({
  answer: answerCommand,
  tap: tapCommand,
  drag: dragCommand,
  key: keyCommand,
  walk: walkCommand,
  bookmark: bookmarkCommand,
  restore: restoreCommand,
  step: stepCommand,
  pause: pauseCommand,
  resume: resumeCommand,
  capture: captureCommand,
  debug: debugCommand,
  reducedMotion: reducedMotionCommand
});
