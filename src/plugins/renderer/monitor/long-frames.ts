/* eslint-disable unicorn/no-null -- a long frame of the log is JSON: "not measured" is `null` (spec 11 R11.1). */
/**
 * @file renderer/monitor — Long Animation Frames and the heap of an agent build. A `PerformanceObserver` delivers the
 * long frames (with script attribution where the browser has LoAF, without it for `longtask`, none on WebKit) into a
 * ring of 64 pre-made records; the heap is Chromium's `performance.memory`. The observer callback runs on the
 * browser's entry list, never per frame.
 */
import type { LongFrameEntry } from "./log-types";
import { sectionOn } from "./sections";
import {
  type LongFrameRecord,
  type LongFrameRing,
  type MonitorSinks,
  type PerfState,
  type ScriptRecord,
  SECTION
} from "./types";
import { BYTES_PER_MB, cellF32, cellF64, roundTo } from "./units";

/** The entry types the observer takes, the better first. */
type LongFrameType = "long-animation-frame" | "longtask";

/**
 * Reads one field of a browser object; the structural reader of the entries TypeScript's DOM lib does not type.
 *
 * @param value - The object.
 * @param key - The field.
 * @returns The field's value; `undefined` when `value` is no object.
 */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/**
 * A number field of a browser object.
 *
 * @param value - The object.
 * @param key - The field.
 * @returns The number, or NaN when the field is no number.
 */
function numberField(value: unknown, key: string): number {
  const found = field(value, key);

  return typeof found === "number" ? found : Number.NaN;
}

/**
 * A string field of a browser object.
 *
 * @param value - The object.
 * @param key - The field.
 * @returns The string by reference, or "" when the field is no string.
 */
function stringField(value: unknown, key: string): string {
  const found = field(value, key);

  return typeof found === "string" ? found : "";
}

/**
 * The time of a LoAF moment relative to the frame's start; NaN for a moment the entry did not have.
 *
 * @param entry - The entry.
 * @param key - `renderStart` or `styleAndLayoutStart`.
 * @param start - The entry's `startTime`.
 * @returns Milliseconds after the start, or NaN.
 */
function sinceStart(entry: unknown, key: string, start: number): number {
  const moment = numberField(entry, key);

  return moment > 0 ? moment - start : Number.NaN;
}

/**
 * Keeps the three scripts of a LoAF entry that took longest, into the record's pre-made script records, the strings
 * by reference.
 *
 * @param record - The record of the entry.
 * @param entry - The entry.
 */
function keepScripts(record: LongFrameRecord, entry: unknown): void {
  const scripts = field(entry, "scripts");

  record.scriptCount = 0;

  if (!Array.isArray(scripts)) return;

  const ranked = scripts
    .filter(script => typeof field(script, "duration") === "number")
    .toSorted((first, second) => numberField(second, "duration") - numberField(first, "duration"));

  for (const [index, script] of ranked.slice(0, record.scripts.length).entries()) {
    const kept: ScriptRecord | undefined = record.scripts[index];

    if (kept === undefined) continue;

    kept.invoker = stringField(script, "invoker");
    kept.type = stringField(script, "invokerType");
    kept.source = stringField(script, "sourceURL");
    kept.fn = stringField(script, "sourceFunctionName");
    kept.ms = numberField(script, "duration");
    kept.forcedLayoutMs = numberField(script, "forcedStyleAndLayoutDuration");
    record.scriptCount = index + 1;
  }
}

/**
 * Writes one entry of the observer into the next record of the ring.
 *
 * @param ring - The long-frame ring.
 * @param entry - A `long-animation-frame` or `longtask` entry.
 * @returns The record written.
 */
export function writeLongFrame(ring: LongFrameRing, entry: PerformanceEntry): LongFrameRecord {
  const record = ring.records[ring.next];

  ring.next = (ring.next + 1) % ring.records.length;
  ring.size = Math.min(ring.size + 1, ring.records.length);

  if (record === undefined) {
    throw new Error(
      "[game] renderer: the long-frame ring has no record.\n  The ring is made with 64; this is an engine bug."
    );
  }

  const start = entry.startTime;

  record.startMs = start;
  record.durationMs = entry.duration;
  record.blockingMs = numberField(entry, "blockingDuration");
  record.renderStartMs = sinceStart(entry, "renderStart", start);
  record.styleLayoutMs = sinceStart(entry, "styleAndLayoutStart", start);
  keepScripts(record, entry);

  return record;
}

/**
 * Observes the long frames from the first attach on: `long-animation-frame` where the browser has it, else
 * `longtask` (no script attribution), else nothing. `buffered: true`, so the boot entries arrive too. While the
 * `longFrames` section is off the entries are dropped: none is kept and none delivered.
 *
 * @param ring - The long-frame ring; it keeps the type observed and the disconnect.
 * @param sinks - The sinks: their section bits say whether long frames are kept.
 * @param deliver - Called with each record the observer writes.
 */
export function observeLongFrames(
  ring: LongFrameRing,
  sinks: MonitorSinks,
  deliver: (record: LongFrameRecord) => void
): void {
  const Observer = globalThis.PerformanceObserver;

  if (typeof Observer !== "function") return;

  // A runtime without the static list (Bun) supports neither type.
  const listed: unknown = Reflect.get(Observer, "supportedEntryTypes");
  const supported: readonly unknown[] = Array.isArray(listed) ? listed : [];
  let type: LongFrameType | undefined;

  if (supported.includes("long-animation-frame")) type = "long-animation-frame";
  else if (supported.includes("longtask")) type = "longtask";

  if (type === undefined) return;

  const observer = new Observer(list => {
    if (!sectionOn(sinks, SECTION.longFrames)) return;

    for (const entry of list.getEntries()) deliver(writeLongFrame(ring, entry));
  });

  observer.observe({ type, buffered: true });
  ring.type = type;
  ring.disconnect = (): void => observer.disconnect();
}

/**
 * A number of a record, or `null` for "not measured".
 *
 * @param value - The value.
 * @returns The value rounded to 0.01 ms, or `null` for NaN.
 * @example
 * ```ts
 * measuredMs(Number.NaN); // null
 * ```
 */
function measuredMs(value: number): number | null {
  return Number.isNaN(value) ? null : roundTo(value, 2);
}

/**
 * A long frame as the log carries it.
 *
 * @param record - The record.
 * @returns A fresh entry, its scripts copied.
 */
export function entryOf(record: LongFrameRecord): LongFrameEntry {
  return {
    startMs: roundTo(record.startMs, 2),
    durationMs: roundTo(record.durationMs, 2),
    blockingMs: measuredMs(record.blockingMs),
    renderStartMs: measuredMs(record.renderStartMs),
    styleLayoutMs: measuredMs(record.styleLayoutMs),
    scripts: record.scripts.slice(0, record.scriptCount).map(script => ({
      invoker: script.invoker,
      type: script.type,
      source: script.source,
      fn: script.fn,
      ms: roundTo(script.ms, 2),
      forcedLayoutMs: roundTo(script.forcedLayoutMs, 2)
    }))
  };
}

/**
 * The records of the ring that overlap a span of the page clock, oldest first.
 *
 * @param ring - The long-frame ring.
 * @param start - The span's start.
 * @param end - The span's end.
 * @returns The records.
 */
export function longFramesIn(ring: LongFrameRing, start: number, end: number): LongFrameRecord[] {
  const found: LongFrameRecord[] = [];

  for (let age = ring.size - 1; age >= 0; age -= 1) {
    const record = ring.records[(ring.next - 1 - age + ring.records.length) % ring.records.length];

    if (
      record !== undefined &&
      record.startMs < end &&
      record.startMs + record.durationMs > start
    ) {
      found.push(record);
    }
  }

  return found;
}

/**
 * Tells whether a long frame overlaps a span of the page clock: the `longFrame` annotation of a spike. No allocation.
 *
 * @param ring - The long-frame ring.
 * @param start - The span's start.
 * @param end - The span's end.
 * @returns True when one overlaps.
 */
export function overlapsLongFrame(ring: LongFrameRing, start: number, end: number): boolean {
  for (let age = 0; age < ring.size; age += 1) {
    const record = ring.records[(ring.next - 1 - age + ring.records.length) % ring.records.length];

    if (
      record !== undefined &&
      record.startMs < end &&
      record.startMs + record.durationMs > start
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Tells whether a long frame overlaps the frame of a ring slot, from the start of its gap to the end of its work:
 * the `longFrame` annotation of a spike.
 *
 * @param perf - The perf state.
 * @param slot - The ring slot of the frame.
 * @returns True when one overlaps it.
 */
export function annotateLongFrame(perf: PerfState, slot: number): boolean {
  const c = perf.ring.columns;
  const t = cellF64(c.t, slot);
  const gap = cellF32(c.gapMs, slot);

  return overlapsLongFrame(
    perf.longFrames,
    Number.isNaN(gap) ? t : t - gap,
    t + cellF32(c.workMs, slot)
  );
}

/**
 * Chromium's `performance` with its `memory`: the one field the heap read takes. Absent elsewhere.
 */
type MemoryPerformance = Performance & { readonly memory?: { readonly usedJSHeapSize: number } };

/**
 * The heap the page uses, in bytes: Chromium's `performance.memory.usedJSHeapSize`. Read every frame: one property
 * load of one shape, no guard shared with the entry readers, so the read stays monomorphic.
 *
 * @returns The bytes, or NaN elsewhere.
 */
export function usedHeapBytes(): number {
  const memory = (globalThis.performance as MemoryPerformance).memory;

  return memory === undefined ? Number.NaN : memory.usedJSHeapSize;
}

/**
 * The heap the page uses for a sample.
 *
 * @returns MiB with 2 decimals, or `null` where the browser does not say.
 */
export function heapMb(): number | null {
  const bytes = usedHeapBytes();

  return Number.isNaN(bytes) ? null : roundTo(bytes / BYTES_PER_MB, 2);
}
