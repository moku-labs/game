import { afterEach, describe, expect, it, vi } from "vitest";
import { frameAt } from "../../monitor/ring";
import { startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the `gc?` hint (spec 11 R8.5, editor review point 11): a gap spike with
// little work and a heap drop of half a megabyte or more. A hint, never more.
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis.performance, "memory");
});

/** The heap `performance.memory` reports, as Chromium does. */
function stubHeap(): { bytes: number } {
  const heap = { bytes: 64 * MB };

  Object.defineProperty(globalThis.performance, "memory", {
    configurable: true,
    get: () => ({ usedJSHeapSize: heap.bytes })
  });

  return heap;
}

/** The causes of a gap of `gapMs` (40 ms) with `workMs` of work, after the heap dropped by `dropMb`. */
async function causesAfter(
  dropMb: number,
  workMs: number,
  heap = true,
  gapMs = 40
): Promise<readonly string[]> {
  const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
  const memory = heap ? stubHeap() : undefined;

  agent.frame({ gapMs: 16.7, workMs: 1 });
  if (memory !== undefined) memory.bytes -= dropMb * MB;
  agent.frame({ gapMs, workMs });

  return frameAt(agent.mock.api.monitor.frames(), 0)?.causes ?? [];
}

describe("the gc? hint", () => {
  it("marks a gap spike with little work after the heap dropped by 0.6 MB", async () => {
    expect(await causesAfter(0.6, 2)).toEqual(["gap", "gc?"]);
  });

  it("leaves a drop of 0.4 MB, a frame with much work and a page without performance.memory unmarked", async () => {
    expect(await causesAfter(0.4, 2)).toEqual(["gap"]);
    expect(await causesAfter(0.6, 12)).toEqual(["gap"]);
    expect(await causesAfter(0.6, 2, false)).toEqual(["gap"]);
  });

  it("needs a gap of 500 ms at most: a longer one is no collection", async () => {
    expect(await causesAfter(0.6, 2, true, 500)).toEqual(["gap", "gc?"]);
    expect(await causesAfter(0.6, 2, true, 501)).toEqual(["gap"]);
  });
});
