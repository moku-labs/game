/**
 * @file flow plugin — API factory. The one place that composes the five modules.
 */
import { createFeaturesApi } from "./features/api";
import type { FeaturesApi, FeaturesInternal } from "./features/types";
import { createFxApi } from "./fx/api";
import type { FxApi, FxInternal } from "./fx/types";
import { createGateApi } from "./gate/api";
import type { GateApi, GateInternal } from "./gate/types";
import { createInboxApi } from "./inbox/api";
import type { InboxApi, InboxInternal } from "./inbox/types";
import { resolveDeps } from "./lifecycle";
import { createRunnerApi } from "./runner/api";
import type { Modules } from "./runner/types";
import type { Api, FlowCtx, KernelSlice } from "./types";

/**
 * Builds the four sibling modules bottom-up: `features` and `gate` stand alone, `fx` needs the
 * gate for a descriptor that carries `answers`, `inbox` stands alone. Each module keeps its data
 * in `ctx.state`, so the objects are views on the plugin state, not owners of it.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns The four modules with their public and internal methods, ready for the runner.
 */
function createModules(ctx: FlowCtx): Modules {
  const features = createFeaturesApi(ctx);
  const gate = createGateApi(ctx);
  const fx = createFxApi(ctx, { gate });
  const inbox = createInboxApi(ctx);

  return { features, fx, gate, inbox };
}

/**
 * Reduces the gate to what a game may call. `open`, `close`, `narrow` and `clearHeld` belong to
 * the runner and to `fx`.
 *
 * @param gate - The full gate module.
 * @returns The public gate API.
 */
function exposeGate(gate: GateApi & GateInternal): GateApi {
  return { answer: gate.answer, pointer: gate.pointer, state: gate.state };
}

/**
 * Reduces the inbox to `post`. `take` and `onPost` belong to the runner.
 *
 * @param inbox - The full inbox module.
 * @returns The public inbox API.
 */
function exposeInbox(inbox: InboxApi & InboxInternal): InboxApi {
  return { post: inbox.post };
}

/**
 * Reduces the effects gateway to registration and fire-and-forget delivery. Awaiting, buffering
 * and the mode switch belong to the runner.
 *
 * @param fx - The full fx module.
 * @returns The public fx API.
 */
function exposeFx(fx: FxApi & FxInternal): FxApi {
  return { handle: fx.handle, dispatch: fx.dispatch };
}

/**
 * Reduces the feature registry to what a feature plugin and the plugins above need. `seal`
 * belongs to `run()`.
 *
 * @param features - The full features module.
 * @returns The public features API.
 */
function exposeFeatures(features: FeaturesApi & FeaturesInternal): FeaturesApi {
  return {
    register: features.register,
    all: features.all,
    contributions: features.contributions
  };
}

/**
 * Creates the flow API. Resolves the dependencies with `resolveDeps`, builds the domain context,
 * creates the modules bottom-up, injects them into the runner, spreads the runner's methods onto
 * the root (`app.flow.run()`) and groups the other modules (`app.flow.gate`). Only the public part
 * of each module reaches the root: the internal methods stay with the runner.
 *
 * @param ctx - Kernel context of the flow plugin.
 * @returns The plugin API.
 */
export function createFlowApi(ctx: KernelSlice): Api {
  const flowCtx: FlowCtx = { ...ctx, deps: resolveDeps(ctx) };
  const modules = createModules(flowCtx);
  const runner = createRunnerApi(flowCtx, modules);

  return {
    ...runner,
    gate: exposeGate(modules.gate),
    inbox: exposeInbox(modules.inbox),
    fx: exposeFx(modules.fx),
    features: exposeFeatures(modules.features)
  };
}
