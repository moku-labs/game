#!/usr/bin/env bun
/**
 * @file Reads what `walk.ts` wrote: `bun bench/stress/game/peaks.ts <dir> [--json]`. Every frame whose own time (the sum of its
 * six phases) is over 16.7 ms is a peak; so is a frame whose start came more than 16.7 ms after its vsync while its
 * own time was short (a stall before the frame: a task or a collection held the thread). Each peak is named by the
 * last action of the walk before it, and carries its phases, its slowest world systems, its GPU time, the monitor's
 * cause bits and demand reason, and the V8 collections of the trace that overlap it. Peaks are then grouped by action.
 * It also reads the bytes of the JS heap between two marks, and the per-second samples of the monitor's stream.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const PHASES = ["input", "animate", "layout", "sync", "signals", "render"] as const;
const PERF_CAUSES = ["gap", "js", "gpu", "compile", "upload", "longFrame", "gc?"];
const DEMAND_REASONS = [
  "always",
  "first",
  "resize",
  "restore",
  "layers",
  "debug",
  "wake",
  "capture",
  "request",
  "mark",
  "verify",
  "none",
  "overlay",
  "retake"
];
const [folder, flag] = process.argv.slice(2);

if (folder === undefined) {
  console.error("Usage: bun peaks.ts <dir> [--json]");
  process.exit(2);
}

type TraceEvent = {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  args?: { data?: { startTime?: number } };
};
type WalkFile = {
  name: string;
  header: Record<string, unknown>;
  cols: string[];
  rows: number[][];
  marks: Array<[number, string, string]>;
  heap: Array<[number, string, number]>;
  systems: string[];
  paths: string[];
  trace: TraceEvent[];
  walkLog: string[];
  lost: number;
  stats: Record<string, unknown>;
  memoryBefore: Record<string, number>;
  memoryAfter: Record<string, number>;
  clock: string;
};
type Peak = {
  scenario: string;
  kind: "work" | "stall";
  at: number;
  label: string;
  path: string;
  sinceMs: number;
  own: number;
  start: number;
  phases: number[];
  systems: Record<string, number>;
  gpu: number;
  rebuilds: number;
  draws: number;
  passes: number;
  uploads: number;
  uploadMb: number;
  compiles: number;
  retakes: number;
  targets: number;
  causes: string[];
  reason: string;
  gcMs: number;
  gcKind: string;
};

const round = (value: number): number => Math.round(value * 10) / 10;

function median(values: number[]): number {
  const sorted = values.toSorted((left, right) => left - right);

  return round(sorted[sorted.length >> 1] ?? 0);
}

function percentile(values: number[], share: number): number {
  const sorted = values.toSorted((left, right) => left - right);

  return round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0);
}

/** A frame's own time: the sum of its six phases, which start at `phase0` of a row. */
function ownAt(row: number[], phase0: number): number {
  return row.slice(phase0, phase0 + 6).reduce((sum, value) => sum + Math.max(0, value), 0);
}

const peaks: Peak[] = [];
const scenarios: Record<string, unknown> = {};
const gestures: Array<{ scenario: string; label: string; n: number; kb: number; kbMax: number }> =
  [];

for (const file of readdirSync(folder).filter(
  name => name.endsWith(".json") && !name.startsWith("peaks") && !name.startsWith("overdraw")
)) {
  const walk = JSON.parse(readFileSync(path.join(folder, file), "utf8")) as WalkFile;
  const { cols } = walk;
  const phase0 = walk.cols.length;
  const system0 = phase0 + 6;
  const at = {
    t: cols.indexOf("t"),
    start: cols.indexOf("startMs"),
    gpu: cols.indexOf("gpuMs"),
    draws: cols.indexOf("draws"),
    rebuilds: cols.indexOf("rebuilds"),
    passes: cols.indexOf("passes"),
    uploads: cols.indexOf("uploads"),
    uploadMb: cols.indexOf("uploadMb"),
    compiles: cols.indexOf("compiles"),
    retakes: cols.indexOf("retakes"),
    drawn: cols.indexOf("drawn"),
    causes: cols.indexOf("causes"),
    reason: cols.indexOf("reason"),
    created: cols.indexOf("targetsCreated"),
    agent: cols.indexOf("agentMs"),
    partial: cols.indexOf("gpuPartial")
  };
  // The trace clock against the page clock: the sync mark has both.
  const sync = walk.trace.find(event => event.name === "hp-sync");
  const offset =
    sync?.args?.data?.startTime === undefined
      ? undefined
      : sync.args.data.startTime - sync.ts / 1000;
  const collections = walk.trace
    .filter(event => event.ph === "X" && (event.name === "MinorGC" || event.name === "MajorGC"))
    .map(event => ({
      name: event.name,
      from: offset === undefined ? Number.NaN : event.ts / 1000 + offset,
      ms: (event.dur ?? 0) / 1000
    }));
  const rows = walk.rows.filter(row => (row[at.drawn] ?? 1) !== 0);
  const reasons = new Map<string, number>();
  const causeCount = new Map<string, number>();
  let workPeaks = 0;
  let over33 = 0;
  let stalls = 0;

  for (const row of rows) {
    const t = row[at.t] ?? 0;
    const start = Math.max(0, row[at.start] ?? 0);
    const own = ownAt(row, phase0);
    const isWork = own > 16.7;
    // A stall: the thread was held between the frame's vsync and its first phase.
    const isStall = !isWork && start > 16.7;
    const reason = DEMAND_REASONS[row[at.reason] ?? 255] ?? "not measured";
    const bits = Math.max(0, row[at.causes] ?? 0);
    const causes = PERF_CAUSES.filter((_cause, bit) => (bits & (1 << bit)) !== 0);

    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    for (const cause of causes) causeCount.set(cause, (causeCount.get(cause) ?? 0) + 1);

    if (!isWork && !isStall) continue;

    if (isWork) workPeaks += 1;
    if (own > 33.3) over33 += 1;
    if (isStall) stalls += 1;

    const to = t + start + own;
    const mark = walk.marks.findLast(entry => entry[0] <= to);
    const systems: Record<string, number> = {};

    for (let top = 0; top < 5; top += 1) {
      const name = walk.systems[row[system0 + top * 2] ?? -1];
      const ms = row[system0 + 1 + top * 2] ?? 0;

      if (name !== undefined && ms >= 0.3) systems[name] = ms;
    }

    const overlapping = collections.filter(event => event.from < to && event.from + event.ms > t);

    peaks.push({
      scenario: walk.name,
      kind: isWork ? "work" : "stall",
      at: round(t),
      label: mark?.[1] ?? "(before the walk)",
      path: mark?.[2] ?? "",
      sinceMs: round(t - (mark?.[0] ?? t)),
      own: round(own),
      start: round(start),
      phases: row.slice(phase0, phase0 + 6).map(value => round(Math.max(0, value))),
      systems,
      gpu: row[at.gpu] ?? -1,
      rebuilds: row[at.rebuilds] ?? 0,
      draws: row[at.draws] ?? 0,
      passes: row[at.passes] ?? 0,
      uploads: Math.max(0, row[at.uploads] ?? 0),
      uploadMb: Math.max(0, row[at.uploadMb] ?? 0),
      compiles: Math.max(0, row[at.compiles] ?? 0),
      retakes: Math.max(0, row[at.retakes] ?? 0),
      targets: Math.max(0, row[at.created] ?? 0),
      causes,
      reason,
      gcMs: round(overlapping.reduce((sum, event) => sum + event.ms, 0)),
      gcKind: [...new Set(overlapping.map(event => event.name))].join("+")
    });
  }

  // Bytes between two marks of one label: the heap at a mark minus the heap at the mark before it. A fall is a
  // collection in between, and that pair is left out.
  const byLabel = new Map<string, number[]>();

  for (let entry = 1; entry < walk.heap.length; entry += 1) {
    const before = walk.heap[entry - 1];
    const after = walk.heap[entry];

    if (before === undefined || after === undefined || after[2] < before[2]) continue;

    byLabel.set(before[1], [...(byLabel.get(before[1]) ?? []), (after[2] - before[2]) / 1024]);
  }

  for (const [label, list] of byLabel) {
    gestures.push({
      scenario: walk.name,
      label,
      n: list.length,
      kb: median(list),
      kbMax: round(Math.max(...list))
    });
  }

  // The per-second samples of the monitor's stream.
  let stream: Array<Record<string, unknown>> = [];

  try {
    stream = readFileSync(path.join(folder, file.replace(".json", ".stream.jsonl")), "utf8")
      .split("\n")
      .filter(line => line.startsWith("{"))
      .map(line => JSON.parse(line) as Record<string, unknown>);
  } catch {
    stream = [];
  }

  const kinds = new Map<string, number>();

  for (const line of stream) kinds.set(String(line.kind), (kinds.get(String(line.kind)) ?? 0) + 1);

  const minor = collections.filter(event => event.name === "MinorGC");
  const major = collections.filter(event => event.name === "MajorGC");
  const gpu = rows.map(row => row[at.gpu] ?? -1).filter(value => value >= 0);

  scenarios[walk.name] = {
    header: walk.header,
    frames: rows.length,
    lost: walk.lost,
    seconds: round(((rows.at(-1)?.[at.t] ?? 0) - (rows[0]?.[at.t] ?? 0)) / 1000),
    over16: workPeaks,
    over33,
    stalls,
    own: {
      p50: median(rows.map(row => ownAt(row, phase0))),
      p95: percentile(
        rows.map(row => ownAt(row, phase0)),
        0.95
      ),
      max: round(Math.max(0, ...rows.map(row => ownAt(row, phase0))))
    },
    gpu: {
      n: gpu.length,
      p50: median(gpu),
      p95: percentile(gpu, 0.95),
      partial: rows.filter(row => (row[at.partial] ?? 0) === 1).length
    },
    draws: {
      p50: median(rows.map(row => row[at.draws] ?? 0)),
      max: Math.max(0, ...rows.map(row => row[at.draws] ?? 0))
    },
    passes: {
      p50: median(rows.map(row => row[at.passes] ?? 0)),
      max: Math.max(0, ...rows.map(row => row[at.passes] ?? 0))
    },
    rebuildFrames: rows.filter(row => (row[at.rebuilds] ?? 0) > 0).length,
    agentMs: median(rows.map(row => Math.max(0, row[at.agent] ?? 0))),
    reasons: Object.fromEntries(reasons),
    causes: Object.fromEntries(causeCount),
    minorGc: {
      n: minor.length,
      ms: round(minor.reduce((sum, event) => sum + event.ms, 0)),
      max: round(Math.max(0, ...minor.map(event => event.ms)))
    },
    majorGc: {
      n: major.length,
      ms: round(major.reduce((sum, event) => sum + event.ms, 0)),
      max: round(Math.max(0, ...major.map(event => event.ms)))
    },
    traced: offset !== undefined,
    streamLines: Object.fromEntries(kinds),
    streamHeader: stream.find(line => line.kind === "header"),
    lastSample: stream.findLast(line => line.kind === "sample"),
    problems: stream
      .filter(
        line =>
          line.kind === "event" &&
          (line.name === "problem" || String(line.name).includes("problem"))
      )
      .slice(0, 20),
    memoryBefore: walk.memoryBefore,
    memoryAfter: walk.memoryAfter,
    stats: walk.stats,
    clock: walk.clock,
    log: walk.walkLog
  };
}

// Peaks by action: a commit's work can land in a few frames after it, so every peak under one label is one group.
const groups = new Map<string, Peak[]>();

for (const peak of peaks) {
  const key = `${peak.scenario} | ${peak.kind} | ${peak.label}`;

  groups.set(key, [...(groups.get(key) ?? []), peak]);
}

const table = [...groups].map(([key, list]) => {
  const systems = new Map<string, number[]>();
  const causes = new Map<string, number>();
  const reasons = new Map<string, number>();

  for (const peak of list) {
    for (const [name, ms] of Object.entries(peak.systems))
      systems.set(name, [...(systems.get(name) ?? []), ms]);
    for (const cause of peak.causes) causes.set(cause, (causes.get(cause) ?? 0) + 1);

    reasons.set(peak.reason, (reasons.get(peak.reason) ?? 0) + 1);
  }

  return {
    key,
    n: list.length,
    own: {
      p50: median(list.map(peak => peak.own)),
      max: round(Math.max(...list.map(peak => peak.own)))
    },
    start: {
      p50: median(list.map(peak => peak.start)),
      max: round(Math.max(...list.map(peak => peak.start)))
    },
    sinceMs: median(list.map(peak => peak.sinceMs)),
    phases: Object.fromEntries(
      PHASES.map((name, phase) => [name, median(list.map(peak => peak.phases[phase] ?? 0))])
    ),
    systems: Object.fromEntries(
      [...systems]
        .filter(([, values]) => values.length >= list.length / 2)
        .map(([name, values]) => [name, median(values)] as const)
        .toSorted((left, right) => right[1] - left[1])
    ),
    gpu: median(list.map(peak => peak.gpu).filter(value => value >= 0)),
    draws: median(list.map(peak => peak.draws)),
    passes: median(list.map(peak => peak.passes)),
    rebuilds: median(list.map(peak => peak.rebuilds)),
    uploads: round(list.reduce((sum, peak) => sum + peak.uploads, 0) / list.length),
    uploadMb: round(list.reduce((sum, peak) => sum + peak.uploadMb, 0) / list.length),
    compiles: round(list.reduce((sum, peak) => sum + peak.compiles, 0) / list.length),
    retakes: round(list.reduce((sum, peak) => sum + peak.retakes, 0) / list.length),
    targets: round(list.reduce((sum, peak) => sum + peak.targets, 0) / list.length),
    causes: Object.fromEntries(causes),
    reasons: Object.fromEntries(reasons),
    withGc: list.filter(peak => peak.gcMs > 0).length,
    gcMs: median(list.filter(peak => peak.gcMs > 0).map(peak => peak.gcMs)),
    gcKinds: [...new Set(list.map(peak => peak.gcKind).filter(kind => kind !== ""))].join(","),
    path: list[0]?.path
  };
});

table.sort((left, right) => right.own.max + right.start.max - (left.own.max + left.start.max));

if (flag === "--json") {
  console.log(JSON.stringify({ scenarios, groups: table, gestures, peaks }, undefined, 1));
} else {
  for (const [name, value] of Object.entries(scenarios)) {
    const rest = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([key]) => !["stats", "header", "streamHeader", "lastSample"].includes(key)
      )
    );

    console.log(name, JSON.stringify(rest));
  }

  for (const row of table) {
    console.log(
      `${String(row.n).padStart(3)}× ${row.key}\n      own ${row.own.p50}/${row.own.max} start ${row.start.p50}/${row.start.max} +${row.sinceMs}ms ` +
        `ph ${JSON.stringify(row.phases)} sys ${JSON.stringify(row.systems)} gpu ${row.gpu} draws ${row.draws} rb ${row.rebuilds} up ${row.uploads}/${row.uploadMb}MB sh ${row.compiles} causes ${JSON.stringify(row.causes)} reason ${JSON.stringify(row.reasons)} gc ${row.withGc}×${row.gcMs}ms ${row.gcKinds}`
    );
  }

  for (const entry of gestures.toSorted((left, right) => right.kb - left.kb).slice(0, 30)) {
    console.log(
      `heap ${String(entry.kb).padStart(8)} KB (max ${entry.kbMax}, n ${entry.n})  ${entry.scenario} | ${entry.label}`
    );
  }
}
