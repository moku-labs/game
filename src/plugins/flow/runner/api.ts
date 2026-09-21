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
 * @example
 * ```ts
 * const main = mainFlow(ctx, "restore");
 * ```
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
 * @example
 * ```ts
 * const graph = graphOf(ctx, modules);
 * ```
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
 * @example
 * ```ts
 * const safe = someCheckpoint(ctx, modules);
 * ```
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
 * @example
 * ```ts
 * checkBookmark(ctx, modules, bookmark);
 * ```
 */
function checkBookmark(ctx: FlowCtx, modules: Modules, bookmark: Bookmark): void {
  const entry = findNode(mainFlow(ctx, "restore"), bookmark.path)?.entry;

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
 * @example
 * ```ts
 * const bookmark = makeBookmark(ctx, modules);
 * ```
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
 * Tells whether the graph stands on a rest node. `setMode` is legal there and before `run()`.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns True while the position is empty or points at a rest node.
 * @example
 * ```ts
 * if (!resting(ctx)) throw new Error("...");
 * ```
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
 * @example
 * ```ts
 * const runner = createRunnerApi(ctx, { features, fx, gate, inbox });
 * ```
 */
export function createRunnerApi(ctx: FlowCtx, modules: Modules): RunnerApi {
  const state = ctx.state.runner;

  return {
    /**
     * Validates the graph, seals the features, loads the save and runs the one loop until
     * `onStop` aborts it. A fatal error rejects: the consumer catches it.
     *
     * @returns The promise of the running graph.
     * @throws {Error} When `run()` was already called.
     * @example
     * ```ts
     * createApp({ onStart: context => context.flow.run().catch(showFatal) });
     * ```
     */
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

    /**
     * Adds a flow the main flow does not reach by reference. Before `run()` only.
     *
     * @param flow - The flow to add.
     * @throws {Error} When the runner is already running.
     * @example
     * ```ts
     * app.flow.register(debugFlow);
     * ```
     */
    register: (flow: AnyFlow): void => {
      if (state.running !== undefined) {
        throw new Error(
          `[game] flow.register("${flow.id}") was called after flow.run().\n  Register every extra flow before the runner starts.`
        );
      }

      if (!state.flows.has(flow.id)) state.flows.set(flow.id, flow);
    },

    /**
     * Registers a callback run before every node body: `assets` preloads at `load`, `scenes`
     * switches at `scene`.
     *
     * @param stage - `"load"` or `"scene"`.
     * @param callback - Called with the node and `{ mode, signal }`, awaited.
     * @returns The unregister function.
     * @example
     * ```ts
     * const off = app.flow.onEnter("load", node => assets.preload(node.path));
     * ```
     */
    onEnter: (stage: Stage, callback: EnterCallback): (() => void) => {
      const callbacks = state.enterCallbacks[stage];

      callbacks.push(callback);

      return () => {
        const index = callbacks.indexOf(callback);

        if (index !== -1) callbacks.splice(index, 1);
      };
    },

    /**
     * Walks a route in fast mode through the running loop.
     *
     * @param route - The player's answers and substituted sub-flow results, in order.
     * @param options - Walk options.
     * @param options.from - Bookmark restored before the first step.
     * @returns The state the walk ended in.
     * @example
     * ```ts
     * await app.flow.walk([{ at: "home", intent: "play" }]);
     * ```
     */
    walk: (route: readonly RouteStep[], options?: { from?: Bookmark }): Promise<FlowState> =>
      walkRoute(ctx, modules, route, options?.from),

    /**
     * Makes a bookmark of the current rest point.
     *
     * @returns The bookmark, ready for JSON.
     * @example
     * ```ts
     * const bookmark = app.flow.bookmark();
     * ```
     */
    bookmark: (): Bookmark => makeBookmark(ctx, modules),

    /**
     * Replaces the state with the bookmark's and enters its node. A checkpoint is always
     * accepted; any other rest node only while the graph is unchanged.
     *
     * @param bookmark - The bookmark to enter.
     * @returns A promise that resolves once the graph rests at the bookmark's node.
     * @throws {Error} When the bookmark names no rest node of this graph.
     * @example
     * ```ts
     * await app.flow.restore(bookmark);
     * ```
     */
    restore: async (bookmark: Bookmark): Promise<void> => {
      checkBookmark(ctx, modules, bookmark);

      await restorePosition(ctx, modules, bookmark);
    },

    /**
     * Renders the whole graph as JSON, without running the game.
     *
     * @returns Nodes, flags, outcomes, edges, slots and who contributed.
     * @example
     * ```ts
     * const graph = app.flow.describe();
     * ```
     */
    describe: (): FlowGraph => graphOf(ctx, modules),

    /**
     * Reads where the graph stands.
     *
     * @returns Whether it runs, the path, the stack, what it waits for and the mode.
     * @example
     * ```ts
     * expect(app.flow.state().path).toBe("board/awaitIntent");
     * ```
     */
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

    /**
     * Reads the edges taken since the last checkpoint.
     *
     * @returns A copy of the journal.
     * @example
     * ```ts
     * const [last] = app.flow.history().slice(-1);
     * ```
     */
    history: (): readonly JournalEntry[] => [...state.journal],

    /**
     * Switches between live and fast mode. Legal before `run()` and while the graph rests.
     *
     * @param mode - `"live"` or `"fast"`.
     * @throws {Error} When a transit node is running.
     * @example
     * ```ts
     * app.flow.setMode("fast");
     * ```
     */
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
