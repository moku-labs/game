/**
 * @file renderer/monitor — GPU time per frame and per pass on WebGPU (R7), with the engine's own device of an agent
 * build when it has `"timestamp-query"`. The passes Pixi begins carry timestamp writes; the stamps are resolved into
 * Pixi's own command buffer (no extra submit) and read back per batch of up to eight drawn frames. A late time is
 * written into the slot of its frame and clears `gpuPartial`. Chrome rounds stamps to 0.1 ms unless its flag is set:
 * enough for a millisecond budget.
 */
import { CAUSE, sequenceOf } from "./ring";
import { addPending, annotate } from "./stream";
import type { FrameTimer, PerfCtx } from "./types";
import { cell } from "./units";

/** Passes timed per frame; the 33rd and later are untimed and mark the frame `gpuPartial`. */
export const PASS_SLOTS = 32;

/** Drawn frames one readback reads. */
export const BATCH_FRAMES = 8;

/** Queries of one frame slot: two per pass. */
const QUERIES_PER_FRAME = 2 * PASS_SLOTS;

/** Bytes of one frame slot's region: a multiple of the 256-byte `resolveQuerySet` offset alignment. */
const REGION_BYTES = QUERIES_PER_FRAME * 8;

/** Timestamp queries of the set: eight frame slots. */
const QUERY_COUNT = BATCH_FRAMES * QUERIES_PER_FRAME;

/** Bytes of the resolve buffer and of each readback buffer. */
const BUFFER_BYTES = BATCH_FRAMES * REGION_BYTES;

/** Readback buffers in turn; with three busy, the next batch is untimed. */
const READBACK_BUFFERS = 3;

/** `GPUBufferUsage.MAP_READ`. */
const MAP_READ = 0x1;

/** `GPUBufferUsage.COPY_SRC`. */
const COPY_SRC = 0x4;

/** `GPUBufferUsage.COPY_DST`. */
const COPY_DST = 0x8;

/** `GPUBufferUsage.QUERY_RESOLVE`. */
const QUERY_RESOLVE = 0x2_00;

/** `GPUMapMode.READ`. */
const MAP_MODE_READ = 0x1;

/** Nanoseconds per millisecond. */
const NS_PER_MS = 1_000_000;

/** The high word of a 64-bit stamp, as a double: no `BigInt`. */
const HIGH_WORD = 2 ** 32;

/**
 * The WebGPU timer: the frame timer plus the two calls of the counting encoder.
 */
export type GpuTimer = FrameTimer & {
  /**
   * Gives a pass of the frame running now its timestamp writes, when the frame has a slot and the
   * pass is one of the first 32.
   *
   * @param descriptor - The descriptor Pixi built for the pass.
   * @param sequence - The pass's number in the pass ring.
   */
  timePass(descriptor: GPURenderPassDescriptor, sequence: number): void;
  /**
   * Resolves the stamps the frame wrote so far into the batch's readback buffer, through Pixi's
   * own command encoder.
   *
   * @param commandEncoder - Pixi's command encoder of the render call.
   */
  resolve(commandEncoder: GPUCommandEncoder): void;
};

/**
 * The frame slots of one batch: what one readback buffer reads back.
 */
type Batch = {
  /** Timed passes of each frame slot. */
  timed: Uint8Array;
  /** 1 when a frame slot misses a pass (a 33rd one, an untimed batch). */
  partial: Uint8Array;
  /** The ring slot of each frame slot; -1 until the frame committed. */
  slots: Int32Array;
  /** The frame number of each frame slot. */
  frames: Float64Array;
  /** The pass-ring number of each timed pass. */
  passes: Float64Array;
  used: number;
};

/**
 * Everything one timer holds, made once at attach.
 */
type Timer = {
  pc: PerfCtx;
  querySet: GPUQuerySet;
  resolveBuffer: GPUBuffer;
  buffers: GPUBuffer[];
  /** 1 while a readback buffer belongs to the open batch or waits for its map. */
  busy: Uint8Array;
  /** `writes[frame * 32 + pass]`: the pre-made timestamp writes of every pass of every frame slot. */
  writes: GPURenderPassTimestampWrites[];
  /** The batch the frames of now are timed in. */
  open: Batch;
  /** What each readback buffer reads back, copied from the open batch when it closed. */
  reading: Batch[];
  /** The two map callbacks of each readback buffer. */
  onMapped: Array<() => void>;
  onFailed: Array<() => void>;
  /** The readback buffer of the open batch, -1 for an untimed one. */
  buffer: number;
  opened: boolean;
  /** The frame slot of the frame running now, -1 before its first timed pass. */
  frameSlot: number;
  stopped: boolean;
};

/**
 * Creates the arrays of one batch.
 *
 * @returns The batch, empty.
 */
function createBatch(): Batch {
  return {
    timed: new Uint8Array(BATCH_FRAMES),
    partial: new Uint8Array(BATCH_FRAMES),
    slots: new Int32Array(BATCH_FRAMES).fill(-1),
    frames: new Float64Array(BATCH_FRAMES),
    passes: new Float64Array(BATCH_FRAMES * PASS_SLOTS),
    used: 0
  };
}

/**
 * Notes the GPU time that landed for a frame: a frame over its budget gains the `gpu` cause, and
 * one that was no spike yet becomes one, waiting for the stream. A stepped frame never spikes.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot of the frame.
 */
export function noteGpuTime(pc: PerfCtx, slot: number): void {
  const { ring } = pc.perf;
  const c = ring.columns;
  const before = cell(c.causes, slot);
  const gpuMs = cell(c.gpuMs, slot);

  if (cell(c.stepped, slot) === 1 || (before & CAUSE.gpu) !== 0) return;
  if (Number.isNaN(gpuMs) || gpuMs <= cell(c.budgetMs, slot)) return;

  c.causes[slot] = before | CAUSE.gpu | (before === 0 ? annotate(pc, slot) : 0);

  if (before === 0) addPending(pc.perf, sequenceOf(ring, slot));
}

/**
 * Reads one 64-bit stamp of a mapped region.
 *
 * @param view - The mapped readback range.
 * @param query - The query's index in the range.
 * @returns Nanoseconds.
 */
function stampAt(view: Uint32Array, query: number): number {
  return cell(view, 2 * query + 1) * HIGH_WORD + cell(view, 2 * query);
}

/**
 * Writes what the readback says of one frame slot: the time of each pass into its pass-ring entry
 * while it is still there, and the sum into the frame's ring slot while the slot still holds that
 * frame. A pass whose end is not after its start is skipped, and the frame stays partial.
 *
 * @param timer - The timer.
 * @param batch - The batch read back.
 * @param view - The mapped range.
 * @param frame - The frame slot.
 */
function readFrame(timer: Timer, batch: Batch, view: Uint32Array, frame: number): void {
  const { columns, passes } = timer.pc.perf.ring;
  const count = cell(batch.timed, frame);
  let sum = 0;
  let whole = cell(batch.partial, frame) === 0;

  for (let pass = 0; pass < count; pass += 1) {
    const start = stampAt(view, frame * QUERIES_PER_FRAME + 2 * pass);
    const end = stampAt(view, frame * QUERIES_PER_FRAME + 2 * pass + 1);
    const sequence = cell(batch.passes, frame * PASS_SLOTS + pass);

    if (start > 0 && end > start) {
      const ms = (end - start) / NS_PER_MS;

      sum += ms;

      if (passes.written - sequence <= passes.capacity) {
        passes.gpuMs[sequence % passes.capacity] = ms;
      }
    } else {
      whole = false;
    }
  }

  const slot = cell(batch.slots, frame);

  if (count === 0 || slot < 0 || cell(columns.frame, slot) !== cell(batch.frames, frame)) return;

  columns.gpuMs[slot] = sum;

  if (whole) columns.gpuPartial[slot] = 0;

  noteGpuTime(timer.pc, slot);
}

/**
 * The success callback of a readback buffer's map: every frame slot of its batch, then the unmap.
 *
 * @param timer - The timer.
 * @param index - The readback buffer.
 */
function readBack(timer: Timer, index: number): void {
  const batch = timer.reading[index];
  const target = timer.buffers[index];

  timer.busy[index] = 0;

  if (batch === undefined || target === undefined || timer.stopped) return;

  const view = new Uint32Array(target.getMappedRange(0, batch.used * REGION_BYTES));

  for (let frame = 0; frame < batch.used; frame += 1) readFrame(timer, batch, view, frame);

  target.unmap();
}

/**
 * Hands the open batch to its readback buffer. An untimed batch (no buffer was free) is only
 * dropped: its frames keep NaN and the flag.
 *
 * @param timer - The timer.
 */
function closeBatch(timer: Timer): void {
  if (!timer.opened) return;

  const index = timer.buffer;
  const batch = timer.reading[index];
  const target = timer.buffers[index];
  const { open } = timer;
  const used = open.used;

  timer.opened = false;
  timer.buffer = -1;
  timer.frameSlot = -1;
  open.used = 0;

  if (batch === undefined || target === undefined) return;

  batch.timed.set(open.timed);
  batch.partial.set(open.partial);
  batch.slots.set(open.slots);
  batch.frames.set(open.frames);
  batch.passes.set(open.passes);
  batch.used = used;
  target
    .mapAsync(MAP_MODE_READ, 0, used * REGION_BYTES)
    .then(timer.onMapped[index], timer.onFailed[index])
    .catch(timer.onFailed[index]);
}

/**
 * Gives the frame running now a frame slot of the open batch, opening the batch on a free readback
 * buffer when needed; with none free the batch is untimed and its frames are partial.
 *
 * @param timer - The timer.
 */
function reserveFrame(timer: Timer): void {
  const { open } = timer;

  if (!timer.opened) {
    timer.opened = true;
    timer.buffer = timer.busy.indexOf(0);

    if (timer.buffer !== -1) timer.busy[timer.buffer] = 1;
  }

  timer.frameSlot = open.used;
  open.used += 1;
  open.timed[timer.frameSlot] = 0;
  open.partial[timer.frameSlot] = timer.buffer === -1 ? 1 : 0;
  open.slots[timer.frameSlot] = -1;
}

/**
 * Sets the timestamp writes of a pass of the frame running now.
 *
 * @param timer - The timer.
 * @param descriptor - The descriptor Pixi built for the pass.
 * @param sequence - The pass's number in the pass ring.
 */
function timePass(timer: Timer, descriptor: GPURenderPassDescriptor, sequence: number): void {
  if (timer.stopped) return;
  if (timer.frameSlot === -1) reserveFrame(timer);
  if (timer.buffer === -1) return;

  const { open } = timer;
  const pass = cell(open.timed, timer.frameSlot);
  const write = timer.writes[timer.frameSlot * PASS_SLOTS + pass];

  if (pass >= PASS_SLOTS || write === undefined) {
    open.partial[timer.frameSlot] = 1;

    return;
  }

  descriptor.timestampWrites = write;
  open.passes[timer.frameSlot * PASS_SLOTS + pass] = sequence;
  open.timed[timer.frameSlot] = pass + 1;
}

/**
 * Resolves the queries the frame wrote so far, and copies them into the frame's region of the
 * batch's buffer: only the written ones; a frame of several render calls resolves its region again
 * with the longer range.
 *
 * @param timer - The timer.
 * @param commandEncoder - Pixi's command encoder of the render call.
 */
function resolveFrame(timer: Timer, commandEncoder: GPUCommandEncoder): void {
  if (timer.frameSlot === -1) return;

  const target = timer.buffers[timer.buffer];
  const count = cell(timer.open.timed, timer.frameSlot);
  const offset = timer.frameSlot * REGION_BYTES;

  if (target === undefined || count === 0) return;

  commandEncoder.resolveQuerySet(
    timer.querySet,
    timer.frameSlot * QUERIES_PER_FRAME,
    2 * count,
    timer.resolveBuffer,
    offset
  );
  commandEncoder.copyBufferToBuffer(timer.resolveBuffer, offset, target, offset, 2 * count * 8);
}

/**
 * Ties the frame's slot of the batch to its ring slot, marks it partial until its time lands, and
 * closes a full batch.
 *
 * @param timer - The timer.
 * @param slot - The ring slot of the frame.
 * @param frame - Its frame number.
 */
function commitTimed(timer: Timer, slot: number, frame: number): void {
  if (timer.frameSlot === -1) return;

  timer.open.slots[timer.frameSlot] = slot;
  timer.open.frames[timer.frameSlot] = frame;
  timer.pc.perf.ring.columns.gpuPartial[slot] = 1;
  timer.frameSlot = -1;

  if (timer.open.used === BATCH_FRAMES) closeBatch(timer);
}

/**
 * Creates the WebGPU timer of one application: one query set of 512 timestamps, one resolve
 * buffer and three readback buffers, 256 pre-made timestamp writes, and the two map callbacks
 * of each buffer, all made here, never per frame.
 *
 * @param device - The engine's own device, with `"timestamp-query"`.
 * @param pc - The perf context.
 * @returns The timer.
 */
export function createGpuTimer(device: GPUDevice, pc: PerfCtx): GpuTimer {
  const querySet = device.createQuerySet({ type: "timestamp", count: QUERY_COUNT });
  const timer: Timer = {
    pc,
    querySet,
    resolveBuffer: device.createBuffer({ size: BUFFER_BYTES, usage: QUERY_RESOLVE | COPY_SRC }),
    buffers: Array.from({ length: READBACK_BUFFERS }, () =>
      device.createBuffer({ size: BUFFER_BYTES, usage: MAP_READ | COPY_DST })
    ),
    busy: new Uint8Array(READBACK_BUFFERS),
    writes: Array.from({ length: BATCH_FRAMES * PASS_SLOTS }, (_write, index) => {
      const first = Math.floor(index / PASS_SLOTS) * QUERIES_PER_FRAME + 2 * (index % PASS_SLOTS);

      return { querySet, beginningOfPassWriteIndex: first, endOfPassWriteIndex: first + 1 };
    }),
    open: createBatch(),
    reading: Array.from({ length: READBACK_BUFFERS }, createBatch),
    onMapped: [],
    onFailed: [],
    buffer: -1,
    opened: false,
    frameSlot: -1,
    stopped: false
  };

  for (let index = 0; index < READBACK_BUFFERS; index += 1) {
    timer.onMapped.push(() => readBack(timer, index));
    timer.onFailed.push(() => {
      timer.busy[index] = 0;
    });
  }

  return {
    kind: "timestamp-query",
    timePass: (descriptor, sequence) => timePass(timer, descriptor, sequence),
    resolve: commandEncoder => resolveFrame(timer, commandEncoder),
    commit: (slot, frame) => commitTimed(timer, slot, frame),
    close: () => closeBatch(timer),
    stop: () => {
      timer.stopped = true;
      querySet.destroy();
      timer.resolveBuffer.destroy();

      for (const buffer of timer.buffers) buffer.destroy();
    }
  };
}
