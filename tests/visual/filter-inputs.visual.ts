/**
 * @file The browser leg of filter inputs (spec 24, OQ24-3): the engine's own filter code on the real Pixi and the
 * real GPU, in Chrome, on WebGPU and on WebGL (`?renderer=webgl`), on a release page and on a dev page. This is where
 * the real compile, the real bind groups and the WebGL sampler binding by name are proven: a filter that reads a
 * second texture through `sampleSoft` draws its blurred copy; a kind whose stage does not compile is broken by the
 * check, logged under the stage's id, and drawn by its fallback (with magenta stripes on the dev page only); no frame
 * is blank. Two backdrop filters read what was drawn under them (change 2026-10-18-memory-render, B1): a frosted band
 * blurs the edge of the square under it and only there, a dimming panel halves it in place, read from a texture and
 * from the canvas, where WebGL copies from Pixi's back buffer. Not a vitest file:
 * `bun tests/visual/filter-inputs.visual.ts`. It bundles `filter-inputs/page.ts` twice, serves both bundles, and exits
 * 1 when a run fails.
 */
import { launchChrome, loadChromium } from "../../src/visual/leg-browser";
import type { BackdropRead, FilterInputsResult } from "./filter-inputs/page";

/** The flags each page is bundled with. */
const BUILDS = {
  release: {
    __MOKU_GAME_DEV__: "false",
    __MOKU_GAME_AGENT__: "false",
    __MOKU_GAME_CONTROL__: "false"
  },
  dev: { __MOKU_GAME_DEV__: "true", __MOKU_GAME_AGENT__: "true", __MOKU_GAME_CONTROL__: "true" }
} as const;

/** One run of the page: the backend asked for and the build. */
type Run = { renderer: "webgpu" | "webgl"; build: keyof typeof BUILDS };

/** The runs, in order. */
const RUNS: readonly Run[] = [
  { renderer: "webgpu", build: "release" },
  { renderer: "webgpu", build: "dev" },
  { renderer: "webgl", build: "release" },
  { renderer: "webgl", build: "dev" }
];

/**
 * Bundles the page with the flags of one build.
 *
 * @param build - The build.
 * @returns The bundled script.
 */
async function bundle(build: keyof typeof BUILDS): Promise<string> {
  const result = await Bun.build({
    entrypoints: [new URL("filter-inputs/page.ts", import.meta.url).pathname],
    define: BUILDS[build],
    target: "browser"
  });
  const [output] = result.outputs;

  if (!result.success || output === undefined) {
    throw new Error(`The page did not bundle.\n  ${result.logs.map(String).join(" ")}.`);
  }

  return output.text();
}

/**
 * The problems of one reading of the backdrop square, in words: the band's edge blurred, the edge above it sharp, the
 * panel's edge halved in place (white to about 128, black stays black: the copy is not shifted or scaled).
 *
 * @param where - Where the pixels were read: `"texture"` or `"canvas"`.
 * @param read - The reading.
 * @returns The problems.
 */
function readProblems(where: string, read: BackdropRead): string[] {
  const problems: string[] = [];
  const blurred = read.inside.filter(red => red > 10 && red < 245).length;
  const sharp = read.outside.filter(red => red > 10 && red < 245).length;
  const white = read.dim.slice(0, 4);
  const black = read.dim.slice(4);

  if (blurred < 4) problems.push(`the ${where} band is not blurred: ${read.inside.join(",")}`);
  if (sharp !== 0)
    problems.push(`the ${where} edge above the band is not sharp: ${read.outside.join(",")}`);
  if (white.some(red => red < 110 || red > 145) || black.some(red => red > 10)) {
    problems.push(`the ${where} dimmed edge is ${read.dim.join(",")}`);
  }

  return problems;
}

/**
 * The problems of the backdrop square, in words: both backdrop kinds checked ok on the device, and the square read
 * from a texture and from the canvas as `readProblems` wants it.
 *
 * @param result - What the page answered.
 * @returns The problems.
 */
function backdropProblems(result: FilterInputsResult): string[] {
  const problems: string[] = [];

  if (result.status.frost !== "ok") problems.push(`the frost kind is ${result.status.frost}`);
  if (result.status.dim !== "ok") problems.push(`the dim kind is ${result.status.dim}`);

  return [
    ...problems,
    ...readProblems("texture", result.backdrop.texture),
    ...readProblems("canvas", result.backdrop.canvas)
  ];
}

/**
 * The problems of one answer, in words; empty when the run proves what it should.
 *
 * @param run - The run.
 * @param result - What the page answered.
 * @returns The problems.
 */
function problemsOf(run: Run, result: FilterInputsResult): string[] {
  const problems: string[] = [];
  const blurred = result.edge.soft.filter(red => red > 10 && red < 245).length;
  const sharp = result.edge.plain.filter(red => red > 10 && red < 245).length;
  const broken = result.errors.filter(entry => entry.event === "effects:broken");
  const compile = result.errors.filter(
    entry => entry.event === "effects:wgsl" || entry.event === "effects:glsl"
  );
  const alpha = result.hazy.white[3] ?? 0;

  if (result.backend !== run.renderer) problems.push(`drew with ${result.backend}`);
  if (result.status.soft !== "ok") problems.push(`the soft kind is ${result.status.soft}`);
  if (result.status.hazy !== "broken") problems.push(`the hazy kind is ${result.status.hazy}`);
  if (sharp !== 0) problems.push(`the plain edge is not sharp: ${result.edge.plain.join(",")}`);
  if (blurred < 4) problems.push(`the soft edge is not blurred: ${result.edge.soft.join(",")}`);
  if (result.draws < 4) problems.push(`one frame made ${result.draws} filter draws`);
  if (
    compile.length === 0 ||
    compile.some(entry => (entry.data as { filter?: string }).filter !== "visual.bad")
  ) {
    problems.push(`the compile lines are ${JSON.stringify(compile)}`);
  }
  if (
    broken.length !== 1 ||
    (broken[0]?.data as { stage?: string } | undefined)?.stage !== "visual.bad"
  ) {
    problems.push(`the broken lines are ${JSON.stringify(broken)}`);
  }
  if (!result.hazy.standIn) problems.push("the broken kind has no stand-in");
  // The fallback multiplies the white half by its spread, 0.5: half its alpha. WebGPU's extract un-premultiplies
  // the colour and WebGL's does not, so the alpha is the one channel both backends answer alike.
  if (alpha < 100 || alpha > 160)
    problems.push(`the fallback's white is ${result.hazy.white.join(",")}`);
  if (run.build === "dev" && result.hazy.magenta === 0)
    problems.push("the dev page draws no stripes");
  if (run.build === "release" && result.hazy.magenta > 0) {
    problems.push(`the release page draws ${result.hazy.magenta} magenta pixels`);
  }
  if (result.frames.includes(0)) problems.push(`a blank frame: ${result.frames.join(",")}`);
  problems.push(...backdropProblems(result));

  return problems;
}

const scripts = { release: await bundle("release"), dev: await bundle("dev") };
const server = Bun.serve({
  port: 0,
  fetch: request => {
    const url = new URL(request.url);

    if (url.pathname === "/release.js" || url.pathname === "/dev.js") {
      const script = url.pathname === "/dev.js" ? scripts.dev : scripts.release;

      return new Response(script, { headers: { "content-type": "text/javascript" } });
    }

    const build = url.searchParams.get("build") === "dev" ? "dev" : "release";

    return new Response(
      `<!doctype html><html><body style="margin:0;background:#888"><script type="module" src="/${build}.js"></script></body></html>`,
      { headers: { "content-type": "text/html" } }
    );
  }
});
const browser = await launchChrome(await loadChromium(), undefined);
const context = await browser.newContext({
  viewport: { width: 760, height: 200 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false
});
let failed = 0;

try {
  for (const run of RUNS) {
    const page = await context.newPage();
    const query =
      run.renderer === "webgl" ? `?renderer=webgl&build=${run.build}` : `?build=${run.build}`;

    await page.goto(`${server.url.href}${query}`);
    await page.waitForFunction(() => "filterInputs" in globalThis, undefined, { timeout: 30_000 });

    const answer = (await page.evaluate(
      () => Reflect.get(globalThis, "filterInputs"),
      undefined
    )) as FilterInputsResult | { error: string };
    const problems = "error" in answer ? [answer.error] : problemsOf(run, answer);

    if (problems.length > 0) failed += 1;

    console.log(
      `${run.renderer} ${run.build}: ${problems.length === 0 ? "ok" : "FAIL"}`,
      "error" in answer
        ? ""
        : JSON.stringify({
            edge: answer.edge.soft,
            hazy: answer.hazy,
            draws: answer.draws,
            backdrop: answer.backdrop
          }),
      problems.join("; ")
    );
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}

process.exitCode = failed === 0 ? 0 : 1;
