/**
 * @file flow/runner — the fast walk. It never starts a second loop: it watches the one loop
 * `run()` owns, answers its gate at each rest point of the route and substitutes the results of
 * the sub-flows the route skips.
 */
import type { Json } from "../../model/types";
import type { Answer } from "../gate/types";
import type { FlowCtx } from "../types";
import { loopSeam, restorePosition } from "./loop";
import { framePath } from "./registry";
import type { Bookmark, FlowState, LoopSeam, Modules, RouteStep } from "./types";

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

/**
 * How many microtasks the walk yields to the loop while it travels from a committed edge to the
 * gate of the rest node it entered. That stretch is a fixed chain of awaited promises, so a
 * generous budget costs nothing: the wait ends the moment the gate is open.
 */
const gateTicks = 64;

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
 * if (substitutes(step)) armResult(seam, step);
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
 * @example
 * ```ts
 * armResult(seam, { at: "level", result: { outcome: "win", payload: { stars: 3 } } });
 * ```
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
 * @example
 * ```ts
 * const watch = watchRest(loopSeam(ctx.state.runner));
 * ```
 */
function watchRest(seam: LoopSeam): RestWatch {
  const watch: { seen: boolean; wake: (() => void) | undefined } = {
    seen: false,
    wake: undefined
  };
  /**
   * Records a rest point and wakes a waiting step.
   *
   * @example
   * ```ts
   * listener("home");
   * ```
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
     * @example
     * ```ts
     * await watch.next();
     * ```
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
     *
     * @example
     * ```ts
     * watch.off();
     * ```
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
 * const ended = watchEnd(ctx.state.runner.running);
 * ```
 */
function watchEnd(running: Promise<void>): EndWatch {
  const end: EndWatch = {
    done: false,
    settled: Promise.resolve()
  };
  /**
   * Marks the loop as ended.
   *
   * @example
   * ```ts
   * finish();
   * ```
   */
  const finish = (): void => {
    end.done = true;
  };

  end.settled = running.then(finish, finish);

  return end;
}

/**
 * Yields to the loop until its gate is open. The loop needs a handful of microtasks between the
 * edge it commits and the gate of the rest node it enters; this hands them over without a timer.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param ended - The watch on the end of the loop.
 * @example
 * ```ts
 * await reachGate(ctx, ended);
 * ```
 */
async function reachGate(ctx: FlowCtx, ended: EndWatch): Promise<void> {
  for (let tick = 0; tick < gateTicks; tick += 1) {
    if (ctx.state.gate.open !== undefined) return;
    if (ended.done) return;

    await Promise.resolve();
  }
}

/**
 * The error of a step the loop never reached, naming where it stands instead.
 *
 * @param at - Path the step waited for.
 * @param path - Path the loop rests at.
 * @returns The error `walk` rejects with.
 * @example
 * ```ts
 * throw notReached("board/awaitIntent", "home");
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
 * const answer = answerOf({ at: "home", intent: "play" });
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
 * @example
 * ```ts
 * answerHere(ctx, modules, step, ["play"]);
 * ```
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
 * @param step - The step to answer with.
 * @param watch - The watch on the rest points of the loop.
 * @param ended - The watch on the end of the loop.
 * @throws {Error} When the loop ends or rests elsewhere before the step is reached.
 * @example
 * ```ts
 * await playStep(ctx, modules, { at: "home", intent: "play" }, watch, ended);
 * ```
 */
async function playStep(
  ctx: FlowCtx,
  modules: Modules,
  step: IntentStep,
  watch: RestWatch,
  ended: EndWatch
): Promise<void> {
  while (!ended.done) {
    await reachGate(ctx, ended);

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
 * the route leads to and not with the one it answered last. A loop that is still travelling gets
 * one more rest point, or its end.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param watch - The watch on the rest points of the loop.
 * @param ended - The watch on the end of the loop.
 * @example
 * ```ts
 * await settleAfterRoute(ctx, watch, ended);
 * ```
 */
async function settleAfterRoute(ctx: FlowCtx, watch: RestWatch, ended: EndWatch): Promise<void> {
  await reachGate(ctx, ended);

  if (ctx.state.gate.open !== undefined) return;
  if (ended.done) return;

  await Promise.race([watch.next(), ended.settled]);
  await reachGate(ctx, ended);
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
 * @example
 * ```ts
 * await playRoute(ctx, modules, route, running);
 * ```
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

      await playStep(ctx, modules, step, watch, ended);
    }

    await settleAfterRoute(ctx, watch, ended);
  } finally {
    watch.off();
  }
}

/**
 * Reads where the graph stands, the way `flow.state()` does.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns Whether it runs, the path, the stack, what it waits for and the mode.
 * @example
 * ```ts
 * return walkState(ctx);
 * ```
 */
function walkState(ctx: FlowCtx): FlowState {
  const state = ctx.state.runner;
  const open = ctx.state.gate.open;

  return {
    running: state.running !== undefined,
    path: framePath(state.stack),
    stack: [...state.stack],
    pending: open === undefined ? {} : { gate: [...open.allowed] },
    mode: ctx.state.fx.mode
  };
}

/**
 * Walks a route through the running loop: restores `from` when given, switches to fast mode,
 * waits until the loop rests at each step's `at` and answers through the gate, and substitutes
 * the result of every sub-flow node the route skips. The mode of the caller is put back
 * afterwards, also when a step rejects.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs: features, fx, gate, inbox.
 * @param route - The player's answers and substituted results, in order.
 * @param from - Bookmark restored before the first step.
 * @returns The state the walk ended in.
 * @throws {Error} Before `run()` was called, and when a step's `at` is never reached.
 * @example
 * ```ts
 * const state = await walkRoute(ctx, modules, [{ at: "home", intent: "play" }]);
 * ```
 */
export async function walkRoute(
  ctx: FlowCtx,
  modules: Modules,
  route: readonly RouteStep[],
  from?: Bookmark
): Promise<FlowState> {
  const running = ctx.state.runner.running;

  if (running === undefined) {
    throw new Error(
      "[game] flow.walk() needs a running graph.\n  Call flow.run() from the createApp onStart callback first."
    );
  }

  if (from !== undefined) await restorePosition(ctx, modules, from);

  const previous = ctx.state.fx.mode;

  modules.fx.setMode("fast");

  try {
    await playRoute(ctx, modules, route, running);
  } finally {
    modules.fx.setMode(previous);
  }

  return walkState(ctx);
}
