/**
 * @file renderer/host — the resolution the canvas draws at (contract C-d): the device pixels, the cap of
 * `maxResolution`, the render scale of the adaptive frame rate, the override of `monitor.setResolution`, and the
 * listener that follows a change of `devicePixelRatio`. Every change is asked through one mechanism and applied on the
 * resize path of the next frame, so a burst of changes costs one resize.
 */
import type { Config, RendererCtx } from "../types";
import type { HostState } from "./types";

/**
 * Why the resolution changed: the device pixels, a setting, the debug switch, the render scale of the adaptive frame
 * rate. Exported: `HostInternal` and spec 14's demand subscriber use it (11-I14).
 */
export type ResolutionReason = "dpr" | "setting" | "debug" | "rate";

/** The short side, in CSS pixels, at or under which a coarse pointer is a phone: the rule of `effects.phone`. */
const PHONE_SIDE = 820;

/**
 * Device pixels per CSS pixel of the window; 1 without a window. Moved here from `host/init.ts`.
 *
 * @returns The ratio the drawing resolution is capped against.
 */
export function devicePixels(): number {
  return typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1;
}

/**
 * The resolution to draw at: the override, else the device pixels under the cap at the render scale.
 *
 * @param state - The resolution state of the host.
 * @param state.dpr - Device pixels per CSS pixel.
 * @param state.cap - The cap of `maxResolution`.
 * @param state.override - The switch of `monitor.setResolution`, when set.
 * @param state.scale - The render scale of the adaptive frame rate.
 * @returns The target resolution.
 * @example
 * ```ts
 * targetResolution({ dpr: 2.81, cap: 2, override: undefined, scale: 0.75 }); // 1.5
 * ```
 */
export function targetResolution(state: {
  dpr: number;
  cap: number;
  override: number | undefined;
  scale: number;
}): number {
  return state.override ?? Math.min(state.dpr, state.cap) * state.scale;
}

/**
 * Tells a phone: a coarse pointer and a short side of at most 820 CSS px, the rule `effects` reads for `phone: "auto"`.
 * False without a window.
 *
 * @returns True on a phone.
 */
function isPhone(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false;

  return (
    globalThis.matchMedia("(pointer: coarse)").matches &&
    Math.min(globalThis.innerWidth, globalThis.innerHeight) <= PHONE_SIDE
  );
}

/**
 * The lowest render scale the adaptive frame rate may choose on this device: the floor of `adaptiveScale` where its
 * `devices` take this one, otherwise 1, none.
 *
 * @param config - The resolved plugin config.
 * @returns The floor; 1 allows no scale.
 */
export function scaleFloorOf(config: Readonly<Config>): number {
  const { adaptiveScale } = config;

  if (adaptiveScale === false) return 1;

  return adaptiveScale.devices === "all" || isPhone() ? adaptiveScale.floor : 1;
}

/**
 * Follows the render scale `time:rate` carries: remembers it and asks for the target with reason `"rate"`. The
 * override still wins.
 *
 * @param state - The host branch of the plugin state.
 * @param scale - The render scale the adaptive frame rate chose.
 * @returns True when a change is now pending.
 */
export function followScale(state: HostState, scale: number): boolean {
  if (scale === state.resolution.scale) return false;

  state.resolution.scale = scale;

  return askResolution(state, targetResolution(state.resolution), "rate");
}

/**
 * Lets the adaptive frame rate step the render scale down to the floor of this device, or to none while the override
 * holds, and takes the scale it answers: a scale it withdrew is 1 again.
 *
 * @param ctx - Domain context of the renderer plugin.
 */
export function allowRuleScale(ctx: RendererCtx): void {
  const { resolution } = ctx.state.host;
  const floor = resolution.override === undefined ? resolution.floor : 1;

  resolution.scale = ctx.deps.time.allowScale(floor).scale;
}

/**
 * The one mechanism: remembers a resolution for the next frame. Nothing is applied here. While no
 * application is ready nothing is remembered: the next application reads the target itself.
 *
 * @param state - The host branch of the plugin state.
 * @param value - Device pixels per CSS pixel.
 * @param reason - Why it changes.
 * @returns True when a change is now pending.
 */
export function askResolution(state: HostState, value: number, reason: ResolutionReason): boolean {
  const app = state.app;

  if (!state.ready || app === undefined) return false;
  if (value === app.renderer.resolution && state.resolution.pending === undefined) return false;

  state.resolution.pending = { value, reason };

  return true;
}

/**
 * Asks for the target resolution for a reason.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param reason - Why it changed.
 * @returns True when a change is now pending.
 */
export function refreshResolution(ctx: RendererCtx, reason: ResolutionReason): boolean {
  const state = ctx.state.host;

  return askResolution(state, targetResolution(state.resolution), reason);
}

/**
 * How far past a whole device pixel a box of whole device pixels may measure: browsers keep layout sizes in 1/64 CSS
 * px, so the A26's window of 2340 rows at 2.77 measures 844.765625 CSS px, 2340.0008 device px. One more row would
 * be resampled over the whole canvas; a twentieth of a device pixel left uncovered is never seen.
 */
const PIXEL_SLACK = 0.05;

/**
 * The CSS length to hand Pixi so its backing store covers a CSS length: Pixi rounds `length × resolution` to whole
 * device pixels, so the length is raised to the next whole device pixel first. A product a rounding error past a
 * whole pixel stays on that pixel.
 *
 * @param length - The CSS length to cover.
 * @param resolution - Device pixels per CSS pixel.
 * @returns The CSS length of the covering backing store.
 * @example
 * ```ts
 * coverLength(844.77, 2.625); // 2218 / 2.625, about 844.95
 * ```
 */
function coverLength(length: number, resolution: number): number {
  return Math.ceil(length * resolution - PIXEL_SLACK) / resolution;
}

/**
 * Resizes the renderer to a CSS-pixel size, at the pending resolution when one differs from what
 * Pixi draws at; the listeners hear the change. The pending change is gone afterwards either way.
 * The backing store is rounded up to whole device pixels and the canvas box is the size itself,
 * fractions kept, so the canvas covers its mount to the last device pixel (F116).
 *
 * @param state - The host branch of the plugin state.
 * @param width - New CSS width of the canvas.
 * @param height - New CSS height of the canvas.
 */
export function resizeAt(state: HostState, width: number, height: number): void {
  const app = state.app;

  if (!state.ready || app === undefined) return;

  const { pending } = state.resolution;
  const from = app.renderer.resolution;

  state.resolution.pending = undefined;
  app.canvas.style.width = `${width}px`;
  app.canvas.style.height = `${height}px`;

  if (pending === undefined || pending.value === from) {
    app.renderer.resize(coverLength(width, from), coverLength(height, from));

    return;
  }

  app.renderer.resize(
    coverLength(width, pending.value),
    coverLength(height, pending.value),
    pending.value
  );

  for (const fn of state.onResolutionChange) fn(from, pending.value, pending.reason);
}

/**
 * Follows `devicePixelRatio` with a `matchMedia` query of the ratio the page has now, armed once
 * and armed again for the new ratio after every change: a window moved to a screen of another
 * ratio, or a browser zoom, draws sharp from the next frame. Every build. The remover goes to
 * `state.cleanups`. No window or no `matchMedia`: nothing is armed.
 *
 * @param ctx - Domain context of the renderer plugin.
 */
export function watchPixelRatio(ctx: RendererCtx): void {
  if (typeof globalThis.matchMedia !== "function") return;

  const state = ctx.state.host;
  let query: MediaQueryList | undefined;

  /**
   * Arms the query for the ratio the page has now.
   */
  function arm(): void {
    query = globalThis.matchMedia(`(resolution: ${state.resolution.dpr}dppx)`);
    query.addEventListener("change", follow, { once: true });
  }

  /**
   * Reads the new ratio, asks for the target and arms again.
   */
  function follow(): void {
    state.resolution.dpr = devicePixels();
    refreshResolution(ctx, "dpr");
    arm();
  }

  arm();
  state.cleanups.push(() => query?.removeEventListener("change", follow));
}
