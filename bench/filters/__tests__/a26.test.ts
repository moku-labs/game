/* eslint-disable unicorn/no-null -- a sample is JSON: "no node" is `null`. */
import { describe, expect, it } from "vitest";
import {
  ARMS,
  armSchedule,
  armsAddress,
  clockSample,
  clocksPathOf,
  focusOf,
  phoneVerdict,
  portsOf,
  samplesOf
} from "../lib/a26";

const SERIAL = "R5CY32V0J9M";

describe("the phone check", () => {
  // Bug: a forward line of another session is read as nothing, and the run takes its port.
  it("reads the three columns of adb forward --list, and nothing from an empty answer", () => {
    expect(
      portsOf(
        "R5CY32V0J9M tcp:9333 localabstract:webview_devtools_remote_4242\nemulator-5554 tcp:9222 tcp:9222\n"
      )
    ).toEqual([
      {
        serial: SERIAL,
        local: "tcp:9333",
        remote: "localabstract:webview_devtools_remote_4242"
      },
      { serial: "emulator-5554", local: "tcp:9222", remote: "tcp:9222" }
    ]);
    expect(portsOf("")).toEqual([]);
  });

  // Bug: the package name is cut from the wrong field, so a game in front reads as free.
  it("reads the app in front from dumpsys window", () => {
    const dump =
      "  mHoldScreenWindow=null\n  mCurrentFocus=Window{7d1c2 u0 com.mokulabs.memorymissing.debug/com.mokulabs.MainActivity}\n  mFocusedApp=ActivityRecord{1}";

    expect(focusOf(dump)).toBe("com.mokulabs.memorymissing.debug");
    expect(focusOf("  mCurrentFocus=Window{9a u0 NotificationShade}\n")).toBe("NotificationShade");
    expect(focusOf("  mCurrentFocus=null\n")).toBeUndefined();
    expect(focusOf("no such line")).toBeUndefined();
  });

  const free = {
    serial: SERIAL,
    forwards: [],
    reverses: [],
    focus: "com.sec.android.app.launcher"
  };

  // Bug: a free phone refused, so the run never starts.
  it("calls the phone free with no port held and the launcher or Chrome in front", () => {
    expect(phoneVerdict(free)).toEqual({ free: true, reasons: [] });
    expect(phoneVerdict({ ...free, focus: "com.android.chrome" }).free).toBe(true);
  });

  // Bug: the 2026-10-27 accident: a run rebinds tcp:9333 while another session measures on it.
  it("refuses a forward another session holds on this phone, naming the port", () => {
    const verdict = phoneVerdict({
      ...free,
      forwards: [{ serial: SERIAL, local: "tcp:9333", remote: "localabstract:chrome" }]
    });

    expect(verdict.free).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("tcp:9333");
  });

  // Bug: a forward of another device blocks a free phone.
  it("does not count a forward of another device", () => {
    expect(
      phoneVerdict({
        ...free,
        forwards: [{ serial: "emulator-5554", local: "tcp:9333", remote: "tcp:9333" }]
      }).free
    ).toBe(true);
  });

  // Bug: only forwards are checked; a session serving its page through a reverse is overrun.
  it("refuses a reverse port", () => {
    const verdict = phoneVerdict({
      ...free,
      reverses: [{ serial: "UsbFfs", local: "tcp:3000", remote: "tcp:3000" }]
    });

    expect(verdict.free).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("tcp:3000");
  });

  // Bug: taps and a page land in an app another session plays.
  it("refuses another app in front, a locked phone and a dark screen, each in its words", () => {
    expect(phoneVerdict({ ...free, focus: "com.mokulabs.memorymissing.debug" }).reasons).toEqual([
      "com.mokulabs.memorymissing.debug is in front."
    ]);
    expect(phoneVerdict({ ...free, focus: "NotificationShade" }).reasons).toEqual([
      "The phone is locked: a person unlocks it."
    ]);
    expect(phoneVerdict({ ...free, focus: undefined }).reasons).toEqual([
      "No app in front: the screen is off."
    ]);
  });
});

describe("the clock samples", () => {
  const block = [
    "@ 1761826800123456789",
    "/sys/class/devfreq/13000000.mali/cur_freq 949000000",
    "/sys/class/devfreq/17000010.devfreq_mif/cur_freq 2028000",
    "/sys/class/devfreq/17000020.devfreq_int/cur_freq 533000"
  ];

  // Bug: the bins of the slope come from the wrong node, MIF read as GPU.
  it("tells the GPU and the MIF node apart, keeps the others, and takes the phone's time in ms", () => {
    expect(clockSample(block)).toEqual({
      t: 1_761_826_800_123,
      gpu: 949_000_000,
      mif: 2_028_000,
      busy: null,
      nodes: {
        "13000000.mali": 949_000_000,
        "17000010.devfreq_mif": 2_028_000,
        "17000020.devfreq_int": 533_000
      }
    });
  });

  // Bug: an A26 with no devfreq node for the Mali gives no GPU clock at all.
  // Bug: the load reads 86% with its sign, a plain number test drops it and no run has a busy column.
  it("reads the load of the GPU, a percent sign and all", () => {
    expect(clockSample(["@ 1000000000", "/sys/kernel/gpu/gpu_busy 86%"])?.busy).toBe(86);
    expect(clockSample(["@ 1000000000", "/sys/kernel/gpu/gpu_clock 221000"])?.busy).toBeNull();
  });

  it("takes the GPU from gpu_clock only when no devfreq node names it", () => {
    expect(clockSample(["@ 1000000000", "/sys/kernel/gpu/gpu_clock 949"])?.gpu).toBe(949);
    expect(clockSample([...block, "/sys/kernel/gpu/gpu_clock 1"])?.gpu).toBe(949_000_000);
  });

  // Bug: a cat that failed on a closed node writes NaN into the JSONL.
  it("skips a node whose value is not a number, and a block with no time", () => {
    expect(clockSample(["@ 1000000000", "/sys/class/devfreq/x.mali/cur_freq"])).toEqual({
      t: 1000,
      gpu: null,
      mif: null,
      busy: null,
      nodes: {}
    });
    expect(clockSample(["/sys/class/devfreq/x.mali/cur_freq 1"])).toBeUndefined();
  });

  // Bug: two samples glued into one, or a half block at the head of the stream kept.
  it("cuts a stream into blocks at every time line, and holds the last one back as unfinished", () => {
    const { samples, rest } = samplesOf([
      "/sys/class/devfreq/x.mali/cur_freq 5",
      "@ 1000000",
      "/sys/class/devfreq/x.mali/cur_freq 7",
      "@ 2000000",
      "/sys/class/devfreq/x.mali/cur_freq 8"
    ]);

    expect(samples.map(sample => [sample.t, sample.gpu])).toEqual([[1, 7]]);
    expect(rest).toEqual(["@ 2000000", "/sys/class/devfreq/x.mali/cur_freq 8"]);
  });

  // Bug: the clocks land away from the log, and nobody joins them.
  it("writes the clocks beside the perf log", () => {
    expect(clocksPathOf("/runs/perf-1449.jsonl", SERIAL)).toBe("/runs/perf-1449.clocks.jsonl");
    expect(clocksPathOf(undefined, SERIAL)).toBe(`clocks-${SERIAL}.jsonl`);
  });
});

describe("the arms schedule", () => {
  // Bug: arms run in blocks, so a clock drift lands on one arm; or an arm ends under 300 frames.
  it("interleaves the arms every slot and gives each at least 300 usable frames", () => {
    const schedule = armSchedule(["a", "b"], { slotSeconds: 2, minFrames: 300, fps: 60, skip: 6 });

    // 114 usable frames a slot: three rounds.
    expect(schedule.rounds).toBe(3);
    expect(schedule.seconds).toBe(12);
    expect(schedule.slots.map(slot => slot.arm)).toEqual(["a", "b", "a", "b", "a", "b"]);
    expect(schedule.slots.map(slot => slot.at)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  // Bug: at the boundary one round short.
  it("adds no round when the frames fit exactly, and one when they fall one short", () => {
    const options = { slotSeconds: 2, fps: 60, skip: 0 };

    expect(armSchedule(["a"], { ...options, minFrames: 240 }).rounds).toBe(2);
    expect(armSchedule(["a"], { ...options, minFrames: 241 }).rounds).toBe(3);
  });

  // Bug: the printed address plays another schedule than the printed table.
  it("writes the address the page plays the arms from", () => {
    expect(armsAddress("http://127.0.0.1:4173/", ["a", "b"], 2, 12)).toBe(
      "http://127.0.0.1:4173/#arms=a,b&every=2&k=12"
    );
  });

  // Bug: the run report misses an arm the spec's A26 run lists.
  it("carries every arm of the A26 run", () => {
    expect(ARMS).toEqual(
      expect.arrayContaining([
        "slope-0",
        "slope-8",
        "slope-0-mask",
        "slope-8-mask",
        "full",
        "fade",
        "entry",
        "glow",
        "sweep",
        "fog",
        "fog-local",
        "flip",
        "scale"
      ])
    );
  });
});
