/* eslint-disable unicorn/no-null -- the startup line is JSON: a missing mark makes its field `null` (spec 11 R10). */
/**
 * @file renderer/monitor — the startup line of an agent build (R10): how the page started, in ms since
 * `performance.timeOrigin`. The page's own marks `moku:script` (with the bundle URL as detail) and `moku:main` are
 * written by spec 10 into every page; the engine's `moku:pixi-*` and `moku:init-*` marks by `host`. Built once, at the
 * first flush after the first drawn frame, so the buffered long frames have arrived.
 */
import { epochOf, pageNow } from "./clock";
import { buildId, kb } from "./log";
import { PERF_LOG_VERSION, type PerfStartupLine } from "./log-types";
import { entryOf, longFramesIn } from "./long-frames";
import type { PerfCtx } from "./types";
import { roundTo } from "./units";

/** Long frames of the boot the line lists by duration. */
const TOP_LONG_FRAMES = 5;

/**
 * A number field of a performance entry.
 *
 * @param entry - The entry, or `undefined`.
 * @param key - The field.
 * @returns The number, or `undefined`.
 */
function numberOf(entry: PerformanceEntry | undefined, key: string): number | undefined {
  const value: unknown = entry === undefined ? undefined : Reflect.get(entry, key);

  return typeof value === "number" ? value : undefined;
}

/**
 * The first mark of a name on the page's timeline.
 *
 * @param name - The mark.
 * @returns The mark, or `undefined` when the page has none.
 */
function markOf(name: string): PerformanceEntry | undefined {
  return globalThis.performance.getEntriesByName(name, "mark")[0];
}

/**
 * The time between two marks.
 *
 * @param from - The first mark.
 * @param to - The second mark.
 * @returns Milliseconds, or `null` without both.
 */
function between(from: string, to: string): number | null {
  const start = markOf(from);
  const end = markOf(to);

  return start === undefined || end === undefined
    ? null
    : roundTo(end.startTime - start.startTime, 2);
}

/**
 * The page bundle the mark `moku:script` names, from its resource timing entry.
 *
 * @param scriptMark - The mark, or `undefined`.
 * @returns The bundle's URL, when it finished downloading and its sizes, or `null`.
 */
function scriptOf(scriptMark: PerformanceEntry | undefined): PerfStartupLine["script"] {
  const url: unknown = scriptMark === undefined ? undefined : Reflect.get(scriptMark, "detail");

  if (typeof url !== "string") return null;

  const resource = globalThis.performance
    .getEntriesByType("resource")
    .find(entry => entry.name === url);

  if (resource === undefined) return null;

  return {
    url,
    fetchEndMs: roundTo(numberOf(resource, "responseEnd") ?? 0, 2),
    transferKb: kb(numberOf(resource, "transferSize") ?? 0),
    decodedKb: kb(numberOf(resource, "decodedBodySize") ?? 0)
  };
}

/**
 * Builds the startup line from the page's timeline, the engine's marks, the first drawn frame and the long frames of
 * the boot.
 *
 * @param pc - The perf context.
 * @returns A fresh startup line.
 */
export function buildStartup(pc: PerfCtx): PerfStartupLine {
  const { firstDrawnAt, longFrames } = pc.perf;
  const navigation = globalThis.performance.getEntriesByType("navigation")[0];
  const scriptMark = markOf("moku:script");
  const mainMark = markOf("moku:main");
  const script = scriptOf(scriptMark);
  const boot = longFramesIn(longFrames, 0, firstDrawnAt)
    .filter(record => record.startMs < firstDrawnAt)
    .toSorted((first, second) => second.durationMs - first.durationMs);
  const responseEnd = numberOf(navigation, "responseEnd");

  return {
    v: PERF_LOG_VERSION,
    kind: "startup",
    t: epochOf(pageNow()),
    build: buildId(),
    htmlMs: responseEnd === undefined ? null : roundTo(responseEnd, 2),
    script,
    parseMs:
      scriptMark === undefined || script === null
        ? null
        : roundTo(scriptMark.startTime - script.fetchEndMs, 2),
    evaluateMs:
      scriptMark === undefined || mainMark === undefined
        ? null
        : roundTo(mainMark.startTime - scriptMark.startTime, 2),
    pixiMs: between("moku:pixi-start", "moku:pixi-end"),
    initMs: between("moku:init-start", "moku:init-end"),
    firstFrameMs: roundTo(firstDrawnAt, 2),
    longFrames:
      longFrames.type === undefined
        ? null
        : {
            count: boot.length,
            totalMs: roundTo(
              boot.reduce((sum, record) => sum + record.durationMs, 0),
              2
            ),
            maxMs: roundTo(boot[0]?.durationMs ?? 0, 2),
            blockingMs:
              longFrames.type === "longtask"
                ? null
                : roundTo(
                    boot.reduce((sum, record) => sum + record.blockingMs, 0),
                    2
                  ),
            top: boot.slice(0, TOP_LONG_FRAMES).map(record => entryOf(record))
          }
  };
}
