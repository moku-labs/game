/* eslint-disable unicorn/no-null -- a frame record and a log line are JSON: "not measured" is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BATCH_FRAMES, createGpuTimer, type GpuTimer, PASS_SLOTS } from "../../monitor/gpu-timer";
import { frameAt, writePass } from "../../monitor/ring";
import { type AgentRenderer, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: GPU time on WebGPU (spec 11 R7, review point 14): timestamp writes per
// pass, the resolve into Pixi's command buffer, the readback per batch of up to
// eight drawn frames, a late time written into its slot.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fake GPU buffer: its bytes, and the maps a test settles by hand. */
type FakeBuffer = {
  data: ArrayBuffer;
  maps: Array<{ resolve(): void; reject(error: Error): void; size: number }>;
  mapAsync: ReturnType<typeof vi.fn>;
  getMappedRange(offset: number, size: number): ArrayBuffer;
  unmap: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

/** A fake device with `timestamp-query`: its query set and its buffers, resolve buffer first. */
function fakeDevice() {
  const buffers: FakeBuffer[] = [];
  const querySet = { destroy: vi.fn() };
  const device = {
    features: new Set(["timestamp-query"]),
    createQuerySet: vi.fn(() => querySet),
    createBuffer: vi.fn((descriptor: { size: number }) => {
      const buffer: FakeBuffer = {
        data: new ArrayBuffer(descriptor.size),
        maps: [],
        mapAsync: vi.fn(
          (_mode: number, _offset: number, size: number) =>
            new Promise<void>((resolve, reject) => buffer.maps.push({ resolve, reject, size }))
        ),
        getMappedRange: (offset, size) => buffer.data.slice(offset, offset + size),
        unmap: vi.fn(),
        destroy: vi.fn()
      };

      buffers.push(buffer);

      return buffer;
    }),
    destroy: vi.fn()
  };

  return { device, buffers, querySet };
}

/** A command encoder that records the resolves and copies. */
function fakeEncoder() {
  return { resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn() };
}

/** Writes a pass's begin and end stamps into a readback buffer, as low and high words. */
function stamp(
  buffer: FakeBuffer,
  frame: number,
  pass: number,
  begin: [number, number],
  end: [number, number]
): void {
  const view = new Uint32Array(buffer.data);
  const query = frame * 2 * PASS_SLOTS + 2 * pass;

  view.set([begin[1], begin[0], end[1], end[0]], query * 2);
}

/** Settles the maps of every readback buffer, then the queue. */
async function settle(buffers: FakeBuffer[]): Promise<void> {
  for (const buffer of buffers) for (const map of buffer.maps.splice(0)) map.resolve();
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

/** A timed agent build: the timer on its perf state. */
async function timed(): Promise<
  { agent: AgentRenderer; timer: GpuTimer } & ReturnType<typeof fakeDevice>
> {
  const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
  const fake = fakeDevice();
  const timer = createGpuTimer(fake.device as unknown as GPUDevice, agent.pc);

  agent.pc.perf.timer = timer;

  return { agent, timer, ...fake };
}

/** One frame with `passes` timed passes, recorded in the pass ring, and its resolve. */
function drawn(
  setup: { agent: AgentRenderer; timer: GpuTimer },
  passes: number
): GPURenderPassDescriptor[] {
  const { agent, timer } = setup;
  const descriptors: GPURenderPassDescriptor[] = [];

  for (let pass = 0; pass < passes; pass += 1) {
    const descriptor = { colorAttachments: [] } as GPURenderPassDescriptor;
    const sequence = writePass(
      agent.pc.perf.ring.passes,
      agent.pc.perf.frame,
      pass,
      0,
      0,
      8,
      8,
      null
    );

    timer.timePass(descriptor, sequence);
    descriptors.push(descriptor);
  }

  timer.resolve(fakeEncoder() as unknown as GPUCommandEncoder);
  agent.mock.measureFrame({ frame: agent.pc.perf.frame, workMs: 1 });

  return descriptors;
}

describe("the WebGPU timer", () => {
  it("gives the first 32 passes of a frame their own write indices, and none to the 33rd", async () => {
    const setup = await timed();
    const descriptors = drawn(setup, PASS_SLOTS + 1);
    const writes = descriptors.map(descriptor => descriptor.timestampWrites);

    expect(writes[0]).toMatchObject({ beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 });
    expect(writes[31]).toMatchObject({ beginningOfPassWriteIndex: 62, endOfPassWriteIndex: 63 });
    expect(new Set(writes.slice(0, 32)).size).toBe(32);
    expect(writes[32]).toBeUndefined();
    expect(frameAt(setup.agent.mock.api.monitor.frames(), 0)?.gpuPartial).toBe(true);
  });

  it("resolves only the written queries of a frame into its 512-byte region of the batch's buffer", async () => {
    const setup = await timed();
    const encoder = fakeEncoder();

    drawn(setup, 1);
    setup.timer.timePass({ colorAttachments: [] } as unknown as GPURenderPassDescriptor, 0);
    setup.timer.timePass({ colorAttachments: [] } as unknown as GPURenderPassDescriptor, 1);
    setup.timer.resolve(encoder as unknown as GPUCommandEncoder);

    const [querySet, first, count, resolveBuffer, offset] =
      encoder.resolveQuerySet.mock.calls[0] ?? [];

    expect([first, count, offset]).toEqual([64, 4, 512]);
    expect(querySet).toBe(setup.querySet);
    expect(resolveBuffer).toBe(setup.buffers[0]);
    expect(encoder.copyBufferToBuffer).toHaveBeenCalledWith(
      setup.buffers[0],
      512,
      setup.buffers[1],
      512,
      32
    );
  });

  it("reads back a batch at eight drawn frames and at a flush", async () => {
    const setup = await timed();

    for (let frame = 0; frame < BATCH_FRAMES - 1; frame += 1) drawn(setup, 1);

    expect(setup.buffers[1]?.mapAsync).not.toHaveBeenCalled();

    drawn(setup, 1);

    expect(setup.buffers[1]?.mapAsync).toHaveBeenCalledWith(1, 0, BATCH_FRAMES * 512);

    drawn(setup, 1);
    setup.timer.close();

    expect(setup.buffers[2]?.mapAsync).toHaveBeenCalledWith(1, 0, 512);
  });

  it("writes the stamps' difference of each pass and their sum into the frame, and clears gpuPartial", async () => {
    const setup = await timed();
    const ring = setup.agent.mock.api.monitor.frames();

    drawn(setup, 2);

    expect(frameAt(ring, 0)?.gpuPartial).toBe(true);
    expect(frameAt(ring, 0)?.gpuMs).toBeNull();

    const buffer = setup.buffers[1];

    if (buffer === undefined) throw new Error("no buffer");

    stamp(buffer, 0, 0, [0, 1_000_000], [0, 3_000_000]);
    stamp(buffer, 0, 1, [1, 0], [1, 1_500_000]);
    setup.timer.close();
    await settle(setup.buffers);

    expect(frameAt(ring, 0)?.gpuMs).toBe(3.5);
    expect(frameAt(ring, 0)?.gpuPartial).toBe(false);
    expect([...ring.passes.gpuMs.subarray(0, 2)]).toEqual([2, 1.5]);
    expect(buffer.unmap).toHaveBeenCalled();
  });

  it("skips a pass whose end is not after its start, and keeps the frame partial", async () => {
    const setup = await timed();
    const ring = setup.agent.mock.api.monitor.frames();
    const buffer = setup.buffers[1];

    if (buffer === undefined) throw new Error("no buffer");

    drawn(setup, 2);
    stamp(buffer, 0, 0, [0, 1_000_000], [0, 3_000_000]);
    stamp(buffer, 0, 1, [0, 5_000_000], [0, 5_000_000]);
    setup.timer.close();
    await settle(setup.buffers);

    expect(frameAt(ring, 0)?.gpuMs).toBe(2);
    expect(frameAt(ring, 0)?.gpuPartial).toBe(true);
  });

  it("leaves a slot alone that the ring overwrote before the readback landed", async () => {
    const setup = await timed();
    const ring = setup.agent.mock.api.monitor.frames();
    const buffer = setup.buffers[1];

    if (buffer === undefined) throw new Error("no buffer");

    drawn(setup, 1);
    stamp(buffer, 0, 0, [0, 1_000_000], [0, 3_000_000]);
    setup.timer.close();
    ring.columns.frame[ring.newest] = 999;
    await settle(setup.buffers);

    expect(ring.columns.gpuMs[ring.newest]).toBeNaN();
  });

  it("times no batch while three readbacks are busy, and frees a buffer whose map was rejected", async () => {
    const setup = await timed();

    for (let batch = 0; batch < 3; batch += 1) {
      drawn(setup, 1);
      setup.timer.close();
    }

    const untimed = drawn(setup, 1);

    expect(untimed[0]?.timestampWrites).toBeUndefined();
    expect(frameAt(setup.agent.mock.api.monitor.frames(), 0)?.gpuPartial).toBe(true);

    setup.timer.close();
    setup.buffers[1]?.maps[0]?.reject(new Error("device lost"));
    await settle([]);

    expect(drawn(setup, 1)[0]?.timestampWrites).toBeDefined();
  });

  it("marks a frame over its budget with the gpu cause when its time lands", async () => {
    const setup = await timed();
    const ring = setup.agent.mock.api.monitor.frames();
    const buffer = setup.buffers[1];

    if (buffer === undefined) throw new Error("no buffer");

    drawn(setup, 1);
    stamp(buffer, 0, 0, [0, 0], [0, 0]);
    stamp(buffer, 0, 0, [0, 1_000_000], [0, 21_000_000]);
    setup.timer.close();
    await settle(setup.buffers);

    expect(frameAt(ring, 0)?.causes).toEqual(["gpu"]);
    expect(setup.agent.pc.perf.pendingCount).toBe(1);
  });

  it("leaves a frame that drew nothing with no GPU time and no flag", async () => {
    const setup = await timed();

    setup.agent.mock.measureFrame({ workMs: 1 });

    expect(frameAt(setup.agent.mock.api.monitor.frames(), 0)).toMatchObject({
      gpuMs: null,
      gpuPartial: false
    });
  });

  it("destroys its query set and buffers when it stops", async () => {
    const setup = await timed();

    setup.timer.stop();

    expect(setup.querySet.destroy).toHaveBeenCalled();
    expect(setup.buffers.every(buffer => buffer.destroy.mock.calls.length === 1)).toBe(true);
  });
});
