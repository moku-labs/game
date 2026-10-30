#!/usr/bin/env bun
/**
 * @file The A26 run of the bench: `bun bench/filters/a26.ts <serial> [--log perf.jsonl] [--port 4173]
 * [--seconds N] [--fps 30] [--k 8] [--adb adb]`. It checks that the phone is free and refuses when
 * it is not, then brings the page's port to the phone, prints the arms schedule and the address, and
 * samples the GPU and MIF clocks at 10 Hz into a JSONL beside the perf log until the schedule ends
 * or Ctrl+C. It takes no port it found held, and gives back only the one it took.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  ARMS,
  armSchedule,
  armsAddress,
  clocksPathOf,
  focusOf,
  phoneVerdict,
  portsOf,
  samplesOf
} from "./lib/a26";

/** One sampling round on the phone: its time, every devfreq clock, the Samsung GPU clock. */
const SAMPLE_LOOP = [
  "while :; do",
  'echo "@ $(date +%s%N)";',
  "for f in /sys/class/devfreq/*/cur_freq /sys/kernel/gpu/gpu_clock; do",
  '[ -r "$f" ] && echo "$f $(cat "$f")";',
  "done;",
  "sleep 0.1;",
  "done"
].join(" ");

/** The frames at the head of a slot the page's summary drops, as `SETTLE_FRAMES` of the plugin. */
const SKIP = 6;

/** The seconds one arm holds. */
const SLOT_SECONDS = 2;

/** The frames each arm must reach. */
const MIN_FRAMES = 300;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    log: { type: "string" },
    port: { type: "string", default: "4173" },
    seconds: { type: "string" },
    fps: { type: "string", default: "30" },
    k: { type: "string", default: "8" },
    adb: { type: "string", default: "adb" }
  }
});
const [serial] = positionals;

if (serial === undefined) {
  console.error("Usage: bun bench/filters/a26.ts <serial> [--log perf.jsonl] [--port 4173]");
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
    const problem = await new Response(child.stderr).text();

    throw new Error(`[bench] adb ${words.join(" ")} failed.\n  ${problem.trim()}.`);
  }

  return text;
}

// The phone first: a held port or another app in front ends the run before anything is touched.
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

// The plan of the run.
const schedule = armSchedule(ARMS, {
  slotSeconds: SLOT_SECONDS,
  minFrames: MIN_FRAMES,
  fps: Number(values.fps),
  skip: SKIP
});
const out = clocksPathOf(values.log, serial);
const address = armsAddress(
  `http://127.0.0.1:${values.port}/`,
  ARMS,
  SLOT_SECONDS,
  Number(values.k)
);

console.info(`Arms: ${ARMS.length}, ${schedule.rounds} rounds, ${schedule.seconds} s in all.`);
console.info(`Open on the phone: ${address}`);
for (const slot of schedule.slots) console.info(`${String(slot.at).padStart(5)} s  ${slot.arm}`);
console.info(`Clocks go to ${out}`);

// The page's port on the phone, and the file of the clocks.
await adb("reverse", `tcp:${values.port}`, `tcp:${values.port}`);
writeFileSync(out, "");

// The clocks: one sample loop on the phone, for the length of the run or until Ctrl+C.
const sampler = Bun.spawn([values.adb, "-s", serial, "shell", SAMPLE_LOOP], { stderr: "ignore" });
const stop = (): void => sampler.kill();
const seconds = Number(values.seconds ?? schedule.seconds);
const timer = setTimeout(stop, seconds * 1000);

process.on("SIGINT", stop);

const decoder = new TextDecoder();
const stream = { text: "", lines: [] as string[] };

for await (const chunk of sampler.stdout) {
  const parts = (stream.text + decoder.decode(chunk)).split("\n");

  stream.text = parts.pop() ?? "";

  const { samples, rest } = samplesOf([...stream.lines, ...parts]);

  stream.lines = rest;
  for (const sample of samples) appendFileSync(out, `${JSON.stringify(sample)}\n`);
}

// Only the port this run took goes back.
clearTimeout(timer);
await adb("reverse", "--remove", `tcp:${values.port}`);
console.info("Done: the port is given back.");
