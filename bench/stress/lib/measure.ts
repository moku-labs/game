/**
 * @file One measured scene of the stress bench, on any Chromium a runner hands in: the Mac's headless one or the
 * phone's over adb. The page walks by itself; this waits, drains the frames of the engine's ring, and reads the
 * collections of a trace, the fill estimate and, when asked, a CPU profile and an allocation profile.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, CDPSession, Page } from "playwright-core";
import { heapOf, type KindReport, reportOf } from "./report";

/** The page's `game.stress`, as a runner calls it. */
type StressPage = {
  game?: {
    stress: {
      drain(): { rows: number[][]; systems: string[]; lost: number };
      log(): string[];
      info(): unknown;
      fill(): unknown;
    };
    renderer: { host: { kind(): string } };
  };
};

/** How a scene is measured. */
export type MeasureOptions = {
  /** The folder the results go to. */
  out: string;
  /** Seconds measured, after the warm-up. */
  seconds: number;
  /** Whether a CPU profile and an allocation profile follow the measured window. */
  profile: boolean;
  /** The browser, for a trace of the collections; left out where it cannot trace. */
  tracer?: Browser;
  /** Called every few seconds while the scene runs: the phone is kept awake here. */
  tick?: () => Promise<void>;
};

/** What a scene's run says. */
export type SceneResult = {
  scene: string;
  frames: number;
  lost: number;
  seconds: number;
  fps: number;
  heap: { kbPerFrame: number; collections: number };
  collections: Record<string, { n: number; ms: number; maxMs: number }>;
  kinds: Record<string, KindReport>;
  info: unknown;
  fill: unknown;
  /** The JS heap in use when the measured window ended, MB, as DevTools reports it. */
  heapUsedMb: number;
  kind: string | undefined;
};

/**
 * Waits.
 *
 * @param ms - How long.
 * @returns Resolves after it.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * The collections of a trace: how many, and their time.
 *
 * @param trace - The trace buffer of the browser.
 * @returns Counts and ms of the minor and major collections.
 */
function collectionsOf(trace: Buffer): SceneResult["collections"] {
  const events = (JSON.parse(trace.toString()) as { traceEvents: Array<Record<string, unknown>> })
    .traceEvents;
  const found: SceneResult["collections"] = {};

  for (const event of events) {
    const name = String(event.name);

    if (event.ph !== "X" || (name !== "MinorGC" && name !== "MajorGC")) continue;

    const ms = Number(event.dur) / 1000;
    const entry = found[name] ?? { n: 0, ms: 0, maxMs: 0 };

    found[name] = entry;

    entry.n += 1;
    entry.ms = Math.round((entry.ms + ms) * 100) / 100;
    entry.maxMs = Math.max(entry.maxMs, Math.round(ms * 100) / 100);
  }

  return found;
}

/**
 * Takes a CPU profile and then an allocation profile of the running scene, six seconds each.
 *
 * @param cdp - The session of the page.
 * @param file - The path of the results, without an extension.
 * @returns Resolves when both are written.
 */
async function profile(cdp: CDPSession, file: string): Promise<void> {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  await sleep(6000);

  const cpu = await cdp.send("Profiler.stop");

  writeFileSync(`${file}.cpuprofile`, JSON.stringify(cpu.profile));
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.startSampling", {
    samplingInterval: 1024,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true
  });
  await sleep(6000);

  const heap = await cdp.send("HeapProfiler.stopSampling");

  writeFileSync(`${file}.heapprofile`, JSON.stringify(heap.profile));
}

/**
 * Measures the scene a page already shows.
 *
 * @param page - The page, at the scene's address.
 * @param cdp - Its session.
 * @param scene - The scene's token, as in the address.
 * @param options - How to measure.
 * @returns What the run says; also written to `<out>/<scene>.json`, its rows to `<scene>.rows.json`.
 */
export async function measureScene(
  page: Page,
  cdp: CDPSession,
  scene: string,
  options: MeasureOptions
): Promise<SceneResult> {
  const name = scene.replaceAll(/[&=]/g, "-");
  const { seconds } = options;

  await page.waitForFunction(
    () => (globalThis as StressPage).game?.stress !== undefined,
    undefined,
    {
      timeout: 60_000
    }
  );
  // The first seconds hold the engine's warm-up and V8's tiers: not a measurement.
  await sleep(4000);
  // The log from the page's start is kept: its header says which GPU timer runs.
  const stream: string[] =
    (await page.evaluate(() => (globalThis as StressPage).game?.stress.log())) ?? [];

  await page.evaluate(() => {
    (globalThis as StressPage).game?.stress.drain();
    (globalThis as StressPage).game?.stress.fill();
  });

  let tracing = false;

  try {
    await options.tracer?.startTracing(page, {
      categories: ["v8", "devtools.timeline", "disabled-by-default-v8.gc"]
    });
    tracing = options.tracer !== undefined;
  } catch {
    tracing = false;
  }

  const rows: number[][] = [];
  let systems: string[] = [];
  let lost = 0;

  for (let elapsed = 0; elapsed < seconds; elapsed += 4) {
    await sleep(Math.min(4, seconds - elapsed) * 1000);
    await options.tick?.();

    const part = await page.evaluate(() => (globalThis as StressPage).game?.stress.drain());

    rows.push(...(part?.rows ?? []));
    systems = part?.systems ?? systems;
    lost += part?.lost ?? 0;
    stream.push(
      ...((await page.evaluate(() => (globalThis as StressPage).game?.stress.log())) ?? [])
    );
  }

  const usage = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
  const collections =
    tracing && options.tracer !== undefined
      ? collectionsOf(await options.tracer.stopTracing())
      : {};

  if (options.profile) await profile(cdp, path.join(options.out, name));

  const read = await page.evaluate(() => ({
    info: (globalThis as StressPage).game?.stress.info(),
    fill: (globalThis as StressPage).game?.stress.fill(),
    kind: (globalThis as StressPage).game?.renderer.host.kind()
  }));
  const result: SceneResult = {
    scene,
    frames: rows.length,
    lost,
    seconds,
    fps: Math.round((rows.length / seconds) * 10) / 10,
    heap: heapOf(rows),
    collections,
    kinds: reportOf(rows, systems),
    heapUsedMb: Math.round((usage.usedSize / 1_048_576) * 10) / 10,
    ...read
  };

  writeFileSync(path.join(options.out, `${name}.json`), JSON.stringify(result, undefined, 1));
  writeFileSync(path.join(options.out, `${name}.rows.json`), JSON.stringify({ systems, rows }));
  // The raw log of the monitor's stream, one line each, beside the results.
  writeFileSync(path.join(options.out, `${name}.stream.jsonl`), `${stream.join("\n")}\n`);
  console.log(
    scene,
    JSON.stringify({
      fps: result.fps,
      heap: result.heap,
      gc: collections,
      fill: read.fill,
      kinds: Object.fromEntries(
        Object.entries(result.kinds).map(([kind, report]) => [
          kind,
          `${report.work.p50}/${report.work.p95}/${report.work.max} gpu ${report.gpu.p50}`
        ])
      )
    })
  );

  return result;
}

/** The scenes of a full run: the game's sizes first, then the scale. */
export const SCENES = [
  "album&sets=15",
  "album&sets=15&cycle=15",
  "album&sets=40",
  "album&sets=72",
  "scroll&sets=15",
  "scroll&sets=72",
  "popup",
  "popup&cycle=18",
  "popup&glass=1",
  "board&items=63",
  "board&items=126",
  "worst",
  "worst&sets=72&items=126&cycle=18"
];

/**
 * Serves the built page of the bench.
 *
 * @param web - The folder of the page: `bench/stress/dist/web`.
 * @param port - The port; 0 for a free one.
 * @returns The server.
 */
export function servePage(web: string, port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    fetch: async request => {
      const name = decodeURIComponent(new URL(request.url).pathname);
      const file = Bun.file(path.join(web, name.endsWith("/") ? `${name}index.html` : name));

      return (await file.exists()) ? new Response(file) : new Response("none", { status: 404 });
    }
  });
}
