import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stableJson } from "../../../src/visual/compare";
import { defineVisualTest } from "../../../src/visual/define";
import { launchChrome, loadChromium, runBrowserLeg } from "../../../src/visual/leg-browser";
import type { Pixels } from "../../../src/visual/page-script";
import { pageScript, pageStep } from "../../../src/visual/page-script";
import { resolveVisualOptions } from "../../../src/visual/run";
import type { Chromium, VisualSetup, VisualTestResult } from "../../../src/visual/types";
import { createTinyGame } from "./game";

// ---------------------------------------------------------------------------
// Opt-in (MOKU_VISUAL_BROWSER=1, a Chrome with WebGPU): the browser leg in a
// real Chrome, on a tiny page that keeps the page contract and draws a known
// canvas. `bun run test` runs no browser: this test skips with its reason.
// ---------------------------------------------------------------------------

/**
 * The tiny page: an 8x6 canvas in one colour, a game whose graph rests at Home and whose clock
 * the doors' `pause` and `step` hold and move, and doors whose `tap` on the key "paint" turns one
 * pixel red.
 */
const PAGE = `<!doctype html>
<canvas id="screen" width="8" height="6"></canvas>
<script>
  const canvas = document.getElementById("screen");
  const context = canvas.getContext("2d");
  context.fillStyle = "#3366cc";
  context.fillRect(0, 0, 8, 6);
  const model = { player: { coins: 0 }, session: {}, rng: { seed: 1 } };
  const clock = { elapsed: 83.2, paused: false };
  globalThis.game = {
    time: { snapshot: () => ({ elapsed: clock.elapsed }) },
    flow: { state: () => ({ path: "home", running: true, pending: { gate: "home" } }) },
    anim: { finishAll: () => {} },
    renderer: {
      host: { kind: () => (navigator.gpu === undefined ? "none" : "webgpu") },
      capture: async () => canvas.toDataURL("image/png")
    }
  };
  globalThis.doors = {
    sources: { position: "position", model: "model" },
    read: (game, source) => (source === "position" ? { path: "home" } : model),
    run: async (game, command, input) => ({ value: await command.run(game, input) }),
    commands: {
      pause: { run: () => { clock.paused = true; return true; } },
      step: { run: (game, input) => { clock.elapsed += input.frames * input.deltaMs; } },
      restore: {
        run: (game, input) => {
          if (!clock.paused || clock.elapsed !== 5000) throw new Error("Restored before the pause.");
          model.player = input.repro.player;
        }
      },
      tap: {
        run: (game, input) => {
          if (input.key !== "paint") throw new Error("No element with the key " + input.key + ".");
          context.fillStyle = "#ff0000";
          context.fillRect(2, 2, 1, 1);
        }
      }
    }
  };
</script>`;

/**
 * Serves the tiny page on a free port of this machine.
 *
 * @returns Its URL and a close.
 */
async function serve() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(PAGE);
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://localhost:${port}/`,
    close: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
      })
  };
}

/**
 * Tells whether the Chrome the leg launches by default has a WebGPU adapter on a page of `url`.
 *
 * @param chromium - The chromium of playwright-core.
 * @param url - A page of this machine: WebGPU needs a secure context.
 * @returns True when an adapter came.
 */
async function hasWebGpu(chromium: Chromium, url: string): Promise<boolean> {
  const browser = await launchChrome(chromium, undefined).catch(() => undefined);

  if (browser === undefined) return false;

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 520 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();

    await page.goto(url);

    return await page.evaluate(async () => {
      const gpu: { requestAdapter(): Promise<object | null> } | undefined = Reflect.get(
        navigator,
        "gpu"
      );

      return Boolean(await gpu?.requestAdapter());
    }, undefined);
  } finally {
    await browser.close();
  }
}

describe("the browser leg in a real Chrome", () => {
  it("writes the screen, finds it the same, then finds the one pixel a tap changed", async ctx => {
    ctx.skip(
      process.env.MOKU_VISUAL_BROWSER !== "1",
      "opt-in: run with MOKU_VISUAL_BROWSER=1 on a Mac with a WebGPU Chrome"
    );
    ctx.skip(
      /\bcov_\w+\(/u.test(String(pageStep)),
      "coverage instruments the page functions, so they cannot run in Chrome"
    );

    const server = await serve();
    const dir = await mkdtemp(path.join(tmpdir(), "moku-visual-chrome-"));

    try {
      ctx.skip(
        !(await hasWebGpu(await loadChromium(), server.url)),
        "no Chrome with WebGPU found on this machine"
      );

      const setup: VisualSetup = { app: createTinyGame, page: { url: server.url } };
      const run = resolveVisualOptions(setup, { argv: [], dir, pixels: true });
      const start = { player: { coins: 3 } };
      const plain = defineVisualTest("canvas", { start, steps: [{ checkpoint: "plain" }] });
      const painted = defineVisualTest("canvas", {
        start,
        steps: [{ tap: { key: "paint" } }, { checkpoint: "plain" }]
      });
      const headless: VisualTestResult[] = [
        {
          name: "canvas",
          checkpoints: [{ name: "plain", state: "same", describe: "same", pixels: "skipped" }]
        }
      ];
      const folder = path.join(dir, "canvas", "plain");

      await mkdir(folder, { recursive: true });
      await writeFile(
        path.join(folder, "state.json"),
        stableJson({ path: "home", player: { coins: 3 }, session: {}, rng: { seed: 1 } })
      );

      const first = await runBrowserLeg(setup, [plain], run, headless);
      const second = await runBrowserLeg(setup, [plain], run, headless);
      const third = await runBrowserLeg(setup, [painted], run, headless);

      expect(first[0]?.checkpoints[0]).toMatchObject({ state: "same", pixels: "written" });
      expect(second[0]?.checkpoints[0]).toEqual({
        name: "plain",
        state: "same",
        describe: "same",
        pixels: "same"
      });
      expect(third[0]?.checkpoints[0]).toEqual({
        name: "plain",
        state: "same",
        describe: "same",
        pixels: "different",
        pixelRatio: 1 / 48,
        verdict: "rendering"
      });

      for (const name of ["screen.webp", "screen.actual.webp", "screen.diff.webp"]) {
        const bytes = await readFile(path.join(folder, name));

        expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
        expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
      }
    } finally {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

/**
 * Runs in the page: encodes opaque pseudo-random pixels with the WebP encoder of the page script
 * and decodes them again, then counts the bytes that came back different. Random pixels do not
 * compress, so a lossy encoder could never bring them back.
 *
 * @param argument - The size of the picture and the seed of xorshift32.
 * @param argument.width - Pixels across.
 * @param argument.height - Pixels down.
 * @param argument.seed - The seed, not 0.
 * @returns The data URL prefix, the size it decoded to, the differing bytes and the bitstream.
 */
async function roundTrip(argument: { width: number; height: number; seed: number }) {
  const encode: (pixels: Pixels) => Promise<string> = Reflect.get(globalThis, "pageEncode");
  const decode: (url: string) => Promise<Pixels> = Reflect.get(globalThis, "pageDecode");
  const { width, height } = argument;
  const data = new Uint8ClampedArray(width * height * 4);
  let state = argument.seed;

  for (let at = 0; at < data.length; at += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[at] = at % 4 === 3 ? 255 : state & 255;
  }

  const url = await encode({ width, height, data });
  const back = await decode(url);
  const comma = url.indexOf(",");
  let differing = 0;

  for (const [at, value] of data.entries()) {
    if (back.data[at] !== value) differing += 1;
  }

  return {
    prefix: url.slice(0, comma + 1),
    width: back.width,
    height: back.height,
    differing,
    lossless: atob(url.slice(comma + 1)).includes("VP8L")
  };
}

describe("the WebP of the pixel leg in a real Chrome", () => {
  it("is lossless: opaque random pixels come back byte for byte", async ctx => {
    ctx.skip(
      process.env.MOKU_VISUAL_BROWSER !== "1",
      "opt-in: run with MOKU_VISUAL_BROWSER=1 on a Mac with a WebGPU Chrome"
    );
    ctx.skip(
      /\bcov_\w+\(/u.test(String(pageStep)),
      "coverage instruments the page functions, so they cannot run in Chrome"
    );

    const server = await serve();
    const browser = await launchChrome(await loadChromium(), undefined);

    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 520 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true
      });
      const page = await context.newPage();

      await page.addInitScript({ content: pageScript() });
      await page.goto(server.url);

      expect(
        await page.evaluate(roundTrip, { width: 257, height: 131, seed: 2_463_534_242 })
      ).toEqual({
        prefix: "data:image/webp;base64,",
        width: 257,
        height: 131,
        differing: 0,
        lossless: true
      });
    } finally {
      await browser.close();
      await server.close();
    }
  }, 60_000);
});
