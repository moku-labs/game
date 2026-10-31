import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createSyncState } from "../../sync/state";
import { createTexture, destroyTexture } from "../../sync/textures";
import type { CreateTextureOptions, SyncCtx } from "../../sync/types";
import { uploadStep, uploadTextures } from "../../sync/upload";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU: what `destroyTexture`
// does to the bind groups Pixi keeps. Pixi 8.22 caches the bind group of every
// batch in a module map that is never emptied, and the texture system keeps one
// per texture a particle container drew. Each of them listens to `change` on
// the source and on its style, and warns when one of the two is destroyed.
// ---------------------------------------------------------------------------

/** The texture slots of a batch bind group on a common device. */
const SLOTS = 16;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Makes a texture over a source of its own, as `textures.create` does for a loose file.
 *
 * @returns The texture.
 */
function loose(): pixi.Texture {
  return new pixi.Texture({ source: new pixi.TextureSource({ width: 4, height: 4 }) });
}

/**
 * Does to a texture what drawing does in Pixi: the batcher caches a bind group over its source,
 * also one with a neighbour in the same batch, and the texture system keeps one of its own.
 *
 * @param texture - The texture a frame drew.
 * @returns The three bind groups that hold its source now.
 */
function draw(texture: pixi.Texture): pixi.BindGroup[] {
  const neighbour = loose();

  return [
    pixi.getTextureBatchBindGroup([texture.source], 1, SLOTS),
    pixi.getTextureBatchBindGroup([neighbour.source, texture.source], 2, SLOTS),
    new pixi.BindGroup({ 0: texture.source, 1: texture.source.style })
  ];
}

/**
 * Catches the console, where Pixi writes its warnings.
 *
 * @returns The spy.
 */
function quiet(): MockInstance<typeof console.warn> {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

/**
 * Counts the `[BindGroup]` warnings Pixi wrote.
 *
 * @param spy - The spy on `console.warn`.
 * @returns How many calls carried one.
 */
function bindGroupWarnings(spy: MockInstance<typeof console.warn>): number {
  return spy.mock.calls.filter(call => call.some(part => String(part).includes("[BindGroup]")))
    .length;
}

describe("destroying a texture Pixi drew", () => {
  it("warns when Pixi destroys it on its own: the reason for the fix", () => {
    const spy = quiet();
    const texture = loose();

    draw(texture);
    texture.destroy(true);

    // The CI pin: when a Pixi release stops warning here, `destroyTexture` can stop removing
    // the listeners. How many warnings there are is Pixi's business.
    expect(bindGroupWarnings(spy)).toBeGreaterThan(0);
  });

  it("prints no bind group warning through destroyTexture", () => {
    const spy = quiet();
    const state = createSyncState({ nineSlice: false });
    const texture = loose();
    const source = texture.source;

    draw(texture);
    destroyTexture(state, texture);

    expect(bindGroupWarnings(spy)).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(texture.destroyed).toBe(true);
    expect(source.destroyed).toBe(true);
  });

  it("is quiet on a later destroy too, when other textures were drawn since", () => {
    const spy = quiet();
    const state = createSyncState({ nineSlice: false });
    const old = loose();

    draw(old);
    // The frames after a hot swap draw the new texture: the cache still holds the old source.
    for (let frame = 0; frame < 3; frame += 1) draw(loose());
    destroyTexture(state, old);

    expect(bindGroupWarnings(spy)).toBe(0);
  });

  it("leaves the listeners of a source that stays: a slice frees only its wrapper", () => {
    const spy = quiet();
    const state = createSyncState({ nineSlice: false });
    const page = loose();
    const slice = new pixi.Texture({ source: page.source, frame: new pixi.Rectangle(0, 0, 2, 2) });

    state.slices.add(slice);
    draw(slice);

    const listeners = page.source.listenerCount("change");
    const styleListeners = page.source.style.listenerCount("change");

    destroyTexture(state, slice);

    // The bind groups listen to the source and to its style, before the slice went and after.
    expect(listeners).toBeGreaterThan(0);
    expect(styleListeners).toBeGreaterThan(0);
    expect(page.source.listenerCount("change")).toBe(listeners);
    expect(page.source.style.listenerCount("change")).toBe(styleListeners);
    expect(slice.destroyed).toBe(true);
    expect(page.source.destroyed).toBe(false);
    expect(bindGroupWarnings(spy)).toBe(0);

    // The page frees the source the slices shared, as quietly.
    destroyTexture(state, page);

    expect(page.destroyed).toBe(true);
    expect(bindGroupWarnings(spy)).toBe(0);
  });

  it("frees a texture once, however often it is asked", () => {
    const spy = quiet();
    const state = createSyncState({ nineSlice: false });
    const texture = loose();

    draw(texture);
    destroyTexture(state, texture);

    expect(() => destroyTexture(state, texture)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});

/** A decoded image as Pixi's `ImageSource` recognizes it, without a browser. */
class StubBitmap {
  public readonly width = 336;
  public readonly height = 288;

  /** Frees nothing: there are no pixels. */
  public close(): void {
    // A stub has no pixels to free.
  }
}

/**
 * The sync context `createTexture` reads: a ready host over the real Pixi module.
 *
 * @returns The context.
 */
function readyHost(): SyncCtx {
  return { deps: { host: { pixi: () => pixi, ready: () => true } } } as unknown as SyncCtx;
}

describe("creating a texture with the real Pixi", () => {
  it("hands `mips` to Pixi as autoGenerateMipmaps through the public options form", () => {
    vi.stubGlobal("ImageBitmap", StubBitmap);

    const bitmap = new StubBitmap() as unknown as ImageBitmap;
    const mipped = createTexture(readyHost(), bitmap, { mips: true });
    const plain = createTexture(readyHost(), new StubBitmap() as unknown as ImageBitmap);

    expect(mipped.source).toBeInstanceOf(pixi.ImageSource);
    expect(mipped.source.resource).toBe(bitmap);
    expect(mipped.source.autoGenerateMipmaps).toBe(true);
    expect(plain.source.autoGenerateMipmaps).toBe(false);

    mipped.destroy(true);
    plain.destroy(true);
  });
});

// ---------------------------------------------------------------------------
// The same real module and Pixi's real collector, on a source with a stand-in GPU copy (F129): the
// A Memory Missing board warmed 218 MiB, and a minute later 166 MiB of it had left the GPU with no
// unload event, under the budget, so the next screen uploaded them in its frames.
// ---------------------------------------------------------------------------

/** Stands in for a decoded file: Pixi makes an `ImageSource` of an `ImageBitmap`. */
class FakeBitmap {
  public readonly width = 4;
  public readonly height = 4;
}

/** The renderer id the stand-in GPU copy is filed under. */
const RENDERER_UID = 1;

/**
 * A sync context over the real Pixi module, on a device that draws.
 *
 * @param initSource - What the host does with a source.
 * @returns The context.
 */
function drawing(initSource: (source: pixi.TextureSource) => void = vi.fn()): SyncCtx {
  return {
    ctx: {
      state: { sync: createSyncState({ nineSlice: false }) },
      config: { uploads: 1 },
      log: { warn: vi.fn() }
    },
    deps: {
      host: { pixi: () => pixi, ready: () => true, initSource },
      demand: { request: vi.fn() }
    }
  } as unknown as SyncCtx;
}

/**
 * Puts a stand-in GPU copy on a source, and hands the source to Pixi's collector the way the
 * texture system does at an upload.
 *
 * @param gc - The collector.
 * @param source - The source.
 * @returns The stand-in, whose `destroy` tells that the copy left the GPU.
 */
function onGpu(gc: pixi.GCSystem, source: pixi.TextureSource): { destroy: MockInstance } {
  const copy = { destroy: vi.fn() };

  (source._gpuData as Record<number, unknown>)[RENDERER_UID] = copy;
  gc.addResource(source, "resource");

  return copy;
}

/**
 * Pixi's collector with its timer off, for which everything is unused at once.
 *
 * @returns The collector.
 */
function impatientCollector(): pixi.GCSystem {
  const gc = new pixi.GCSystem({ scheduler: {}, tick: 0 } as never);

  gc.init({ gcActive: false, gcMaxUnusedTime: 0, gcFrequency: 1 });

  return gc;
}

describe("a loaded texture and Pixi's collector (F129)", () => {
  it("collects a plain image source: the reason for the fix", () => {
    vi.stubGlobal("ImageBitmap", FakeBitmap);

    const gc = impatientCollector();
    const texture = pixi.Texture.from(new FakeBitmap() as unknown as ImageBitmap);
    const copy = onGpu(gc, texture.source);

    gc.run();

    // The CI pin: when a Pixi release stops collecting here, `createTexture` can stop opting out.
    expect(copy.destroy).toHaveBeenCalledTimes(1);
  });

  // Bug: a warmed bundle leaves the GPU a minute later and its screen uploads it in its frames.
  it.each<[string, CreateTextureOptions | undefined]>([
    ["plain", undefined],
    ["with mips and borders", { mips: true, nine: [1, 1, 1, 1] }]
  ])("never collects a source of `create` (%s)", (_name, options) => {
    vi.stubGlobal("ImageBitmap", FakeBitmap);

    const gc = impatientCollector();
    const bitmap = new FakeBitmap() as unknown as ImageBitmap;
    const texture = createTexture(drawing(), bitmap, options);
    const copy = onGpu(gc, texture.source);

    gc.run();

    expect(copy.destroy).not.toHaveBeenCalled();
  });

  // Bug: with the collector off for the source nothing frees it, and the budget counts memory that stays.
  it("frees the GPU copy through `destroyTexture`, which is what `unloadBundle` calls", () => {
    vi.stubGlobal("ImageBitmap", FakeBitmap);

    const sctx = drawing();
    const texture = createTexture(sctx, new FakeBitmap() as unknown as ImageBitmap);
    const copy = onGpu(impatientCollector(), texture.source);

    destroyTexture(sctx.ctx.state.sync, texture);

    expect(copy.destroy).toHaveBeenCalledTimes(1);
  });

  // Bug: `upload` answers true with nothing on the GPU, so the screen uploads in its frames all the same.
  it("uploads a source again after it left the GPU", async () => {
    const initSource = vi.fn();
    const sctx = drawing(initSource);
    const texture = loose();

    const first = uploadTextures(sctx, [texture]);

    uploadStep(sctx);
    await first;
    texture.source.unload();

    const second = uploadTextures(sctx, [texture]);

    uploadStep(sctx);

    await expect(second).resolves.toBe(true);
    expect(initSource).toHaveBeenCalledTimes(2);
  });

  // Bug: forgetting too much: a source still on the GPU costs a frame of its queue at every warm.
  it("does not upload a source that stayed on the GPU", async () => {
    const initSource = vi.fn();
    const sctx = drawing(initSource);
    const texture = loose();

    const first = uploadTextures(sctx, [texture]);

    uploadStep(sctx);
    await first;

    await expect(uploadTextures(sctx, [texture])).resolves.toBe(true);
    expect(initSource).toHaveBeenCalledTimes(1);
  });
});
