/**
 * @file input plugin — lifecycle functions: dependency resolution, the frame step registered in
 * `onInit`, the pointer listeners opened in `onStart` and the teardown that closes exactly what
 * was opened.
 */
import { flowPlugin } from "../flow";
import { rendererPlugin } from "../renderer";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { stepGestures } from "./gestures";
import { attach, detach } from "./pointer";
import type { Deps, InputCtx, KernelSlice, State } from "./types";

/**
 * Resolves the dependency APIs `time`, `flow`, `world` and `renderer` with `ctx.require`.
 *
 * @param ctx - Kernel context of the input plugin.
 * @returns The four dependency APIs.
 */
export function resolveDeps(ctx: KernelSlice): Deps {
  return {
    time: ctx.require(timePlugin),
    flow: ctx.require(flowPlugin),
    world: ctx.require(worldPlugin),
    renderer: ctx.require(rendererPlugin)
  };
}

/**
 * Builds the domain context the frame step and the API share.
 *
 * @param ctx - Kernel context of the input plugin.
 * @returns The domain context of the input plugin.
 */
export function withDeps(ctx: KernelSlice): InputCtx {
  return { ...ctx, deps: resolveDeps(ctx) };
}

/**
 * Registers the one frame step in `onInit`, which runs before every `onStart`, and binds
 * `time.wake` so a pointer sample lifts the idle frame rate. `world` registers
 * its own `input` callback in its `onStart` and `time` runs the callbacks of a phase in
 * registration order, so the gestures are resolved before any game system of phase `input` runs.
 *
 * @param ctx - Kernel context of the input plugin.
 */
export function initInput(ctx: KernelSlice): void {
  const inputCtx = withDeps(ctx);

  inputCtx.state.wake = (): void => inputCtx.deps.time.wake();
  inputCtx.state.offFrame = inputCtx.deps.time.onFrame("input", time =>
    stepGestures(inputCtx, time)
  );
}

/**
 * Opens the pointer listeners on the canvas the renderer created. Without a DOM the renderer has
 * no canvas: nothing is attached, the plugin is inert, and `app.input.*` still answers the gate.
 *
 * @param ctx - Kernel context of the input plugin.
 */
export function startInput(ctx: KernelSlice): void {
  const canvas = ctx.require(rendererPlugin).host.canvas();

  ctx.state.canvas = canvas;
  if (canvas !== undefined) attach(canvas, ctx.state);
}

/**
 * Closes what the plugin opened: the six DOM listeners, the frame callback and the mute a drag
 * still holds. The tags die with the world, which stops after `input`.
 *
 * @param state - The plugin state, the only thing a teardown context carries.
 */
export function stopInput(state: State): void {
  detach(state);
  state.offFrame?.();
  state.offFrame = undefined;
  state.unmute?.();
  state.unmute = undefined;
  state.samples = [];
  state.canvas = undefined;
  state.phase = "idle";
  state.pointerId = undefined;
  state.entity = undefined;
  state.key = undefined;
  state.hovered = undefined;
  state.pointerOver = undefined;
  state.parent = undefined;
  state.wake = undefined;
  state.tapListeners = [];
}
