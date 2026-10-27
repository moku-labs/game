/**
 * @file flow plugin — event handlers.
 */
import type { Events as ModelEvents } from "../model/types";
import { resolveDeps } from "./lifecycle";
import { noop } from "./runner/loop-types";
import type { KernelSlice, LifecycleChanged } from "./types";

/** Payload of `model:committed`: the roots that changed and what produced the change. */
type ModelCommitted = ModelEvents["model:committed"];

/**
 * Reacts to a change of the pause stack: a resume pokes the clock, going to background starts a
 * flush that `onStop` awaits.
 *
 * @param ctx - Kernel context of the flow plugin.
 * @param payload - What changed: the reason, the direction and whether the game resumed.
 */
function reactToLifecycle(ctx: KernelSlice, payload: LifecycleChanged): void {
  const deps = resolveDeps(ctx);

  if (payload.resumed) deps.clock.poke();
  if (payload.action !== "push") return;
  if (payload.reason !== "background") return;

  // The store already logged a failure. The flush in the `onStop` of model reports a lasting one,
  // so this promise never rejects: nothing is left unhandled and a stop still reaches model.
  ctx.state.runner.flushing = deps.model.store.flush().catch(noop);
}

/**
 * Derives the guide of the node that stands again after a commit: only while a node with a `guide`
 * waits at its open gate, and never for the commit of an edge. The loop lifts the narrow before
 * it commits the edge that leaves the node, so that commit must not show the guide again; the
 * node's abort makes the derive a no-op.
 *
 * @param ctx - Kernel context of the flow plugin.
 * @param payload - What was committed and why.
 */
function refreshGuide(ctx: KernelSlice, payload: ModelCommitted): void {
  const guide = ctx.state.runner.guide;

  if (guide === undefined || payload.cause === "edge") return;
  if (ctx.state.gate.open === undefined) return;

  guide.refresh();
}

/**
 * Creates the hook handlers. On `lifecycle:changed` with `resumed: true` the clock is poked, so
 * the time that passed in the background arrives as one `elapsed`; on a `"background"` push the
 * model flush is started and tracked in `state.runner.flushing`, which `onStop` awaits. On
 * `model:committed` the guide of the node that waits at its gate is derived again.
 *
 * The handler is synchronous — every engine hook is — and it resolves its dependencies when it
 * fires: the kernel registers hooks before it builds the plugin APIs, so nothing is resolvable
 * while this factory runs.
 *
 * @param ctx - Kernel context of the flow plugin.
 * @returns The two hooks of the plugin.
 */
export function createHandlers(ctx: KernelSlice): {
  "lifecycle:changed": (payload: LifecycleChanged) => void;
  "model:committed": (payload: ModelCommitted) => void;
} {
  return {
    /**
     * Reacts to a change of the pause stack.
     *
     * @param payload - What changed: the reason, the direction and whether the game resumed.
     */
    "lifecycle:changed": (payload: LifecycleChanged): void => {
      // A throw reaches the framework `onError`, which logs it as "game: a hook failed".
      reactToLifecycle(ctx, payload);
    },

    /**
     * Derives the guide of the node that waits at its gate again.
     *
     * @param payload - What was committed and why.
     */
    "model:committed": (payload: ModelCommitted): void => {
      refreshGuide(ctx, payload);
    }
  };
}
