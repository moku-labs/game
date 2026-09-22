/**
 * @file renderer/viewport — API factory. The module keeps its data in `ctx.state.viewport` and
 * reaches the canvas only through the injected `host`.
 */
import type { PixiContainer, RendererCtx, ViewportModule } from "../types";
import { fitFrame, referenceOf, scaleOf } from "./fit";
import { measureMount, watchResize } from "./resize";
import { clipToFrame, createSafeAreaProbe, readInsets } from "./safe-area";
import type { Point, SafeArea, ViewportCtx, ViewportDeps, ViewportSize } from "./types";

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
   * Measures the mount, resizes the renderer and recomputes frame, scale and safe area.
   */
  const layout = (): void => {
    const size = measureMount(vctx);

    deps.host.resize(size.width, size.height);
    state.frame = fitFrame(size, ctx.config.aspect, ctx.global.orientation);
    state.scale = scaleOf(state.frame, ctx.global.orientation, ctx.global.referenceSide);
    state.reference = referenceOf(state.frame, state.scale);
    state.safeArea = clipToFrame({
      insets: readInsets(state.probe),
      frame: state.frame,
      canvas: canvasOrigin(deps.host.canvas()),
      window: windowSize(),
      scale: state.scale
    });
  };

  /**
   * The frame a game lays out in before anything was measured: the narrowest allowed shape.
   *
   * @returns The `aspect.min` frame at scale 1 with no safe area.
   */
  const inertSize = (): ViewportSize => {
    const short = ctx.global.referenceSide;
    const long = short * ctx.config.aspect.min;
    const portrait = ctx.global.orientation === "portrait";

    return {
      width: portrait ? short : long,
      height: portrait ? long : short,
      scale: 1,
      orientation: ctx.global.orientation,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
    };
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

    size: (): ViewportSize => {
      if (state.reference.width <= 0) return inertSize();

      const safeArea: SafeArea = { ...state.safeArea };

      return {
        width: state.reference.width,
        height: state.reference.height,
        scale: state.scale,
        orientation: ctx.global.orientation,
        safeArea
      };
    },

    apply: (root: PixiContainer): void => {
      root.position.set(state.frame.x, state.frame.y);
      root.scale.set(state.scale);
    },

    start: (): void => {
      state.probe = createSafeAreaProbe();
      watchResize(vctx);
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
