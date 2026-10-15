/**
 * @file Root integration — the page of the render-on-demand tests. Not a test. The engine's
 * renderer runs for real over Pixi's own display objects (`stagePixi`: the real module, only the
 * `Application` stands in for the GPU and counts its draws), on the fake DOM of the renderer's own
 * tests, and the tree oracle reads every frame: a frame skipped while the screen differs from the
 * last drawn one fails the test. Nothing here knows Pixi's internals.
 */
import { readFile } from "node:fs/promises";
import * as pixi from "pixi.js";
import type { Assets, Renderer } from "../../src";
import type { fakeClock } from "../../src/plugins/clock/fake";
import { type FakeDom, installFakeDom } from "../../src/plugins/renderer/__tests__/fake-dom";
import { type FrameOracle, watchFrames } from "../../src/plugins/renderer/__tests__/stage-oracle";
import { type StagePixi, stagePixi } from "../../src/plugins/renderer/__tests__/stage-pixi";

/** One frame of the page, in milliseconds. */
export const FRAME_MS = 16;

/** The page a screen app draws on. */
export type DrawnPage = {
  dom: FakeDom;
  stage: StagePixi;
  /**
   * The renderer seams of `game.screen()`. `warm: 0`: the warm-up of spec 27 asks for a drawn frame per probe while a
   * game loads, and these tests count the frames a still or a changing screen draws; `warm-game.test.ts` runs the
   * warm-up as a game ships it.
   */
  renderer: { mount: string; loadPixi: () => Promise<Renderer.PixiModule>; warm: number };
  /** Gives the mount another size and tells the observers, as a window resize does. */
  resize(width: number, height: number): void;
  /** Every size the renderer was resized to. */
  sizes(): Array<{ width: number; height: number }>;
};

/**
 * Opens the page: the fake DOM with a mount of the given size, and the real Pixi module.
 *
 * @param width - CSS width of the mount.
 * @param height - CSS height of the mount.
 * @param options - With `builds: true` every render runs Pixi's render group system, so a dev build counts Pixi's
 *   instruction rebuilds (spec 26 R2.3).
 * @param options.builds - True to run Pixi's render group system on every render.
 * @returns The page.
 */
export function openPage(width = 390, height = 844, options: { builds?: boolean } = {}): DrawnPage {
  const dom = installFakeDom({ width, height });
  const stage = stagePixi(options.builds === true ? { builds: true } : {});

  return {
    dom,
    stage,
    renderer: { mount: "#game", loadPixi: () => Promise.resolve(stage.module), warm: 0 },
    resize: (nextWidth, nextHeight) => {
      dom.mount.clientWidth = nextWidth;
      dom.mount.clientHeight = nextHeight;
      dom.mount.rect = { left: 0, top: 0, width: nextWidth, height: nextHeight };
      for (const observer of dom.observers) observer.fire();
    },
    sizes: () => stage.last().renderer.sizes
  };
}

/** The frame driver of a running screen app, with its oracle. */
export type Watched = {
  oracle: FrameOracle;
  /** Lets the promises run, then steps frames of 16 ms; answers how many were drawn. */
  frames(count?: number): Promise<number>;
  /** Steps frames one by one and answers, for each, whether it was drawn. */
  each(count: number): Promise<boolean[]>;
};

/**
 * Watches a started screen app on a page: every frame is stepped and checked by the oracle.
 *
 * @param app - The started app.
 * @param app.time - Its time plugin, for `step`.
 * @param app.time.step - Steps one frame.
 * @param page - The page it draws on.
 * @param clock - The fake clock the app runs on, advanced with every frame.
 * @returns The driver.
 */
export function watch(
  app: { time: { step(deltaMs: number): void } },
  page: DrawnPage,
  clock?: ReturnType<typeof fakeClock>
): Watched {
  const oracle = watchFrames(page.stage.last(), pixi);
  const each = async (count: number): Promise<boolean[]> => {
    const drawn: boolean[] = [];

    for (let frame = 0; frame < count; frame += 1) {
      const before = page.stage.renders();

      await new Promise(resolve => setTimeout(resolve, 0));
      clock?.advance(FRAME_MS);
      app.time.step(FRAME_MS);
      oracle.check();
      drawn.push(page.stage.renders() > before);
    }

    return drawn;
  };

  return {
    oracle,
    each,
    frames: async (count = 1) => {
      const drawn = await each(count);

      return drawn.filter(Boolean).length;
    }
  };
}

/**
 * The file seam over a folder of a fixture game, for real Pixi: every file is read from disk, an
 * image decodes to the size the manifest gives it (512 x 512 for a font page) and becomes a real
 * Pixi texture of that size with no pixels.
 *
 * @param folder - The folder the manifest's paths start from.
 * @param manifest - The manifest, for the sizes of the images.
 * @returns The io.
 */
export function diskIo(folder: URL, manifest: Assets.Manifest): Assets.AssetsIo {
  const sizes = new Map<string, { width: number; height: number }>();
  const decoded = new WeakMap<Blob, { width: number; height: number }>();

  for (const bundle of Object.values(manifest.bundles)) {
    for (const file of bundle.files) {
      if (file.path !== undefined && file.width !== undefined && file.height !== undefined) {
        sizes.set(file.path, { width: file.width, height: file.height });
      }
    }
  }

  return {
    fetch: async url => {
      const path = url.replace(/^\//, "");
      const bytes = await readFile(new URL(path, folder));
      const blob = new Blob([bytes]);
      const text = bytes.toString("utf8");

      decoded.set(blob, sizes.get(path) ?? { width: 512, height: 512 });

      return {
        ok: true,
        status: 200,
        // eslint-disable-next-line unicorn/no-null -- a `Response` answers a missing header with null.
        headers: { get: () => null },
        json: () => Promise.resolve(JSON.parse(text) as unknown),
        blob: () => Promise.resolve(blob),
        text: () => Promise.resolve(text),
        arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer)
      };
    },
    decode: blob =>
      Promise.resolve(
        decoded.get(blob) ?? { width: 512, height: 512 }
      ) as unknown as Promise<Assets.DecodedImage>,
    createTexture: image => {
      const { width, height } = image as unknown as { width: number; height: number };

      return new pixi.Texture({
        source: new pixi.TextureSource({ width, height })
      }) as unknown as Assets.Texture;
    },
    sliceTexture: (page, frame) => {
      const source = (page as unknown as pixi.Texture).source;

      return new pixi.Texture({
        source,
        frame: new pixi.Rectangle(frame.x, frame.y, frame.width, frame.height)
      }) as unknown as Assets.Texture;
    },
    destroyTexture: texture => (texture as unknown as pixi.Texture).destroy()
  };
}
