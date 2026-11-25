/**
 * @file The browser leg of Frost over a Source (F126 stage 5, owner rule "visuals not worse"): the set's `Frost` on a
 * pane over a room of stripes, on the real Pixi and the real GPU, in Chrome on WebGPU, at resolution 1 and 2. The pane
 * is drawn once over the room under `Source()` (its blur drawn from the Source at ¼, its body on the window's quad, one
 * canvas pass) and once on the backdrop path (the room's `Source` taken off: a copy of the canvas, two passes). The two
 * pictures of the pane must be the same within the thresholds of the frame oracle (a channel over 24, a ratio over
 * 0.001), and over the Source the pane must be a kept picture that breaks no canvas pass (one fewer than the backdrop).
 * Each run is made twice: over the room of stripes, and over a bare image under `Source()` (a view that draws itself,
 * wrapped before its first take). Not a vitest file: `bun tests/visual/frost-source.visual.ts`.
 * It bundles `frost-source/page.ts` with the flags of a dev page, serves it, and exits 1 when a run fails.
 */
import sharp from "sharp";
import { launchChrome, loadChromium } from "../../src/visual/leg-browser";
import type { ChromePage } from "../../src/visual/types";
import { type FrostSourcePage, LONG, PANE, SIDE } from "./frost-source/page";

/** The flags of a dev page. */
const DEV = {
  __MOKU_GAME_DEV__: "true",
  __MOKU_GAME_AGENT__: "true",
  __MOKU_GAME_CONTROL__: "true"
};

/** The resolutions a run asks for. */
const RESOLUTIONS = [1, 2] as const;

/** The rooms a run draws: the room of stripes, and one bare image. */
const ROOMS = ["stripes", "bare"] as const;

/** The largest channel delta that still counts as the same pixel: the frame oracle's. */
const THRESHOLD = 24;

/** More than this share of differing pixels is another picture: the frame oracle's. */
const PIXEL_RATIO = 0.001;

/** A Playwright page as this leg uses it: the runner's calls, and the screenshot of the viewport. */
type ShotPage = ChromePage & { screenshot(): Promise<Buffer> };

/**
 * The pixels of the pane in a screenshot, RGB, row by row, at the page's device scale.
 *
 * @param shot - The PNG.
 * @param scale - Device pixels per CSS px.
 * @returns The pixels.
 */
async function paneOf(shot: Buffer, scale: number): Promise<Buffer> {
  return sharp(shot)
    .extract({
      left: PANE.x * scale,
      top: PANE.y * scale,
      width: PANE.width * scale,
      height: PANE.height * scale
    })
    .removeAlpha()
    .raw()
    .toBuffer();
}

/**
 * How many pixels of two pictures of one size differ by more than the threshold on any channel.
 *
 * @param a - One picture, RGB.
 * @param b - The other.
 * @returns The differing pixels and the total.
 */
function differing(a: Buffer, b: Buffer): { differing: number; total: number } {
  const total = Math.floor(a.length / 3);
  let count = 0;

  for (let pixel = 0; pixel < total; pixel += 1) {
    const at = pixel * 3;
    const delta = Math.max(
      Math.abs((a[at] ?? 0) - (b[at] ?? 0)),
      Math.abs((a[at + 1] ?? 0) - (b[at + 1] ?? 0)),
      Math.abs((a[at + 2] ?? 0) - (b[at + 2] ?? 0))
    );

    if (delta > THRESHOLD) count += 1;
  }

  return { differing: count, total };
}

const built = await Bun.build({
  entrypoints: [new URL("frost-source/page.ts", import.meta.url).pathname],
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
          '<!doctype html><html><body style="margin:0;background:#888"><script type="module" src="/page.js"></script></body></html>',
          { headers: { "content-type": "text/html" } }
        )
});
const browser = await launchChrome(await loadChromium(), undefined);
let failed = 0;

try {
  for (const room of ROOMS)
    for (const resolution of RESOLUTIONS) {
      const context = await browser.newContext({
        viewport: { width: SIDE, height: LONG },
        deviceScaleFactor: resolution,
        isMobile: false,
        hasTouch: false
      });
      const page = (await context.newPage()) as ShotPage;

      await page.goto(
        `${server.url.href}?resolution=${resolution}${room === "bare" ? "&bare=1" : ""}`
      );
      await page.waitForFunction(() => "frostSource" in globalThis, undefined, { timeout: 30_000 });

      const ready = (await page.evaluate(() => {
        const answer = Reflect.get(globalThis, "frostSource") as
          | FrostSourcePage
          | { error: string };

        return "error" in answer ? answer.error : answer.backend;
      }, undefined)) as string;
      const problems: string[] = [];
      let report = "";

      if (ready === "webgpu") {
        const toggle = (on: boolean) =>
          page.evaluate(
            async value =>
              (Reflect.get(globalThis, "frostSource") as FrostSourcePage).source(value),
            on
          ) as Promise<{ count: number; canvasPasses: number; pictures: number }>;
        const over = await toggle(true);
        const overShot = await paneOf(await page.screenshot(), resolution);
        const backdrop = await toggle(false);
        const backdropShot = await paneOf(await page.screenshot(), resolution);
        const compared = differing(overShot, backdropShot);

        if (over.count !== 1 || over.canvasPasses !== 1) {
          problems.push(
            `over the Source: ${JSON.stringify(over)}, not one Source and one canvas pass`
          );
        }
        if (backdrop.canvasPasses < 2)
          problems.push(`on the backdrop path: ${backdrop.canvasPasses} canvas passes`);
        if (compared.differing > compared.total * PIXEL_RATIO) {
          problems.push(
            `${compared.differing} of ${compared.total} pane pixels differ from the backdrop path`
          );
        }

        report = JSON.stringify({ over, backdrop, ...compared });
      } else {
        problems.push(`the page drew with ${ready}`);
      }

      if (problems.length > 0) failed += 1;

      console.log(
        `${room}, webgpu at ${resolution}: ${problems.length === 0 ? "ok" : "FAIL"}`,
        report,
        problems.join("; ")
      );
      await page.close();
    }
} finally {
  await browser.close();
  await server.stop(true);
}

process.exitCode = failed === 0 ? 0 : 1;
