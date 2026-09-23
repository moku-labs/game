/**
 * @file flow plugin — the flow sources of the `/inspect` door: the graph, the position, the edge
 * journal, the taint and the cheat journal, and the log trace, since the log is a core API on
 * every app. Production-safe: every source only reads.
 */
import type { Log } from "@moku-labs/common/browser";
import { defineSource } from "./doors/define";
import { cheatsOf, isTainted } from "./doors/session";
import type { HeadlessApp } from "./headless";
import type { FlowState, Position } from "./types";

/** The levels of `Log.LogLevel`, least severe first, as the names a caller passes. */
const LOG_LEVELS: readonly string[] = ["debug", "info", "warn", "error"];

/**
 * The rank of a log level: 0 for `debug` up to 3 for `error`.
 *
 * @param level - The level the caller named.
 * @returns Its rank.
 * @throws {Error} When the log has no such level.
 * @example
 * ```ts
 * rankOf("warn"); // 2
 * ```
 */
function rankOf(level: string): number {
  const rank = LOG_LEVELS.indexOf(level);

  if (rank !== -1) return rank;

  throw new Error(
    '[game] game.log takes the level "debug", "info", "warn" or "error".\n  Leave the level out to read every entry.'
  );
}

/**
 * Turns the flow state into the position a panel shows.
 *
 * @param state - The flow state.
 * @returns The path, the top flow and node, and what the gate waits for.
 * @example
 * ```ts
 * positionOf(app.flow.state()).node; // "awaitIntent"
 * ```
 */
function positionOf(state: FlowState): Position {
  const top = state.stack.at(-1);

  return { path: state.path, flow: top?.flow, node: top?.node, waiting: state.pending.gate ?? [] };
}

/**
 * The flow graph: flows, nodes with their flags and outcomes, edges and slots.
 *
 * @example
 * ```ts
 * // The editor draws the graph of Timber Town.
 * read(app, sources.graph).flows.main?.edges.home; // { play: "board" }
 * ```
 */
export const graphSource = defineSource({
  id: "game.graph",
  title: "Graph",
  input: {},
  changes: "edge",
  read: (app: HeadlessApp) => app.flow.describe()
});

/**
 * Where the graph rests: the path, the node and the intents the gate waits for.
 *
 * @example
 * ```ts
 * // After a tap on Play on the home screen.
 * read(app, sources.position); // { path: "board/awaitIntent", flow: "board", node: "awaitIntent", waiting: ["tap", "leave"] }
 * ```
 */
export const positionSource = defineSource({
  id: "game.position",
  title: "Position",
  input: {},
  changes: "edge",
  read: (app: HeadlessApp) => positionOf(app.flow.state())
});

/**
 * The edges taken since the last checkpoint, all of them or the last few.
 *
 * @example
 * ```ts
 * // Why was the last move refused?
 * read(app, sources.history, { last: 1 }); // [{ path: "board/merge", outcome: "rejected", payload: { reason: "empty" }, ... }]
 * ```
 */
export const historySource = defineSource({
  id: "game.history",
  title: "History",
  input: { last: "number?" },
  changes: "edge",
  read: (app: HeadlessApp, { last }) => {
    const entries = app.flow.history();

    return last === undefined ? entries : entries.slice(Math.max(0, entries.length - last));
  }
});

/**
 * Whether a cheat or a raw command changed this session: a tainted session is no played one.
 *
 * @example
 * ```ts
 * // After run(app, commands.restore, { repro }).
 * read(app, sources.tainted); // true
 * ```
 */
export const taintedSource = defineSource({
  id: "game.tainted",
  title: "Tainted",
  input: {},
  changes: "frame",
  read: (app: HeadlessApp) => isTainted(app)
});

/**
 * The cheat and raw commands run on this app, oldest first, the last 500.
 *
 * @example
 * ```ts
 * // After run(app, commands.restore, { bookmark }) on frame 96.
 * read(app, sources.cheats); // [{ id: "game.restore", input: { bookmark: { path: "home", ... } }, frame: 96 }]
 * ```
 */
export const cheatsSource = defineSource({
  id: "game.cheats",
  title: "Cheats",
  input: {},
  changes: "frame",
  read: (app: HeadlessApp) => cheatsOf(app)
});

/**
 * The log trace, oldest first: every entry, or the entries at a level and above.
 *
 * @example
 * ```ts
 * // What went wrong on the last tap?
 * read(app, sources.log, { level: "warn" });
 * // [{ level: "warn", event: "assets: missing texture", data: { key: "ui.gear" }, ts: 1758620000000 }]
 * ```
 */
export const logSource = defineSource({
  id: "game.log",
  title: "Log",
  input: { level: "string?" },
  changes: "frame",
  read: (app: HeadlessApp & { readonly log: Log.LogApi }, { level }) => {
    const entries = app.log.trace();

    if (level === undefined) return entries;

    const lowest = rankOf(level);

    return entries.filter(entry => LOG_LEVELS.indexOf(entry.level) >= lowest);
  }
});
