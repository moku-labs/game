/**
 * @file flow/runner — the fast walk. It never starts a second loop: it watches the one loop
 * `run()` owns, answers its gate at each rest point of the route and substitutes the results of
 * the sub-flows the route skips.
 */
import type { Json } from "../../model/types";
import type { Answer } from "../gate/types";
import type { FlowCtx } from "../types";
import { loopSeam } from "./loop";
import { framePath } from "./registry";
import type { Bookmark, FlowState, LoopSeam, Modules, RouteStep } from "./types";
import { readState } from "./view";

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

/**
 * Where a walk starts from: the bookmark and the checked restore that enters it. They come
 * together, so a walk can never enter a bookmark the plugin's `restore` would refuse.
 */
type WalkStart = { restore: (bookmark: Bookmark) => Promise<void>; from: Bookmark };

/** A step of the route that answers a rest node through the gate. */
type IntentStep = Extract<RouteStep, { intent: string }>;

/** A step of the route that substitutes the result of a sub-flow node. */
type ResultStep = Extract<RouteStep, { result: unknown }>;

/** What the walk watches while the loop moves between rest points. */
type RestWatch = { next(): Promise<void>; off(): void };

/** Whether the one loop is still running, and the promise of its end. */
type EndWatch = { done: boolean; settled: Promise<void> };

/**
 * Tells an intent step from a substituted sub-flow result.
 *
 * @param step - One step of the route.
 * @returns True when the step carries a result instead of an intent.
 * @example
 * ```ts
 * substitutes({ at: "board", result: { outcome: "left" } }); // true
 * substitutes({ at: "home", intent: "play" }); // false
 * ```
 */
function substitutes(step: RouteStep): step is ResultStep {
  return "result" in step;
}

/**
 * Registers the result of a sub-flow the walk skips. The loop takes it once, without entering the
 * sub-flow, so nothing inside it changes the state.
 *
 * @param seam - The seam of the running loop.
 * @param step - The step naming the sub-flow node and its result.
 */
function armResult(seam: LoopSeam, step: ResultStep): void {
  seam.substitutions.set(step.at, {
    outcome: step.result.outcome,
    payload: step.result.payload ?? noPayload
  });
}

/**
 * Watches the rest points of the loop. `next()` resolves at the next rest point, and at once when
 * one was reached since the last call, so a rest point can never slip between two steps.
 *
 * @param seam - The seam of the running loop.
 * @returns The watch and the way to stop it.
 */
function watchRest(seam: LoopSeam): RestWatch {
  const watch: { seen: boolean; wake: (() => void) | undefined } = {
    seen: false,
    wake: undefined
  };
  /**
   * Records a rest point and wakes a waiting step.
   */
  const listener = (): void => {
    const wake = watch.wake;

    watch.seen = true;
    watch.wake = undefined;
    wake?.();
  };

  seam.rest.push(listener);

  return {
    /**
     * Waits for the next rest point, or returns at once when one was reached meanwhile.
     *
     * @returns A promise that resolves at a rest point of the loop.
     */
    next: (): Promise<void> => {
      if (watch.seen) {
        watch.seen = false;
        return Promise.resolve();
      }

      return new Promise<void>(resolve => {
        watch.wake = resolve;
      });
    },

    /**
     * Stops watching. The walk always stops, also when a step rejected.
     */
    off: (): void => {
      const index = seam.rest.indexOf(listener);

      if (index !== -1) seam.rest.splice(index, 1);
    }
  };
}

/**
 * Watches the end of the loop, so a walk waiting for a rest point that never comes rejects
 * instead of hanging. A rejected `run()` ends the walk the same way; the consumer of `run()` sees
 * the error itself.
 *
 * @param running - The promise of `run()`.
 * @returns A flag that flips when the loop ends, and the promise of that moment.
 * @example
 * ```ts
 * watchEnd(Promise.resolve()).done; // false now, true once the promise has settled
 * ```
 */
function watchEnd(running: Promise<void>): EndWatch {
  const end: EndWatch = {
    done: false,
    settled: Promise.resolve()
  };
  /**
   * Marks the loop as ended.
   */
  const finish = (): void => {
    end.done = true;
  };

  end.settled = running.then(finish, finish);

  return end;
}

/**
 * Waits for the next gate the loop opens. The listener takes itself off when it fires, so a walk
 * that ended meanwhile leaves nothing behind.
 *
 * @param seam - The seam of the running loop.
 * @returns A promise that resolves when the loop opens a gate.
 */
function nextGateOpen(seam: LoopSeam): Promise<void> {
  return new Promise<void>(resolve => {
    /**
     * Wakes the walk once the loop opened the gate.
     */
    const listener = (): void => {
      const index = seam.gateOpen.indexOf(listener);

      if (index !== -1) seam.gateOpen.splice(index, 1);

      resolve();
    };

    seam.gateOpen.push(listener);
  });
}

/**
 * Waits until the loop opens its gate. Between the edge it commits and the gate of the rest node
 * it enters the loop may need a macrotask — an awaited preload, an effect handler — so the walk
 * sleeps on the loop's own notification instead of counting ticks.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param seam - The seam of the running loop.
 * @param ended - The watch on the end of the loop.
 */
async function reachGate(ctx: FlowCtx, seam: LoopSeam, ended: EndWatch): Promise<void> {
  if (ctx.state.gate.open !== undefined) return;
  if (ended.done) return;

  await Promise.race([nextGateOpen(seam), ended.settled]);
}

/**
 * The error of a step the loop never reached, naming where it stands instead.
 *
 * @param at - Path the step waited for.
 * @param path - Path the loop rests at.
 * @returns The error `walk` rejects with.
 * @example
 * ```ts
 * notReached("board/awaitIntent", "home").message;
 * // starts with: [game] flow.walk() never reached "board/awaitIntent".
 * ```
 */
function notReached(at: string, path: string): Error {
  return new Error(
    `[game] flow.walk() never reached "${at}".\n  The graph rests at "${path}": add the steps that lead there to the route.`
  );
}

/**
 * Builds the answer of an intent step. The payload stays absent when the step carries none.
 *
 * @param step - The step to answer with.
 * @returns The answer for the gate.
 * @example
 * ```ts
 * answerOf({ at: "home", intent: "play" }); // { intent: "play" }
 * ```
 */
function answerOf(step: IntentStep): Answer {
  if (step.payload === undefined) return { intent: step.intent };

  return { intent: step.intent, payload: step.payload };
}

/**
 * Answers the open gate of one step. The loop must rest exactly where the step says, and the node
 * must take the intent.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param step - The step to answer with.
 * @param allowed - The intents the open gate takes.
 * @throws {Error} When the loop rests elsewhere, or the node refuses the intent.
 */
function answerHere(
  ctx: FlowCtx,
  modules: Modules,
  step: IntentStep,
  allowed: readonly string[]
): void {
  const path = framePath(ctx.state.runner.stack);

  if (path !== step.at) throw notReached(step.at, path);
  if (modules.gate.answer(answerOf(step))) return;

  const intents = allowed.join(", ");

  throw new Error(
    `[game] flow.walk() could not answer "${step.intent}" at "${step.at}".\n  The node takes: ${intents}.`
  );
}

/**
 * Plays one intent step: waits until the loop rests with an open gate and answers it. The wait
 * ends without a timer — every turn of it is a rest point of the loop or the end of the loop.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param seam - The seam of the running loop.
 * @param step - The step to answer with.
 * @param watch - The watch on the rest points of the loop.
 * @param ended - The watch on the end of the loop.
 * @throws {Error} When the loop ends or rests elsewhere before the step is reached.
 */
async function playStep(
  ctx: FlowCtx,
  modules: Modules,
  seam: LoopSeam,
  step: IntentStep,
  watch: RestWatch,
  ended: EndWatch
): Promise<void> {
  while (!ended.done) {
    await reachGate(ctx, seam, ended);

    const open = ctx.state.gate.open;

    if (open !== undefined) {
      answerHere(ctx, modules, step, open.allowed);
      return;
    }

    await Promise.race([watch.next(), ended.settled]);
  }

  throw notReached(step.at, framePath(ctx.state.runner.stack));
}

/**
 * Waits for the loop to come to rest after the last step, so the walk resolves with the position
 * the route leads to and not with the one it answered last. The wait ends at the gate the loop
 * opens there, or at the end of the loop.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param seam - The seam of the running loop.
 * @param ended - The watch on the end of the loop.
 * @returns A promise that resolves at the gate of the rest point, or at the end of the loop.
 */
function settleAfterRoute(ctx: FlowCtx, seam: LoopSeam, ended: EndWatch): Promise<void> {
  return reachGate(ctx, seam, ended);
}

/**
 * Plays the whole route: a substituted result is armed as soon as its step comes up, an intent is
 * answered at the rest point it names.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param route - The player's answers and substituted results, in order.
 * @param running - The promise of `run()`.
 * @throws {Error} When a step is never reached.
 */
async function playRoute(
  ctx: FlowCtx,
  modules: Modules,
  route: readonly RouteStep[],
  running: Promise<void>
): Promise<void> {
  const seam = loopSeam(ctx.state.runner);
  const watch = watchRest(seam);
  const ended = watchEnd(running);

  try {
    for (const step of route) {
      if (substitutes(step)) {
        armResult(seam, step);
        continue;
      }

      await playStep(ctx, modules, seam, step, watch, ended);
    }

    await settleAfterRoute(ctx, seam, ended);
  } finally {
    watch.off();
  }
}

/**
 * Walks a route through the running loop: restores `from` when given, switches to fast mode,
 * waits until the loop rests at each step's `at` and answers through the gate, and substitutes
 * the result of every sub-flow node the route skips. The mode of the caller is put back
 * afterwards, also when a step rejects, and a substitution the route never reached is disarmed:
 * it must not skip a sub-flow in the live play that follows.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs: features, fx, gate, inbox.
 * @param route - The player's answers and substituted results, in order.
 * @param start - Bookmark to enter first and the checked restore that enters it.
 * @returns The state the walk ended in.
 * @throws {Error} Before `run()` was called, when the bookmark is refused, and when a step's `at`
 *   is never reached.
 */
export async function walkRoute(
  ctx: FlowCtx,
  modules: Modules,
  route: readonly RouteStep[],
  start?: WalkStart
): Promise<FlowState> {
  const running = ctx.state.runner.running;

  if (running === undefined) {
    throw new Error(
      "[game] flow.walk() needs a running graph.\n  Call flow.run() from the createApp onStart callback first."
    );
  }

  if (start !== undefined) await start.restore(start.from);

  const previous = ctx.state.fx.mode;

  modules.fx.setMode("fast");

  try {
    await playRoute(ctx, modules, route, running);
  } finally {
    loopSeam(ctx.state.runner).substitutions.clear();
    modules.fx.setMode(previous);
  }

  return readState(ctx);
}
