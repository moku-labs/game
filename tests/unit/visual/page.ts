/**
 * @file Test helpers of the browser leg, with no browser: a fake image codec (a "PNG" or "WebP"
 * data URL whose bytes are the JSON of the pixels), a page that runs the page functions in this
 * process against the tiny game, and a fake `chromium` that hands out such pages.
 */
import { vi } from "vitest";
import { commands } from "../../../src/plugins/flow/doors/commands";
import { read } from "../../../src/plugins/flow/doors/read";
import { run } from "../../../src/plugins/flow/doors/run";
import { sources } from "../../../src/plugins/flow/doors/sources";
import type { RendererKind } from "../../../src/plugins/renderer/types";
import type {
  ChromeBrowser,
  ChromePage,
  Chromium,
  ContextOptions,
  LaunchOptions
} from "../../../src/visual/types";
import { createTinyGame } from "./game";

/** Pixels as the codec keeps them. */
export type Picture = { width: number; height: number; data: number[] };

/** The RGBA of every pixel of a picture the helpers draw, unless a test names its own. */
const plain = (): readonly number[] => [10, 20, 30, 255];

/**
 * Writes a picture as a fake data URL of a type: its bytes are the JSON of the pixels.
 *
 * @param type - The MIME type, such as `"image/png"`.
 * @param width - Pixels across.
 * @param height - Pixels down.
 * @param pixel - The RGBA of a pixel by its index.
 * @returns The data URL.
 */
function pictureUrl(
  type: string,
  width: number,
  height: number,
  pixel: (index: number) => readonly number[]
): string {
  const data = Array.from({ length: width * height }, (_, index) => [...pixel(index)]).flat();

  return `data:${type};base64,${Buffer.from(JSON.stringify({ width, height, data })).toString("base64")}`;
}

/**
 * Writes a picture as a fake PNG data URL, the way the renderer captures one.
 *
 * @param width - Pixels across.
 * @param height - Pixels down.
 * @param pixel - The RGBA of a pixel by its index.
 * @returns The data URL.
 */
export function pngOf(
  width: number,
  height: number,
  pixel: (index: number) => readonly number[] = plain
): string {
  return pictureUrl("image/png", width, height, pixel);
}

/**
 * Writes a picture as a fake WebP data URL, the way a baseline holds one.
 *
 * @param width - Pixels across.
 * @param height - Pixels down.
 * @param pixel - The RGBA of a pixel by its index.
 * @returns The data URL.
 */
export function webpOf(
  width: number,
  height: number,
  pixel: (index: number) => readonly number[] = plain
): string {
  return pictureUrl("image/webp", width, height, pixel);
}

/**
 * Reads a fake data URL back, whatever its type.
 *
 * @param url - A data URL `pngOf`, `webpOf` or the fake canvas wrote.
 * @returns The picture.
 */
export function pictureOf(url: string): Picture {
  const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");

  return JSON.parse(bytes.toString("utf8")) as Picture;
}

/** The fake `ImageData` of the codec. */
class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number
  ) {}
}

/** The type the fake canvas encodes whatever it is asked for, when a test names one. */
const encoder: { only: string | undefined } = { only: undefined };

/** The fake `OffscreenCanvas` of the codec: one RGBA buffer, a 2D context over it. */
class FakeCanvas {
  pixels: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  getContext() {
    return {
      drawImage: (bitmap: Picture) => {
        this.pixels = Uint8ClampedArray.from(bitmap.data);
      },
      getImageData: (_x: number, _y: number, width: number, height: number) =>
        new FakeImageData(this.pixels, width, height),
      putImageData: (image: FakeImageData) => {
        this.pixels = image.data;
      }
    };
  }

  convertToBlob(options: { type?: string } = {}) {
    const picture = { width: this.width, height: this.height, data: [...this.pixels] };
    const type = encoder.only ?? options.type ?? "image/png";

    return Promise.resolve(new Blob([JSON.stringify(picture)], { type }));
  }
}

/**
 * Puts the fake codec in place of `createImageBitmap`, `OffscreenCanvas` and `ImageData`.
 * `vi.unstubAllGlobals()` takes it away.
 *
 * @param options - `encodes`: the one type the canvas encodes, the PNG of a browser with no WebP
 *   encoder; every type it is asked for by default.
 * @param options.encodes - The one type the canvas encodes.
 */
export function installCodec(options: { encodes?: string } = {}): void {
  encoder.only = options.encodes;
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => JSON.parse(await blob.text()));
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  vi.stubGlobal("ImageData", FakeImageData);
}

/** What the page game hands the renderer: the kind it reports and the picture it captures. */
export type PageGameOptions = {
  kind?: RendererKind;
  screen?: () => string | undefined;
  runGraph?: boolean;
};

/**
 * The frame of the browser in the page: a 40 Hz display, so a test tells the game time the
 * browser's frames move from the 1000/60 ms the leg steps.
 */
export const BROWSER_FRAME_MS = 25;

/** Runs one frame of the browser on the running page game, when one runs. */
let stepPageGame: (() => void) | undefined;

/**
 * Enters the page: puts in `requestAnimationFrame`, which runs one browser frame of the page
 * game per call, the way the time plugin's frame loop does: `BROWSER_FRAME_MS` of game time, and
 * none while the game is paused. The page is another realm in Chrome; here it shares the
 * process with the headless leg, whose app must never see a frame loop, so the page has frames
 * only while a call runs in it.
 *
 * @returns Leaves the page: takes `requestAnimationFrame` away.
 */
export function enterPage(): () => void {
  const step = stepPageGame;

  if (step === undefined) return () => {};

  Reflect.set(globalThis, "requestAnimationFrame", (callback: (time: number) => void) => {
    step();
    setTimeout(() => callback(0), 0);

    return 0;
  });

  return () => {
    Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  };
}

/**
 * Starts the tiny game as the dev page would: live, its graph running, `globalThis.game` and
 * `globalThis.doors` set, the dev flag on. The renderer reports `kind` and captures `screen`.
 * `enterPage()` gives it frames; `vi.unstubAllGlobals()` and the returned `stop` take it away.
 *
 * @param options - The renderer kind and the picture.
 * @returns The app, the page's game object and a stop.
 */
export async function startPageGame(options: PageGameOptions = {}) {
  const app = createTinyGame();

  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  app.flow.setMode("live");
  await app.start();

  if (options.runGraph !== false) app.flow.run().catch(() => {});

  const game = {
    ...app,
    renderer: {
      ...app.renderer,
      host: { ...app.renderer.host, kind: () => options.kind ?? "webgpu" },
      capture: () => Promise.resolve(options.screen === undefined ? pngOf(2, 2) : options.screen())
    }
  };

  vi.stubGlobal("game", game);
  vi.stubGlobal("doors", { read, run, sources, commands });
  stepPageGame = () => {
    if (!app.time.isPaused()) app.time.step(BROWSER_FRAME_MS);
  };

  const stop = async () => {
    stepPageGame = undefined;
    await app.stop();
  };

  return { app, game, stop };
}

/** What the fake browser saw: launches, contexts, pages, scripts, URLs, load waits and closes. */
export type BrowserLog = {
  launches: LaunchOptions[];
  contexts: ContextOptions[];
  scripts: string[];
  urls: string[];
  loads: string[];
  pagesClosed: number;
  browsersClosed: number;
};

/** How the fake browser misbehaves; `idle: false` is a page that never stops loading. */
export type BrowserFaults = {
  launch?: (options: LaunchOptions) => string | undefined;
  goto?: string;
  ready?: boolean;
  idle?: boolean;
  evaluate?: (fn: unknown) => string | undefined;
};

/**
 * Builds a page that runs every page function in this process, as Playwright would run it in
 * the page.
 *
 * @param log - Where the calls go.
 * @param faults - How it misbehaves.
 * @returns The page.
 */
export function inProcessPage(log: BrowserLog, faults: BrowserFaults = {}): ChromePage {
  return {
    addInitScript: script => {
      log.scripts.push(script.content);

      return Promise.resolve();
    },
    goto: url => {
      log.urls.push(url);

      return faults.goto === undefined
        ? Promise.resolve()
        : Promise.reject(new Error(`page.goto: ${faults.goto}\nCall log:\n  - navigating`));
    },
    waitForFunction: fn =>
      faults.ready !== false && fn()
        ? Promise.resolve()
        : Promise.reject(new Error("page.waitForFunction: Timeout 15000ms exceeded.")),
    waitForLoadState: state => {
      log.loads.push(state);

      return faults.idle === false
        ? Promise.reject(new Error("page.waitForLoadState: Timeout 15000ms exceeded."))
        : Promise.resolve();
    },
    evaluate: async (fn, arg) => {
      const failure = faults.evaluate?.(fn);

      if (failure !== undefined) {
        throw new Error(`page.evaluate: ${failure}\n    at eval (<anonymous>:1:1)`);
      }

      const leave = enterPage();

      try {
        return await fn(arg);
      } finally {
        leave();
      }
    },
    close: () => {
      log.pagesClosed += 1;

      return Promise.resolve();
    }
  };
}

/**
 * Builds a fake `chromium` whose browser hands out in-process pages.
 *
 * @param faults - How it misbehaves.
 * @returns The fake and what it saw.
 */
export function fakeChromium(faults: BrowserFaults = {}) {
  const log: BrowserLog = {
    launches: [],
    contexts: [],
    scripts: [],
    urls: [],
    loads: [],
    pagesClosed: 0,
    browsersClosed: 0
  };
  const browser: ChromeBrowser = {
    newContext: options => {
      log.contexts.push(options);

      return Promise.resolve({ newPage: () => Promise.resolve(inProcessPage(log, faults)) });
    },
    close: () => {
      log.browsersClosed += 1;

      return Promise.resolve();
    }
  };
  const chromium: Chromium = {
    launch: options => {
      log.launches.push(options);

      const failure = faults.launch?.(options);

      return failure === undefined ? Promise.resolve(browser) : Promise.reject(new Error(failure));
    }
  };

  return { chromium, log };
}
