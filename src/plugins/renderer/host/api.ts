/**
 * @file renderer/host — API factory. The module keeps its data in `ctx.state.host`; nothing
 * above it ever touches Pixi's `Application`.
 */
import type { HostModule, PixiContainer, PixiModule, RendererCtx, RendererKind } from "../types";
import { watchDevice } from "./device";
import { createApplication, destroyApplication, resolveMount } from "./init";
import { showUnsupported } from "./unsupported";
import { watchVisibility } from "./visibility";

/**
 * Creates the host module: the one Pixi application and everything that can take it away.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @returns The host API and its internal half.
 */
export function createHostApi(ctx: RendererCtx): HostModule {
  const state = ctx.state.host;

  /**
   * Builds a new application over the same mount, after the old device went away.
   *
   * @returns True when the new application is up.
   */
  const restart = async (): Promise<boolean> => {
    const mount = state.mount;

    if (mount === undefined) return false;

    // The tree is still alive here: this is where `sync` saves the objects the game owns.
    for (const fn of state.onLoss) fn();

    destroyApplication(state);

    try {
      await createApplication(ctx, mount);
    } catch (error) {
      showUnsupported(ctx, mount, error);

      return false;
    }

    watchDevice(ctx, restart);

    return true;
  };

  return {
    ready: (): boolean => state.ready,
    kind: (): RendererKind => state.kind,
    canvas: (): HTMLCanvasElement | undefined => state.canvas,
    pixi: (): PixiModule | undefined => state.pixi,
    stage: (): PixiContainer | undefined => state.app?.stage,
    mount: (): HTMLElement | undefined => state.mount,

    onReady: (fn: () => void): void => {
      state.onReady.push(fn);
    },

    onRestore: (fn: () => void): void => {
      state.onRestore.push(fn);
    },

    onLoss: (fn: () => void): void => {
      state.onLoss.push(fn);
    },

    resize: (width: number, height: number): void => {
      if (state.ready) state.app?.renderer.resize(width, height);
    },

    render: (): void => {
      const app = state.app;

      if (!state.ready || app === undefined) return;

      app.renderer.render(app.stage);
    },

    init: async (): Promise<void> => {
      const mount = resolveMount(ctx);

      if (mount === undefined) return;

      state.mount = mount;

      try {
        await createApplication(ctx, mount);
      } catch (error) {
        showUnsupported(ctx, mount, error);

        return;
      }

      watchDevice(ctx, restart);
      watchVisibility(ctx);
      state.ready = true;

      for (const fn of state.onReady) fn();
    }
  };
}
