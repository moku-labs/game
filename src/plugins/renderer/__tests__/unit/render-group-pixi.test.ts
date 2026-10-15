import * as pixi from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  createRebindingRenderGroupPipe,
  installRebindingRenderGroupPipe
} from "../../host/render-group";
import type { PixiModule } from "../../types";
import { FakeRenderGroupPipe, fakeExtensions, WEBGL_PIPES, WEBGPU_PIPES } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU (F10): Pixi's
// RenderGroupPipe refreshes a group cached as a texture with push … pop, and
// pop binds the stack's previous entry, the canvas, not the filter's input a
// FilterSystem bound with `bind`. The pin fails the day Pixi fixes it; the
// renderer's subclass binds the input again, with no clear.
// ---------------------------------------------------------------------------

/** One render pass the stand-in adaptor was asked to start: the target's colour texture and the clear. */
type PassStart = { source: unknown; clear: unknown };

/** The real render target system over a stand-in adaptor, and the passes it started. */
type Targets = { system: pixi.RenderTargetSystem<pixi.GpuRenderTarget>; passes: PassStart[] };

/**
 * Pixi's own `RenderTargetSystem` over an adaptor that records the passes it starts: `bind`, `push`, `pop`,
 * `getBindState` and `renderSurface` are Pixi's, only the GPU calls are stood in.
 *
 * @returns The system and its record.
 */
function realTargets(): Targets {
  const passes: PassStart[] = [];
  const system = new pixi.RenderTargetSystem<pixi.GpuRenderTarget>({
    gc: { addCollection: (): void => undefined }
  } as unknown as ConstructorParameters<typeof pixi.RenderTargetSystem>[0]);

  // The adaptor is the one stand-in: Pixi's backends set it in their own constructor.
  Object.assign(system, {
    adaptor: {
      init: (): void => undefined,
      initGpuRenderTarget: () => ({ width: 0, height: 0 }),
      resizeGpuRenderTarget: (): void => undefined,
      startRenderPass: (target: pixi.RenderTarget, clear: unknown): void => {
        passes.push({ source: target.colorTexture.source, clear });
      },
      finishRenderPass: (): void => undefined,
      clear: (): void => undefined,
      destroyGpuRenderTarget: (): void => undefined,
      copyToTexture: (): pixi.Texture => pixi.Texture.EMPTY
    }
  });

  return { system, passes };
}

/**
 * A render group cached as a texture, as `_executeCacheAsTexture` reads it: renderable, its texture, no instruction.
 *
 * @param texture - The texture it is cached into.
 * @param options - Whether it is cached and whether its texture is stale.
 * @param options.cached - `isCachedAsTexture`.
 * @param options.stale - `textureNeedsUpdate`.
 * @returns The group.
 */
function cachedGroup(
  texture: pixi.Texture,
  options: { cached: boolean; stale: boolean }
): pixi.RenderGroup {
  return {
    isRenderable: true,
    isCachedAsTexture: options.cached,
    textureNeedsUpdate: options.stale,
    texture,
    inverseParentTextureTransform: new pixi.Matrix(),
    worldColorAlpha: 0xff_ff_ff_ff,
    _textureBounds: { x: 0, y: 0 },
    instructionSet: { instructions: [], instructionSize: 0 },
    _batchableRenderGroup: {
      _batcher: {
        updateElement: (): void => undefined,
        geometry: { buffers: [{ update: (): void => undefined }] }
      }
    }
  } as unknown as pixi.RenderGroup;
}

/**
 * A filter's moment inside a frame: the canvas pushed, the filter's input bound with `bind` as `FilterSystem` does,
 * then one render group executed by a pipe of the given class.
 *
 * @param Pipe - The render-group pipe class.
 * @param options - The group's state.
 * @param options.cached - `isCachedAsTexture`.
 * @param options.stale - `textureNeedsUpdate`.
 * @returns The canvas, the input, the bound surface after the group, and the passes started after the bind.
 */
function insideAFilter(
  Pipe: typeof pixi.RenderGroupPipe,
  options: { cached: boolean; stale: boolean }
): { canvas: pixi.Texture; input: pixi.Texture; bound: unknown; after: PassStart[] } {
  const { system, passes } = realTargets();
  const canvas = pixi.RenderTexture.create({ width: 64, height: 64 });
  const input = pixi.RenderTexture.create({ width: 32, height: 32 });
  const group = pixi.RenderTexture.create({ width: 16, height: 16 });
  const renderer = {
    renderTarget: system,
    globalUniforms: { push: (): void => undefined, pop: (): void => undefined },
    renderPipes: {}
  };
  const pipe = new Pipe(renderer as unknown as ConstructorParameters<typeof Pipe>[0]);

  system.push({ target: canvas, clear: true });
  system.bind({ target: input, clear: true });

  const from = passes.length;

  pipe.execute(cachedGroup(group, options));

  return { canvas, input, bound: system.renderSurface, after: passes.slice(from) };
}

describe("Pixi's RenderGroupPipe inside a filter", () => {
  // Pin: when this fails, Pixi binds the filter's input again itself and the subclass may go.
  it("leaves the canvas bound after refreshing a cached group inside a filter", () => {
    const { canvas, bound } = insideAFilter(pixi.RenderGroupPipe, { cached: true, stale: true });

    expect(bound).toBe(canvas);
  });

  // Bug: the rest of the filter's input is drawn into the canvas, the game's black memory screen.
  it("the engine's pipe binds the filter's input again, with no clear", () => {
    const Pipe = createRebindingRenderGroupPipe(pixi as unknown as PixiModule);
    const { input, bound, after } = insideAFilter(Pipe, { cached: true, stale: true });

    expect(bound).toBe(input);
    // Pixi's push into the group's texture, its pop onto the canvas, then the engine's bind of the input, kept.
    expect(after.at(-1)).toEqual({ source: input.source, clear: pixi.CLEAR.NONE });
  });

  // Bug: a group that draws straight, or a cached one that needs no refresh, is rebound in every frame.
  it("a group that is not cached, or needs no refresh, binds nothing extra", () => {
    const Pipe = createRebindingRenderGroupPipe(pixi as unknown as PixiModule);

    for (const options of [
      { cached: false, stale: true },
      { cached: true, stale: false }
    ]) {
      const { input, bound, after } = insideAFilter(Pipe, options);

      expect(bound).toBe(input);
      expect(after).toEqual([]);
    }
  });

  it("the subclass keeps Pixi's extension object and registers under the same name, and the remover puts Pixi's back", () => {
    const calls: Array<[string, unknown]> = [];
    const module = {
      ...pixi,
      extensions: {
        add: (item: unknown): void => {
          calls.push(["add", item]);
        },
        remove: (item: unknown): void => {
          calls.push(["remove", item]);
        }
      }
    } as unknown as PixiModule;

    expect(pixi.RenderGroupPipe.extension).toEqual({
      type: [
        pixi.ExtensionType.WebGLPipes,
        pixi.ExtensionType.WebGPUPipes,
        pixi.ExtensionType.CanvasPipes
      ],
      name: "renderGroup"
    });

    const off = installRebindingRenderGroupPipe(module);
    const [removed, added] = calls;
    const pipe = added?.[1] as typeof pixi.RenderGroupPipe;

    expect(removed).toEqual(["remove", pixi.RenderGroupPipe]);
    expect(Object.getPrototypeOf(pipe)).toBe(pixi.RenderGroupPipe);
    expect(pipe.extension).toBe(pixi.RenderGroupPipe.extension);

    off();

    expect(calls.slice(2)).toEqual([
      ["remove", pipe],
      ["add", pixi.RenderGroupPipe]
    ]);
  });
});

describe("the host and the render-group pipe", () => {
  // Bug: the pipe is never installed, or Pixi's own is not put back for the next application on the page.
  it("is installed before init in every build and swapped back when the host stops", async () => {
    const mock = createMockRenderer();

    await mock.start();

    const installed = fakeExtensions.named(WEBGPU_PIPES, "renderGroup");

    expect(installed).not.toBe(FakeRenderGroupPipe);
    expect(Object.getPrototypeOf(installed)).toBe(FakeRenderGroupPipe);
    expect(fakeExtensions.named(WEBGL_PIPES, "renderGroup")).toBe(installed);

    mock.stop();

    expect(fakeExtensions.named(WEBGPU_PIPES, "renderGroup")).toBe(FakeRenderGroupPipe);
    expect(mock.ctx.state.host.uninstallRenderGroup).toBeUndefined();
  });

  it("starts on Pixi's own pipe and warns when the module lacks it", async () => {
    const mock: MockRenderer = createMockRenderer({
      config: {
        loadPixi: () =>
          Promise.resolve({
            ...mock.pixi.module,
            RenderGroupPipe: undefined
          } as unknown as PixiModule)
      }
    });

    await mock.start();

    expect(mock.api.host.ready()).toBe(true);
    expect(mock.ctx.state.host.uninstallRenderGroup).toBeUndefined();
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: a cached group inside a filter may draw to the canvas",
      expect.objectContaining({ error: expect.any(TypeError) })
    );
    vi.unstubAllGlobals();
  });
});
