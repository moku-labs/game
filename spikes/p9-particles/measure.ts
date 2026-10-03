// Spike P9. Serves the page, drives system Chrome through playwright-core, writes metrics.json.
// bun measure.ts            -> full run (headed by default: real vsync, real GPU)
// bun measure.ts --probe    -> only print renderer/adapter info
// bun measure.ts --headless -> headless Chrome

import { chromium } from "playwright-core";

const probe = process.argv.includes("--probe");
const headless = process.argv.includes("--headless");

// build in memory and serve with COOP/COEP: cross-origin isolation gives performance.now() 5 us steps instead of 100 us
const built = await Bun.build({ entrypoints: [`${import.meta.dir}/index.html`], minify: true });
if (!built.success) throw new Error(built.logs.join("\n"));
const files = new Map<string, Blob>();
for (const output of built.outputs) files.set(output.path.replace(/^\.\//, "/").replace(/^([^/])/, "/$1"), output);
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
const server = Bun.serve({
  port: 3059,
  fetch(request) {
    const path = new URL(request.url).pathname;
    const file = files.get(path === "/" ? "/index.html" : path);
    if (!file) return new Response("not found", { status: 404 });
    return new Response(file, { headers: { ...isolation, "Content-Type": file.type } });
  }
});

const browser = await chromium.launch({
  channel: "chrome",
  headless,
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
});
// a phone-shaped page: 390 x 844 CSS px at DPR 3 -> 1170 x 2532 canvas pixels
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const page = await context.newPage();
const logs: string[] = [];
page.on("console", m => logs.push(m.text()));
page.on("pageerror", e => logs.push(`pageerror ${e.message}`));
await page.goto(server.url.href);
await page.waitForFunction(() => (window as unknown as { p9?: unknown }).p9 !== undefined, null, { timeout: 20_000 });
const info = await page.evaluate(() => (window as unknown as { p9: { info: unknown } }).p9.info);
console.log("info", JSON.stringify(info), logs);
const cdp = await context.newCDPSession(page);
const throttle = (rate: number) => cdp.send("Emulation.setCPUThrottlingRate", { rate });

type P9 = {
  runLoad: (mode: string, target: number, size?: number) => Promise<Record<string, unknown>>;
  runBursts: () => Promise<Record<string, unknown>>;
  orderTest: () => unknown;
  artifactTest: (dynamic: string) => Promise<unknown>;
  cullTest: () => unknown;
  microBench: () => unknown;
};

if (!probe) {
  const order = await page.evaluate(() => (window as unknown as { p9: P9 }).p9.orderTest());
  const cull = await page.evaluate(() => (window as unknown as { p9: P9 }).p9.cullTest());
  const artifacts = [];
  for (const d of ["full", "position"]) artifacts.push(await page.evaluate(m => (window as unknown as { p9: P9 }).p9.artifactTest(m), d));
  const micro: Record<string, unknown> = {};
  const load: Record<string, unknown>[] = [];
  const bursts: Record<string, unknown>[] = [];
  for (const rate of [1, 4, 6]) {
    await throttle(rate);
    micro[`x${rate}`] = await page.evaluate(() => (window as unknown as { p9: P9 }).p9.microBench());
    for (const mode of ["position", "full", "position-nochurn"]) {
      for (const target of [1000, 5000, 20000, 50000]) {
        const r = await page.evaluate(([m, t]) => (window as unknown as { p9: P9 }).p9.runLoad(m as string, t as number), [mode, target]);
        load.push({ cpuThrottle: rate, ...r });
        console.log(rate, mode, target, JSON.stringify({ step: r.stepMs, render: r.renderCallMs, raf: r.rafDeltaMs, gpu: r.gpuDoneAfterSubmitMs }));
      }
    }
    const b = await page.evaluate(() => (window as unknown as { p9: P9 }).p9.runBursts());
    bursts.push({ cpuThrottle: rate, ...b });
    console.log(rate, "bursts", JSON.stringify(b));
  }
  // fill rate: the same counts with 64 CSS px particles (192 device px), no CPU throttle
  await throttle(1);
  for (const mode of ["position", "full"])
    for (const target of [5000, 20000]) {
      const r = await page.evaluate(([m, t]) => (window as unknown as { p9: P9 }).p9.runLoad(m as string, t as number, 1), [mode, target]);
      load.push({ cpuThrottle: 1, ...r });
      console.log(1, mode, target, "big", JSON.stringify({ step: r.stepMs, render: r.renderCallMs, raf: r.rafDeltaMs, gpu: r.gpuDoneAfterSubmitMs }));
    }
  await Bun.write(
    `${import.meta.dir}/metrics.json`,
    JSON.stringify({ when: new Date().toISOString(), headless, info, order, cull, artifacts, micro, load, bursts, logs }, null, 2)
  );
  console.log(JSON.stringify({ order, cull, artifacts, micro }));
}

await browser.close();
server.stop();
