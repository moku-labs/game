/**
 * @file The browser leg of kept pictures (spec 23 T4): the engine's kept pictures on the real Pixi and the real GPU, in
 * Chrome, on WebGPU and on WebGL (`?renderer=webgl`), with `debug.verifyFrames` on. Every scene — a glow at rest, the
 * same after a fractional move, a blur at resolution 0.5, the same at renderer resolution 2.8125, a placed filter
 * with `canvasPixel`, a nested kept view, a kept view inside a card drawn live, a bare sprite and a shape at alpha
 * 0.5 (both taken through a wrapper, spec 23 D4) — must be drawn from a picture, equal its live frame within the thresholds
 * of the frame oracle (a channel over 24, a ratio over 0.001), and log no `renderer:stale-picture`,
 * `renderer:missed-frame` or `renderer:missed-mark`. Not a vitest file: `bun tests/visual/kept-pictures.visual.ts`. It
 * bundles `kept-pictures/page.ts` with the flags of a dev page, serves it, and exits 1 when a run fails.
 */
import { launchChrome, loadChromium } from "../../src/visual/leg-browser";
import type { KeptPicturesResult } from "./kept-pictures/page";

/** The flags of a dev page: the pixel leg of the kept oracle runs in dev and agent builds only. */
const DEV = {
  __MOKU_GAME_DEV__: "true",
  __MOKU_GAME_AGENT__: "true",
  __MOKU_GAME_CONTROL__: "true"
};

/** More than this share of differing pixels is a picture that is not the live frame. */
const PIXEL_RATIO = 0.001;

/** The backends a run asks for. */
const RENDERERS = ["webgpu", "webgl"] as const;

/**
 * The problems of one answer, in words; empty when the run proves what it should.
 *
 * @param renderer - The backend asked for.
 * @param result - What the page answered.
 * @returns The problems.
 */
function problemsOf(renderer: (typeof RENDERERS)[number], result: KeptPicturesResult): string[] {
  const problems: string[] = [];

  if (result.backend !== renderer) problems.push(`drew with ${result.backend}`);

  for (const scene of result.scenes) {
    if (scene.pictures < 1) problems.push(`${scene.name}: drawn live, not from a picture`);
    if (scene.lit === 0) problems.push(`${scene.name}: a blank capture`);
    if (scene.differing > scene.total * PIXEL_RATIO) {
      problems.push(
        `${scene.name}: ${scene.differing} of ${scene.total} pixels differ from the live frame`
      );
    }
  }

  for (const warning of result.warnings) {
    problems.push(`${warning.event} ${JSON.stringify(warning.data)}`);
  }

  return problems;
}

const built = await Bun.build({
  entrypoints: [new URL("kept-pictures/page.ts", import.meta.url).pathname],
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
  viewport: { width: 480, height: 480 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false
});
let failed = 0;

try {
  for (const renderer of RENDERERS) {
    const page = await context.newPage();

    await page.goto(`${server.url.href}${renderer === "webgl" ? "?renderer=webgl" : ""}`);
    await page.waitForFunction(() => "keptPictures" in globalThis, undefined, { timeout: 60_000 });

    const answer = (await page.evaluate(
      () => Reflect.get(globalThis, "keptPictures"),
      undefined
    )) as KeptPicturesResult | { error: string };
    const problems = "error" in answer ? [answer.error] : problemsOf(renderer, answer);

    if (problems.length > 0) failed += 1;

    console.log(
      `${renderer}: ${problems.length === 0 ? "ok" : "FAIL"}`,
      "error" in answer
        ? ""
        : JSON.stringify(
            answer.scenes.map(scene => [
              scene.name,
              scene.pictures,
              scene.frames,
              scene.differing,
              scene.lit
            ])
          ),
      problems.join("; ")
    );
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}

process.exitCode = failed === 0 ? 0 : 1;
