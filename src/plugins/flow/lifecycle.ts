/**
 * @file flow plugin — lifecycle functions: dependency resolution, the `onInit` wiring and the
 * teardown registration.
 */
import { teardown } from "../../teardown";
import { clockPlugin } from "../clock";
import { modelPlugin } from "../model";
import type { Json } from "../model/types";
import { timePlugin } from "../time";
import { createFxApi } from "./fx/api";
import type { Descriptor, FxApi, Hint } from "./fx/types";
import { createGateApi } from "./gate/api";
import { createInboxApi } from "./inbox/api";
import { stopRunner } from "./runner/loop";
import type { Deps, FlowCtx, KernelSlice } from "./types";

/**
 * Resolves the dependency APIs `time`, `model` and `clock` with `ctx.require`. The kernel builds
 * the plugin APIs in registration order and `flow` is registered last, so the three are ready
 * whenever a callback of `flow` runs — except in `hooks`, which the kernel calls before any API
 * exists; the hook resolves them when it fires.
 *
 * @param ctx - Kernel context of the flow plugin.
 * @returns The three dependency APIs.
 * @example
 * ```ts
 * const { time, model, clock } = resolveDeps(ctx);
 * ```
 */
export function resolveDeps(ctx: KernelSlice): Deps {
  return {
    time: ctx.require(timePlugin),
    model: ctx.require(modelPlugin),
    clock: ctx.require(clockPlugin)
  };
}

/**
 * Builds the domain context the modules share: the kernel context plus the resolved dependencies.
 *
 * @param ctx - Kernel context of the flow plugin.
 * @returns The domain context of the flow plugin.
 * @example
 * ```ts
 * const flowCtx = withDeps(ctx);
 * ```
 */
function withDeps(ctx: KernelSlice): FlowCtx {
  return { ...ctx, deps: resolveDeps(ctx) };
}

/**
 * Reads the `moment` of a `schedule` descriptor. An absent, non-numeric or non-object payload
 * means "nothing to schedule", which cancels the pending timer.
 *
 * @param payload - Payload of the descriptor handed to the handler.
 * @returns The epoch moment to schedule, or `undefined`.
 * @example
 * ```ts
 * clock.scheduleAt(readMoment(descriptor.payload));
 * ```
 */
function readMoment(payload: Json | undefined): number | undefined {
  if (payload === undefined || payload === null) return undefined;
  if (typeof payload !== "object" || Array.isArray(payload)) return undefined;

  const moment = payload.moment;

  return typeof moment === "number" ? moment : undefined;
}

/**
 * Registers the handler of the `schedule` effect. It is the only effect `flow` owns: logic asks
 * for the next `elapsed` with `await fx(schedule(moment))` and never touches the clock itself.
 * `runInFast` is set, so a fast walk arms the timer as the live game does.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param fx - The effects gateway built over `ctx.state`.
 * @example
 * ```ts
 * registerSchedule(flowCtx, fx);
 * ```
 */
function registerSchedule(ctx: FlowCtx, fx: FxApi): void {
  fx.handle(
    "schedule",
    (descriptor: Descriptor | Hint): void => {
      ctx.deps.clock.scheduleAt(readMoment(descriptor.payload));
    },
    { runInFast: true }
  );
}

/**
 * Connects flow to its dependencies in `onInit`: posts `elapsed` from `clock.onElapsed` into the
 * inbox, flushes effect completions and the gate hold in `time.onFrame("signals")`, and registers
 * the `schedule` handler. `onInit` has no access to the plugin's own API, so it builds its own
 * module objects — they are pure functions over `ctx.state`, which is the one place the modules
 * keep their data, so these objects and the API's objects are the same gate and the same fx.
 *
 * @param ctx - Kernel context of the flow plugin.
 * @example
 * ```ts
 * createPlugin("flow", { onInit: connectFlow });
 * ```
 */
export function connectFlow(ctx: KernelSlice): void {
  const flowCtx = withDeps(ctx);
  const gate = createGateApi(flowCtx);
  const fx = createFxApi(flowCtx, { gate });
  const inbox = createInboxApi(flowCtx);

  flowCtx.deps.clock.onElapsed(input => {
    inbox.post({ type: "elapsed", payload: input });
  });

  flowCtx.deps.time.onFrame("signals", ({ frame }) => {
    fx.flushSettled();
    gate.clearHeld(frame);
  });

  registerSchedule(flowCtx, fx);
}

/**
 * Registers the flow disposer: on stop the active node is aborted, its settle is awaited up to
 * `settleTimeoutMs` and an open transaction is discarded. It never starts the loop — an endless
 * awaited loop would never let `app.start()` resolve, so the consumer calls `flow.run()`.
 *
 * @param ctx - Kernel context of the flow plugin.
 * @example
 * ```ts
 * createPlugin("flow", { onStart: registerFlowTeardown });
 * ```
 */
export function registerFlowTeardown(ctx: KernelSlice): void {
  const flowCtx = withDeps(ctx);

  teardown.register(ctx.global, "flow", () => stopRunner(flowCtx));
}
