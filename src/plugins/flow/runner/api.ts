/**
 * @file flow/runner — API factory. `run` owns the one loop; everything else inspects it or enters
 * a position through it.
 */
import type { Json } from "../../model/types";
import type { FlowCtx } from "../types";
import { collectGraph, restorePosition, runLoop } from "./loop";
import { describeGraph, findNode, framePath, graphHash } from "./registry";
import type {
  AnyFlow,
  Bookmark,
  EnterCallback,
  FlowGraph,
  FlowState,
  JournalEntry,
  Modules,
  RouteStep,
  RunnerApi,
  Stage
} from "./types";
import { walkRoute } from "./walk";

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

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
 * Renders the whole graph as JSON. It reads the flows as data, so it works before `run()`.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @returns The graph.
 */
function graphOf(ctx: FlowCtx, modules: Modules): FlowGraph {
  return describeGraph(collectGraph(ctx, modules.features), modules.features);
}

/**
 * Names a checkpoint of the graph, for the message of a refused bookmark.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @returns The path of the first checkpoint, or the start of the main flow.
 */
function someCheckpoint(ctx: FlowCtx, modules: Modules): string {
  const main = mainFlow(ctx, "restore");

  for (const flow of collectGraph(ctx, modules.features).values()) {
    for (const [name, entry] of Object.entries(flow.nodes)) {
      if (entry.kind === "node" && entry.checkpoint) {
        return flow.id === main.id ? name : `${flow.id}/${name}`;
      }
    }
  }

  return main.start;
}

/**
 * Checks that a bookmark may be entered: a checkpoint always, any other rest node only while the
 * graph is the one the bookmark was made for.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param bookmark - The bookmark to enter.
 * @throws {Error} When the path is no rest node, or the graph changed since the bookmark.
 */
function checkBookmark(ctx: FlowCtx, modules: Modules, bookmark: Bookmark): void {
  const entry = findNode(
    mainFlow(ctx, "restore"),
    bookmark.path,
    modules.features.contributions
  )?.entry;

  if (entry === undefined || entry.kind !== "node" || !entry.rest) {
    throw new Error(
      `[game] The bookmark "${bookmark.path}" is not a rest node of the graph.\n  Restore a rest node, for example the checkpoint "${someCheckpoint(ctx, modules)}".`
    );
  }

  if (entry.checkpoint) return;
  if (graphHash(graphOf(ctx, modules)) === bookmark.graph) return;

  throw new Error(
    `[game] The bookmark "${bookmark.path}" was made for another graph.\n  Restore the checkpoint "${someCheckpoint(ctx, modules)}" instead.`
  );
}

/**
 * Makes a bookmark of the rest point the graph stands on.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @returns A rest node plus a state that really existed there.
 * @throws {Error} When the graph has no position yet.
 */
function makeBookmark(ctx: FlowCtx, modules: Modules): Bookmark {
  const state = ctx.state.runner;
  const frames = state.restFrame ?? state.stack;

  if (frames.length === 0) {
    throw new Error(
      "[game] flow.bookmark() needs a position.\n  Call it while the graph rests at a node."
    );
  }

  const snapshot = ctx.deps.model.store.snapshot();

  return {
    path: framePath(frames),
    input: frames.at(-1)?.input ?? noPayload,
    player: snapshot.player,
    session: snapshot.session,
    rng: { seed: snapshot.rng.seed, streams: { ...snapshot.rng.streams } },
    graph: graphHash(graphOf(ctx, modules))
  };
}

/**
 * Enters a bookmark the way the plugin's `restore` does: the bookmark is checked first, then the
 * running loop is sent to its node. `walk({ from })` enters through here as well, so both ways
 * into a position refuse the same bookmarks.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param bookmark - The bookmark to enter.
 * @returns A promise that resolves once the loop rests at the bookmark's node.
 * @throws {Error} When the bookmark names no rest node of this graph.
 */
async function enterBookmark(ctx: FlowCtx, modules: Modules, bookmark: Bookmark): Promise<void> {
  checkBookmark(ctx, modules, bookmark);

  await restorePosition(ctx, modules, bookmark);
}

/**
 * Tells whether the graph stands on a rest node. `setMode` is legal there and before `run()`.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns True while the position is empty or points at a rest node.
 */
function resting(ctx: FlowCtx): boolean {
  const frame = ctx.state.runner.stack.at(-1);

  if (frame === undefined) return true;

  const entry = ctx.state.runner.flows.get(frame.flow)?.nodes[frame.node];

  return entry !== undefined && entry.kind === "node" && entry.rest;
}

/**
 * Creates the runner API: `run` owns the one loop, `walk` and `restore` enter a position through
 * it, `describe`, `state` and `history` inspect it. Its methods are spread onto the plugin root.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs: features, fx, gate, inbox.
 * @returns The runner API.
 */
export function createRunnerApi(ctx: FlowCtx, modules: Modules): RunnerApi {
  const state = ctx.state.runner;

  return {
    run: (): Promise<void> => {
      if (state.running !== undefined) {
        throw new Error(
          "[game] flow.run() was already called.\n  Call it once from the createApp onStart callback."
        );
      }

      const running = runLoop(ctx, modules);

      state.running = running;

      return running;
    },

    onEnter: (stage: Stage, callback: EnterCallback): (() => void) => {
      const callbacks = state.enterCallbacks[stage];

      callbacks.push(callback);

      return () => {
        const index = callbacks.indexOf(callback);

        if (index !== -1) callbacks.splice(index, 1);
      };
    },

    walk: (route: readonly RouteStep[], options?: { from?: Bookmark }): Promise<FlowState> => {
      const from = options?.from;

      if (from === undefined) return walkRoute(ctx, modules, route);

      return walkRoute(ctx, modules, route, {
        /**
         * Enters the bookmark the walk starts from, checked the way `restore` checks it.
         *
         * @param bookmark - The bookmark to enter.
         * @returns A promise that resolves once the loop rests at its node.
         */
        restore: (bookmark: Bookmark): Promise<void> => enterBookmark(ctx, modules, bookmark),
        from
      });
    },

    bookmark: (): Bookmark => makeBookmark(ctx, modules),

    restore: (bookmark: Bookmark): Promise<void> => enterBookmark(ctx, modules, bookmark),

    describe: (): FlowGraph => graphOf(ctx, modules),

    state: (): FlowState => {
      const open = ctx.state.gate.open;

      return {
        running: state.running !== undefined,
        path: framePath(state.stack),
        stack: [...state.stack],
        pending: open === undefined ? {} : { gate: [...open.allowed] },
        mode: ctx.state.fx.mode
      };
    },

    history: (): readonly JournalEntry[] => [...state.journal],

    setMode: (mode: "live" | "fast"): void => {
      if (state.running !== undefined && !resting(ctx)) {
        throw new Error(
          "[game] flow.setMode() was called while a transit node runs.\n  Call it before run() or while the graph rests."
        );
      }

      modules.fx.setMode(mode);
    }
  };
}

export { stopRunner } from "./loop";
