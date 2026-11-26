#!/usr/bin/env bun
/**
 * @file The Mac run of the stress bench: `bun bench/stress/run.ts [--out dir] [--seconds 12] [--throttle 1]
 * [--scenes a,b] [--profile]`. It serves `bench/stress/dist/web` (build it first: `bun bench/stress/build.ts`),
 * opens each scene in headless Chromium on WebGPU, lets it walk, and writes per scene the frames of the engine's
 * ring grouped by kind, the heap growth a frame, the collections of a trace and, with `--profile`, a CPU profile
 * and an allocation profile.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { measureScene, SCENES, servePage } from "./lib/measure";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: path.join(import.meta.dir, "out") },
    seconds: { type: "string", default: "12" },
    throttle: { type: "string", default: "1" },
    scenes: { type: "string" },
    profile: { type: "boolean", default: false }
  }
});
const throttle = Number(values.throttle);
const scenes = values.scenes === undefined ? SCENES : values.scenes.split(",");

mkdirSync(values.out, { recursive: true });

const server = servePage(path.join(import.meta.dir, "dist", "web"), 0);
const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-gpu",
    "--use-angle=metal",
    "--ignore-gpu-blocklist",
    "--enable-precise-memory-info"
  ]
});
const summary: Record<string, unknown> = {};

for (const scene of scenes) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  page.on("pageerror", error => console.log("pageerror", scene, String(error).slice(0, 300)));
  await page.goto(`http://localhost:${server.port}/#${scene}`);

  const cdp = await context.newCDPSession(page);

  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });

  summary[scene] = {
    throttle,
    ...(await measureScene(page, cdp, scene, {
      out: values.out,
      seconds: Number(values.seconds),
      profile: values.profile,
      tracer: browser
    }))
  };
  await context.close();
}

writeFileSync(path.join(values.out, "summary.json"), JSON.stringify(summary, undefined, 1));
await browser.close();
await server.stop();
