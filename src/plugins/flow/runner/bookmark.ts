/**
 * @file flow/runner — which bookmark the loop may enter. `restore` and `walk` both ask here, so the
 * two ways into a position refuse the same bookmarks and take the same fallback: the rest point
 * before a transit node, when the graph changed under a bookmark that carries one.
 */
import type { FlowCtx } from "../types";
import { collectGraph, graphOf } from "./graph";
import { findNode, graphHash, isRestCheckpoint } from "./registry";
import type { AnyFlow, AnyNode, Bookmark, Modules } from "./types";

/** A bookmark that passed the check, and whether the node it names is a rest node. */
type Accepted = { bookmark: Bookmark; rest: boolean };

/**
 * Reads the main flow of the config.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param method - Name of the API method that needs it, for the message.
 * @returns The top-level flow.
 * @throws {Error} When no main flow was configured.
 */
function mainFlow(ctx: FlowCtx, method: string): AnyFlow {
  const main = ctx.config.mainFlow;

  if (main === undefined) {
    throw new Error(
      `[game] flow.${method}() needs a main flow.\n  Pass it as pluginConfigs.flow.mainFlow.`
    );
  }

  return main;
}

/**
 * Names a checkpoint of the graph, for the message of a refused bookmark. Only a rest node is
 * one: a transit node that carries the flag is no place a restore may be sent to.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @returns The path of the first rest checkpoint, or the start of the main flow.
 */
function someCheckpoint(ctx: FlowCtx, modules: Modules): string {
  const main = mainFlow(ctx, "restore");

  for (const flow of collectGraph(ctx, modules.features).values()) {
    for (const [name, entry] of Object.entries(flow.nodes)) {
      if (isRestCheckpoint(entry)) return flow.id === main.id ? name : `${flow.id}/${name}`;
    }
  }

  return main.start;
}

/**
 * Looks up the node at a path. A sub-flow and a slot are no nodes: nothing runs at them.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param path - Path of a bookmark, or of its rest point.
 * @returns The node there, a rest node or a transit node, or `undefined` when the path names none.
 */
function nodeAt(ctx: FlowCtx, modules: Modules, path: string): AnyNode | undefined {
  const entry = findNode(mainFlow(ctx, "restore"), path, modules.features.contributions)?.entry;

  return entry?.kind === "node" ? entry : undefined;
}

/**
 * Finds the node a bookmark names.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param bookmark - The bookmark to enter.
 * @returns The node at the bookmark's path, a rest node or a transit node.
 * @throws {Error} When the path names no node of the graph.
 */
function bookmarkNode(ctx: FlowCtx, modules: Modules, bookmark: Bookmark): AnyNode {
  const node = nodeAt(ctx, modules, bookmark.path);

  if (node === undefined) {
    throw new Error(
      `[game] The bookmark "${bookmark.path}" is not a node of the graph.\n  Restore a rest node, for example the checkpoint "${someCheckpoint(ctx, modules)}".`
    );
  }

  return node;
}

/**
 * Tells whether the graph is the one a bookmark was made for. The answer costs a description and
 * a hash of the whole graph, so one acceptance works it out once: see `askedOnce`.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param bookmark - The bookmark to compare with.
 * @returns True while the hash of `describe()` is the bookmark's.
 */
function sameGraph(ctx: FlowCtx, modules: Modules, bookmark: Bookmark): boolean {
  return graphHash(graphOf(ctx, modules.features)) === bookmark.graph;
}

/**
 * Makes a question that is worked out at most once: at the first ask, and never when nobody asks.
 *
 * @param ask - Works the answer out.
 * @returns The question. Every ask after the first gets the first answer.
 * @example
 * ```ts
 * const same = askedOnce(() => true);
 * same() && same(); // true, and the answer was worked out once
 * ```
 */
function askedOnce(ask: () => boolean): () => boolean {
  const answer: { value: boolean | undefined } = { value: undefined };

  return () => {
    answer.value ??= ask();

    return answer.value;
  };
}

/**
 * Checks that a bookmark may be entered: a rest checkpoint always, any other node only while the
 * graph is the one the bookmark was made for. A transit node is never taken for a checkpoint,
 * whatever its flag says: it is a place inside a transition, not a place a save may stand on.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param bookmark - The bookmark to enter.
 * @param unchanged - Asks whether the graph is the bookmark's own. Not asked for a checkpoint.
 * @returns The node the bookmark names.
 * @throws {Error} When the path is no node, or the graph changed since the bookmark.
 */
function checkBookmark(
  ctx: FlowCtx,
  modules: Modules,
  bookmark: Bookmark,
  unchanged: () => boolean
): AnyNode {
  const node = bookmarkNode(ctx, modules, bookmark);

  if (isRestCheckpoint(node)) return node;
  if (unchanged()) return node;

  throw new Error(
    `[game] The bookmark "${bookmark.path}" was made for another graph.\n  Restore the checkpoint "${someCheckpoint(ctx, modules)}" instead.`
  );
}

/**
 * Builds the bookmark of the rest point before a transit node, for a bookmark that carries `rest`
 * and was made for another graph. That is one whose path names a transit node while the hash
 * differs, and one whose path names no node any more: a renamed or removed node is a changed
 * graph too. Only the position changes: the state stays the bookmark's.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param bookmark - The bookmark to enter.
 * @param unchanged - Asks whether the graph is the bookmark's own. Asked for a transit node only.
 * @returns The bookmark to enter instead, or `undefined` when the bookmark stands for itself.
 */
function restFallback(
  ctx: FlowCtx,
  modules: Modules,
  bookmark: Bookmark,
  unchanged: () => boolean
): Bookmark | undefined {
  const rest = bookmark.rest;

  if (rest === undefined) return undefined;

  // The node is still there, and it is a rest node or the graph is the bookmark's own.
  const node = nodeAt(ctx, modules, bookmark.path);
  const standsForItself = node !== undefined && (node.rest || unchanged());

  if (standsForItself) return undefined;

  return { ...bookmark, path: rest.path, input: rest.input };
}

/**
 * Decides what the loop enters for a bookmark: the bookmark itself, or the rest point before it
 * when the graph changed under a bookmark that has one. Either one passes the same check, so the
 * fallback is entered only when it is a checkpoint, and the log says that it was taken.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param bookmark - The bookmark to enter.
 * @returns The bookmark the loop enters, and whether its node is a rest node.
 * @throws {Error} When neither the bookmark nor its rest point may be entered.
 */
export function acceptBookmark(ctx: FlowCtx, modules: Modules, bookmark: Bookmark): Accepted {
  // One answer serves the fallback and the check: both compare the graph with the same hash.
  const unchanged = askedOnce(() => sameGraph(ctx, modules, bookmark));

  // What the loop enters: the bookmark, or the rest point before it. Either passes the check.
  const fallback = restFallback(ctx, modules, bookmark, unchanged);
  const entered = fallback ?? bookmark;
  const node = checkBookmark(ctx, modules, entered, unchanged);

  if (fallback !== undefined) {
    ctx.log.info("flow:restore-fell-back", { from: bookmark.path, to: fallback.path });
  }

  return { bookmark: entered, rest: node.rest };
}
