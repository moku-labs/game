/**
 * @file The browser leg of the HUD under the veil (F147): `Overlay({ hud: "under" })` on the real Pixi and the real
 * GPU, in Chrome, on WebGPU and on WebGL (`?renderer=webgl`). The scene layer is filled with one colour, an overlay in
 * the `ui` layer with `dim: 0.82, dimColor: 0x1e161a` is a bright panel away from the HUD, and the HUD layer holds an
 * opaque white square. With `hud: "under"` the square's pixels are white under the veil, `c·(1−a) + d·a`, the scene is
 * veiled the same way and the panel stays bright; with `"all"` the square is white again; with `"under"` once more it
 * is veiled again. The canvas is read from the browser's screenshot. Not a vitest file:
 * `bun tests/visual/hud-under.visual.ts`. It bundles `hud-under/page.ts` with the flags of a dev page, serves it, and
 * exits 1 when a run fails.
 */
import sharp from "sharp";
import type { OverlayValue } from "../../src/index";
import { launchChrome, loadChromium } from "../../src/visual/leg-browser";
import type { ChromeContext, ChromePage } from "../../src/visual/types";
import {
  DIM,
  DIM_COLOR,
  type HudUnderPage,
  LONG,
  PANEL,
  PANEL_COLOR,
  SCENE_COLOR,
  SIDE,
  SQUARE
} from "./hud-under/page";

/** The flags of a dev page. */
const DEV = {
  __MOKU_GAME_DEV__: "true",
  __MOKU_GAME_AGENT__: "true",
  __MOKU_GAME_CONTROL__: "true"
};

/** The backends a run asks for. */
const RENDERERS = ["webgpu", "webgl"] as const;

/** How far a channel may stand from the colour it should have: 8-bit rounding of the picture and the blend. */
const SLACK = 4;

/** One pixel: red, green, blue. */
type Rgb = [number, number, number];

/** The three places the leg reads, CSS px: the HUD square, the panel, and the scene away from both. */
const SPOTS = {
  square: { x: SQUARE.x + SQUARE.side / 2, y: SQUARE.y + SQUARE.side / 2 },
  panel: { x: PANEL.x + PANEL.width / 2, y: PANEL.y + PANEL.height / 2 },
  scene: { x: 400, y: 250 }
} as const;

/** The pixels of the three places. */
type Spots = Record<keyof typeof SPOTS, Rgb>;

/** A Playwright page as this leg uses it: the runner's calls, and the screenshot of the viewport, the canvas alone. */
type ShotPage = ChromePage & { screenshot(): Promise<Buffer> };

/**
 * The channels of a colour.
 *
 * @param color - 0xRRGGBB.
 * @returns Red, green, blue.
 * @example
 * ```ts
 * rgbOf(0x1e161a); // [30, 22, 26]
 * ```
 */
function rgbOf(color: number): Rgb {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/**
 * A colour under the veil: each channel `c·(1−a) + d·a`.
 *
 * @param color - What is under the veil.
 * @returns The colour the veil leaves.
 * @example
 * ```ts
 * veiled([255, 255, 255]); // ≈ [70.5, 63.94, 67.22]
 * ```
 */
function veiled(color: Rgb): Rgb {
  const dim = rgbOf(DIM_COLOR);

  return [0, 1, 2].map(
    channel => (color[channel] ?? 0) * (1 - DIM) + (dim[channel] ?? 0) * DIM
  ) as Rgb;
}

/**
 * The pixels of the three places, from a screenshot of the canvas.
 *
 * @param png - The screenshot.
 * @returns The pixels.
 */
async function spotsOf(png: Buffer): Promise<Spots> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  /**
   * One pixel at a place.
   *
   * @param spot - The place, CSS px.
   * @param spot.x - Its x.
   * @param spot.y - Its y.
   * @returns The pixel.
   */
  const at = (spot: { x: number; y: number }): Rgb => {
    const index =
      (Math.round((spot.y * info.height) / LONG) * info.width +
        Math.round((spot.x * info.width) / SIDE)) *
      3;

    return [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
  };

  return { square: at(SPOTS.square), panel: at(SPOTS.panel), scene: at(SPOTS.scene) };
}

/**
 * Writes the overlay's `hud` and reads the three places from a screenshot of the viewport: the canvas fills it.
 *
 * @param page - The page.
 * @param mode - The `hud` of the overlay.
 * @returns The pixels.
 */
async function switchTo(page: ShotPage, mode: OverlayValue["hud"]): Promise<Spots> {
  await page.evaluate(
    async value => (Reflect.get(globalThis, "hudUnder") as HudUnderPage).hud(value),
    mode
  );

  return spotsOf(await page.screenshot());
}

/**
 * The problems of one place, in words; empty when every channel is within `SLACK` of the colour it should have.
 *
 * @param label - What is read, for the message.
 * @param pixel - The pixel read.
 * @param wanted - The colour it should have.
 * @returns The problems.
 */
function off(label: string, pixel: Rgb, wanted: Rgb): string[] {
  if (pixel.every((channel, index) => Math.abs(channel - (wanted[index] ?? 0)) <= SLACK)) return [];

  return [
    `${label}: rgb(${pixel.join(", ")}), not rgb(${wanted.map(channel => Math.round(channel)).join(", ")})`
  ];
}

/**
 * The problems of one read: the square veiled or white, the scene veiled, the panel bright.
 *
 * @param mode - The `hud` the read was taken with.
 * @param spots - The pixels.
 * @returns The problems.
 */
function problemsOf(mode: "under" | "all", spots: Spots): string[] {
  const white: Rgb = [255, 255, 255];

  return [
    ...off(`${mode}: the HUD square`, spots.square, mode === "under" ? veiled(white) : white),
    ...off(`${mode}: the scene`, spots.scene, veiled(rgbOf(SCENE_COLOR))),
    ...off(`${mode}: the panel`, spots.panel, rgbOf(PANEL_COLOR))
  ];
}

/**
 * Reads the three places with the overlay's `hud` written under, all and under again: the problems of the reads.
 *
 * @param page - The page, its scene up.
 * @param reads - Where the reads go, for the line of the run.
 * @returns The problems.
 */
async function readModes(page: ShotPage, reads: Array<[string, Spots]>): Promise<string[]> {
  const problems: string[] = [];

  for (const mode of ["under", "all", "under"] as const) {
    const spots = await switchTo(page, mode);

    reads.push([mode, spots]);
    problems.push(...problemsOf(mode, spots));
  }

  return problems;
}

/**
 * Runs the leg on one backend: opens the page, checks it drew with that backend, reads the three modes, and prints one
 * line.
 *
 * @param context - The browser context.
 * @param url - The page's address.
 * @param renderer - The backend asked for.
 * @returns True when the run found no problem.
 */
async function runRenderer(
  context: ChromeContext,
  url: string,
  renderer: (typeof RENDERERS)[number]
): Promise<boolean> {
  // The context is Playwright's: its pages take a screenshot, which the runner's structural type leaves out.
  const page = (await context.newPage()) as ShotPage;
  const reads: Array<[string, Spots]> = [];
  const problems: string[] = [];

  try {
    await page.goto(`${url}${renderer === "webgl" ? "?renderer=webgl" : ""}`);
    await page.waitForFunction(() => "hudUnder" in globalThis, undefined, { timeout: 60_000 });

    const answer = (await page.evaluate(() => {
      const value = Reflect.get(globalThis, "hudUnder") as HudUnderPage | { error: string };

      return "error" in value ? value : { backend: value.backend };
    }, undefined)) as { backend: string } | { error: string };

    if ("error" in answer) {
      problems.push(answer.error);

      return false;
    }

    if (answer.backend !== renderer) problems.push(`drew with ${answer.backend}`);
    problems.push(...(await readModes(page, reads)));

    return problems.length === 0;
  } finally {
    console.log(
      `${renderer}: ${problems.length === 0 ? "ok" : "FAIL"}`,
      JSON.stringify(reads),
      problems.join("; ")
    );
    await page.close();
  }
}

// Build the page: the leg's own bundle of `hud-under/page.ts`, with the flags of a dev page.
const built = await Bun.build({
  entrypoints: [new URL("hud-under/page.ts", import.meta.url).pathname],
  define: DEV,
  target: "browser"
});
const [output] = built.outputs;

if (!built.success || output === undefined) {
  throw new Error(`The page did not bundle.\n  ${built.logs.map(String).join(" ")}.`);
}

// Serve it: the bundle at /page.js, an empty page around it everywhere else.
const script = await output.text();
const server = Bun.serve({
  port: 0,
  fetch: request =>
    new URL(request.url).pathname === "/page.js"
      ? new Response(script, { headers: { "content-type": "text/javascript" } })
      : new Response(
          '<!doctype html><html><body style="margin:0;background:#000"><script type="module" src="/page.js"></script></body></html>',
          { headers: { "content-type": "text/html" } }
        )
});
const browser = await launchChrome(await loadChromium(), undefined);
const context = await browser.newContext({
  viewport: { width: SIDE, height: LONG },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false
});
let failed = 0;

// Run each renderer in turn; the browser and the server go whatever happens.
try {
  for (const renderer of RENDERERS) {
    if (!(await runRenderer(context, server.url.href, renderer))) failed += 1;
  }
} finally {
  await browser.close();
  await server.stop(true);
}

process.exitCode = failed === 0 ? 0 : 1;
