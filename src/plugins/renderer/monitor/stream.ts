/* eslint-disable unicorn/no-null -- the log is JSON: an event between frames has frame `null`, a header without a reading `null` (spec 11 R11.1). */
/**
 * @file renderer/monitor — the stream of the performance log (R11.3–4): who listens, what each new listener gets first
 * (the header, then the startup line once it is measured), what a flush writes once a second (the sample, the spikes
 * whose GPU time is known or that waited a flush, the compiles and uploads of the second, the `shader` events of the
 * compiles not sent yet, the `problem` events of the rules that crossed or stopped), and the delivery itself:
 * synchronous, in subscription order, one fresh deep-frozen line for every listener, a throwing listener warned once
 * and kept. Nothing is built while nobody listens; the ring records anyway.
 */
import type { Json } from "../../model/types";
import { nativeShell, readingOf, whenShellReady } from "../../time/native";
import { takeShaderEvents } from "./compiles";
import {
  deepFreeze,
  displayOf,
  eventLine,
  headerLine,
  sampleLine,
  shellThermal,
  slotAt,
  spikeLine,
  thermalLine,
  windowOf
} from "./log";
import type { PerfEventName, PerfLogLine } from "./log-types";
import { annotateLongFrame } from "./long-frames";
import { judgeProblems, viewLabel } from "./problems";
import { CAUSE, CHANGED, noteSubject, slotOfSequence } from "./ring";
import { buildStartup } from "./startup";
import { PENDING_SLOTS } from "./state";
import { type PerfCtx, type PerfRing, type PerfState, SECTION } from "./types";
import { cellF32, cellF64, cellU8, cellU32 } from "./units";

/** How long the header waits for the native shell to answer at page start. */
export const SHELL_WAIT_MS = 500;

/** A gap spike is annotated `compile` for a compile in one of this many frames before it: the stall comes later. */
const COMPILE_LOOKBACK = 4;

/** What a refused promise of the shell leads to: nothing, the log goes on. */
const ignore = (): void => {};

/**
 * Hands one line to one listener; a throw is warned about once per listener, and the listener stays.
 *
 * @param pc - The perf context.
 * @param listener - The listener.
 * @param line - The line, frozen already.
 */
function sendTo(pc: PerfCtx, listener: (line: PerfLogLine) => void, line: PerfLogLine): void {
  try {
    listener(line);
  } catch (error) {
    if (pc.perf.failed.has(listener)) return;

    pc.perf.failed.add(listener);
    pc.ctx.log.warn("renderer: a monitor listener failed", { error });
  }
}

/**
 * Freezes a line, deeply, and hands it to every listener in subscription order: one object for all of them.
 *
 * @param pc - The perf context.
 * @param line - A fresh line.
 */
export function deliver(pc: PerfCtx, line: PerfLogLine): void {
  const { listeners } = pc.perf;

  deepFreeze(line);

  for (const listener of listeners) sendTo(pc, listener, line);
}

/**
 * Admits a listener: its header at once, then the startup line when it was measured, then every line from now on. A
 * shell that answers its thermal reading with a promise gives the header `null` and a `thermal` line later.
 *
 * @param pc - The perf context.
 * @param listener - The listener.
 */
function admit(pc: PerfCtx, listener: (line: PerfLogLine) => void): void {
  const { perf } = pc;
  const thermal = shellThermal();
  const reading = thermal instanceof Promise ? null : thermal;

  sendTo(pc, listener, deepFreeze(headerLine(pc, reading)));

  if (perf.startup !== undefined) sendTo(pc, listener, perf.startup);

  perf.listeners = [...perf.listeners, listener];

  if (thermal instanceof Promise) {
    thermal.then(answer => deliver(pc, thermalLine(readingOf(answer))), ignore);
  }
}

/**
 * Starts waiting for the native shell once: a page without a shell, or a shell without `ready`, writes headers at
 * once; otherwise the headers wait until the shell answered or `SHELL_WAIT_MS` passed, and the listeners that came
 * meanwhile are admitted then.
 *
 * @param pc - The perf context.
 */
function settleShell(pc: PerfCtx): void {
  const { perf } = pc;

  if (perf.shell !== "unknown") return;

  const shell = nativeShell();

  if (shell?.ready === undefined) {
    perf.shell = "settled";

    return;
  }

  perf.shell = "waiting";
  whenShellReady(shell, SHELL_WAIT_MS).then(() => {
    const { waiting } = perf;

    perf.shell = "settled";
    perf.waiting = [];

    for (const listener of waiting) admit(pc, listener);
  }, ignore);
}

/**
 * Subscribes a listener to the log.
 *
 * @param pc - The perf context.
 * @param listener - Called with each line, synchronously.
 * @returns The unsubscribe; a second call does nothing.
 */
export function subscribe(pc: PerfCtx, listener: (line: PerfLogLine) => void): () => void {
  const { perf } = pc;

  settleShell(pc);

  if (perf.shell === "waiting") perf.waiting = [...perf.waiting, listener];
  else admit(pc, listener);

  let subscribed = true;

  return (): void => {
    if (!subscribed) return;

    subscribed = false;
    perf.waiting = perf.waiting.filter(other => other !== listener);
    perf.listeners = perf.listeners.filter(other => other !== listener);
  };
}

/**
 * Remembers a frame for the stream: a spike waits for its GPU result, at most 64 of them, the oldest dropped when
 * full.
 *
 * @param perf - The perf state.
 * @param sequence - The frame's commit number.
 */
export function addPending(perf: PerfState, sequence: number): void {
  if (perf.pendingCount === PENDING_SLOTS) {
    perf.pending.copyWithin(0, 1);
    perf.pendingCount -= 1;
  }

  perf.pending[perf.pendingCount] = sequence;
  perf.pendingCount += 1;
}

/**
 * Tells whether one of the 4 frames before a frame compiled, among the frames the ring still holds before it.
 *
 * @param ring - The ring.
 * @param slot - The frame's slot.
 * @returns True when one of them compiled.
 */
function compiledBefore(ring: PerfRing, slot: number): boolean {
  const age = (ring.newest - slot + ring.capacity) % ring.capacity;

  for (let back = 1; back <= COMPILE_LOOKBACK && age + back < ring.size; back += 1) {
    if (cellF32(ring.columns.compiles, (slot - back + ring.capacity) % ring.capacity) > 0)
      return true;
  }

  return false;
}

/**
 * The annotations of a spike the counters give: a compile (in the frame, or for a gap spike in one of the 4 frames
 * before it), an upload of a megabyte or more. A frame whose `shaders` or `passes` section was off counted none. Read after the
 * frame's causes are written (a gap spike reads them). No allocation.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot of the frame.
 * @returns The `CAUSE` bits of the annotations.
 */
export function annotateCounted(pc: PerfCtx, slot: number): number {
  const { ring } = pc.perf;
  const c = ring.columns;
  const late = (cellU8(c.causes, slot) & CAUSE.gap) !== 0;
  let bits = 0;

  if (cellF32(c.compiles, slot) > 0 || (late && compiledBefore(ring, slot))) bits |= CAUSE.compile;
  if (cellF32(c.uploadMb, slot) >= 1) bits |= CAUSE.upload;

  return bits;
}

/**
 * The annotations of a spike: the counters' (`annotateCounted`) and an overlapping long frame while the `longFrames`
 * section is on. Read at the flush, when late long frames have arrived, and when a GPU time lands. No allocation.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot of the frame.
 * @returns The `CAUSE` bits of the annotations.
 */
export function annotate(pc: PerfCtx, slot: number): number {
  let bits = annotateCounted(pc, slot);

  if ((pc.sinks.sections & SECTION.longFrames) !== 0 && annotateLongFrame(pc.perf, slot)) {
    bits |= CAUSE.longFrame;
  }

  return bits;
}

/**
 * Writes the spikes that may go now: each whose GPU time is known, or that was already pending at the previous flush,
 * so its GPU time had a second to land. The others wait; a spike overwritten in the ring is dropped.
 *
 * @param pc - The perf context.
 * @param windowStart - The start of the window being flushed.
 */
function flushSpikes(pc: PerfCtx, windowStart: number): void {
  const { perf } = pc;
  const { ring } = perf;
  const c = ring.columns;
  let kept = 0;

  for (let index = 0; index < perf.pendingCount; index += 1) {
    const sequence = cellF64(perf.pending, index);
    const slot = slotOfSequence(ring, sequence);

    if (slot === -1) continue;

    if (cellU8(c.gpuPartial, slot) === 0 || cellF64(c.t, slot) < windowStart) {
      c.causes[slot] = cellU8(c.causes, slot) | annotate(pc, slot);
      deliver(pc, spikeLine(pc, slot));
    } else {
      perf.pending[kept] = sequence;
      kept += 1;
    }
  }

  perf.pendingCount = kept;
}

/**
 * Writes an event of the frames of the window that compiled or uploaded, after the first drawn frame.
 *
 * @param pc - The perf context.
 * @param start - The window's start.
 * @param end - Its end.
 */
function flushLoads(pc: PerfCtx, start: number, end: number): void {
  const { ring, firstDrawnAt } = pc.perf;
  const c = ring.columns;
  const window = windowOf(ring, start, end);

  for (let age = window.first + window.count - 1; age >= window.first; age -= 1) {
    const slot = slotAt(ring, age);
    const frame = cellU32(c.frame, slot);

    // Before the first drawn frame (or with none: NaN) the compiles are the boot's, not the game's.
    if (Number.isNaN(firstDrawnAt) || cellF64(c.t, slot) <= firstDrawnAt) continue;

    const compiles = cellF32(c.compiles, slot);
    const mb = cellF32(c.uploadMb, slot);

    if (compiles > 0) deliver(pc, eventLine("compile", { frame, count: compiles }, frame));
    if (mb > 0) {
      deliver(pc, eventLine("upload", { frame, mb: Math.round(mb * 100) / 100 }, frame));
    }
  }
}

/**
 * Writes a `shader` event for every compile and shader module not sent yet that the ring still holds, boot compiles
 * included: a listener that came after the boot still gets them at its first flush.
 *
 * @param pc - The perf context.
 */
function flushShaders(pc: PerfCtx): void {
  for (const detail of takeShaderEvents(pc, entity => viewLabel(pc, entity))) {
    deliver(pc, eventLine("shader", detail, detail.frame));
  }
}

/**
 * Judges the problem rules of the second and writes a `problem` event for each that opened or cleared; without a
 * listener the rules are judged all the same, so their accumulators stay per second. Nothing while `problems` is off.
 *
 * @param pc - The perf context.
 */
function flushProblems(pc: PerfCtx): void {
  if ((pc.sinks.sections & SECTION.problems) === 0) return;

  const details = judgeProblems(pc);

  if (pc.perf.listeners.length === 0) return;

  for (const detail of details) deliver(pc, eventLine("problem", detail, pc.perf.frame));
}

/**
 * Starts a new second: the histogram, the system sums and maxima, the sections' cost and the monitor's own cost go back
 * to 0, the system accumulators grown when the world registered more systems than they hold.
 *
 * @param pc - The perf context; `perf.staged[1]` is where the next window starts.
 */
function nextSecond(pc: PerfCtx): void {
  const { perf } = pc;
  const systems = pc.ctx.deps.world.systemTimes()?.names.length ?? 0;

  if (systems > perf.secSum.length) {
    perf.secSum = new Float64Array(systems * 2);
    perf.secMax = new Float32Array(systems * 2);
  }

  perf.gapHist.fill(0);
  perf.secSum.fill(0);
  perf.secMax.fill(0);
  perf.sectionsMs.fill(0);
  perf.listenersSum = 0;
  perf.lastFlushAt = cellF64(perf.staged, 1);
}

/**
 * The flush, once a second of page clock and on a pause: the GPU batch closes, the startup line is built once after
 * the first drawn frame, and with a listener the sample of the window, the spikes that may go and the compile and
 * upload events of the window are written. Without a listener the spikes waiting are dropped.
 *
 * @param pc - The perf context; `perf.staged[1]` is the end of the window, page clock: frames that
 *   started before it are in it. Staged, not passed: a double handed to a call is boxed.
 */
export function flushPerf(pc: PerfCtx): void {
  const { perf } = pc;
  const start = perf.lastFlushAt;
  const windowEnd = cellF64(perf.staged, 1);

  perf.timer?.close();

  if (perf.startup === undefined && !Number.isNaN(perf.firstDrawnAt)) {
    const startup = deepFreeze(buildStartup(pc));

    perf.startup = startup;
    deliver(pc, startup);
  }

  if (perf.listeners.length > 0 && !Number.isNaN(start)) {
    deliver(pc, sampleLine(pc, start, windowEnd));
    flushSpikes(pc, start);
    flushLoads(pc, start, windowEnd);
    flushShaders(pc);
  } else {
    perf.pendingCount = 0;
  }

  flushProblems(pc);
  nextSecond(pc);
}

/**
 * Writes a `display` event: the screen of the moment, after a resize, a restore or a turn.
 *
 * @param pc - The perf context.
 */
export function writeDisplay(pc: PerfCtx): void {
  const display = displayOf(pc);

  pc.perf.display = display;

  if (pc.perf.listeners.length > 0) deliver(pc, eventLine("display", display, pc.perf.frame));
}

/**
 * Writes an event at the frame it happens in: a scene switch or a bundle load also marks the frame and keeps its
 * subject (the scene switched to, the bundle) for the frame's record.
 *
 * @param pc - The perf context.
 * @param name - What happened.
 * @param detail - Plain JSON about it.
 */
export function writeEvent(
  pc: PerfCtx,
  name: PerfEventName,
  detail: Readonly<Record<string, Json>>
): void {
  const { perf, sinks } = pc;

  if (name === "scene" || name === "bundle") {
    const what = name === "scene" ? detail.to : detail.bundle;

    perf.flags |= CHANGED[name];
    noteSubject(perf.events, perf.frame, name, typeof what === "string" ? what : null);
  }

  if (perf.listeners.length > 0) {
    deliver(pc, eventLine(name, detail, sinks.inFrame ? perf.frame : null));
  }
}
