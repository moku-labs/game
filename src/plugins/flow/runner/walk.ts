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
 * Where a walk starts from: the bookmark, the restore that enters it and the kind of node that is
 * entered. The runner API fills it in after its check of the bookmark, so a walk can never enter
 * a bookmark the plugin's `restore` would refuse.
 */
type WalkStart = {
  restore: (bookmark: Bookmark) => Promise<void>;
  from: Bookmark;
  /**
   * True when `restore` enters a transit node: the walk then switches to fast mode before the
   * enter. Absent for a rest node, which is entered first.
   */
  transit?: boolean;
};

/** A step of the route that answers a rest node through the gate. */
type IntentStep = Extract<RouteStep, { intent: string }>;

/** A step of the route that substitutes the result of a sub-flow node. */
type ResultStep = Extract<RouteStep, { result: unknown }>;

/** What the walk watches while the loop moves between rest points. */
type RestWatch = { next(): Promise<void>; off(): void };

/** The wait for the next gate the loop opens, and the way to give it up. */
type GateWatch = { promise: Promise<void>; off(): void };

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
 * Watches for the next gate the loop opens. The listener leaves the seam when a gate wakes it. A
 * wait that something else ended calls `off()`: the gate that would take the listener off may
 * never come.
 *
 * @param seam - The seam of the running loop.
 * @returns The promise of the next open gate, and the way to stop watching.
 */
function nextGateOpen(seam: LoopSeam): GateWatch {
  const watch: { wake: (() => void) | undefined } = { wake: undefined };
  /**
   * Takes the listener off the seam. It may be gone already.
   */
  const off = (): void => {
    const index = seam.gateOpen.indexOf(listener);

    if (index !== -1) seam.gateOpen.splice(index, 1);
  };
  /**
   * Wakes the waiting side once the loop opened a gate, and leaves.
   */
  function listener(): void {
    off();
    watch.wake?.();
  }
  const promise = new Promise<void>(resolve => {
    watch.wake = resolve;
  });

  seam.gateOpen.push(listener);

  return { promise, off };
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

  const opened = nextGateOpen(seam);

  try {
    await Promise.race([opened.promise, ended.settled]);
  } finally {
    // When the loop ended first, no gate comes to take the listener off.
    opened.off();
  }
}

/**
 * Waits until a transit node the loop was sent into shows what it waits for: the gate it opens,
 * or, when it opens none, the next rest point or the end of the loop. `restore` waits here after
 * it entered a transit bookmark, so its caller reads a state with the open gate in it. There is no
 * timeout: a node that opens no gate, never rests and never ends keeps the wait pending, as its
 * body would. Call it only after the loop entered the node: a gate opened before that belongs to
 * the node the restore aborted.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns A promise that resolves at the open gate, at a rest point or at the end of the loop.
 */
export async function reachGateOrRest(ctx: FlowCtx): Promise<void> {
  const running = ctx.state.runner.running;

  if (running === undefined || ctx.state.gate.open !== undefined) return;

  const seam = loopSeam(ctx.state.runner);
  const opened = nextGateOpen(seam);
  const rested = watchRest(seam);

  try {
    await Promise.race([opened.promise, rested.next(), watchEnd(running).settled]);
  } finally {
    // One of the three won. The other two must leave nothing on the seam.
    opened.off();
    rested.off();
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
 * the result of every sub-flow node the route skips. A rest node `from` names is entered before
 * the switch: the stages of that node see the mode of the caller. A transit node is entered
 * after the switch, so it never starts live and never shows its popup. The mode of the caller
 * is put back afterwards, also when the bookmark is refused or a step rejects, and a
 * substitution the route never reached is disarmed: it must not skip a sub-flow in the live play
 * that follows.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs: features, fx, gate, inbox.
 * @param route - The player's answers and substituted results, in order.
 * @param start - Bookmark to enter first, the restore that enters it and the kind of its node.
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

  // The bookmark is entered on one side of the switch: a rest node before it, a transit node after.
  const entersBeforeSwitch = start !== undefined && !start.transit;
  const entersAfterSwitch = start !== undefined && !entersBeforeSwitch;

  if (entersBeforeSwitch) await start.restore(start.from);

  // From here on the graph runs fast, until the route is played or a step rejects.
  const previous = ctx.state.fx.mode;

  modules.fx.setMode("fast");

  try {
    if (entersAfterSwitch) await start.restore(start.from);

    await playRoute(ctx, modules, route, running);
  } finally {
    // The live play that follows gets the caller's mode back and no substitution left armed.
    loopSeam(ctx.state.runner).substitutions.clear();
    modules.fx.setMode(previous);
  }

  return readState(ctx);
}
