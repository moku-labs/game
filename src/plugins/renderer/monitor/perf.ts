/**
 * @file renderer/monitor — the performance monitor of an agent build: attaching to the application that draws (once:
 * the ring, the time listener, the long-frame observer, the host's resolution, loss and restore; then per
 * application: the passes, the compile counting and the GPU timer), the agent's spans, marks, the flow path, the pause
 * events, the thermal line, and the stop. Reached only from the agent branches of `monitor/api.ts`: a production
 * bundle carries none of it.
 */
import type { Json } from "../../model/types";
import type { ThermalReading } from "../../time/types";
import { pageNow } from "./clock";
import { commitFrame } from "./commit";
import { attachCompileCounting } from "./compiles";
import { createGlTimer } from "./gl-timer";
import { createGpuTimer } from "./gpu-timer";
import { displayOf, longFrameLine, markLine, thermalLine } from "./log";
import type { PerfChange } from "./log-types";
import { observeLongFrames } from "./long-frames";
import { attachGlPasses, createPassSink } from "./passes";
import { CHANGED, createFrameRing } from "./ring";
import { deliver, flushPerf, writeEvent } from "./stream";
import { MEASURE, type MonitorSinks, type PerfCtx, type PerfState } from "./types";

/** Flow paths the ring interns; the rest share the overflow path of id 0. */
const PATH_SLOTS = 1024;

/**
 * Notes the flow path of the frames from now on, interned once; a rest on a path other than the last rest path writes
 * an auto mark named by it.
 *
 * @param pc - The perf context.
 * @param path - The flow path.
 * @param rest - True when the flow came to rest there.
 */
export function notePath(pc: PerfCtx, path: string, rest: boolean): void {
  const { perf } = pc;
  const { paths } = perf.ring;
  let id = perf.pathIds.get(path);

  if (id === undefined && paths.length < PATH_SLOTS) {
    id = paths.length;
    paths.push(path);
    perf.pathIds.set(path, id);
  }

  perf.pathId = id ?? 0;

  if (!rest || path === perf.restPath) return;

  perf.restPath = path;
  writeMark(pc, path, true);
}

/**
 * Writes a mark into the log, so what follows has a name.
 *
 * @param pc - The perf context.
 * @param label - What follows.
 * @param auto - True for the mark of a new rest path.
 */
export function writeMark(pc: PerfCtx, label: string, auto: boolean): void {
  if (pc.perf.listeners.length > 0) deliver(pc, markLine(label, auto));
}

/**
 * Writes the thermal line of a reading of the native shell.
 *
 * @param pc - The perf context.
 * @param reading - The reading.
 */
export function writeThermal(pc: PerfCtx, reading: ThermalReading): void {
  if (pc.perf.listeners.length > 0) deliver(pc, thermalLine(reading));
}

/**
 * Writes the pause or resume event of a change of the pause stack; a pause also flushes the partial second, and a
 * resume starts the next second with its first frame.
 *
 * @param pc - The perf context.
 * @param reasons - The pause reasons now.
 * @param paused - True when the clock just paused.
 * @param resumed - True when it just resumed.
 */
export function notePauses(
  pc: PerfCtx,
  reasons: readonly string[],
  paused: boolean,
  resumed: boolean
): void {
  const detail: Record<string, Json> = { reasons: [...reasons] };

  if (paused) {
    writeEvent(pc, "pause", detail);
    pc.perf.staged[1] = pageNow();
    flushPerf(pc);
  } else if (resumed) {
    writeEvent(pc, "resume", detail);
    pc.perf.lastFlushAt = Number.NaN;
  }
}

/**
 * Notes a change of the frame running now.
 *
 * @param perf - The perf state.
 * @param change - What changed.
 */
export function noteChange(perf: PerfState, change: PerfChange): void {
  perf.flags |= CHANGED[change];
}

/**
 * Opens an agent span unless one is open: a nested begin is ignored.
 *
 * @param perf - The perf state.
 */
export function beginAgent(perf: PerfState): void {
  if (Number.isNaN(perf.agentStart)) perf.agentStart = pageNow();
}

/**
 * Closes the open agent span: its time goes into the agent phase of the frame interval it falls in, and to
 * `time.chargeAgent`, so the adaptive frame rate leaves it out too. An end without a begin is ignored.
 *
 * @param pc - The perf context.
 */
export function endAgent(pc: PerfCtx): void {
  const { perf } = pc;

  if (Number.isNaN(perf.agentStart)) return;

  const span = pageNow() - perf.agentStart;

  perf.agentStart = Number.NaN;
  perf.agentMs += span;
  pc.ctx.deps.time.chargeAgent(span);
}

/**
 * The first attach of a renderer state: the ring gets its capacity (the paths interned so far kept), the time
 * listener and the long-frame observer start, the host's resolution, loss, restore and pool trims and the end of a
 * warm-up run are heard, the flow
 * path and the display of the moment are noted. The time listener and the observer stay across restores.
 *
 * @param pc - The perf context.
 */
function attachFirst(pc: PerfCtx): void {
  const { perf, ctx, deps } = pc;
  const { host } = deps;

  perf.attached = true;

  if (perf.ring.capacity !== perf.frames) {
    const ring = createFrameRing(perf.frames, perf.events, pc.sinks.kindNames);

    ring.paths = perf.ring.paths;
    perf.ring = ring;
    perf.scratch = new Float32Array(perf.frames);
  }

  perf.frame = ctx.deps.time.snapshot().frame + 1;
  perf.lastFlushAt = Number.NaN;
  ctx.state.host.cleanups.push(ctx.deps.time.measure(measure => commitFrame(pc, measure)));
  observeLongFrames(perf.longFrames, record => {
    if (perf.listeners.length > 0) deliver(pc, longFrameLine(pc, record));
  });
  host.onResolution((from, to, reason) => {
    perf.flags |= CHANGED.resolution;
    writeEvent(pc, "resolution", { from, to, reason });
  });
  host.onLoss(() => writeEvent(pc, "device-lost", { kind: host.kind() }));
  host.onRestore(() => {
    perf.flags |= CHANGED.restore;
    writeEvent(pc, "device-restored", { kind: host.kind() });
  });
  // The trim reaches the log through the host (O24): `host/pool.ts` never imports the monitor.
  host.onTrim((reason, freedMb) => writeEvent(pc, "pool-trim", { reason, freedMb }));
  // The end of a warm-up run reaches it through sync the same way: `sync/warm.ts` never imports the monitor.
  deps.sync.onWarm(draws => writeEvent(pc, "warm", { draws }));
  notePath(pc, ctx.deps.flow.state().path, false);
  perf.display = displayOf(pc);
}

/**
 * Attaches to a WebGPU application: the pass sink in the counting encoder, the GPU timer on the engine's own device
 * with `"timestamp-query"`, the compile counting on that device.
 *
 * @param pc - The perf context.
 * @param counted - The counting classes are installed.
 * @returns The `MEASURE` bits.
 */
function attachGpu(pc: PerfCtx, counted: boolean): number {
  const { perf, sinks } = pc;
  const device = pc.ctx.state.host.ownGpu?.device;
  let bits = 0;

  if (counted) {
    const timer = device?.features.has("timestamp-query") ? createGpuTimer(device, pc) : undefined;

    sinks.passes = createPassSink(pc, timer);
    bits |= MEASURE.passes | MEASURE.stencilPasses | MEASURE.draws;

    if (timer !== undefined) {
      perf.timer = timer;
      perf.detach.push(() => timer.stop());
      bits |= MEASURE.gpu;
    }
  }

  if (device !== undefined) {
    perf.detach.push(attachCompileCounting(pc, device));
    bits |= MEASURE.compiles;
  }

  return bits;
}

/**
 * Attaches to a WebGL application: the passes on Pixi's runners, the compile counting on the context, the timer
 * where the browser has timer queries.
 *
 * @param pc - The perf context.
 * @returns The `MEASURE` bits.
 */
function attachGl(pc: PerfCtx): number {
  const { perf } = pc;
  const app = pc.ctx.state.host.app;
  const gl = pc.deps.host.gl();

  if (app === undefined || gl === undefined) return 0;

  const timer = createGlTimer(gl, app.renderer, pc);

  perf.detach.push(attachGlPasses(app.renderer, pc), attachCompileCounting(pc, gl));

  if (timer === undefined) return MEASURE.passes | MEASURE.compiles;

  perf.timer = timer;
  perf.detach.push(() => timer.stop());

  return MEASURE.passes | MEASURE.compiles | MEASURE.gpu;
}

/**
 * Attaches the measurement to the application that draws now: at the first ready and after every restore. The
 * removers of the previous application run first.
 *
 * @param pc - The perf context.
 */
export function attachPerf(pc: PerfCtx): void {
  const { perf, sinks, ctx } = pc;

  if (!perf.attached) attachFirst(pc);

  for (const off of perf.detach) off();

  perf.detach.length = 0;
  perf.timer = undefined;
  sinks.passes = undefined;
  sinks.filterKinds = ctx.state.sync.filterKinds;

  const counted = ctx.state.host.uninstallCounting !== undefined;
  const kind = pc.deps.host.kind();
  let bits = counted ? MEASURE.counted : 0;

  if (kind === "webgpu") bits |= attachGpu(pc, counted);
  else if (kind === "webgl") bits |= attachGl(pc);

  perf.measuring = bits;
}

/**
 * Stops the monitor of an agent build: the per-application removers run, the timer stops, the observer disconnects,
 * the listeners, the pending spikes and the paths go. The ring keeps its arrays (a restart of the same app reuses
 * them), empty.
 *
 * @param perf - The perf state.
 * @param sinks - The sinks.
 */
export function stopPerf(perf: PerfState, sinks: MonitorSinks): void {
  for (const off of perf.detach) off();

  perf.detach.length = 0;
  perf.timer = undefined;
  perf.longFrames.disconnect?.();
  perf.longFrames.disconnect = undefined;
  perf.longFrames.type = undefined;
  perf.listeners = [];
  perf.waiting = [];
  perf.pendingCount = 0;
  perf.pathIds.clear();
  perf.ring.paths.length = 1;
  perf.pathId = 0;
  perf.restPath = undefined;
  perf.ring.size = 0;
  perf.ring.newest = -1;
  perf.ring.passes.size = 0;
  perf.ring.passes.newest = -1;
  perf.attached = false;
  perf.lastFlushAt = Number.NaN;
  perf.agentStart = Number.NaN;
  perf.agentMs = 0;
  perf.flags = 0;
  perf.drawn = false;
  sinks.passes = undefined;
  sinks.filterKinds = undefined;
  sinks.inFrame = false;
}
