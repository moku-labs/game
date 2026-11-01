/**
 * @file The browser leg of a view on its filter's own shader (F126 stage 2): a kept view whose number changes, on the
 * real Pixi and the real GPU, in Chrome on WebGPU, at resolution 1 and 2, with `debug.verifyFrames` on. Every row must
 * run on its shader, equal its live frame within the thresholds of the frame oracle (a channel over 24, a ratio over
 * 0.001), and log no `renderer:stale-picture`, no shader or pipeline error. View alpha and an ancestor's alpha are the
 * stop rule of the slice: a double fade shows there. The fractional row holds the mode to no more difference from live
 * than stage 3 has. A placed view under a filter whose bounds start off the origin is held against a value by hand, which
 * its live frame must miss: live differs there on purpose. Not a vitest file: `bun tests/visual/kept-quad.visual.ts`. It
 * bundles `kept-quad/page.ts` with the flags of a dev page, serves it, and exits 1 when a run fails.
 */
import { launchChrome, loadChromium } from "../../src/visual/leg-browser";
import type { KeptQuadResult, RowResult } from "./kept-quad/page";

/** The flags of a dev page: `why()` and the pixel leg of the kept oracle run in dev and agent builds only. */
const DEV = {
  __MOKU_GAME_DEV__: "true",
  __MOKU_GAME_AGENT__: "true",
  __MOKU_GAME_CONTROL__: "true"
};

/** More than this share of differing pixels is a picture that is not the live frame. */
const PIXEL_RATIO = 0.001;

/** The resolutions a run asks for. */
const RESOLUTIONS = [1, 2] as const;

/**
 * The problems of one row, in words.
 *
 * @param row - What the row answered.
 * @returns The problems.
 */
function rowProblems(row: RowResult): string[] {
  const problems: string[] = [];

  if (row.shaded < 1) problems.push(`${row.name}: not on its shader`);
  if (row.lit === 0) problems.push(`${row.name}: a blank capture`);

  if (row.stage3 === undefined && row.differing > row.total * PIXEL_RATIO) {
    const against = row.live === undefined ? "live" : "the value by hand";

    problems.push(`${row.name}: ${row.differing} of ${row.total} pixels differ from ${against}`);
  }

  if (row.stage3 !== undefined && row.differing > row.stage3) {
    problems.push(`${row.name}: ${row.differing} pixels differ, stage 3 ${row.stage3}`);
  }

  // Live must miss the value by hand, or the row cannot tell the two places apart.
  if (row.live === 0) problems.push(`${row.name}: live hits the value by hand`);

  return problems;
}

/**
 * The problems of one answer, in words; empty when the run proves what it should.
 *
 * @param result - What the page answered.
 * @returns The problems.
 */
function problemsOf(result: KeptQuadResult): string[] {
  const problems = result.rows.flatMap(row => rowProblems(row));

  if (result.backend !== "webgpu") problems.push(`drew with ${result.backend}`);
  if (result.scopes === 0) problems.push("the warm-up drew no quad");

  for (const first of result.firstFrames) {
    if (first.quads.length > 0) {
      problems.push(`${first.name}: a compile in play: ${first.quads.join(", ")}`);
    }
  }

  for (const warning of result.warnings) {
    problems.push(`${warning.event} ${JSON.stringify(warning.data)}`);
  }

  return problems;
}

const built = await Bun.build({
  entrypoints: [new URL("kept-quad/page.ts", import.meta.url).pathname],
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
let failed = 0;

try {
  for (const resolution of RESOLUTIONS) {
    const context = await browser.newContext({
      viewport: { width: 480, height: 480 },
      deviceScaleFactor: resolution,
      isMobile: false,
      hasTouch: false
    });
    const page = await context.newPage();

    await page.goto(`${server.url.href}?resolution=${resolution}`);
    await page.waitForFunction(() => "keptQuad" in globalThis, undefined, { timeout: 120_000 });

    const answer = (await page.evaluate(() => Reflect.get(globalThis, "keptQuad"), undefined)) as
      | KeptQuadResult
      | { error: string };
    const problems = "error" in answer ? [answer.error] : problemsOf(answer);

    if (problems.length > 0) failed += 1;

    console.log(
      `resolution ${resolution}: ${problems.length === 0 ? "ok" : "FAIL"}`,
      "error" in answer ? "" : `quad probes ${answer.scopes}`,
      "error" in answer ? "" : `warm-up pipelines ${answer.warmed}`,
      "error" in answer
        ? ""
        : JSON.stringify(
            answer.rows.map(row => [row.name, row.shaded, row.differing, row.lit, row.stage3])
          ),
      problems.join("; ")
    );

    if (!("error" in answer)) {
      for (const first of answer.firstFrames) {
        console.log(
          `  first frames ${first.name}: quads ${JSON.stringify(first.quads)}, others ${JSON.stringify(first.others)}`
        );
      }

      for (const row of answer.rows) {
        if (row.live !== undefined) console.log(`  ${row.name}: live misses by ${row.live}`);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}

process.exitCode = failed === 0 ? 0 : 1;
