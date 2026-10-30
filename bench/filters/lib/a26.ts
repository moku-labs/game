/* eslint-disable unicorn/no-null -- a sample is JSON: "no node" is `null`. */
/**
 * @file The pure half of the A26 script: reading what adb answers, the verdict on whether the phone
 * is free, the clock samples and the arms schedule. `../a26.ts` is the half that runs adb.
 */

/** Every arm of the A26 run, in the order of one round. */
export const ARMS = [
  "slope-0",
  "slope-1",
  "slope-2",
  "slope-4",
  "slope-8",
  "slope-0-mask",
  "slope-1-mask",
  "slope-2-mask",
  "slope-4-mask",
  "slope-8-mask",
  "full",
  "fade",
  "entry",
  "glow",
  "sweep",
  "fog",
  "fog-local",
  "flip",
  "scale",
  "lens",
  "promo"
] as const;

/** The apps that may stand in front of a free phone. */
const FREE_FRONT = new Set(["com.sec.android.app.launcher", "com.android.chrome"]);

/** The windows of a locked phone. */
const LOCKED_FRONT = /^(?:NotificationShade|Keyguard|StatusBar)/;

/** A devfreq node of the GPU: Mali on the A26, `gpu` or `g3d` elsewhere. */
const GPU_NODE = /mali|gpu|g3d/i;

/** A devfreq node of the memory bus. */
const MIF_NODE = /mif|ddr|dmc/i;

/** The GPU clock the Samsung kernel keeps outside devfreq. */
const GPU_CLOCK_FILE = "/sys/kernel/gpu/gpu_clock";

/** One line of `adb forward --list` or `adb reverse --list`. */
export type PortLine = { serial: string; local: string; remote: string };

/** What the phone answered, read. */
export type PhoneReading = {
  serial: string;
  forwards: readonly PortLine[];
  reverses: readonly PortLine[];
  focus: string | undefined;
};

/** Whether the run may go on, and why not. */
export type PhoneVerdict = { free: boolean; reasons: string[] };

/** One sample of the clocks. */
export type ClockSample = {
  /** The phone's time, epoch ms: the clock of the page's frames. */
  t: number;
  /** The GPU clock as the node gives it; `null` without a node. */
  gpu: number | null;
  /** The memory clock as the node gives it; `null` without a node. */
  mif: number | null;
  /** Every devfreq node, by name. */
  nodes: Record<string, number>;
};

/** What the schedule needs. */
export type ScheduleOptions = {
  /** The seconds one arm holds. */
  slotSeconds: number;
  /** The usable frames each arm must reach. */
  minFrames: number;
  /** The frame rate the arms are planned on: the worst one expected. */
  fps: number;
  /** The frames at the head of a slot the summary drops. */
  skip: number;
};

/** One turn of the arms, planned. */
export type Schedule = {
  /** How many times every arm comes. */
  rounds: number;
  /** The whole run. */
  seconds: number;
  /** Who runs when, seconds from the start. */
  slots: { at: number; arm: string }[];
};

/**
 * Reads the answer of `adb forward --list` or `adb reverse --list`.
 *
 * @param text - What adb printed.
 * @returns One entry per line.
 * @example
 * ```ts
 * portsOf("R5CY tcp:9333 tcp:9222\n"); // [{ serial: "R5CY", local: "tcp:9333", remote: "tcp:9222" }]
 * ```
 */
export function portsOf(text: string): PortLine[] {
  return text.split("\n").flatMap(line => {
    const [serial, local, remote] = line.trim().split(/\s+/);

    return serial === undefined || local === undefined || remote === undefined
      ? []
      : [{ serial, local, remote }];
  });
}

/**
 * Reads the app in front from `dumpsys window`.
 *
 * @param dump - What dumpsys printed.
 * @returns The package or the window's name; `undefined` when nothing has the focus.
 * @example
 * ```ts
 * focusOf("mCurrentFocus=Window{7d u0 com.android.chrome/Main}"); // "com.android.chrome"
 * ```
 */
export function focusOf(dump: string): string | undefined {
  const window = /mCurrentFocus=Window\{\S+ \S+ ([^}/\s]+)/.exec(dump);

  return window?.[1];
}

/**
 * Decides whether the phone is free: no port held on it, nothing of anybody else in front.
 *
 * @param reading - What the phone answered.
 * @returns The verdict, with every reason against.
 */
export function phoneVerdict(reading: PhoneReading): PhoneVerdict {
  const held = [
    ...reading.forwards.filter(line => line.serial === reading.serial),
    ...reading.reverses
  ];
  const reasons = held.map(line => `${line.local} is held (${line.remote}).`);
  const { focus } = reading;

  if (focus === undefined) reasons.push("No app in front: the screen is off.");
  else if (LOCKED_FRONT.test(focus)) reasons.push("The phone is locked: a person unlocks it.");
  else if (!FREE_FRONT.has(focus)) reasons.push(`${focus} is in front.`);

  return { free: reasons.length === 0, reasons };
}

/**
 * Reads one block of the sampling loop: `@ <ns>`, then `<file> <value>` lines.
 *
 * @param block - The lines.
 * @returns The sample; `undefined` for a block with no time.
 * @example
 * ```ts
 * clockSample(["@ 2000000", "/sys/class/devfreq/x.mali/cur_freq 7"])?.gpu; // 7
 * ```
 */
export function clockSample(block: readonly string[]): ClockSample | undefined {
  const [time, ...lines] = block;
  const nanos = /^@ (\d+)$/.exec(time ?? "")?.[1];

  if (nanos === undefined) return undefined;

  const sample: ClockSample = {
    t: Math.floor(Number(nanos) / 1_000_000),
    gpu: null,
    mif: null,
    nodes: {}
  };
  const fallback = { gpu: undefined as number | undefined };

  for (const line of lines) {
    const [file = "", word = ""] = line.split(" ");
    const value = /^\d+$/.test(word) ? Number(word) : undefined;
    const node = /devfreq\/([^/]+)\//.exec(file)?.[1];

    if (value === undefined) continue;
    if (file === GPU_CLOCK_FILE) fallback.gpu = value;
    if (node === undefined) continue;

    sample.nodes[node] = value;
    if (GPU_NODE.test(node)) sample.gpu = value;
    if (MIF_NODE.test(node)) sample.mif = value;
  }

  sample.gpu ??= fallback.gpu ?? sample.gpu;

  return sample;
}

/**
 * Cuts the lines of the loop into samples. The last block may still grow, so it stays behind.
 *
 * @param lines - The lines so far.
 * @returns The finished samples and the lines to carry on with.
 * @example
 * ```ts
 * samplesOf(["@ 1000000", "@ 2000000"]).rest; // ["@ 2000000"]
 * ```
 */
export function samplesOf(lines: readonly string[]): {
  samples: ClockSample[];
  rest: string[];
} {
  const starts = lines.flatMap((line, index) => (line.startsWith("@ ") ? [index] : []));
  const samples = starts.slice(0, -1).flatMap((start, index) => {
    const sample = clockSample(lines.slice(start, starts[index + 1]));

    return sample === undefined ? [] : [sample];
  });

  return { samples, rest: lines.slice(starts.at(-1) ?? lines.length) };
}

/**
 * Where the clocks of a run go: beside its perf log.
 *
 * @param perfLog - The path of the perf log, when there is one.
 * @param serial - The phone.
 * @returns The path of the JSONL.
 * @example
 * ```ts
 * clocksPathOf("/runs/perf-1449.jsonl", "R5CY"); // "/runs/perf-1449.clocks.jsonl"
 * ```
 */
export function clocksPathOf(perfLog: string | undefined, serial: string): string {
  return perfLog === undefined
    ? `clocks-${serial}.jsonl`
    : perfLog.replace(/(?:\.jsonl)?$/, ".clocks.jsonl");
}

/**
 * Plans the arms: every arm in turn, one slot each, as many rounds as it takes for each arm to
 * reach its frames after the settling ones of every slot.
 *
 * @param arms - The arms of one round.
 * @param options - The slot, the frames and the frame rate.
 * @returns The plan.
 * @example
 * ```ts
 * armSchedule(["a"], { slotSeconds: 2, minFrames: 300, fps: 60, skip: 6 }).rounds; // 3
 * ```
 */
export function armSchedule(arms: readonly string[], options: ScheduleOptions): Schedule {
  const { slotSeconds, minFrames, fps, skip } = options;
  const rounds = Math.ceil(minFrames / (slotSeconds * fps - skip));
  const slots = Array.from({ length: rounds * arms.length }, (_unused, index) => ({
    at: index * slotSeconds,
    arm: arms[index % arms.length] ?? ""
  }));

  return { rounds, seconds: slots.length * slotSeconds, slots };
}

/**
 * The address that plays the arms on the page.
 *
 * @param base - The page.
 * @param arms - The arms.
 * @param every - The seconds of a slot.
 * @param ballast - The K of the ballast.
 * @returns The address.
 * @example
 * ```ts
 * armsAddress("http://127.0.0.1:4173/", ["a"], 2, 8); // "http://127.0.0.1:4173/#arms=a&every=2&k=8"
 * ```
 */
export function armsAddress(
  base: string,
  arms: readonly string[],
  every: number,
  ballast: number
): string {
  return `${base}#arms=${arms.join(",")}&every=${every}&k=${ballast}`;
}
