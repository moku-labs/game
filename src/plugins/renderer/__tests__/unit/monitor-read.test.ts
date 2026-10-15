import { afterEach, describe, expect, it, vi } from "vitest";
import { startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: `frames().read(into, since)` (spec 11 R8.2, review point 12): the
// overlay's allocation-free reader of the frames after its cursor.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** An agent build whose ring holds 64 frames, with `count` frames of work 1, 2, 3, … committed. */
async function withFrames(count: number) {
  const agent = await startAgent({ config: { monitor: { budgetMs: "rate", frames: 64 } } });

  for (let index = 1; index <= count; index += 1) {
    agent.frame({
      at: index,
      workMs: index,
      phaseMs: Float32Array.of(index, 0, 0, 0, 0, index / 2)
    });
  }

  return agent.mock.api.monitor.frames();
}

describe("FrameRing.read", () => {
  it("copies the newest frames after the cursor, oldest first, at most into.length of them", async () => {
    const ring = await withFrames(10);
    const into = { length: 4, workMs: new Float32Array(4) };
    const result = ring.read(into, 0);

    expect([...into.workMs]).toEqual([7, 8, 9, 10]);
    expect(result).toEqual({ copied: 4, lost: 6 });
  });

  it("copies across the wrap of the ring", async () => {
    const ring = await withFrames(70);
    const into = { length: 16, workMs: new Float32Array(16), frame: new Uint32Array(16) };
    const result = ring.read(into, 60);

    expect(result).toEqual({ copied: 10, lost: 0 });
    expect([...into.workMs.subarray(0, 10)]).toEqual([61, 62, 63, 64, 65, 66, 67, 68, 69, 70]);
    expect(into.frame[9]).toBe(70);
  });

  it("copies only the columns the caller gave, six phases a frame", async () => {
    const ring = await withFrames(3);
    const into = { length: 2, phaseMs: new Float32Array(12) };

    ring.read(into, 1);

    expect([...into.phaseMs]).toEqual([2, 0, 0, 0, 0, 1, 3, 0, 0, 0, 0, 1.5]);
    expect("workMs" in into).toBe(false);
  });

  it("counts the frames the ring overwrote before the read as lost", async () => {
    const ring = await withFrames(100);
    const result = ring.read({ length: 128, workMs: new Float32Array(128) }, 0);

    expect(result).toEqual({ copied: 64, lost: 36 });
    expect(result.copied + result.lost).toBe(ring.written - 0);
  });

  it("answers the same object every call and copies the same numbers into the same arrays", async () => {
    const ring = await withFrames(5);
    const into = { length: 8, workMs: new Float32Array(8) };
    const arrays = into.workMs;
    const first = ring.read(into, 2);
    const copied = [...into.workMs];
    const second = ring.read(into, 2);

    expect(second).toBe(first);
    expect([...into.workMs]).toEqual(copied);
    expect(into.workMs).toBe(arrays);
    expect(ring.read(into, ring.written)).toEqual({ copied: 0, lost: 0 });
  });
});

describe("the frame ring across a stop and a start", () => {
  // A reader that finds frame k at k % capacity (spec 11: the editor's overlay) would read the
  // wrong frame if a restart began writing at slot 0 again while the commit number kept counting.
  it("keeps frame k in slot k % capacity after the renderer stops and starts again", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: "rate", frames: 64 } } });

    for (let index = 1; index <= 5; index += 1) agent.frame({ at: index, workMs: index });
    await agent.mock.stop();
    await agent.mock.start();
    for (let index = 6; index <= 8; index += 1) agent.frame({ at: index, workMs: index * 10 });

    const perf = agent.mock.ctx.state.monitor.perf;
    const ring = perf?.ring;

    expect(ring?.written).toBe(8);
    // Frames 5, 6, 7 (commit numbers) were written after the restart, with work 60, 70, 80.
    expect([5, 6, 7].map(k => ring?.columns.workMs[k % 64])).toEqual([60, 70, 80]);
  });
});
