#!/usr/bin/env bun
/**
 * @file The desktop side of a dry run of `walk.ts`: `bun bench/stress/game/desktop.ts <web-dir> [throttle]`. It serves a
 * debug web build of the game, opens it in headless Chromium on WebGPU at 390 × 844 with the DevTools port 9353,
 * and stays up until killed.
 */
import path from "node:path";
import { chromium } from "playwright-core";

const [web, throttle] = process.argv.slice(2);

if (web === undefined) {
  console.error("Usage: bun desktop.ts <web-dir> [throttle]");
  process.exit(2);
}

const server = Bun.serve({
  port: 0,
  fetch: async request => {
    const name = decodeURIComponent(new URL(request.url).pathname);
    const file = Bun.file(path.join(web, name.endsWith("/") ? `${name}index.html` : name));

    return (await file.exists()) ? new Response(file) : new Response("none", { status: 404 });
  }
});
const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-gpu",
    "--use-angle=metal",
    "--ignore-gpu-blocklist",
    "--remote-debugging-port=9353"
  ]
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2
});
const page = await context.newPage();

page.on("pageerror", error => console.log("pageerror", String(error).slice(0, 300)));
await page.goto(`http://localhost:${server.port}/`);

if (throttle !== undefined) {
  const cdp = await context.newCDPSession(page);

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(throttle) });
}

console.log(`ready on 9353, page http://localhost:${server.port}/`);
await new Promise(() => undefined);
