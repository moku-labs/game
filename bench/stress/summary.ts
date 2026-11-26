#!/usr/bin/env bun
/**
 * @file Reads a results folder of the stress bench: `bun bench/stress/summary.ts <dir> [--json]`. Per scene and per
 * kind of frame it prints the frame's own time (the sum of its six phases: the wait for the frame's start left out),
 * the phases, the world systems, the GPU time, and how many frames went over 16.7 and 33 ms; then the collections
 * and the heap of the scene.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { KIND_NAMES, medianOf, spreadOf } from "./lib/report";

/** The phases of a frame, in row order from column 4. */
const PHASES = ["input", "animate", "layout", "sync", "signals", "render"] as const;

/** The kinds that are a commit: its work lands in the marked frame or one of the two after it. */
const COMMITS = new Set([3, 4, 5, 6, 7]);

const [folder, flag] = process.argv.slice(2);

if (folder === undefined) {
  console.error("Usage: bun bench/stress/summary.ts <dir> [--json]");
  process.exit(2);
}

/**
 * A frame's own time: the sum of its phases.
 *
 * @param row - The row.
 * @returns Ms.
 * @example
 * ```ts
 * ownOf([0, 0, 5, 9, 1, 0, 2, 1, 0, 0.5]); // 4.5
 * ```
 */
function ownOf(row: number[]): number {
  let sum = 0;

  for (let phase = 0; phase < 6; phase += 1) sum += row[4 + phase] ?? 0;

  return sum;
}

/**
 * Groups rows by kind; a commit is the slowest of its marked frame and the two after it.
 *
 * @param rows - Every row, oldest first.
 * @returns The rows of each kind.
 */
function groupsOf(rows: number[][]): Map<number, number[][]> {
  const groups = new Map<number, number[][]>();
  const taken = new Set<number[]>();

  for (const [index, row] of rows.entries()) {
    const kind = row[1] ?? 0;

    if (!COMMITS.has(kind)) continue;

    let worst = row;

    for (const next of rows.slice(index + 1, index + 3))
      if (ownOf(next) > ownOf(worst)) worst = next;

    taken.add(worst);
    groups.set(kind, [...(groups.get(kind) ?? []), worst]);
  }

  for (const row of rows) {
    const kind = row[1] ?? 0;

    if (!COMMITS.has(kind) && !taken.has(row)) groups.set(kind, [...(groups.get(kind) ?? []), row]);
  }

  return groups;
}

/**
 * The median ms of each world system over a group, over the frames the system was one of the five slowest in.
 *
 * @param group - The rows.
 * @param systems - The names the rows index.
 * @returns Name to ms, the systems seen in at least half of the frames.
 */
function systemsOf(group: number[][], systems: readonly string[]): Record<string, number> {
  const seen = new Map<string, number[]>();

  for (const row of group) {
    for (let top = 0; top < 5; top += 1) {
      const name = systems[row[16 + top * 2] ?? -1];

      if (name !== undefined) seen.set(name, [...(seen.get(name) ?? []), row[17 + top * 2] ?? 0]);
    }
  }

  return Object.fromEntries(
    [...seen]
      .filter(([, list]) => list.length >= group.length / 2)
      .map(([name, list]) => [name, medianOf(list)] as const)
      .filter(([, ms]) => ms >= 0.1)
      .toSorted((left, right) => right[1] - left[1])
  );
}

/** The monitor's spike causes, in bit order (`PERF_CAUSES` of the engine). */
const CAUSES = ["gap", "js", "gpu", "compile", "upload", "longFrame", "gc?"];

/** Why a frame was drawn, by index (`DEMAND_REASONS` of the engine). */
const REASONS = [
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

/**
 * Counts the cause bits and the demand reasons of a group of frames: columns 26 and 27 of a row.
 *
 * @param group - The rows.
 * @returns How many frames carry each cause, and each reason.
 */
function signalsOf(group: number[][]): {
  causes: Record<string, number>;
  reasons: Record<string, number>;
} {
  const causes: Record<string, number> = {};
  const reasons: Record<string, number> = {};

  for (const row of group) {
    const bits = Math.max(0, row[26] ?? 0);
    const reason = REASONS[row[27] ?? 255] ?? "not measured";

    reasons[reason] = (reasons[reason] ?? 0) + 1;

    for (const [bit, cause] of CAUSES.entries()) {
      if ((bits & (1 << bit)) !== 0) causes[cause] = (causes[cause] ?? 0) + 1;
    }
  }

  return { causes, reasons };
}

const out: Record<string, unknown> = {};

for (const file of readdirSync(folder).filter(name => name.endsWith(".rows.json"))) {
  const { rows, systems } = JSON.parse(readFileSync(path.join(folder, file), "utf8")) as {
    rows: number[][];
    systems: string[];
  };
  const result = JSON.parse(
    readFileSync(path.join(folder, file.replace(".rows.json", ".json")), "utf8")
  ) as Record<string, unknown> & {
    scene: string;
    info?: { entities?: number; stats?: Record<string, unknown> };
  };
  const kinds: Record<string, unknown> = {};

  for (const [kind, group] of groupsOf(rows)) {
    kinds[KIND_NAMES[kind] ?? String(kind)] = {
      own: spreadOf(group.map(row => ownOf(row))),
      phases: Object.fromEntries(
        PHASES.map((name, phase) => [name, medianOf(group.map(row => row[4 + phase] ?? 0))])
      ),
      systems: systemsOf(group, systems),
      gpu: spreadOf(group.map(row => row[10] ?? -1).filter(value => value >= 0)),
      draws: medianOf(group.map(row => row[11] ?? 0)),
      ...signalsOf(group),
      rebuilds:
        Math.round((group.reduce((sum, row) => sum + (row[12] ?? 0), 0) / group.length) * 100) / 100
    };
  }

  const gaps = rows.map(row => (row[2] ?? 0) + ownOf(row));

  out[result.scene] = {
    frames: rows.length,
    fps: result.fps,
    entities: result.info?.entities,
    views: result.info?.stats?.views,
    textureMb: result.info?.stats?.textureMb,
    drawCalls: result.info?.stats?.drawCalls,
    fill: result.fill,
    over16: rows.filter(row => ownOf(row) > 16.7).length,
    over33: rows.filter(row => ownOf(row) > 33.3).length,
    // The cause bits and the demand reasons of the frames over 16.7 ms.
    peaks: signalsOf(rows.filter(row => ownOf(row) > 16.7)),
    // The wait for the frame's start added: a collection between two frames shows here, not in a phase.
    lateOver16: gaps.filter(ms => ms > 16.7).length,
    lateOver33: gaps.filter(ms => ms > 33.3).length,
    start: spreadOf(rows.map(row => row[2] ?? 0)),
    collections: result.collections,
    heap: result.heap,
    kinds
  };
}

if (flag === "--json") {
  console.log(JSON.stringify(out, undefined, 1));
} else {
  for (const [scene, value] of Object.entries(out)) {
    const entry = value as Record<string, unknown> & {
      kinds: Record<string, Record<string, unknown>>;
    };
    const { kinds, ...head } = entry;

    console.log(`\n## ${scene}\n${JSON.stringify(head)}`);
    for (const [kind, report] of Object.entries(kinds))
      console.log(`  ${kind.padEnd(7)} ${JSON.stringify(report)}`);
  }
}
