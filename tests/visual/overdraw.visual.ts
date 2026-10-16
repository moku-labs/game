/**
 * @file The browser leg of the overdraw heat map (U6): the engine's `debug.overdraw` on the real Pixi and the real GPU,
 * in Chrome, on WebGPU and on WebGL (`?renderer=webgl`). Three white sprites with three tints stack from the left edge
 * (480, 320 and 160 CSS px wide, the whole 640 high): with the map on, the strip under one sprite is grey 1/16, the strip
 * under two is twice as bright and the strip under three three times, whatever the tints; with the map off again the
 * strips show the tints of the game. The canvas is read from the browser's screenshot: the map exists on the canvas
 * alone. Not a vitest file: `bun tests/visual/overdraw.visual.ts`. It bundles `overdraw/page.ts` with the flags of a
 * dev page, serves it, and exits 1 when a run fails.
 */
import sharp from "sharp";
import { launchChrome, loadChromium } from "../../src/visual/leg-browser";
import type { ChromePage } from "../../src/visual/types";
import { LONG, type OverdrawPage, SIDE } from "./overdraw/page";

/** The flags of a dev page: the heat map draws in dev and agent builds only. */
const DEV = {
  __MOKU_GAME_DEV__: "true",
  __MOKU_GAME_AGENT__: "true",
  __MOKU_GAME_CONTROL__: "true"
};

/** The backends a run asks for. */
const RENDERERS = ["webgpu", "webgl"] as const;

/** The grey one layer adds: 1/16 of 255. */
const LAYER = 255 / 16;

/** How far a channel may stand from the grey it should have: 8-bit rounding of three additions, and a little more. */
const SLACK = 4;

/** The middle of each strip, from the left: under three sprites, two, one. */
const STRIPS = [SIDE / 6, SIDE / 2, (SIDE * 5) / 6] as const;

/** One pixel: red, green, blue. */
type Rgb = [number, number, number];

/** A Playwright page as this leg uses it: the runner's calls, and the screenshot of the viewport, the canvas alone. */
type ShotPage = ChromePage & { screenshot(): Promise<Buffer> };

/**
 * The pixels at the middle height of the three strips of the canvas, from a screenshot of it.
 *
 * @param png - The screenshot of the canvas element.
 * @returns The three pixels, from the left.
 */
async function stripsOf(png: Buffer): Promise<Rgb[]> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const y = Math.round(info.height / 2);

  return STRIPS.map(x => {
    const at = (y * info.width + Math.round((x * info.width) / SIDE)) * 3;

    return [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
  });
}

/**
 * Switches the heat map of the page and reads the three strips of the canvas from a screenshot of the viewport: the
 * canvas fills it.
 *
 * @param page - The page.
 * @param on - True for the heat map.
 * @returns The three pixels, from the left.
 */
async function switchTo(page: ShotPage, on: boolean): Promise<Rgb[]> {
  await page.evaluate(
    async value => (Reflect.get(globalThis, "overdraw") as OverdrawPage).overdraw(value),
    on
  );

  return stripsOf(await page.screenshot());
}

/**
 * The problems of the heat map, in words; empty when the three strips are flat greys of 3, 2 and 1 layers.
 *
 * @param strips - The three pixels with the map on.
 * @returns The problems.
 */
function mapProblems(strips: readonly Rgb[]): string[] {
  const problems: string[] = [];

  for (const [index, [red, green, blue]] of strips.entries()) {
    const layers = 3 - index;
    const grey = layers * LAYER;

    if ([red, green, blue].some(channel => Math.abs(channel - grey) > SLACK)) {
      problems.push(
        `${layers} layers: rgb(${red}, ${green}, ${blue}), not grey ${Math.round(grey)}`
      );
    }
  }

  return problems;
}

/**
 * The problems of the game drawn again, in words: the strip under three sprites shows the top tint (blue), the strip
 * under one the bottom tint (red).
 *
 * @param strips - The three pixels with the map off.
 * @returns The problems.
 */
function gameProblems(strips: readonly Rgb[]): string[] {
  const [top, , bottom] = strips;
  const problems: string[] = [];

  if (top === undefined || !(top[2] > 200 && top[0] < 100)) {
    problems.push(`off: the left strip is ${JSON.stringify(top)}, not the blue tint`);
  }
  if (bottom === undefined || !(bottom[0] > 200 && bottom[2] < 100)) {
    problems.push(`off: the right strip is ${JSON.stringify(bottom)}, not the red tint`);
  }

  return problems;
}

const built = await Bun.build({
  entrypoints: [new URL("overdraw/page.ts", import.meta.url).pathname],
  define: DEV,
  target: "browser"
});
const [output] = built.outputs;

if (!built.success || output === undefined) {
  throw new Error(`The page did not bundle.\n  ${built.logs.map(String).join(" ")}.`);
}

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

try {
  for (const renderer of RENDERERS) {
    // The context is Playwright's: its pages take a screenshot, which the runner's structural type leaves out.
    const page = (await context.newPage()) as ShotPage;

    await page.goto(`${server.url.href}${renderer === "webgl" ? "?renderer=webgl" : ""}`);
    await page.waitForFunction(() => "overdraw" in globalThis, undefined, { timeout: 60_000 });

    const answer = (await page.evaluate(() => {
      const value = Reflect.get(globalThis, "overdraw") as OverdrawPage | { error: string };

      return "error" in value ? value : { backend: value.backend };
    }, undefined)) as { backend: string } | { error: string };
    const problems: string[] = [];
    let strips: Rgb[] = [];

    if ("error" in answer) problems.push(answer.error);
    else {
      if (answer.backend !== renderer) problems.push(`drew with ${answer.backend}`);
      strips = await switchTo(page, true);
      problems.push(...mapProblems(strips), ...gameProblems(await switchTo(page, false)));
    }

    if (problems.length > 0) failed += 1;

    console.log(
      `${renderer}: ${problems.length === 0 ? "ok" : "FAIL"}`,
      JSON.stringify(strips),
      problems.join("; ")
    );
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}

process.exitCode = failed === 0 ? 0 : 1;
