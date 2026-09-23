/**
 * @file flow/doors — the base sources: every source of the engine, keyed by a short name. Each
 * descriptor lives with the plugin that owns its data; this module only gathers them. Imported
 * by the door `src/inspect.ts` only, so no plugin reaches it, no import cycle forms and an
 * `/inspect` bundle carries no command.
 */
import { assetsSource } from "../../assets/inspect";
import { soundsSource } from "../../audio/inspect";
import { modelSource } from "../../model/inspect";
import { renderSource } from "../../renderer/inspect";
import { rectSource, uiSource } from "../../ui/inspect";
import { entitiesSource, projectionsSource } from "../../world/inspect";
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
