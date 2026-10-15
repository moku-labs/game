/**
 * @file renderer/viewport — API factory. The module keeps its data in `ctx.state.viewport` and
 * reaches the canvas only through the injected `host`.
 */
import type { PixiContainer, RendererCtx, ViewportModule } from "../types";
import { fitFrame, referenceOf, scaleOf } from "./fit";
import { measureMount, watchResize, watchSafeArea } from "./resize";
import { clipInsets, clipToFrame, createSafeAreaProbes, readInsets } from "./safe-area";
import type { Point, ViewportCtx, ViewportDeps, ViewportSize } from "./types";

/**
 * Where the canvas sits in the window, read at call time.
 *
 * @param canvas - The canvas, or `undefined` while inert.
 * @returns The top left corner in client coordinates.
 */
function canvasOrigin(canvas: HTMLCanvasElement | undefined): { left: number; top: number } {
  if (canvas === undefined) return { left: 0, top: 0 };

  const rect = canvas.getBoundingClientRect();

  return { left: rect.left, top: rect.top };
}

/**
 * The size of the window, or zero where there is none.
 *
 * @returns Width and height of the visual viewport.
 */
function windowSize(): { width: number; height: number } {
  return {
    width: typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 0,
    height: typeof globalThis.innerHeight === "number" ? globalThis.innerHeight : 0
  };
}

/**
 * The size object `size()` hands out: the one it handed out before when no number changed, else a new frozen one.
 * All nine values count, `scale` too: a game that reads `scale` sees its change.
 *
 * @param kept - The object handed out so far, or nothing.
 * @param next - The frame the layout measured.
 * @returns `kept`, or a new deeply frozen object.
 * @example
 * keptSize(undefined, { width: 1080, height: 1920, scale: 0.5, orientation: "portrait", safeArea: { top: 47, right: 0, bottom: 34, left: 0 } }).width // 1080
 */
function keptSize(
  kept: Readonly<ViewportSize> | undefined,
  next: ViewportSize
): Readonly<ViewportSize> {
  if (
    kept !== undefined &&
    kept.width === next.width &&
    kept.height === next.height &&
    kept.scale === next.scale &&
    kept.orientation === next.orientation &&
    kept.safeArea.top === next.safeArea.top &&
    kept.safeArea.right === next.safeArea.right &&
    kept.safeArea.bottom === next.safeArea.bottom &&
    kept.safeArea.left === next.safeArea.left
  ) {
    return kept;
  }

  return frozenSize(next);
}

/**
 * A deeply frozen copy of a frame: the object and its safe area.
 *
 * @param size - The frame.
 * @returns The frozen copy.
 */
function frozenSize(size: ViewportSize): Readonly<ViewportSize> {
  const { top, right, bottom, left } = size.safeArea;

  return Object.freeze({
    width: size.width,
    height: size.height,
    scale: size.scale,
    orientation: size.orientation,
    safeArea: Object.freeze({ top, right, bottom, left })
  });
}

/**
 * Creates the viewport module: the map between the window and the reference space.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The injected `host` module.
 * @returns The viewport API and its internal half.
 */
export function createViewportApi(ctx: RendererCtx, deps: ViewportDeps): ViewportModule {
  const vctx: ViewportCtx = { ctx, deps };
  const state = ctx.state.viewport;

  /**
   * Measures the mount, resizes the renderer and recomputes frame, scale and safe area. The scale
   * fits the long side between the insets that cover the frame, so they are clipped first, in CSS
   * pixels, and turned into reference units last.
   */
  const layout = (): void => {
    const size = measureMount(vctx);

    deps.host.resize(size.width, size.height);
    state.frame = fitFrame(size, ctx.config.aspect, ctx.global.orientation);

    const clip = {
      insets: readInsets(state.probes),
      frame: state.frame,
      canvas: canvasOrigin(deps.host.canvas()),
      window: windowSize()
    };
    const { orientation, referenceSide, referenceLong } = ctx.global;

    state.scale = scaleOf(state.frame, orientation, referenceSide, referenceLong, clipInsets(clip));
    state.reference = referenceOf(state.frame, state.scale);
    state.safeArea = clipToFrame({ ...clip, scale: state.scale });
    // A layout that gives the same frame (the observer's first echo, a resolution with the same CSS size) keeps it.
    state.size = keptSize(state.size, {
      width: state.reference.width,
      height: state.reference.height,
      scale: state.scale,
      orientation,
      safeArea: state.safeArea
    });
  };

  /**
   * The frame a game lays out in before anything was measured: the narrowest allowed shape. The config and
   * `ctx.global` are frozen for the app's life, so one object made on first use is enough.
   *
   * @returns The `aspect.min` frame at scale 1 with no safe area, frozen.
   */
  const inertSize = (): Readonly<ViewportSize> => {
    const short = ctx.global.referenceSide;
    const long = short * ctx.config.aspect.min;
    const portrait = ctx.global.orientation === "portrait";

    state.inert ??= frozenSize({
      width: portrait ? short : long,
      height: portrait ? long : short,
      scale: 1,
      orientation: ctx.global.orientation,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
    });

    return state.inert;
  };

  return {
    toReference: (clientX: number, clientY: number): Point => {
      const canvas = deps.host.canvas();

      if (canvas === undefined || state.scale <= 0) return { x: clientX, y: clientY };

      const rect = canvas.getBoundingClientRect();

      return {
        x: (clientX - rect.left - state.frame.x) / state.scale,
        y: (clientY - rect.top - state.frame.y) / state.scale
      };
    },

    toScreen: (point: Point): Point => {
      const canvas = deps.host.canvas();

      if (canvas === undefined || state.scale <= 0) return { x: point.x, y: point.y };

      const rect = canvas.getBoundingClientRect();

      return {
        x: rect.left + state.frame.x + point.x * state.scale,
        y: rect.top + state.frame.y + point.y * state.scale
      };
    },

    size: (): Readonly<ViewportSize> =>
      state.size === undefined || state.reference.width <= 0 ? inertSize() : state.size,

    apply: (root: PixiContainer): void => {
      root.position.set(state.frame.x, state.frame.y);
      root.scale.set(state.scale);
    },

    start: (): void => {
      state.probes = createSafeAreaProbes();
      watchResize(vctx);
      watchSafeArea(vctx);
      layout();
    },

    applyPending: (): boolean => {
      if (!state.resizePending) return false;

      state.resizePending = false;
      layout();

      return true;
    }
  };
}
