/**
 * @file renderer/host — the hidden tab. One pause reason, pushed and popped; `flow` hears
 * `lifecycle:changed` and flushes the save. The renderer does nothing else.
 */
import type { RendererCtx } from "../types";

/**
 * Listens to `visibilitychange` and mirrors it onto the pause stack.
 *
 * @param ctx - Domain context of the renderer plugin.
 */
export function watchVisibility(ctx: RendererCtx): void {
  if (typeof globalThis.document === "undefined") return;

  const target = globalThis.document;
  const listener = (): void => {
    if (target.hidden) ctx.deps.lifecycle.push("background");
    else ctx.deps.lifecycle.pop("background");
  };

  target.addEventListener("visibilitychange", listener);
  ctx.state.host.cleanups.push(() => target.removeEventListener("visibilitychange", listener));
}
