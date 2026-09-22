/**
 * @file assets plugin — the graph-driven preload: which bundles a node needs, which bundles its
 * neighbourhood needs, and the background queue that fetches them one after another.
 */

import type { GraphNode } from "../flow/runner/types";
import type { FlowGraph, NodeInfo } from "../flow/types";
import { usedMb } from "./budget";
import { ignoreFailure, isAbortError, loadBundle } from "./tiers";
import type { AssetsCtx, PreloadQueue, State } from "./types";

/** One node the walk reached: where it is, how it got there and how far away it is. */
type Visit = {
  flow: string;
  node: string;
  frames: Array<{ flow: string; node: string }>;
  distance: number;
};

/**
 * Lists the `feature`-tier bundles of the feature that owns a flow.
 *
 * @param ctx - Domain context of the plugin.
 * @param flow - Id of the flow.
 * @returns The bundle names.
 */
function featureBundles(ctx: AssetsCtx, flow: string): string[] {
  const feature = ctx.state.featureOfFlow.get(flow);

  if (feature === undefined) return [];

  return Object.entries(ctx.state.manifest.bundles)
    .filter(([, entry]) => entry.feature === feature && entry.tier === "feature")
    .map(([name]) => name);
}

/**
 * Adds the names of a list to another, without repeating one.
 *
 * @param names - The list being built.
 * @param extra - What to add.
 */
function addAll(names: string[], extra: readonly string[]): void {
  for (const name of extra) {
    if (!names.includes(name)) names.push(name);
  }
}

/**
 * The bundles the node being entered needs: the bundle of its scene, and every `feature`-tier
 * bundle of the feature that owns its flow. A node without a scene keeps the scene bundle of the
 * node before it.
 *
 * @param ctx - Domain context of the plugin.
 * @param node - The node being entered.
 * @returns The bundle names, the scene first.
 * @example
 * ```ts
 * // Entering "board/awaitIntent", which names the scene "board".
 * bundlesOfNode(ctx, node); // ["board", "board.chains"]
 * ```
 */
export function bundlesOfNode(ctx: AssetsCtx, node: NodeInfo): string[] {
  const names: string[] = [];
  const scene =
    node.scene === undefined ? ctx.state.sceneBundle : ctx.state.bundleOfScene.get(node.scene);

  if (scene !== undefined) names.push(scene);
  addAll(names, featureBundles(ctx, node.flow));

  return names;
}

/**
 * The bundles a node of `describe()` needs. Unlike `bundlesOfNode` it carries nothing forward:
 * a walk has no "node before it".
 *
 * @param ctx - Domain context of the plugin.
 * @param node - One node of the graph description.
 * @returns The bundle names.
 */
function bundlesOfGraphNode(ctx: AssetsCtx, node: GraphNode): string[] {
  const names: string[] = [];
  const scene = node.scene === undefined ? undefined : ctx.state.bundleOfScene.get(node.scene);

  if (scene !== undefined) names.push(scene);
  addAll(names, featureBundles(ctx, node.flow));

  return names;
}

/**
 * Creates the set of visited `flow/node` ids. It lives in its own non-exported function because
 * lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @param first - The id the walk starts at.
 * @returns A set holding that one id.
 * @example
 * ```ts
 * seenIds("board/await").has("board/await"); // true
 * ```
 */
function seenIds(first: string): Set<string> {
  return new Set([first]);
}

/**
 * Creates the map from a bundle name to the distance it was first seen at, for the same reason as
 * `seenIds`.
 *
 * @returns An empty map.
 */
function emptyDistances(): Map<string, number> {
  return new Map();
}

/**
 * Enqueues a node the walk has not seen yet.
 *
 * @param queue - The breadth-first queue.
 * @param visited - Every `flow/node` already enqueued.
 * @param visit - The node to add.
 */
function push(queue: Visit[], visited: Set<string>, visit: Visit): void {
  const id = `${visit.flow}/${visit.node}`;

  if (visited.has(id)) return;

  visited.add(id);
  queue.push(visit);
}

/**
 * Adds what a node opens inside itself: the start node of its sub-flow, and the start node of
 * every flow contributed to its slot. Both sit at the same distance as the node itself.
 *
 * @param graph - The graph description.
 * @param node - The node the walk stands on.
 * @param visit - How the walk got there.
 * @param queue - The breadth-first queue.
 * @param visited - Every `flow/node` already enqueued.
 */
function expandInner(
  graph: FlowGraph,
  node: GraphNode,
  visit: Visit,
  queue: Visit[],
  visited: Set<string>
): void {
  const inner: string[] = [];

  if (node.subFlow !== undefined) inner.push(node.subFlow);
  if (node.slot !== undefined) {
    for (const contribution of graph.slots[node.slot] ?? []) inner.push(contribution.flow);
  }

  for (const id of inner) {
    const flow = graph.flows[id];

    if (flow === undefined) continue;

    push(queue, visited, {
      flow: id,
      node: flow.start,
      frames: [...visit.frames, { flow: visit.flow, node: visit.node }],
      distance: visit.distance
    });
  }
}

/**
 * Follows one edge target of `describe()`: `"node"` and `"map:node"` stay in the flow,
 * `"exit:name"` leaves it on the frame the runner would return to.
 *
 * @param graph - The graph description.
 * @param visit - The node the edge starts at.
 * @param target - The rendered target string.
 * @param queue - The breadth-first queue.
 * @param visited - Every `flow/node` already enqueued.
 */
function follow(
  graph: FlowGraph,
  visit: Visit,
  target: string,
  queue: Visit[],
  visited: Set<string>
): void {
  const distance = visit.distance + 1;

  if (target.startsWith("exit:")) {
    const parent = visit.frames.at(-1);

    if (parent === undefined) return;

    const next = graph.flows[parent.flow]?.edges[parent.node]?.[target.slice("exit:".length)];

    if (next === undefined) return;

    follow(
      graph,
      { ...parent, frames: visit.frames.slice(0, -1), distance: visit.distance },
      next,
      queue,
      visited
    );

    return;
  }

  push(queue, visited, {
    flow: visit.flow,
    node: target.startsWith("map:") ? target.slice("map:".length) : target,
    frames: visit.frames,
    distance
  });
}

/**
 * Walks the graph breadth-first from the node the game stands on and lists the bundles worth
 * preloading: ordered by distance and then by name, without the `lazy` tier, without what is
 * already there, and cut where the budget would break.
 *
 * @param ctx - Domain context of the plugin.
 * @param depth - How many edges to look ahead.
 * @returns The bundle names in load order.
 * @example
 * ```ts
 * // Resting on "board/awaitIntent" with a depth of two edges.
 * neighbourhood(ctx, 2); // ["board", "board.chains", "shop", "home", "reward"]
 * ```
 */
export function neighbourhood(ctx: AssetsCtx, depth: number): string[] {
  const current = ctx.state.current;

  if (current === undefined) return [];

  const graph = ctx.deps.flow.describe();
  const stack = ctx.deps.flow.state().stack;
  const queue: Visit[] = [
    {
      flow: current.flow,
      node: current.node,
      frames: stack.slice(0, -1).map(frame => ({ flow: frame.flow, node: frame.node })),
      distance: 0
    }
  ];
  const visited = seenIds(`${current.flow}/${current.node}`);
  const distances = emptyDistances();

  for (const visit of queue) {
    const node = graph.flows[visit.flow]?.nodes[visit.node];

    if (node === undefined) continue;

    for (const name of bundlesOfGraphNode(ctx, node)) {
      if (!distances.has(name)) distances.set(name, visit.distance);
    }

    expandInner(graph, node, visit, queue, visited);

    if (visit.distance >= depth) continue;

    for (const target of Object.values(graph.flows[visit.flow]?.edges[visit.node] ?? {})) {
      follow(graph, visit, target, queue, visited);
    }
  }

  return affordable(ctx, distances);
}

/**
 * Filters the walk's result: the `lazy` tier, a bundle that is already there and everything
 * behind the first bundle that would break the budget are dropped. Preload never evicts.
 *
 * @param ctx - Domain context of the plugin.
 * @param distances - Bundle name to the distance it was first seen at.
 * @returns The bundle names in load order.
 */
function affordable(ctx: AssetsCtx, distances: Map<string, number>): string[] {
  const ordered = [...distances.entries()]
    .toSorted((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([name]) => name);
  const wanted: string[] = [];
  let running = usedMb(ctx.state);

  for (const name of ordered) {
    const entry = ctx.state.manifest.bundles[name];
    const record = ctx.state.records.get(name);

    if (entry === undefined || entry.tier === "lazy") continue;
    if (record !== undefined && record.status !== "idle") continue;
    if (running + entry.mb > ctx.config.textureBudgetMb) break;

    running += entry.mb;
    wanted.push(name);
  }

  return wanted;
}

/**
 * Loads the queue one bundle after another. A failure is logged and the queue goes on; an abort
 * ends it without a word.
 *
 * @param ctx - Domain context of the plugin.
 * @param queue - The queue to work through.
 */
async function runQueue(ctx: AssetsCtx, queue: PreloadQueue): Promise<void> {
  for (const name of queue.bundles) {
    if (queue.controller.signal.aborted) break;

    try {
      await loadBundle(ctx, name, queue.controller.signal, "preload");
    } catch (error) {
      if (!isAbortError(error)) {
        ctx.log.warn("assets: a preloaded bundle failed", { bundle: name, error: String(error) });
      }
    }
  }

  if (ctx.state.queue === queue) ctx.state.queue = undefined;
}

/**
 * Aborts the background preload and forgets it.
 *
 * @param state - The plugin state.
 * @example
 * ```ts
 * // A new rest node arrived, so the old neighbourhood is no longer the right one.
 * stopPreload(state); // state.queue is undefined and its fetches are cancelled
 * ```
 */
export function stopPreload(state: State): void {
  state.queue?.controller.abort();
  state.queue = undefined;
}

/**
 * Replaces the background preload with the neighbourhood of the node the game rests on. A depth
 * of zero and a headless app do nothing.
 *
 * @param ctx - Domain context of the plugin.
 * @example
 * ```ts
 * // What the `flow:rest` hook does after it enforced the budget.
 * startPreload(ctx); // state.queue.bundles is the neighbourhood, loading in the background
 * ```
 */
export function startPreload(ctx: AssetsCtx): void {
  const state = ctx.state;

  if (state.io === undefined || ctx.config.preloadDepth <= 0) return;

  stopPreload(state);

  const bundles = neighbourhood(ctx, ctx.config.preloadDepth);

  if (bundles.length === 0) return;

  const queue: PreloadQueue = { bundles, controller: new AbortController() };

  state.queue = queue;
  runQueue(ctx, queue).catch(ignoreFailure);
}
