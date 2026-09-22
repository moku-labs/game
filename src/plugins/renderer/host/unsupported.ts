/**
 * @file renderer/host — the unsupported-device screen: a plain `<div role="alert">`, no Pixi.
 * The logic of the game keeps running, exactly as it does headless.
 */
import type { RendererCtx } from "../types";
import { destroyApplication } from "./init";

/**
 * Shows the honest screen: no WebGPU and no WebGL. The renderer reports `ready() === false` and
 * `kind() === "none"` from here on, so every caller above takes its own fallback path.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param mount - Where the message goes.
 * @param error - What Pixi or the loader threw.
 */
export function showUnsupported(ctx: RendererCtx, mount: HTMLElement, error: unknown): void {
  const state = ctx.state.host;

  state.ready = false;
  state.kind = "none";
  destroyApplication(state);

  if (state.unsupported === undefined && typeof globalThis.document !== "undefined") {
    const element = globalThis.document.createElement("div");

    element.setAttribute("role", "alert");
    element.textContent = ctx.config.unsupportedMessage;
    mount.append(element);
    state.unsupported = element;
  }

  ctx.log.error("renderer: no WebGPU and no WebGL", { error });
}
