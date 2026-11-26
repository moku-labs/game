#!/usr/bin/env bun
/**
 * @file The phone run of the stress bench: `bun bench/stress/a26.ts <serial> [--out dir] [--seconds 12]
 * [--scenes a,b] [--profile]`. It reads `adb forward --list`, `adb reverse --list` and the window in front and
 * refuses a phone that is taken, having touched nothing. Then it serves `bench/stress/dist/web` (build it first),
 * brings the port to the phone, opens the page in the phone's Chrome, measures each scene over the DevTools port,
 * wakes the screen every two minutes, and gives back only the two ports it took. Port 9333 is never used.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { focusOf, phoneVerdict, portsOf } from "../filters/lib/a26";
import { measureScene, SCENES, servePage, sleep } from "./lib/measure";

/** The port of the page, on the Mac and on the phone. */
const PAGE_PORT = 4184;

/** The Mac's port of the phone's DevTools. */
const CDP_PORT = 9444;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: path.join(import.meta.dir, "out-a26") },
    seconds: { type: "string", default: "12" },
    scenes: { type: "string" },
    profile: { type: "boolean", default: false },
    adb: { type: "string", default: "adb" }
  }
});
const [serial] = positionals;

if (serial === undefined) {
  console.error(
    "Usage: bun bench/stress/a26.ts <serial> [--out dir] [--seconds 12] [--scenes a,b]"
  );
  process.exit(2);
}

/**
 * Runs adb on the phone, and waits for its answer.
 *
 * @param words - The arguments after the serial.
 * @returns What it printed.
 */
async function adb(...words: string[]): Promise<string> {
  const child = Bun.spawn([values.adb, "-s", serial as string, ...words], { stderr: "pipe" });
  const text = await new Response(child.stdout).text();

  if ((await child.exited) !== 0) {
    throw new Error(
      `[stress] adb ${words.join(" ")} failed: ${await new Response(child.stderr).text()}`
    );
  }

  return text;
}

const verdict = phoneVerdict({
  serial,
  forwards: portsOf(await adb("forward", "--list")),
  reverses: portsOf(await adb("reverse", "--list")),
  focus: focusOf(await adb("shell", "dumpsys", "window"))
});

if (!verdict.free) {
  console.error(`The phone is taken, nothing was touched.\n  ${verdict.reasons.join("\n  ")}`);
  process.exit(1);
}

mkdirSync(values.out, { recursive: true });

const scenes = values.scenes === undefined ? SCENES : values.scenes.split(",");
const server = servePage(path.join(import.meta.dir, "dist", "web"), PAGE_PORT);
const clocks: Record<string, string[]> = {};
const awake = { at: Date.now() };

await adb("reverse", `tcp:${PAGE_PORT}`, `tcp:${PAGE_PORT}`);
await adb("forward", `tcp:${CDP_PORT}`, "localabstract:chrome_devtools_remote");

try {
  const summary: Record<string, unknown> = {};
  let visit = 0;

  for (const scene of scenes) {
    visit += 1;

    // A new address each time, so the page loads again and reads its scene.
    const address = `http://127.0.0.1:${PAGE_PORT}/?v=${visit}#${scene}`;

    await adb(
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `'${address}'`,
      "com.android.chrome"
    );
    await sleep(2500);

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const page = browser
      .contexts()
      .flatMap(context => context.pages())
      .find(candidate => candidate.url().includes(`?v=${visit}#`));

    if (page === undefined) throw new Error(`[stress] the phone did not open ${address}`);

    const cdp = await page.context().newCDPSession(page);

    clocks[scene] = [];
    summary[scene] = await measureScene(page, cdp, scene, {
      out: values.out,
      seconds: Number(values.seconds),
      profile: values.profile,
      tick: async () => {
        // The GPU clock and load of this moment, for the reading of the GPU times.
        const clock = await adb("shell", "cat /sys/kernel/gpu/gpu_clock /sys/kernel/gpu/gpu_busy");

        clocks[scene]?.push(clock.trim());

        if (Date.now() - awake.at < 120_000) return;

        awake.at = Date.now();
        await adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
      }
    });
    await browser.close();
  }

  writeFileSync(path.join(values.out, "summary.json"), JSON.stringify(summary, undefined, 1));
  writeFileSync(path.join(values.out, "clocks.json"), JSON.stringify(clocks, undefined, 1));
} finally {
  await adb("forward", "--remove", `tcp:${CDP_PORT}`).catch(() => undefined);
  await adb("reverse", "--remove", `tcp:${PAGE_PORT}`).catch(() => undefined);
  await server.stop();
}
