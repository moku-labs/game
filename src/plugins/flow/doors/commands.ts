/**
 * @file flow/doors — the base commands: every command of the engine, keyed by a short name. Each
 * descriptor lives with the plugin that owns its data; this module only gathers them. Imported
 * by the door `src/control.ts` only, so no plugin reaches it and no import cycle forms.
 */
import { reducedMotionCommand } from "../../anim/control";
import { muteCommand } from "../../audio/control";
import { filterCommand } from "../../effects/control";
import { dragCommand, keyCommand, traceCommand } from "../../input/control";
import { pauseCommand, resumeCommand } from "../../lifecycle/control";
import { captureCommand, debugCommand } from "../../renderer/control";
import { frameRateCommand, stepCommand, timeScaleCommand } from "../../time/control";
import { fillCommand, scrollCommand, tapCommand } from "../../ui/control";
import {
  answerCommand,
  bookmarkCommand,
  restoreCommand,
  saveExportCommand,
  saveImportCommand,
  walkCommand
} from "../control";

/**
 * Every command of the engine, keyed by its short name: what an editor lists as buttons and MCP
 * tools. Frozen. Each runs on the dev page and on a debug page, by the profile `run` checks: a
 * `--debug` page runs every one, a `--debug=read` page the read and cosmetic ones.
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
  saveExport: saveExportCommand,
  saveImport: saveImportCommand,
  step: stepCommand,
  pause: pauseCommand,
  resume: resumeCommand,
  capture: captureCommand,
  debug: debugCommand,
  reducedMotion: reducedMotionCommand,
  fill: fillCommand,
  scroll: scrollCommand,
  timeScale: timeScaleCommand,
  frameRate: frameRateCommand,
  mute: muteCommand,
  trace: traceCommand,
  filter: filterCommand
});
