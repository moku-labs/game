/**
 * @file renderer/host — device loss and restore. WebGPU hands out a `device.lost` promise and
 * needs a new application; WebGL raises two canvas events and Pixi restores itself.
 */
import type { EmitDeviceLost, RendererCtx } from "../types";

/**
 * Starts a loss: the renderer stops drawing, the game pauses and the event goes out. A loss
 * while the plugin is already down, or while a restore runs, is ignored.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param kind - Which backend lost its device.
 * @param reason - What the browser said.
 * @returns True when this call really started the loss.
 */
function beginLoss(ctx: RendererCtx, kind: "webgpu" | "webgl", reason: string): boolean {
  const state = ctx.state.host;

  if (!state.ready || state.restoring) return false;

  state.ready = false;
  state.restoring = true;
  ctx.deps.lifecycle.push("device-lost");

  // The one narrowing of the plugin: see the note on `KernelSlice`. Only `emit` is cast.
  const emit = ctx.emit as EmitDeviceLost;

  emit("renderer:device-lost", { kind, reason });

  return true;
}

/**
 * Ends a restore: the renderer draws again and the pause reason goes. After a WebGPU restore the
 * whole display tree is new, so the `onRestore` callbacks rebuild it first.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param rebuild - True when a new application replaced the old one.
 */
export function finishRestore(ctx: RendererCtx, rebuild: boolean): void {
  const state = ctx.state.host;

  if (!state.restoring) return;

  state.ready = true;
  state.restoring = false;

  if (rebuild) for (const fn of state.onRestore) fn();

  ctx.deps.lifecycle.pop("device-lost");
}

/**
 * Watches the device of the current application. Called again after every restore, because a
 * new application carries a new device and a new canvas.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param restart - Destroys the application and builds a new one; false when that failed.
 */
export function watchDevice(ctx: RendererCtx, restart: () => Promise<boolean>): void {
  const state = ctx.state.host;
  const app = state.app;

  if (app === undefined) return;

  if ("gpu" in app.renderer) {
    const onLost = async (info: { reason: string }): Promise<void> => {
      if (ctx.state.host.app !== app) return;
      if (!beginLoss(ctx, "webgpu", info.reason)) return;
      if (await restart()) finishRestore(ctx, true);
    };

    app.renderer.gpu.device.lost
      .then(onLost)
      .catch((error: unknown) => ctx.log.error("renderer: restore failed", { error }));

    return;
  }

  const canvas = state.canvas;

  if (canvas === undefined) return;

  const onContextLost = (event: Event): void => {
    event.preventDefault();
    beginLoss(ctx, "webgl", "webglcontextlost");
  };
  const onContextRestored = (): void => finishRestore(ctx, false);

  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  state.cleanups.push(() => {
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
  });
}
