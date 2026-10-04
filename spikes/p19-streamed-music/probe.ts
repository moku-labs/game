// Runs probe.html in Chromium and in Playwright's WebKit (desktop macOS build, NOT iOS).
// Usage: bun spikes/p19-streamed-music/server.ts & bun spikes/p19-streamed-music/probe.ts
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type BrowserType, type Page } from "playwright-core";

const URL = "http://127.0.0.1:8796/probe.html";
const engines: Array<[string, BrowserType, string[]]> = [
  ["chromium", chromium, ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--js-flags=--expose-gc"]],
  ["webkit", webkit, []]
];
const results: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function run(page: Page, name: string, ...args: unknown[]) {
  await page.evaluate(([n, a]) => (window as any).arm(n, a), [name, args] as const);
  await page.click("#go");
  return page.evaluate(() => (window as any).result);
}

/** RSS (kB) of every process, by pid. */
function processes(): Map<number, number> {
  const map = new Map<number, number>();
  for (const line of execSync("ps -axo pid=,rss=").toString().trim().split("\n")) {
    const [pid, kb] = line.trim().split(/\s+/).map(Number);
    map.set(pid!, kb!);
  }
  return map;
}

/** Sums RSS (MB) of the processes that were not there before the browser started. */
function rss(baseline: Map<number, number>) {
  const kb = [...processes()].filter(([pid]) => !baseline.has(pid)).map(([, v]) => v);
  return { totalMB: Math.round(kb.reduce((a, b) => a + b, 0) / 1024), largestMB: Math.round(Math.max(0, ...kb) / 1024), processes: kb.length };
}

for (const [name, type, args] of engines) {
  const r: Record<string, unknown> = { version: undefined };
  const browser = await type.launch({ args });
  r.version = browser.version();
  const page = await browser.newPage();
  await page.goto(URL);
  r.decodeDefault = await run(page, "decode", ["track.mp3", "track.m4a", "track.ogg", "track.opus.ogg", "track.webm", "track.wav"], 0);
  r.decode44k = await run(page, "decode", ["track.mp3", "track.m4a"], 44100);
  r.decodeLoopEdges = await run(page, "decode", ["loop.wav", "loop.mp3", "loop.m4a", "loop.ogg", "loop.opus.ogg", "loop.webm"], 44100);
  r.fade = await run(page, "fade", "/range/track.mp3");
  r.fadeNoRange = await run(page, "fade", "/norange/track.mp3");
  r.crossfade = await run(page, "crossfade", "track.mp3", "track.m4a", 1000);
  r.loop = [];
  for (const f of ["loop.wav", "loop.mp3", "loop.m4a", "loop.ogg", "loop.webm"]) {
    (r.loop as unknown[]).push(await run(page, "loop", "element", f, 6));
    (r.loop as unknown[]).push(await run(page, "loop", "buffer", f, 6));
  }
  r.seekloop = [];
  for (const mode of ["range", "norange"]) for (const f of ["track.mp3", "track.m4a"]) (r.seekloop as unknown[]).push(await run(page, "seekloop", mode, f));
  r.nocors = await run(page, "nocors", "track.mp3");
  await browser.close();

  // Memory: a fresh browser per scenario, RSS of the whole browser after 3 s of playback.
  r.memory = [];
  for (const [mode, n] of [["none", 0], ["buffer", 1], ["buffer", 2], ["stream", 1], ["stream", 2]] as const) {
    const baseline = processes();
    const b = await type.launch({ args });
    const p = await b.newPage();
    await p.goto(URL);
    await sleep(1000);
    const before = rss(baseline);
    const res = await run(p, "hold", mode, n, "track.mp3");
    await p.evaluate(() => (globalThis as any).gc?.());
    await sleep(1000);
    (r.memory as unknown[]).push({ mode, n, res, before, after: rss(baseline) });
    await b.close();
    await sleep(500);
  }
  results[name] = r;
  console.log(name, "done");
}
writeFileSync(join(import.meta.dir, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
