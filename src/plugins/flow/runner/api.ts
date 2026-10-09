/**
 * @file flow/runner — API factory. `run` owns the one loop; everything else inspects it or enters
 * a position through it.
 */
import type { Json } from "../../model/types";
import type { FlowCtx } from "../types";
import { acceptBookmark } from "./bookmark";
import { graphOf } from "./graph";
import { restorePosition, runLoop } from "./loop";
import { framePath, graphHash } from "./registry";
import type {
  Bookmark,
  EnterCallback,
  FlowGraph,
  FlowState,
  Frame,
  JournalEntry,
  Modules,
  RouteStep,
  RunnerApi,
  Stage
} from "./types";
import { readState } from "./view";
import { reachGateOrRest, walkRoute } from "./walk";

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

/**
 * Tells whether a frame points at a rest node.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param frame - One level of a position.
 * @returns True when the entry of that frame is a node with `rest`.
 */
function restsAt(ctx: FlowCtx, frame: Frame): boolean {
  const entry = ctx.state.runner.flows.get(frame.flow)?.nodes[frame.node];

  return entry !== undefined && entry.kind === "node" && entry.rest;
}

/**
 * Tells whether the graph stands on a rest node. `setMode` is legal there and before `run()`.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns True while the position is empty or points at a rest node.
 */
function resting(ctx: FlowCtx): boolean {
  const frame = ctx.state.runner.stack.at(-1);

  return frame === undefined || restsAt(ctx, frame);
}

/**
 * Tells whether a transit node waits at the gate: an effect that takes answers is open inside
 * it. A rest node with its own gate open rests, so it does not count.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns True while the gate is open and the position is no rest node.
 */
function waitsInTransit(ctx: FlowCtx): boolean {
  return ctx.state.gate.open !== undefined && !resting(ctx);
}

/**
 * Reads the rest point before the transit node the graph stands in. The rest frame names a
 * transit node when the graph started at one or a restore entered one: no rest point came
 * before it then.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns The last rest node and its input, or `undefined` when the rest frame names none.
 */
function restBefore(ctx: FlowCtx): Bookmark["rest"] {
  const frames = ctx.state.runner.restFrame ?? [];
  const frame = frames.at(-1);

  if (frame === undefined || !restsAt(ctx, frame)) return undefined;

  return { path: framePath(frames), input: frame.input };
}

/**
 * Makes a bookmark of where the graph stands. While a transit node waits at the gate for the
 * answer of an effect it is that node, with the rest point before it; in every other moment it is
 * the last rest point. The state is the committed one in both cases: for a waiting transit node
 * that is the state it was entered with, since its own writes are still in the open transaction.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @returns A node plus a state that really existed there.
 * @throws {Error} When the graph has no position yet.
 */
function makeBookmark(ctx: FlowCtx, modules: Modules): Bookmark {
  const state = ctx.state.runner;

  // The node to name: the transit node that waits at the gate, else the last rest point.
  const waiting = waitsInTransit(ctx);
  const frames = waiting ? state.stack : (state.restFrame ?? state.stack);

  if (frames.length === 0) {
    throw new Error(
      "[game] flow.bookmark() needs a position.\n  Call it while the graph rests at a node."
    );
  }

  // The state that existed there. A waiting node also gets the rest point before it.
  const snapshot = ctx.deps.model.store.snapshot();
  const rest = waiting ? restBefore(ctx) : undefined;

  // The bookmark: plain data, ready for JSON.
  return {
    path: framePath(frames),
    input: frames.at(-1)?.input ?? noPayload,
    player: snapshot.player,
    session: snapshot.session,
    rng: { seed: snapshot.rng.seed, streams: { ...snapshot.rng.streams } },
    graph: graphHash(graphOf(ctx, modules.features)),
    // `exactOptionalPropertyTypes`: a bookmark without a rest point has no key.
    ...(rest === undefined ? {} : { rest })
  };
}

/**
 * Sends the running loop to a bookmark that passed the check, the short way a walk needs: the
 * promise resolves as soon as the loop stands at the node, before the node ran. It stays an
 * `async` function of its own: the microtask turn it adds lets the loop start the stages of a
 * rest node before the walk goes on and switches to fast mode.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param bookmark - The accepted bookmark.
 * @returns A promise that resolves once the loop entered the node.
 */
async function enterAccepted(ctx: FlowCtx, modules: Modules, bookmark: Bookmark): Promise<void> {
  // Not a plain `return`: this await is the turn in which the loop starts a rest node's stages.
  await restorePosition(ctx, modules, bookmark);
}

/**
 * Walks a route from a bookmark. The bookmark passes the check `restore` runs, so both ways into
 * a position refuse the same bookmarks and take the same fallback. The walk is told which kind of
 * node it enters: a rest node is entered before the switch to fast mode, a transit node after it.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param route - The player's answers and substituted results, in order.
 * @param from - The bookmark to enter first.
 * @returns The state the walk ended in.
 * @throws {Error} When the bookmark may not be entered, and when a step's `at` is never reached.
 */
async function walkFrom(
  ctx: FlowCtx,
  modules: Modules,
  route: readonly RouteStep[],
  from: Bookmark
): Promise<FlowState> {
  const accepted = acceptBookmark(ctx, modules, from);

  return walkRoute(ctx, modules, route, {
    /**
     * Enters the accepted bookmark. The walk never waits for a gate here: it answers the gates
     * of its own route.
     *
     * @param bookmark - The bookmark to enter.
     * @returns A promise that resolves once the loop entered its node.
     */
    restore: (bookmark: Bookmark): Promise<void> => enterAccepted(ctx, modules, bookmark),
    from: accepted.bookmark,
    transit: !accepted.rest
  });
}

/**
 * Restores a bookmark, the way the plugin's `restore` does. A rest node is entered as `walk`
 * enters it. A transit node shows nothing until it ran up to its gate, so for one the promise
 * waits on: for the gate the node opens, or the rest point or the end of the loop it reaches
 * without one. The wait starts only after the loop entered the node, so a gate the aborted old
 * node still opened is not taken for the new one.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param bookmark - The bookmark to enter.
 * @returns A promise that resolves once a rest node is entered, or a transit node waits.
 * @throws {Error} When the bookmark may not be entered, and before `run()`.
 */
async function restoreBookmark(ctx: FlowCtx, modules: Modules, bookmark: Bookmark): Promise<void> {
  const accepted = acceptBookmark(ctx, modules, bookmark);

  await restorePosition(ctx, modules, accepted.bookmark);

  if (!accepted.rest) await reachGateOrRest(ctx);
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

      // Before `run()` the walk refuses by itself, whatever the bookmark is.
      if (from === undefined || state.running === undefined) return walkRoute(ctx, modules, route);

      return walkFrom(ctx, modules, route, from);
    },

    bookmark: (): Bookmark => makeBookmark(ctx, modules),

    restore: (bookmark: Bookmark): Promise<void> => restoreBookmark(ctx, modules, bookmark),

    describe: (): FlowGraph => graphOf(ctx, modules.features),

    state: (): FlowState => readState(ctx),

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
