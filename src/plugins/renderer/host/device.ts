/**
 * @file renderer/host — device loss and restore. WebGPU hands out a `device.lost` promise and
 * needs a new application; WebGL raises two canvas events and Pixi restores itself.
 */
import type { RendererCtx } from "../types";
import { textureUsage } from "./readback";
import type { HostState, LossInfo } from "./types";

/**
 * The GPU device of the application that draws now. Only a WebGPU application has one; a lost
 * device, the unsupported screen and an inert plugin have none.
 *
 * @param state - The host branch of the plugin state.
 * @returns The live device, or `undefined`.
 */
export function liveDevice(state: HostState): GPUDevice | undefined {
  const app = state.app;

  if (!state.ready || state.kind !== "webgpu" || app === undefined) return undefined;

  return "gpu" in app.renderer ? app.renderer.gpu.device : undefined;
}

/**
 * The WebGL2 context of the application that draws now. Only a WebGL application has one; a lost
 * context, the unsupported screen and an inert plugin have none.
 *
 * @param state - The host branch of the plugin state.
 * @returns The live context, or `undefined`.
 */
export function liveGl(state: HostState): WebGL2RenderingContext | undefined {
  const app = state.app;

  if (!state.ready || state.kind !== "webgl" || app === undefined) return undefined;

  return "gl" in app.renderer ? app.renderer.gl : undefined;
}

/**
 * Starts a loss: the renderer stops drawing, the game pauses and the event goes out; then the `decideLoss` callbacks
 * hear it, and one that answers true marks the page as leaving (F189). A loss while the plugin is already down, or
 * while a restore runs, is ignored.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param kind - Which backend lost its device.
 * @param reason - What the browser said.
 * @returns True when this call really started the loss.
 */
function beginLoss(ctx: RendererCtx, kind: "webgpu" | "webgl", reason: string): boolean {
  const state = ctx.state.host;

  if (!state.ready || state.restoring) return false;

  // Measured while the lost application still lists its textures, for the record of the loss (F189).
  const info: LossInfo = {
    kind,
    reason,
    textureBytes: state.app === undefined ? 0 : textureUsage(state.app, state.kept).bytes
  };

  state.ready = false;
  state.restoring = true;
  ctx.deps.lifecycle.push("device-lost");

  ctx.emit("renderer:device-lost", { kind, reason });

  // A callback that answers true takes the page away (a reload): nothing is restored.
  for (const decide of state.lossDeciders) {
    if (decide(info)) state.leaving = true;
  }

  return true;
}

/**
 * Ends a restore: the renderer draws again and the pause reason goes. The `onRestore` callbacks run first: after a
 * WebGPU restore the whole display tree is new and they rebuild it; after a WebGL restore the tree stands, but the
 * canvas and every render texture came back empty, so they ask for a whole frame and the pictures again. A page that
 * leaves after the loss (F189) restores nothing: the call returns at once and the pause reason stays.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param rebuild - True when a new application replaced the old one.
 */
export function finishRestore(ctx: RendererCtx, rebuild: boolean): void {
  const state = ctx.state.host;

  if (!state.restoring || state.leaving) return;

  state.ready = true;
  state.restoring = false;

  for (const fn of state.onRestore) fn(rebuild);

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
      // The page reloads: no new application is made.
      if (ctx.state.host.leaving) return;
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
