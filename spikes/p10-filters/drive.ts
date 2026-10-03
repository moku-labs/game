// Spike P10. Starts the page server, opens system Chrome with WebGPU through playwright-core,
// runs the checks and the benches, writes metrics.json.
import { chromium } from "playwright-core";

const headless = process.env.HEADED !== "1";
const server = Bun.spawn(["bun", "serve.ts"], { cwd: import.meta.dir, stdout: "pipe" });
await Bun.sleep(1500);

const browser = await chromium.launch({
  channel: "chrome",
  headless,
  args: ["--enable-unsafe-webgpu", "--js-flags=--expose-gc", "--enable-precise-memory-info", "--disable-gpu-sandbox"]
});
const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("console", m => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[page ${m.type()}]`, m.text().slice(0, 300));
});
page.on("pageerror", e => console.log("[pageerror]", e.message));
await page.goto("http://localhost:3060/");
await page.waitForFunction(() => (window as unknown as { p10ready?: boolean }).p10ready === true, null, { timeout: 30000 });

type P10 = Record<string, (...a: unknown[]) => Promise<unknown>>;
const call = <T>(fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => ((window as unknown as { p10: P10 }).p10[f as string] as (...x: unknown[]) => Promise<unknown>)(...(a as unknown[])), [fn, args] as const) as Promise<T>;

const out: Record<string, unknown> = { date: new Date().toISOString(), headless };
out.env = await call("setup");
console.log("env", out.env);
out.browserVersion = browser.version();
if (process.env.SKIPCHECK !== "1") out.check = await call("checkFilters");
console.log("check done");
out.poolSizes = await call("poolSizes");
if (process.env.BROKEN === "1") {
  out.broken = await call("brokenFilter");
  console.log("broken", JSON.stringify(out.broken));
}

const scenarios = (process.env.SCENARIOS ?? "base-0,tint-1,tint-10,glow-1,glow-3,glow-10,glow-10-pad48,pfglow-1,pfglow-3,pfglow-10,glowparent-10,disabled-10,blur-1,blur-3,blur-10,blur-1-q1,blur-1-res05,blur-1-edge,blurarea-1,blurarea-1-full").split(",");
const runs: unknown[] = [];
for (const s of scenarios) {
  const r = await call("bench", s);
  console.log(JSON.stringify(r));
  runs.push(r);
}
out.bench = runs;

const cdp = await context.newCDPSession(page);
if (process.env.THROTTLE !== "0") {
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const throttled: unknown[] = [];
for (const s of ["base-0", "glow-1", "glow-3", "glow-10", "pfglow-10", "blur-1", "blur-3", "blur-10"]) {
  const r = await call("bench", s);
  console.log("thr4", JSON.stringify(r));
  throttled.push(r);
}
out.benchCpuThrottle4x = throttled;
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
}

const churn: unknown[] = [];
for (const spec of (process.env.TOGGLES ?? "steady,enabled,onoff,pooled,slotFree,slot").split(",")) {
  const [m, it] = spec.split(":");
  const r = await call("toggle", m, Number(it ?? 1000));
  console.log(JSON.stringify(r));
  churn.push(r);
}
out.toggle = churn;
if (process.env.GCWAIT !== "0") {
  out.gcWait = await call("waitGc", Number(process.env.GCWAIT ?? 100));
  console.log("gcWait", out.gcWait);
}
out.rtSizesCreated = await call("rtSizes");
out.finalGpu = await call("snapshot");
out.warnings = await call("warnings");

await Bun.write(`${import.meta.dir}/${process.env.OUT ?? "metrics.json"}`, JSON.stringify(out, null, 2));
await browser.close();
server.kill();
console.log("written");
