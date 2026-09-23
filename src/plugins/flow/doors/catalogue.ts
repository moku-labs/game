/**
 * @file flow/doors — the base catalogue: every source and command of the engine, keyed by a
 * short name. Each descriptor lives with the plugin that owns its data; this module only
 * gathers them. Imported by the two doors `src/inspect.ts` and `src/control.ts` only, so no
 * plugin reaches it and no import cycle forms.
 */
import { reducedMotionCommand } from "../../anim/control";
import { assetsSource } from "../../assets/inspect";
import { soundsSource } from "../../audio/inspect";
import { dragCommand, keyCommand, tapCommand } from "../../input/control";
import { pauseCommand, resumeCommand } from "../../lifecycle/control";
import { modelSource } from "../../model/inspect";
import { captureCommand, debugCommand } from "../../renderer/control";
import { renderSource } from "../../renderer/inspect";
import { stepCommand } from "../../time/control";
import { rectSource, uiSource } from "../../ui/inspect";
import { entitiesSource, projectionsSource } from "../../world/inspect";
import { answerCommand, bookmarkCommand, restoreCommand, walkCommand } from "../control";
import {
  cheatsSource,
  graphSource,
  historySource,
  logSource,
  positionSource,
  taintedSource
} from "../inspect";

/**
 * Every source of the engine, keyed by its short name: what an editor lists as panel data and
 * MCP tools. Frozen.
 *
 * @example
 * ```ts
 * // An e2e script checks where the game rests, and the editor registers every source.
 * read(app, sources.position).path; // "board/awaitIntent"
 * for (const source of Object.values(sources)) registry.add(source);
 * ```
 */
export const sources = Object.freeze({
  graph: graphSource,
  position: positionSource,
  history: historySource,
  tainted: taintedSource,
  cheats: cheatsSource,
  model: modelSource,
  entities: entitiesSource,
  projections: projectionsSource,
  ui: uiSource,
  rect: rectSource,
  render: renderSource,
  sounds: soundsSource,
  assets: assetsSource,
  log: logSource
});

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
