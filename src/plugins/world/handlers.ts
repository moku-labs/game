/**
 * @file world plugin — event handlers.
 */
import { createModules } from "./api";
import { withDeps } from "./lifecycle";
import type { KernelInput, ModelCommitted } from "./types";

/**
 * Creates the hook handlers. `model:committed` only records the cause and the roots: the reconcile
 * runs once, at the start of the next frame, against the latest snapshot, so two commits in one
 * frame give one reconcile. In fast mode there is no next frame, so the projection reconciles at
 * once, direct.
 *
 * The handler is synchronous — every engine hook is — and it builds its module objects when it
 * fires: the kernel registers hooks before it builds the plugin APIs, so nothing is resolvable
 * while this factory runs.
 *
 * @param ctx - Kernel context of the world plugin.
 * @returns The one hook of the plugin.
 */
export function createHandlers(ctx: KernelInput): {
  "model:committed": (payload: ModelCommitted) => void;
} {
  return {
    /**
     * Records a commit for the next reconcile.
     *
     * @param payload - The roots the commit touched and why it happened.
     */
    "model:committed": (payload: ModelCommitted): void => {
      // A throw reaches the framework `onError`, which logs it as "game: a hook failed".
      createModules(withDeps(ctx)).projection.markDirty(payload.roots, payload.cause);
    }
  };
}
