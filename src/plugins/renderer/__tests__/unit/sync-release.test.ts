import * as pixi from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refillImages, releaseStep } from "../../sync/release";
import { createSyncState } from "../../sync/state";
import { createTexture, destroyTexture } from "../../sync/textures";
import type { SyncCtx, TextureReload } from "../../sync/types";

// ---------------------------------------------------------------------------
// F189: a decoded ImageBitmap lived next to its GPU copy for the life of the texture. On an iPhone 16 Pro Max the
// bitmaps were ~440 MB of a 1671 MB WebContent footprint, and iOS ended the page at 2048 MB. Real pixi.js module,
// no GPU: the host says which sources Pixi has on the GPU.
// ---------------------------------------------------------------------------

/** A decoded image as Pixi's `ImageSource` recognizes it, counting its `close` calls. */
class StubBitmap {
  public readonly width = 4;
  public readonly height = 4;
  public closed = 0;

  /** Counts the free. */
  public close(): void {
    this.closed += 1;
  }
}

/** A 1x1 canvas, as the browser makes it. */
class StubCanvas {
  public constructor(
    public readonly width: number,
    public readonly height: number
  ) {}

  /**
   * Answers a context, as a canvas does.
   *
   * @returns A stand-in context.
   */
  public getContext(): object {
    return {};
  }
}

beforeEach(() => {
  vi.stubGlobal("ImageBitmap", StubBitmap);
  vi.stubGlobal("OffscreenCanvas", StubCanvas);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * A sync context over the real Pixi module, on a device that draws; `uploaded` holds what Pixi has on the GPU.
 *
 * @returns The context and the set of uploaded sources.
 */
function drawing(): {
  sctx: SyncCtx;
  uploaded: Set<pixi.TextureSource>;
  warn: ReturnType<typeof vi.fn>;
} {
  const uploaded = new Set<pixi.TextureSource>();
  const warn = vi.fn();
  const sctx = {
    ctx: { state: { sync: createSyncState({ nineSlice: false }) }, log: { warn } },
    deps: {
      host: {
        pixi: () => pixi,
        ready: () => true,
        onGpu: (source: pixi.TextureSource) => uploaded.has(source)
      }
    }
  } as unknown as SyncCtx;

  return { sctx, uploaded, warn };
}

/**
 * A reload that answers new stub bitmaps, counting its calls.
 *
 * @returns The reload and the bitmaps it made.
 */
function reloader(): { reload: TextureReload; made: StubBitmap[] } {
  const made: StubBitmap[] = [];
  const reload = vi.fn(async () => {
    const bitmap = new StubBitmap();

    made.push(bitmap);

    return bitmap as unknown as ImageBitmap;
  });

  return { reload, made };
}

describe("freeing the decoded image after the upload (F189)", () => {
  // Bug: every texture keeps its decoded bitmap next to its GPU copy, twice the memory on WebKit.
  it("closes the bitmap once Pixi has the source on the GPU, and gives the source a 1x1 stand-in", () => {
    const { sctx, uploaded } = drawing();
    const bitmap = new StubBitmap();
    const texture = createTexture(sctx, bitmap as unknown as ImageBitmap, {
      reload: reloader().reload
    });

    uploaded.add(texture.source);
    releaseStep(sctx);

    expect(bitmap.closed).toBe(1);
    expect(texture.source.resource).toBeInstanceOf(StubCanvas);
    expect((texture.source.resource as StubCanvas).width).toBe(1);
    // The texture keeps its own size: only what a later upload reads changed.
    expect(texture.source.pixelWidth).toBe(4);
  });

  // Bug: closing before the upload: Pixi uploads an empty bitmap and the texture is blank (or WebGPU throws).
  it("keeps the bitmap of a source Pixi has not uploaded yet, and frees it after a later upload", () => {
    const { sctx, uploaded } = drawing();
    const bitmap = new StubBitmap();
    const texture = createTexture(sctx, bitmap as unknown as ImageBitmap, {
      reload: reloader().reload
    });

    releaseStep(sctx);

    expect(bitmap.closed).toBe(0);
    expect(texture.source.resource).toBe(bitmap);

    uploaded.add(texture.source);
    releaseStep(sctx);
    releaseStep(sctx);

    expect(bitmap.closed).toBe(1);
  });

  // Bug: a texture with no way back is freed, and a lost device leaves it blank forever.
  it("never closes the bitmap of a texture made without a reload", () => {
    const { sctx, uploaded } = drawing();
    const bitmap = new StubBitmap();
    const texture = createTexture(sctx, bitmap as unknown as ImageBitmap);

    uploaded.add(texture.source);
    releaseStep(sctx);

    expect(bitmap.closed).toBe(0);
    expect(texture.source.resource).toBe(bitmap);
  });

  // Bug: a bundle unloaded before its first draw leaves its bitmaps to the collector, which WebKit runs late.
  it("closes the bitmap of a texture destroyed before its upload, and once only", () => {
    const { sctx } = drawing();
    const state = sctx.ctx.state.sync;
    const bitmap = new StubBitmap();
    const texture = createTexture(sctx, bitmap as unknown as ImageBitmap, {
      reload: reloader().reload
    });

    destroyTexture(state, texture);
    releaseStep(sctx);

    expect(bitmap.closed).toBe(1);
    expect(state.release.pending).toEqual([]);
    expect(state.release.reloads.size).toBe(0);
  });

  // Bug: a slice of an atlas page frees the page's bitmap while the page still waits for its upload.
  it("leaves the page's bitmap when a slice of it is destroyed", () => {
    const { sctx } = drawing();
    const state = sctx.ctx.state.sync;
    const bitmap = new StubBitmap();
    const page = createTexture(sctx, bitmap as unknown as ImageBitmap, {
      reload: reloader().reload
    });
    const slice = new pixi.Texture({ source: page.source, frame: new pixi.Rectangle(0, 0, 2, 2) });

    state.slices.add(slice);
    destroyTexture(state, slice);

    expect(bitmap.closed).toBe(0);
    expect(state.release.reloads.has(page.source)).toBe(true);
  });
});

describe("a lost device and the freed textures (F189)", () => {
  // Bug: after a lost device the freed textures upload the 1x1 stand-in: the game draws transparent pictures.
  it("reads every freed texture from its file again, into the same source, and frees it after its next upload", async () => {
    const { sctx, uploaded } = drawing();
    const { reload, made } = reloader();
    const texture = createTexture(sctx, new StubBitmap() as unknown as ImageBitmap, { reload });

    uploaded.add(texture.source);
    releaseStep(sctx);
    // A new device holds nothing.
    uploaded.clear();

    const update = vi.spyOn(texture.source, "update");

    await refillImages(sctx);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(texture.source.resource).toBe(made[0]);
    expect(update).toHaveBeenCalledTimes(1);

    uploaded.add(texture.source);
    releaseStep(sctx);

    expect(made[0]?.closed).toBe(1);
  });

  // Bug: a restore with nothing freed waits for a promise and the renderer draws a frame late.
  it("answers nothing to wait for when no texture was freed", () => {
    const { sctx } = drawing();

    createTexture(sctx, new StubBitmap() as unknown as ImageBitmap, { reload: reloader().reload });

    expect(refillImages(sctx)).toBeUndefined();
  });

  // Bug: one missing file rejects the restore, and the device never draws again.
  it("logs a file that fails and keeps the texture transparent", async () => {
    const { sctx, uploaded, warn } = drawing();
    const reload = vi.fn(async (): Promise<ImageBitmap> => {
      throw new Error("offline");
    });
    const texture = createTexture(sctx, new StubBitmap() as unknown as ImageBitmap, { reload });

    uploaded.add(texture.source);
    releaseStep(sctx);

    await expect(refillImages(sctx)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("renderer:reload-failed", expect.anything());
    expect(texture.source.resource).toBeInstanceOf(StubCanvas);
  });

  // Bug: a texture destroyed while its file is read takes the new bitmap back into a dead source, never closed.
  it("closes the new image of a texture destroyed while its file was read", async () => {
    const { sctx, uploaded } = drawing();
    const { reload, made } = reloader();
    const texture = createTexture(sctx, new StubBitmap() as unknown as ImageBitmap, { reload });

    uploaded.add(texture.source);
    releaseStep(sctx);

    const filling = refillImages(sctx);

    destroyTexture(sctx.ctx.state.sync, texture);
    await filling;

    expect(made[0]?.closed).toBe(1);
  });
});
