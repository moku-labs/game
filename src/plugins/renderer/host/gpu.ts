/**
 * @file renderer/host — the engine's own WebGPU device in agent builds, requested with `timestamp-query` so the monitor
 * can time every pass, and handed to Pixi through its public `webgpu.gpu` option. With it Pixi neither installs its
 * own loss restore nor destroys the device: the engine restores by rebuilding the app and destroys its device after
 * the app. Reached only from the agent branch of `createApplication`: a production bundle carries none of it.
 */
import type { PixiApplication, RendererCtx } from "../types";
import type { OwnGpu } from "./types";

/**
 * Pixi's own feature request, which this device must keep so no texture format is lost; a test compares it with the
 * installed Pixi.
 */
export const PIXI_GPU_FEATURES = [
  "texture-compression-bc",
  "texture-compression-astc",
  "texture-compression-etc2",
  "indirect-first-instance",
  "bgra8unorm-storage",
  "texture-formats-tier1"
] as const;

/** The options `app.init` takes. */
type InitOptions = NonNullable<Parameters<PixiApplication["init"]>[0]>;

/**
 * Requests an adapter and a device with Pixi's features the adapter has, plus `timestamp-query` when it offers it, and
 * the two limits Pixi asks for. Only for the WebGPU preference on a page with `navigator.gpu`; no adapter answers
 * `undefined`, and Pixi then runs its own path (and falls back to WebGL by itself). A rejected request is logged.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @returns The adapter and the device, or `undefined`.
 */
export async function requestTimedGpu(ctx: RendererCtx): Promise<OwnGpu | undefined> {
  const gpu = typeof globalThis.navigator === "undefined" ? undefined : globalThis.navigator.gpu;

  if (ctx.config.preference !== "webgpu" || gpu === undefined) return undefined;

  try {
    const adapter = await gpu.requestAdapter();

    if (adapter === null) return undefined;

    const requiredFeatures: GPUFeatureName[] = PIXI_GPU_FEATURES.filter(feature =>
      adapter.features.has(feature)
    );

    if (adapter.features.has("timestamp-query")) requiredFeatures.push("timestamp-query");

    const device = await adapter.requestDevice({
      requiredFeatures,
      requiredLimits: {
        maxSampledTexturesPerShaderStage: adapter.limits.maxSampledTexturesPerShaderStage,
        maxSamplersPerShaderStage: adapter.limits.maxSamplersPerShaderStage
      }
    });

    return { adapter, device };
  } catch (error) {
    ctx.log.warn("renderer: no timed GPU device", { error });

    return undefined;
  }
}

/**
 * Writes a startup mark on the page's performance timeline (R10): the moments the startup line of the log reads.
 *
 * @param name - The mark.
 */
export function startupMark(name: string): void {
  globalThis.performance.mark(name);
}

/**
 * Initializes the application of an agent build: the engine's own device when it gets one, scoped to the WebGPU
 * attempt (`webgpu.gpu`, so a WebGL fallback never sees it), and the two init marks around `app.init`.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param app - The application to initialize.
 * @param options - What every build passes to `app.init`.
 * @returns Resolves when the application is up.
 */
export async function initTimed(
  ctx: RendererCtx,
  app: PixiApplication,
  options: InitOptions
): Promise<void> {
  const gpu = await requestTimedGpu(ctx);

  // Kept before init: an init that fails still leaves the device to `destroyApplication`.
  ctx.state.host.ownGpu = gpu;
  startupMark("moku:init-start");
  await app.init(gpu === undefined ? options : { ...options, webgpu: { gpu } });
  startupMark("moku:init-end");
}
