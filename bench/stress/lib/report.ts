/**
 * @file What a run of the stress bench says: the rows of the frame ring grouped by what the walk did in each frame.
 * Pure: rows go in, numbers come out.
 */

/** The kinds of a frame, by the code a row carries. */
export const KIND_NAMES = [
  "rest",
  "drag",
  "slide",
  "peek",
  "turn",
  "open",
  "close",
  "merge",
  "scroll"
] as const;

/** The kinds that are a commit: its work lands in the marked frame or one of the two after it. */
const COMMITS = new Set([3, 4, 5, 6, 7]);

/** The phases of a frame, in row order from column 4. */
const PHASES = ["input", "animate", "layout", "sync", "signals", "render"] as const;

/** The spread of a list of numbers. */
export type Spread = { n: number; p50: number; p95: number; max: number };

/** What one kind of frame cost. */
export type KindReport = {
  work: Spread;
  gpu: Spread;
  phases: Record<string, number>;
  systems: Record<string, number>;
  draws: number;
  rebuilds: number;
  passes: number;
};

/**
 * The spread of a list.
 *
 * @param values - The numbers.
 * @returns Their count, median, 95th percentile and maximum, rounded to a hundredth.
 * @example
 * ```ts
 * spreadOf([1, 2, 3, 10]); // { n: 4, p50: 3, p95: 10, max: 10 }
 * ```
 */
export function spreadOf(values: number[]): Spread {
  const sorted = values.toSorted((left, right) => left - right);
  const at = (share: number): number =>
    Math.round(
      (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0) * 100
    ) / 100;

  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}

/**
 * The median of a list, rounded to a hundredth.
 *
 * @param values - The numbers.
 * @returns The middle one; 0 for none.
 * @example
 * ```ts
 * medianOf([3, 1, 2]); // 2
 * ```
 */
export function medianOf(values: number[]): number {
  return spreadOf(values).p50;
}

/**
 * The frame a commit's work landed in: the slowest of the marked frame and the two after it.
 *
 * @param rows - Every row, oldest first.
 * @param index - The marked row.
 * @returns The row.
 */
function commitRow(rows: number[][], index: number): number[] {
  let worst = rows[index] ?? [];

  for (let ahead = 1; ahead <= 2; ahead += 1) {
    const next = rows[index + ahead];

    if (next !== undefined && (next[3] ?? 0) > (worst[3] ?? 0)) worst = next;
  }

  return worst;
}

/**
 * The ms of each world system over a group of frames. A system is in a row only when it was one of the frame's five
 * slowest.
 *
 * @param group - The rows.
 * @param systems - The names the rows index.
 * @returns The ms by system name, one per frame it was in.
 */
function systemsOf(group: number[][], systems: readonly string[]): Map<string, number[]> {
  const bySystem = new Map<string, number[]>();

  for (const row of group) {
    for (let top = 0; top < 5; top += 1) {
      const name = systems[row[16 + top * 2] ?? -1];

      if (name === undefined) continue;

      bySystem.set(name, [...(bySystem.get(name) ?? []), row[17 + top * 2] ?? 0]);
    }
  }

  return bySystem;
}

/**
 * Groups the rows of a run by the kind of their frame.
 *
 * @param rows - The rows of `game.stress.drain()`, oldest first.
 * @param systems - The names of the world systems the rows index.
 * @returns A report per kind that has frames.
 */
export function reportOf(rows: number[][], systems: readonly string[]): Record<string, KindReport> {
  const groups = new Map<number, number[][]>();
  const taken = new Set<number[]>();

  for (const [index, row] of rows.entries()) {
    const kind = row[1] ?? 0;

    if (!COMMITS.has(kind)) continue;

    const commit = commitRow(rows, index);

    taken.add(commit);
    groups.set(kind, [...(groups.get(kind) ?? []), commit]);
  }

  for (const row of rows) {
    const kind = row[1] ?? 0;

    if (COMMITS.has(kind) || taken.has(row)) continue;

    groups.set(kind, [...(groups.get(kind) ?? []), row]);
  }

  const report: Record<string, KindReport> = {};

  for (const [kind, group] of groups) {
    const bySystem = systemsOf(group, systems);

    report[KIND_NAMES[kind] ?? String(kind)] = {
      work: spreadOf(group.map(row => row[3] ?? 0)),
      gpu: spreadOf(group.map(row => row[10] ?? -1).filter(value => value >= 0)),
      phases: Object.fromEntries(
        PHASES.map((name, phase) => [name, medianOf(group.map(row => row[4 + phase] ?? 0))])
      ),
      // A system is in a row only when it was one of the frame's five slowest: its median is over those frames.
      systems: Object.fromEntries(
        [...bySystem]
          .filter(([, list]) => list.length >= group.length / 2)
          .map(([name, list]) => [name, medianOf(list)])
      ),
      draws: medianOf(group.map(row => row[11] ?? 0)),
      rebuilds:
        Math.round((group.reduce((sum, row) => sum + (row[12] ?? 0), 0) / group.length) * 100) /
        100,
      passes: medianOf(group.map(row => row[13] ?? 0))
    };
  }

  return report;
}

/**
 * What the JS heap did over a run: the MB it grew between collections, per frame, and how many times it fell.
 *
 * @param rows - The rows, oldest first; column 15 is the heap in MB.
 * @returns KB allocated a frame and the collections seen.
 * @example
 * ```ts
 * heapOf([[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,10], [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,10.5]]); // { kbPerFrame: 256, collections: 0 }
 * ```
 */
export function heapOf(rows: number[][]): { kbPerFrame: number; collections: number } {
  let grown = 0;
  let collections = 0;

  for (let index = 1; index < rows.length; index += 1) {
    const step = (rows[index]?.[15] ?? 0) - (rows[index - 1]?.[15] ?? 0);

    if (step >= 0) grown += step;
    else if (step < -0.5) collections += 1;
  }

  return { kbPerFrame: Math.round((grown * 1024) / Math.max(1, rows.length - 1)), collections };
}
