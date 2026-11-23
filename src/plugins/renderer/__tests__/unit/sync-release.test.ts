import * as pixi from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseStep } from "../../sync/release";
import { createSyncState } from "../../sync/state";
import { createTexture, destroyTexture } from "../../sync/textures";
import type { SyncCtx } from "../../sync/types";

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
function drawing(): { sctx: SyncCtx; uploaded: Set<pixi.TextureSource> } {
  const uploaded = new Set<pixi.TextureSource>();
  const sctx = {
    ctx: { state: { sync: createSyncState({ nineSlice: false }) } },
    deps: {
      host: {
        pixi: () => pixi,
        ready: () => true,
        onGpu: (source: pixi.TextureSource) => uploaded.has(source),
        mark: () => undefined
      }
    }
  } as unknown as SyncCtx;

  return { sctx, uploaded };
}

/**
 * Makes a texture of a new stub bitmap.
 *
 * @param sctx - The sync context.
 * @returns The texture and its bitmap.
 */
function made(sctx: SyncCtx): { texture: pixi.Texture; bitmap: StubBitmap } {
  const bitmap = new StubBitmap();

  return { texture: createTexture(sctx, bitmap as unknown as ImageBitmap), bitmap };
}

describe("freeing the decoded image after the upload (F189)", () => {
  // Bug: every texture keeps its decoded bitmap next to its GPU copy, twice the memory on WebKit.
  it("closes the bitmap once Pixi has the source on the GPU, and gives the source a 1x1 stand-in", () => {
    const { sctx, uploaded } = drawing();
    const { texture, bitmap } = made(sctx);

    uploaded.add(texture.source);
    releaseStep(sctx);

    expect(bitmap.closed).toBe(1);
    expect(texture.source.resource).toBeInstanceOf(StubCanvas);
    expect((texture.source.resource as StubCanvas).width).toBe(1);
    // The texture keeps its own size: only what a later upload reads changed.
    expect(texture.source.pixelWidth).toBe(4);
    expect(sctx.ctx.state.sync.release.freed.has(texture.source)).toBe(true);
  });

  // Bug: closing before the upload: Pixi uploads an empty bitmap and the texture is blank (or WebGPU throws).
  it("keeps the bitmap of a source Pixi has not uploaded yet, and frees it after a later upload, once", () => {
    const { sctx, uploaded } = drawing();
    const { texture, bitmap } = made(sctx);

    releaseStep(sctx);

    expect(bitmap.closed).toBe(0);
    expect(texture.source.resource).toBe(bitmap);

    uploaded.add(texture.source);
    releaseStep(sctx);
    releaseStep(sctx);

    expect(bitmap.closed).toBe(1);
  });

  // Bug: a runtime without OffscreenCanvas closes the bitmap and leaves nothing a later upload can read.
  it("keeps the bitmap where no stand-in can be made", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);

    const { sctx, uploaded } = drawing();
    const { texture, bitmap } = made(sctx);

    uploaded.add(texture.source);
    releaseStep(sctx);

    expect(bitmap.closed).toBe(0);
    expect(texture.source.resource).toBe(bitmap);
  });

  // Bug: a bundle unloaded before its first draw leaves its bitmaps to the collector, which WebKit runs late.
  it("closes the bitmap of a texture destroyed before its upload, and forgets it", () => {
    const { sctx } = drawing();
    const state = sctx.ctx.state.sync;
    const { texture, bitmap } = made(sctx);

    destroyTexture(state, texture);
    releaseStep(sctx);

    expect(bitmap.closed).toBe(1);
    expect(state.release.pending).toEqual([]);
  });

  // Bug: a destroyed freed texture still counts, and a later loss reloads the page for nothing.
  it("forgets a freed texture that is destroyed", () => {
    const { sctx, uploaded } = drawing();
    const state = sctx.ctx.state.sync;
    const { texture, bitmap } = made(sctx);

    uploaded.add(texture.source);
    releaseStep(sctx);
    destroyTexture(state, texture);

    expect(state.release.freed.size).toBe(0);
    expect(bitmap.closed).toBe(1);
  });

  // Bug: a slice of an atlas page frees the page's bitmap while the page still waits for its upload.
  it("leaves the page's bitmap when a slice of it is destroyed", () => {
    const { sctx } = drawing();
    const state = sctx.ctx.state.sync;
    const { texture: page, bitmap } = made(sctx);
    const slice = new pixi.Texture({ source: page.source, frame: new pixi.Rectangle(0, 0, 2, 2) });

    state.slices.add(slice);
    destroyTexture(state, slice);

    expect(bitmap.closed).toBe(0);
    expect(state.release.pending).toEqual([page.source]);
  });
});
