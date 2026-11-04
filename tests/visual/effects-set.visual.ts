/**
 * @file The browser leg of the engine's effect set (F126 stage 3 slices 1 and 2): every member on the real Pixi and the
 * real GPU, in Chrome, on WebGPU and on WebGL (`?renderer=webgl`), at resolution 1 and 2, with
 * `debug.verifyFrames` on. Per member: a held value is kept as a picture and equals its live frame within the frame
 * oracle's thresholds (a channel over 24, a ratio over 0.001); a tweening value runs on the view's own quad on WebGPU
 * and stays within 1/255 of its live frame; one pixel by hand (Flash at amount 1 is its colour, Grade at saturation 0
 * of red is the luma, Vignette's centre is the source) is within 2/255; and every WebGL capture is held against the
 * WebGPU capture of the same row: alpha within 2/255 and colour within 8/255 on 99.5 % of the pixels. No
 * `renderer:stale-picture`, no shader, pipeline or GPU error, no unlisted member. Not a vitest file:
 * `bun tests/visual/effects-set.visual.ts`. It bundles `effects-set/page.ts` with the flags of a dev page, serves it,
 * and exits 1 when a run fails.
 */
import { launchChrome, loadChromium } from "../../src/visual/leg-browser";
import type { CrossRow, SetResult, SetRow } from "./effects-set/page";

/** The flags of a dev page: `why()` and the pixel leg of the kept oracle run in dev and agent builds only. */
const DEV = {
  __MOKU_GAME_DEV__: "true",
  __MOKU_GAME_AGENT__: "true",
  __MOKU_GAME_CONTROL__: "true"
};

/** More than this share of differing pixels is a picture that is not the live frame. */
const PIXEL_RATIO = 0.001;

/** How far a pixel by hand may miss: the rounding of a pass and a capture through 8 bits. */
const PROBE_OFF = 2;

/** The share of pixels a WebGL capture must hold to the WebGPU one within 8/255 colour and 2/255 alpha. */
const CROSS_SHARE = 0.995;

/** The resolutions a run asks for. */
const RESOLUTIONS = [1, 2] as const;

/** The backends a run asks for, WebGPU first: its captures are what WebGL is held against. */
const RENDERERS = ["webgpu", "webgl"] as const;

/**
 * The problems of one row, in words.
 *
 * @param renderer - The backend.
 * @param row - What the row answered.
 * @returns The problems.
 */
function rowProblems(renderer: (typeof RENDERERS)[number], row: SetRow): string[] {
  const problems: string[] = [];

  if (row.lit === 0) problems.push(`${row.name}: a blank capture`);

  if (row.kind === "held") {
    if (row.pictures < 1) problems.push(`${row.name}: drawn live, not from a picture`);
    if (row.differing > row.total * PIXEL_RATIO) {
      problems.push(`${row.name}: ${row.differing} of ${row.total} pixels differ from live`);
    }
  }

  if (row.kind === "tween" && renderer === "webgpu") {
    if (row.shaded < 1) problems.push(`${row.name}: not on its quad`);
    if (row.largest > 1) {
      problems.push(
        `${row.name}: ${row.overOne} pixels more than 1/255 off live, at most ${row.largest}`
      );
    }
  }

  if (row.probe !== undefined && row.probe.off > PROBE_OFF) {
    problems.push(
      `${row.name}: ${JSON.stringify(row.probe.got)}, wanted ${JSON.stringify(row.probe.wanted)}`
    );
  }

  return problems;
}

/**
 * The problems of one answer, in words; empty when the run proves what it should.
 *
 * @param renderer - The backend asked for.
 * @param result - What the page answered.
 * @returns The problems.
 */
function problemsOf(renderer: (typeof RENDERERS)[number], result: SetResult): string[] {
  const problems = result.rows.flatMap(row => rowProblems(renderer, row));

  if (result.backend !== renderer) problems.push(`drew with ${result.backend}`);

  for (const warning of result.warnings) {
    problems.push(`${warning.event} ${JSON.stringify(warning.data)}`);
  }

  return problems;
}

/**
 * The problems of the comparison of WebGL with WebGPU, in words.
 *
 * @param lines - What the WebGL page answered.
 * @param rows - How many rows the WebGPU page captured.
 * @returns The problems.
 */
function crossProblems(lines: readonly CrossRow[], rows: number): string[] {
  const problems = lines
    .filter(line => line.share < CROSS_SHARE)
    .map(
      line =>
        `${line.name}: ${(line.share * 100).toFixed(2)} % within 8/255 of WebGPU (colour at most ${line.color}, alpha ${line.alpha})`
    );

  if (lines.length !== rows) problems.push(`compared ${lines.length} rows of ${rows}`);

  return problems;
}

const built = await Bun.build({
  entrypoints: [new URL("effects-set/page.ts", import.meta.url).pathname],
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
    let gpuCaptures: Record<string, string> = {};

    for (const renderer of RENDERERS) {
      const page = await context.newPage();
      const backend = renderer === "webgl" ? "&renderer=webgl" : "";

      await page.goto(`${server.url.href}?resolution=${resolution}${backend}`);
      await page.waitForFunction(() => "effectsSet" in globalThis, undefined, { timeout: 120_000 });

      const answer = (await page.evaluate(
        () => Reflect.get(globalThis, "effectsSet"),
        undefined
      )) as SetResult | { error: string };
      const problems = "error" in answer ? [answer.error] : problemsOf(renderer, answer);
      let cross: CrossRow[] = [];

      if (!("error" in answer) && renderer === "webgpu") {
        gpuCaptures = (await page.evaluate(
          () => (Reflect.get(globalThis, "effectsSetCaptures") as () => Record<string, string>)(),
          undefined
        )) as Record<string, string>;
      }

      if (!("error" in answer) && renderer === "webgl") {
        cross = (await page.evaluate(
          others =>
            (
              Reflect.get(globalThis, "compareSet") as (
                given: Record<string, string>
              ) => Promise<CrossRow[]>
            )(others),
          gpuCaptures
        )) as CrossRow[];
        problems.push(...crossProblems(cross, Object.keys(gpuCaptures).length));
      }

      if (problems.length > 0) failed += 1;

      console.log(
        `${renderer} at resolution ${resolution}: ${problems.length === 0 ? "ok" : "FAIL"}`,
        problems.join("; ")
      );

      if (!("error" in answer)) {
        for (const row of answer.rows) {
          const probe =
            row.probe === undefined
              ? ""
              : `, probe ${JSON.stringify(row.probe.got)} wanted ${JSON.stringify(row.probe.wanted)}`;

          console.log(
            `  ${row.name}: kept ${row.pictures}, quad ${row.shaded}, oracle ${row.differing}, over 1/255 ${row.overOne}, at most ${row.largest}, lit ${row.lit} of ${row.total}${probe}`
          );
        }
      }

      for (const line of cross) {
        console.log(
          `  against WebGPU, ${line.name}: ${(line.share * 100).toFixed(3)} % within, colour at most ${line.color}, alpha at most ${line.alpha}`
        );
      }

      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.stop(true);
}

process.exitCode = failed === 0 ? 0 : 1;
