import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api as RendererApi } from "../../../renderer/types";
import { browserDecode, browserFetch, createBrowserIo } from "../../browser";
import type { CreateTextureOptions, DecodedImage, Texture } from "../../types";

/** What the fake renderer recorded. */
type Recorded = {
  created: Array<{ image: DecodedImage; options: CreateTextureOptions | undefined }>;
  destroyed: Texture[];
  api: RendererApi;
};

/**
 * Builds a renderer whose texture registry only records what it was asked for.
 *
 * @returns The recordings and the API.
 */
function createRecordingRenderer(): Recorded {
  const created: Recorded["created"] = [];
  const destroyed: Texture[] = [];

  return {
    created,
    destroyed,
    api: {
      sync: {
        textures: {
          create: (image: DecodedImage, options?: CreateTextureOptions): Texture => {
            created.push({ image, options });

            return { id: `t${created.length}` } as unknown as Texture;
          },
          destroy: (texture: Texture): void => {
            destroyed.push(texture);
          }
        }
      }
    } as unknown as RendererApi
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserFetch", () => {
  it("passes the URL and the caller's signal to the global fetch", async () => {
    const calls: Array<{ url: string; signal: AbortSignal }> = [];

    vi.stubGlobal("fetch", async (url: string, init: { signal: AbortSignal }) => {
      calls.push({ url, signal: init.signal });

      return { ok: true, status: 200 };
    });

    const controller = new AbortController();
    const response = await browserFetch("/assets/manifest.json", { signal: controller.signal });

    expect(calls).toEqual([{ url: "/assets/manifest.json", signal: controller.signal }]);
    expect(response.status).toBe(200);
  });
});

describe("browserDecode", () => {
  it("hands the blob to createImageBitmap", async () => {
    const blob = new Blob(["png"]);
    const decoded = { width: 128 } as unknown as ImageBitmap;

    vi.stubGlobal("createImageBitmap", async (given: Blob) => {
      expect(given).toBe(blob);

      return decoded;
    });

    await expect(browserDecode(blob)).resolves.toBe(decoded);
  });
});

describe("createBrowserIo", () => {
  it("uses the browser pair for the network and the decode", () => {
    const io = createBrowserIo(createRecordingRenderer().api);

    expect(io.fetch).toBe(browserFetch);
    expect(io.decode).toBe(browserDecode);
  });

  it("makes a texture through the renderer, nine-slice borders and all", () => {
    const renderer = createRecordingRenderer();
    const io = createBrowserIo(renderer.api);
    const image = { width: 256 } as unknown as ImageBitmap;

    const texture = io.createTexture(image, { nine: [48, 48, 48, 48] });

    expect(renderer.created).toEqual([{ image, options: { nine: [48, 48, 48, 48] } }]);
    expect(texture).toEqual({ id: "t1" });
  });

  it("makes a plain texture when the file carries no borders", () => {
    const renderer = createRecordingRenderer();
    const io = createBrowserIo(renderer.api);
    const image = { width: 128 } as unknown as ImageBitmap;

    io.createTexture(image);

    expect(renderer.created).toEqual([{ image, options: undefined }]);
  });

  it("frees a texture through the renderer", () => {
    const renderer = createRecordingRenderer();
    const io = createBrowserIo(renderer.api);
    const texture = io.createTexture({ width: 1 } as unknown as ImageBitmap);

    io.destroyTexture(texture);

    expect(renderer.destroyed).toEqual([texture]);
  });
});
