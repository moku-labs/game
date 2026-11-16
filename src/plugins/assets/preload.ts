/**
 * @file assets plugin — the graph-driven preload: which bundles a node needs, which bundles its
 * neighbourhood needs, and the background queue that fetches them one after another.
 */

import type { FlowGraph, FlowState, GraphNode, NodeInfo } from "../flow/types";
import { namedBundles } from "../scenes/bundles";
import type { SceneState } from "../scenes/types";
import { featuresOnStack, isHeld, usedMb } from "./budget";
import { ignoreFailure, isAbortError, loadBundle } from "./tiers";
import type { AssetsCtx, LookAhead, Manifest, PreloadQueue, State } from "./types";

/** The answer of a flow or scene that names no bundle: one frozen list, so asking allocates nothing. */
const NO_NAMES: readonly string[] = Object.freeze([]);

/** The entries one frame takes in a walk's flattened frames: its flow, then its node. */
const FRAME_WIDTH = 2;

/** One frame of the flow stack. */
type FlowFrame = FlowState["stack"][number];

/** One node the walk reached: where it is, how it got there and how far away it is. */
type Visit = {
  flow: string;
  node: string;
  frames: Array<{ flow: string; node: string }>;
  distance: number;
};

/**
 * Indexes the `feature`-tier bundles of the manifest by feature, in the manifest's order.
 *
 * @param manifest - The manifest.
 * @returns Feature name to its bundle names, each list frozen.
 */
function indexFeatures(manifest: Manifest): Map<string, readonly string[]> {
  const byFeature = new Map<string, string[]>();

  for (const [name, entry] of Object.entries(manifest.bundles)) {
    if (entry.tier !== "feature") continue;

    const names = byFeature.get(entry.feature);

    if (names === undefined) byFeature.set(entry.feature, [name]);
    else names.push(name);
  }

  for (const names of byFeature.values()) Object.freeze(names);

  return byFeature;
}

/**
 * Lists the `feature`-tier bundles of the feature that owns a flow, from the index of the manifest: built once per
 * manifest, not once per call (F194: the look-ahead scanned every bundle of the manifest for each node it visited).
 *
 * @param ctx - Domain context of the plugin.
 * @param flow - Id of the flow.
 * @returns The bundle names, frozen.
 */
function featureBundles(ctx: AssetsCtx, flow: string): readonly string[] {
  const state = ctx.state;
  const feature = state.featureOfFlow.get(flow);

  if (feature === undefined) return NO_NAMES;

  if (state.featureIndex?.manifest !== state.manifest) {
    state.featureIndex = { manifest: state.manifest, byFeature: indexFeatures(state.manifest) };
  }

  return state.featureIndex.byFeature.get(feature) ?? NO_NAMES;
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
 * Reads the committed state a scene's `bundles` gets: the frozen `player` and `session` of
 * `model.store.snapshot()`, never a draft of the node being entered.
 *
 * @param ctx - Domain context of the plugin.
 * @returns The committed player and session, frozen.
 */
function committedState(ctx: AssetsCtx): SceneState {
  const { player, session } = ctx.deps.model.store.snapshot();

  return Object.freeze({ player, session });
}

/**
 * The bundles a known scene names for a committed state: its bundle, then what its `bundles`
 * returns. An unknown scene names none.
 *
 * @param ctx - Domain context of the plugin.
 * @param id - Id of the scene.
 * @param state - The committed player and session.
 * @returns The bundle names, the scene bundle first.
 * @throws {Error} What the scene's `bundles` throws, or when it returns no list of names.
 */
function sceneNames(ctx: AssetsCtx, id: string, state: SceneState): readonly string[] {
  const scene = ctx.state.scenes.get(id);

  return scene === undefined ? NO_NAMES : namedBundles(scene, state, ctx.state.namedMemo);
}

/**
 * The bundles the preload expects a scene to name. A `bundles` that throws costs the look-ahead
 * only that scene's extra names: the scene stage reports the error when the node is entered.
 *
 * @param ctx - Domain context of the plugin.
 * @param id - Id of the scene.
 * @param state - The committed player and session of now.
 * @returns The bundle names, the scene bundle first.
 */
function expectedNames(ctx: AssetsCtx, id: string, state: SceneState): readonly string[] {
  try {
    return sceneNames(ctx, id, state);
  } catch {
    const bundle = ctx.state.scenes.get(id)?.bundle;

    return bundle === undefined ? [] : [bundle];
  }
}

/**
 * The bundles the node being entered needs: what its scene names (the scene bundle, then what the
 * scene's `bundles` returns for the committed state), and every `feature`-tier bundle of the
 * feature that owns its flow. A node without a scene keeps the scene of the node before it.
 *
 * @param ctx - Domain context of the plugin.
 * @param node - The node being entered.
 * @returns The bundle names, the scene first.
 * @throws {Error} When the scene's `bundles` throws: the `load` stage fails and flow rolls back.
 * @example
 * ```ts
 * // Entering "board/awaitIntent", which names the scene "board".
 * bundlesOfNode(ctx, node); // ["board", "board.chains"]
 * ```
 */
export function bundlesOfNode(ctx: AssetsCtx, node: NodeInfo): string[] {
  const names: string[] = [];
  const scene = node.scene ?? ctx.state.sceneId;

  if (scene !== undefined) addAll(names, sceneNames(ctx, scene, committedState(ctx)));
  addAll(names, featureBundles(ctx, node.flow));

  return names;
}

/**
 * The bundles a node of `describe()` needs. Unlike `bundlesOfNode` it carries nothing forward:
 * a walk has no "node before it". The scene's names are read with the state of now.
 *
 * @param ctx - Domain context of the plugin.
 * @param node - One node of the graph description.
 * @param state - The committed player and session of now.
 * @returns The bundle names.
 */
function bundlesOfGraphNode(ctx: AssetsCtx, node: GraphNode, state: SceneState): string[] {
  const names: string[] = [];

  if (node.scene !== undefined) addAll(names, expectedNames(ctx, node.scene, state));
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
 * already there or loading outside the running queue, and cut where the budget would break. A rest
 * at the place of the last walk, with the same committed state, graph, manifest, scenes and depth,
 * walks nothing: it filters the last order again, since the statuses and the budget move (F196).
 * The answer is the plugin's scratch list, valid until the next call.
 *
 * @param ctx - Domain context of the plugin.
 * @param depth - How many edges to look ahead.
 * @returns The bundle names in load order.
 */
export function neighbourhood(ctx: AssetsCtx, depth: number): readonly string[] {
  const current = ctx.state.current;

  if (current === undefined) return NO_NAMES;

  return affordable(ctx, walkOrder(ctx, current, depth));
}

/**
 * Tells whether the last walk was made at this place, for this committed state, graph, manifest,
 * scenes and depth. Field reads and a loop over the frames, no allocation.
 *
 * @param ctx - Domain context of the plugin.
 * @param walk - The last walk.
 * @param current - The node the game stands on.
 * @param depth - How many edges the walk looks ahead.
 * @returns True when its order holds now.
 */
function isSameWalk(ctx: AssetsCtx, walk: LookAhead, current: NodeInfo, depth: number): boolean {
  const { player, session } = ctx.deps.model.store.snapshot();
  const state = ctx.state;
  const same =
    walk.flow === current.flow &&
    walk.node === current.node &&
    walk.depth === depth &&
    walk.player === player &&
    walk.session === session &&
    walk.manifest === state.manifest &&
    // `scenes` and `featureOfFlow` are filled in place once, in `onStart`, before the first rest; a new map moves it.
    walk.scenes === state.scenes &&
    walk.graph === ctx.deps.flow.describe();

  return same && isSameFrames(walk.frames, ctx.deps.flow.state().stack);
}

/**
 * Tells whether the frames below the top of the flow stack are the ones a walk kept, flattened.
 *
 * @param kept - Flow and node of each frame below the top, one after the other.
 * @param stack - The flow stack now, the top last.
 * @returns True for the same flows and nodes in the same order.
 */
function isSameFrames(kept: readonly string[], stack: readonly FlowFrame[]): boolean {
  if (kept.length !== (stack.length - 1) * FRAME_WIDTH) return false;

  for (let at = 0; at < stack.length - 1; at += 1) {
    if (!isKeptFrame(stack[at], kept, at * FRAME_WIDTH)) return false;
  }

  return true;
}

/**
 * Tells whether one frame of the stack is the flow and node a walk kept at an offset of its flat list.
 *
 * @param frame - The frame of the stack now.
 * @param kept - The flattened frames the walk kept.
 * @param offset - Where the frame's flow sits in `kept`; its node follows.
 * @returns True for the same flow and node.
 */
function isKeptFrame(
  frame: FlowFrame | undefined,
  kept: readonly string[],
  offset: number
): boolean {
  return frame?.flow === kept[offset] && frame?.node === kept[offset + 1];
}

/**
 * The order the walk from the node the game stands on gives: the last walk's when it holds (see
 * `isSameWalk`), else a new walk, kept for the next rest.
 *
 * @param ctx - Domain context of the plugin.
 * @param current - The node the game stands on.
 * @param depth - How many edges to look ahead.
 * @returns The bundle names by distance and then by name, never written after the walk.
 */
function walkOrder(ctx: AssetsCtx, current: NodeInfo, depth: number): readonly string[] {
  const last = ctx.state.lookAhead;

  if (last !== undefined && isSameWalk(ctx, last, current, depth)) return last.ordered;

  const graph = ctx.deps.flow.describe();
  const stack = ctx.deps.flow.state().stack;
  const state = committedState(ctx);
  const below = stack.slice(0, -1);
  // Not frozen: a `for…of` over a frozen array allocates an iterator result per element in V8 (F196, 848 B a rest).
  const ordered = walk(ctx, graph, current, below, depth, state);

  ctx.state.lookAhead = {
    flow: current.flow,
    node: current.node,
    frames: below.flatMap(frame => [frame.flow, frame.node]),
    player: state.player,
    session: state.session,
    graph,
    manifest: ctx.state.manifest,
    scenes: ctx.state.scenes,
    depth,
    ordered
  };

  return ordered;
}

/**
 * Walks the graph breadth-first from a node and orders the bundles it reaches: by the distance
 * each was first seen at, then by name.
 *
 * @param ctx - Domain context of the plugin.
 * @param graph - The graph description.
 * @param current - The node the walk starts at.
 * @param below - The frames of the flow stack below it.
 * @param depth - How many edges to look ahead.
 * @param state - The committed player and session of now.
 * @returns The bundle names in order.
 */
function walk(
  ctx: AssetsCtx,
  graph: FlowGraph,
  current: NodeInfo,
  below: readonly FlowFrame[],
  depth: number,
  state: SceneState
): string[] {
  const queue: Visit[] = [
    {
      flow: current.flow,
      node: current.node,
      frames: below.map(frame => ({ flow: frame.flow, node: frame.node })),
      distance: 0
    }
  ];
  const visited = seenIds(`${current.flow}/${current.node}`);
  const distances = emptyDistances();

  for (const visit of queue) {
    const node = graph.flows[visit.flow]?.nodes[visit.node];

    if (node === undefined) continue;

    for (const name of bundlesOfGraphNode(ctx, node, state)) {
      if (!distances.has(name)) distances.set(name, visit.distance);
    }

    expandInner(graph, node, visit, queue, visited);

    if (visit.distance >= depth) continue;

    for (const target of Object.values(graph.flows[visit.flow]?.edges[visit.node] ?? {})) {
      follow(graph, visit, target, queue, visited);
    }
  }

  return [...distances.entries()]
    .toSorted((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([name]) => name);
}

/**
 * Tells whether the preload still has to bring a bundle: it is not there yet, or it is loading
 * while the running queue holds it. A load of the running queue belongs to the neighbourhood, so
 * the same rest node gives the same queue again.
 *
 * @param state - The plugin state.
 * @param name - Name of the bundle.
 * @returns True for an idle bundle and for one the running queue is bringing.
 */
function isStillWanted(state: State, name: string): boolean {
  const status = state.records.get(name)?.status ?? "idle";

  if (status === "idle") return true;

  return status === "loading" && state.queue?.bundles.includes(name) === true;
}

/**
 * Filters the walk's result: the `lazy` tier, a `"leave"` bundle nobody holds (it would be
 * released at the next rest), a bundle that is already there or loading outside the queue, and
 * everything behind the first bundle that would break the budget are dropped. Preload never
 * evicts.
 *
 * It writes into the scratch list of the plugin state, so a rest allocates no answer.
 *
 * @param ctx - Domain context of the plugin.
 * @param ordered - The bundle names by distance and then by name.
 * @returns The bundle names in load order: the scratch list, valid until the next call.
 */
function affordable(ctx: AssetsCtx, ordered: readonly string[]): readonly string[] {
  const wanted = ctx.state.wantedScratch;

  // Emptied by `pop`: a cut by `length` would free its store.
  while (wanted.length > 0) wanted.pop();

  const onStack = featuresOnStack(ctx);
  // In a typed cell, not a local: a fractional sum carried over a call V8 does not inline is boxed once per bundle
  // (F196, 192 B a rest for 12 bundles).
  const running = ctx.state.runningMb;

  running[0] = usedMb(ctx.state);

  for (const name of ordered) {
    const entry = ctx.state.manifest.bundles[name];

    if (entry === undefined || entry.tier === "lazy") continue;
    if (entry.release === "leave" && !isHeld(ctx, name, entry, onStack)) continue;
    if (!isStillWanted(ctx.state, name)) continue;
    if ((running[0] ?? 0) + entry.mb > ctx.config.textureBudgetMb) break;

    running[0] = (running[0] ?? 0) + entry.mb;
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
 * Tells whether a new neighbourhood is what the running queue still has to bring: its bundles
 * that are not loaded yet, in the same order.
 *
 * @param state - The plugin state.
 * @param queue - The running queue.
 * @param bundles - The neighbourhood of the node the game rests on now.
 * @returns True when the running queue already brings exactly these bundles.
 */
function isSameQueue(state: State, queue: PreloadQueue, bundles: readonly string[]): boolean {
  let at = 0;

  for (const name of queue.bundles) {
    if (state.records.get(name)?.status === "loaded") continue;
    if (bundles[at] !== name) return false;

    at += 1;
  }

  return at === bundles.length;
}

/**
 * Points the background preload at the neighbourhood of the node the game rests on. The same
 * neighbourhood keeps the running queue, so a rest node the graph comes back to often does not
 * restart its loads; another neighbourhood aborts it and starts a new one. A depth of zero and a
 * headless app do nothing.
 *
 * @param ctx - Domain context of the plugin.
 */
export function startPreload(ctx: AssetsCtx): void {
  const state = ctx.state;

  if (state.io === undefined || ctx.config.preloadDepth <= 0) return;

  // The same neighbourhood again: the running queue already brings it.
  const bundles = neighbourhood(ctx, ctx.config.preloadDepth);

  if (state.queue !== undefined && isSameQueue(state, state.queue, bundles)) return;

  // Another neighbourhood: the old queue goes, a new one starts.
  stopPreload(state);

  if (bundles.length === 0) return;

  // The answer is the scratch list the next rest fills again: the queue keeps its own copy.
  const queue: PreloadQueue = { bundles: [...bundles], controller: new AbortController() };

  state.queue = queue;
  runQueue(ctx, queue).catch(ignoreFailure);
}
