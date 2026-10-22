import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { Config, PixiTexture } from "../../types";
import {
  type FakeGpuTextureSystem,
  FakeRectangle,
  type FakeSource,
  FakeTexture
} from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test of the texture upload queue (F60) on the fake Pixi: `sync.textures.upload` queues each source once and
// the render phase of a drawn frame hands `renderer.uploads` of them to Pixi's texture system (`initSource`) before
// the stage pass, asking for frames while sources wait. Each call answers true after its last source, false when
// nothing can draw, with `uploads: 0`, or when the device goes first.
// ---------------------------------------------------------------------------

const running: MockRenderer[] = [];

afterEach(() => {
  for (const mock of running.splice(0)) mock.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Yields the microtask queue, so a promise the renderer answered reaches its `then`.
 *
 * @param times - How many microtasks to wait.
 */
async function tick(times = 20): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * One frame: the sync pass, the change sets closed, then the input and render phases.
 *
 * @param mock - The mock renderer.
 */
function frame(mock: MockRenderer): void {
  mock.modules.sync.pass();
  mock.world.clearChanges();
  mock.drawFrame();
}

/**
 * Starts a renderer that draws on demand, past its first frame, so a frame is drawn only for a reason.
 *
 * @param config - Config of the renderer: `uploads` above all.
 * @returns The running mock.
 */
async function uploading(config: Partial<Config> = {}): Promise<MockRenderer> {
  const mock = createMockRenderer({ config: { onDemand: true, ...config } });

  running.push(mock);
  await mock.start();
  frame(mock);
  frame(mock);

  return mock;
}

/**
 * The texture system of the application drawing now.
 *
 * @param mock - The mock renderer.
 * @returns Pixi's `renderer.texture` of the fake.
 */
function system(mock: MockRenderer): FakeGpuTextureSystem {
  return mock.pixi.last().renderer.texture as FakeGpuTextureSystem;
}

/**
 * Textures over a source of their own each, as loose files of a bundle.
 *
 * @param count - How many.
 * @returns The textures.
 */
function loose(count: number): PixiTexture[] {
  return Array.from(
    { length: count },
    () => new FakeTexture({ source: { width: 64, height: 64, destroyed: false } }) as never
  );
}

/**
 * The source of a texture, writable.
 *
 * @param texture - The texture.
 * @returns Its fake source.
 */
function sourceOf(texture: PixiTexture | undefined): FakeSource {
  return (texture as unknown as FakeTexture).source;
}

/**
 * Watches a call's answer without awaiting it.
 *
 * @param call - The promise of `upload`.
 * @returns What it answered so far, `undefined` while it waits.
 */
function watch(call: Promise<boolean>): { answer: boolean | undefined } {
  const seen: { answer: boolean | undefined } = { answer: undefined };

  call.then(answer => {
    seen.answer = answer;
  });

  return seen;
}

/**
 * The renders onto the canvas the application made: one per drawn frame.
 *
 * @param mock - The mock renderer.
 * @returns The count.
 */
function renders(mock: MockRenderer): number {
  return mock.pixi.last().renderer.renders;
}

describe("sync.textures.upload", () => {
  // Bug: the whole queue goes in one frame (the 55 ms spike only moves), or the call answers before its last upload.
  it("hands `uploads` sources a drawn frame to initSource, in order, and answers true after the last", async () => {
    const mock = await uploading({ uploads: 2 });
    const textures = loose(5);
    const call = watch(mock.api.sync.textures.upload(textures));
    const made = (): object[] => [...system(mock).made.keys()];

    frame(mock);
    await tick();

    expect(made()).toEqual(textures.slice(0, 2).map(texture => sourceOf(texture)));
    expect(call.answer).toBeUndefined();

    frame(mock);
    frame(mock);
    await tick();

    expect(made()).toEqual(textures.map(texture => sourceOf(texture)));
    expect(call.answer).toBe(true);
  });

  // Bug: with onDemand a still screen draws no frame, so the queue never moves; or the frames go on once it is empty.
  it("asks for a drawn frame while sources wait, and for none once the queue is empty", async () => {
    const mock = await uploading({ uploads: 1 });
    const before = renders(mock);

    const call = mock.api.sync.textures.upload(loose(3));

    frame(mock);
    frame(mock);
    frame(mock);

    expect(renders(mock)).toBe(before + 3);

    frame(mock);

    expect(renders(mock)).toBe(before + 3);
    await expect(call).resolves.toBe(true);
  });

  // Bug: two slices of one atlas page upload the page twice, or a page on the GPU already waits for frames again.
  it("uploads a source shared by two textures once, and answers true at once for sources on this device", async () => {
    const mock = await uploading({ uploads: 1 });
    const page: FakeSource = { width: 512, height: 512, destroyed: false };
    const slices = [
      new FakeTexture({ source: page, frame: new FakeRectangle(0, 0, 64, 64) }),
      new FakeTexture({ source: page, frame: new FakeRectangle(64, 0, 64, 64) })
    ] as unknown as PixiTexture[];
    const init = vi.spyOn(system(mock), "initSource");
    const call = watch(mock.api.sync.textures.upload(slices));

    frame(mock);
    await tick();

    expect(call.answer).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);

    const again = watch(mock.api.sync.textures.upload(slices));

    await tick();

    expect(again.answer).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(mock.ctx.state.sync.upload.queue).toHaveLength(0);
  });

  // Bug: a headless app or `uploads: 0` waits forever, or queues work no frame will do.
  it("answers false at once while nothing draws and with uploads 0, queuing nothing", async () => {
    const inert = createMockRenderer({ dom: false });

    await inert.start();
    // The seam itself does nothing without an application.
    inert.modules.host.initSource(sourceOf(loose(1)[0]) as never);

    await expect(inert.api.sync.textures.upload(loose(2))).resolves.toBe(false);

    const off = await uploading({ uploads: 0 });
    const init = vi.spyOn(system(off), "initSource");

    await expect(off.api.sync.textures.upload(loose(2))).resolves.toBe(false);

    frame(off);

    expect(init).not.toHaveBeenCalled();
    expect(off.ctx.state.sync.upload.queue).toHaveLength(0);
  });

  // Bug: a call waiting when the renderer stops never answers, and `assets.warm` hangs the game's load.
  it("answers false when the renderer stops before the queue reached the sources", async () => {
    const mock = await uploading({ uploads: 1 });
    const call = watch(mock.api.sync.textures.upload(loose(3)));

    frame(mock);
    mock.stop();
    running.splice(running.indexOf(mock), 1);
    await tick();

    expect(call.answer).toBe(false);
  });

  // Bug: a lost device leaves its calls waiting, or the new device believes the sources are on its GPU already.
  it("answers false when the device is lost, and uploads the sources again on the new device", async () => {
    const mock = await uploading({ uploads: 1 });
    const textures = loose(2);
    const lost = watch(mock.api.sync.textures.upload(textures));

    frame(mock);
    mock.pixi.last().lose("unknown");
    await tick();

    expect(lost.answer).toBe(false);

    const again = watch(mock.api.sync.textures.upload(textures));

    await tick();

    expect(again.answer).toBeUndefined();

    frame(mock);
    frame(mock);
    await tick();

    expect(again.answer).toBe(true);
    expect([...system(mock).made.keys()]).toEqual(textures.map(texture => sourceOf(texture)));
  });

  // Bug: one source Pixi cannot upload stops the queue or hangs the call, or is logged at every call.
  it("logs a source whose upload throws once, counts it done and goes on", async () => {
    const mock = await uploading({ uploads: 1 });
    const [bad, good] = loose(2);
    const init: MockInstance = vi.spyOn(system(mock), "initSource");

    init.mockImplementation((source: unknown) => {
      if (source === sourceOf(bad)) throw new Error("fake pixi: no memory");

      return { label: "gpu texture" };
    });

    const call = watch(mock.api.sync.textures.upload([bad, good] as PixiTexture[]));

    frame(mock);
    frame(mock);
    await tick();

    expect(call.answer).toBe(true);
    expect(init).toHaveBeenCalledTimes(2);
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer:upload-failed",
      expect.objectContaining({ error: expect.any(Error) })
    );

    await expect(mock.api.sync.textures.upload([bad] as PixiTexture[])).resolves.toBe(true);

    expect(
      vi.mocked(mock.log.warn).mock.calls.filter(([event]) => event === "renderer:upload-failed")
    ).toHaveLength(1);
  });

  // Bug: a texture `assets` destroyed while it waited goes to Pixi (which throws on it), or costs a frame's budget.
  it("skips a source destroyed while it waits, at no cost of the frame's budget", async () => {
    const mock = await uploading({ uploads: 1 });
    const [gone, kept] = loose(2);
    const init = vi.spyOn(system(mock), "initSource");
    const call = watch(mock.api.sync.textures.upload([gone, kept] as PixiTexture[]));

    sourceOf(gone).destroyed = true;
    frame(mock);
    await tick();

    expect(init.mock.calls).toEqual([[sourceOf(kept)]]);
    expect(call.answer).toBe(true);
  });

  // Bug: the step runs in a frame that is not drawn, so the GPU works while nothing is submitted, out of the budget.
  it("uploads only in a drawn frame", async () => {
    const mock = await uploading({ uploads: 1 });
    const [texture] = loose(1);
    const init = vi.spyOn(system(mock), "initSource");

    // Queued as `upload` queues it, without the frame it asks for.
    mock.ctx.state.sync.upload.queue.push(sourceOf(texture) as never);
    frame(mock);

    expect(init).not.toHaveBeenCalled();

    mock.modules.demand.request();
    frame(mock);

    expect(init).toHaveBeenCalledTimes(1);
  });

  // Bug: a frame that uploaded (~9 ms of GPU on the A26) counted as a sample of the adaptive rate and could lower it.
  it("tells time a frame that uploaded is no sample of the adaptive rate", async () => {
    const mock = await uploading({ uploads: 1 });
    const [texture] = loose(1);

    mock.ctx.state.sync.upload.queue.push(sourceOf(texture) as never);
    mock.modules.demand.request();
    frame(mock);

    expect(mock.time.frameProbed).toHaveBeenCalledTimes(1);

    mock.modules.demand.request();
    frame(mock);

    expect(mock.time.frameProbed).toHaveBeenCalledTimes(1);
  });
});
