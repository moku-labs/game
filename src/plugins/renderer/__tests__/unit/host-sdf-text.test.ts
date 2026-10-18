import { afterEach, describe, expect, it, vi } from "vitest";
import { SDF, SDF_BATCHER } from "../../host/sdf-batcher";
import { createSdfTextPipe, installSdfText } from "../../host/sdf-text";
import type { PixiModule } from "../../types";
import {
  BATCHER,
  createFakePixi,
  FakeBatcher,
  FakeBatcherPipe,
  FakeBitmapTextPipe,
  fakeExtensions,
  WEBGL_PIPES,
  WEBGPU_PIPES
} from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test: the install of the renderer's batched distance-field text. Its batcher, its bitmap text pipe and its
// routing batch pipe go into Pixi's extension registry before init, under Pixi's names, and come out at stop; a dev
// build's counting batch pipe extends the routing pipe and takes its place.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Yields the microtask queue, so a restore inside the renderer can finish.
 */
async function tick(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("createSdfTextPipe", () => {
  it("subclasses Pixi's bitmap text pipe and keeps its extension metadata object", () => {
    const pixi = createFakePixi();
    const Pipe = createSdfTextPipe(pixi.module);

    expect(Object.getPrototypeOf(Pipe)).toBe(FakeBitmapTextPipe);
    expect((Pipe as unknown as typeof FakeBitmapTextPipe).extension).toBe(
      FakeBitmapTextPipe.extension
    );
  });
});

describe("installSdfText", () => {
  // Bug: a pipe left in Pixi's registry after stop draws the next application's text with a removed batcher.
  it("swaps both pipes for the subclasses under Pixi's names on both backends, adds the batcher, and swaps the pipes back", () => {
    const pixi = createFakePixi();
    const off = installSdfText(pixi.module);
    const text = fakeExtensions.named(WEBGPU_PIPES, "bitmapText");
    const batch = fakeExtensions.named(WEBGPU_PIPES, "batch");
    const batcher = fakeExtensions.named(BATCHER, SDF_BATCHER);

    expect(Object.getPrototypeOf(text)).toBe(FakeBitmapTextPipe);
    expect(Object.getPrototypeOf(batch)).toBe(FakeBatcherPipe);
    expect(Object.getPrototypeOf(batcher)).toBe(FakeBatcher);
    expect(fakeExtensions.named(WEBGL_PIPES, "bitmapText")).toBe(text);
    expect(fakeExtensions.named(WEBGL_PIPES, "batch")).toBe(batch);

    off();

    expect(fakeExtensions.named(WEBGPU_PIPES, "bitmapText")).toBe(FakeBitmapTextPipe);
    expect(fakeExtensions.named(WEBGL_PIPES, "bitmapText")).toBe(FakeBitmapTextPipe);
    expect(fakeExtensions.named(WEBGPU_PIPES, "batch")).toBe(FakeBatcherPipe);
    expect(fakeExtensions.named(WEBGL_PIPES, "batch")).toBe(FakeBatcherPipe);
  });

  // Bug: stopping one application removed the batcher another one on the same module still met in a pooled element.
  it("keeps the batcher registered after the remover, so a pooled element named moku-sdf still finds it", () => {
    const pixi = createFakePixi();

    installSdfText(pixi.module)();

    expect(Object.getPrototypeOf(fakeExtensions.named(BATCHER, SDF_BATCHER))).toBe(FakeBatcher);
  });

  // Bug: a module without a piece left the registry half swapped: the batcher in, Pixi's text pipe out.
  it("touches the registry not at all when a piece is missing", () => {
    const pixi = createFakePixi();
    const lacking = { ...pixi.module, BatcherPipe: undefined } as unknown as PixiModule;

    expect(() => installSdfText(lacking)).toThrow(TypeError);
    expect(fakeExtensions.named(WEBGPU_PIPES, "bitmapText")).toBe(FakeBitmapTextPipe);
    expect(fakeExtensions.named(BATCHER, SDF_BATCHER)).toBeUndefined();
  });
});

describe("the host and the batched text", () => {
  it("installs the pipe before init in a production build", async () => {
    const mock = createMockRenderer();

    await mock.start();

    const pipe = mock.pixi.last().textPipe;

    expect(pipe).not.toBe(FakeBitmapTextPipe);
    expect(Object.getPrototypeOf(pipe)).toBe(FakeBitmapTextPipe);
    expect(Object.getPrototypeOf(mock.pixi.last().drawClasses?.batcher)).toBe(FakeBatcherPipe);
    expect(mock.ctx.state.host.uninstallSdfText).toBeTypeOf("function");
  });

  it("installs it on the WebGL fallback too", async () => {
    const mock = createMockRenderer({ kind: "webgl" });

    await mock.start();

    expect(Object.getPrototypeOf(mock.pixi.last().textPipe)).toBe(FakeBitmapTextPipe);
  });

  it("installs nothing while inert", async () => {
    const mock = createMockRenderer({ dom: false });

    await mock.start();

    expect(mock.ctx.state.host.uninstallSdfText).toBeUndefined();
    expect(fakeExtensions.named(WEBGPU_PIPES, "bitmapText")).toBe(FakeBitmapTextPipe);
  });

  it("reuses the installed pipe for the new application after a lost WebGPU device", async () => {
    const mock = createMockRenderer();

    await mock.start();

    const first = mock.pixi.last();

    first.lose("unknown");
    await tick();

    const second = mock.pixi.last();

    expect(second).not.toBe(first);
    expect(second.textPipe).toBe(first.textPipe);
  });

  it("swaps Pixi's own pipes back when the host stops", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.stop();

    expect(fakeExtensions.named(WEBGPU_PIPES, "bitmapText")).toBe(FakeBitmapTextPipe);
    expect(fakeExtensions.named(WEBGL_PIPES, "bitmapText")).toBe(FakeBitmapTextPipe);
    expect(fakeExtensions.named(WEBGPU_PIPES, "batch")).toBe(FakeBatcherPipe);
    expect(mock.ctx.state.host.uninstallSdfText).toBeUndefined();
  });

  it("starts on Pixi's own pipe and warns when the module lacks the SDF pieces", async () => {
    const mock: MockRenderer = createMockRenderer({
      config: {
        loadPixi: () =>
          Promise.resolve({
            ...mock.pixi.module,
            BitmapTextPipe: undefined
          } as unknown as PixiModule)
      }
    });

    await mock.start();

    expect(mock.api.host.ready()).toBe(true);
    expect(mock.ctx.state.host.uninstallSdfText).toBeUndefined();
    expect(mock.pixi.last().textPipe).toBe(FakeBitmapTextPipe);
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: distance-field text applies its alpha twice",
      expect.objectContaining({ error: expect.any(TypeError) })
    );
  });

  // Bug: the counting pipe of a dev build took the name "batch" from the routing pipe, so a dev build drew every label
  // with Pixi's default batcher; or the routing pipe took it back, and the rebuilds went uncounted.
  it("in a dev build, counts with a batch pipe that extends the routing pipe and still routes", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer();

    await mock.start();

    const Counting = fakeExtensions.named(
      WEBGPU_PIPES,
      "batch"
    ) as unknown as new () => FakeBatcherPipe;
    const routing: unknown = Object.getPrototypeOf(Counting);
    const pipe = new Counting();
    const label = { batcherName: "default", renderable: { [SDF]: { perScale: 4 } } };

    pipe.buildStart({});
    pipe.addToBatch(label, {});

    expect(routing).not.toBe(FakeBatcherPipe);
    expect(Object.getPrototypeOf(routing)).toBe(FakeBatcherPipe);
    expect(pipe.builds).toBe(1);
    expect(pipe.added).toEqual([{ element: label, batcherName: SDF_BATCHER }]);
  });
});
