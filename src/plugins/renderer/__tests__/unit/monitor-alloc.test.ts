import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { FrameMeasure } from "../../../time/types";
import { startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the per-frame path allocates nothing (spec 11, LEAD-FIXES-2). A dev-only
// probe: 5 000 warm-up frames, then the heap sampler of the runtime records
// 20 000 frames with no stream listener, three times, and the bytes sampled in the per-frame
// modules of the monitor, `time` and `world` stay under 1 KiB (sampling noise; a
// real allocation of one small object a frame is over 320 KiB there). Bun's
// inspector has no HeapProfiler domain: there the test is skipped and the review
// list of "The per-frame path allocates nothing" stands alone.
// ---------------------------------------------------------------------------

/** A node of a sampled heap profile. */
type ProfileNode = {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: ProfileNode[];
};

/** The modules whose code runs on the per-frame path. */
const PER_FRAME =
  /src\/plugins\/(renderer\/monitor\/(commit|ring|ticks|draw-calls|units|long-frames|api|passes|clock)|time\/(measure|phases|api|rate-rules)|world\/ecs\/systems)\.ts/;

/** An inspector session with a heap sampler, or `undefined` where the runtime has none. */
async function heapSession(): Promise<
  { post(method: string, params?: object): Promise<unknown> } | undefined
> {
  try {
    const inspector = await import("node:inspector/promises");
    const session = new inspector.Session();

    session.connect();
    await session.post("HeapProfiler.enable");

    return session;
  } catch {
    return undefined;
  }
}

const session = await heapSession();

/**
 * Sums the bytes sampled in the functions of the per-frame modules. Vite's module runner, which
 * loads the sources here, reaches every export through an anonymous accessor of its own
 * (`__vite_ssr_exportName__("cell", () => { try { return cell } catch {} })`); what is sampled in
 * those is the loader's, not the engine's: a bundle imports directly. Every function of the
 * engine's per-frame path has a name. What runs under `flushPerf`, once a second, is left out:
 * the flush is one of the allocations the spec allows.
 *
 * @param node - A node of the profile.
 * @returns The bytes of the per-frame path under it.
 */
function perFrameBytes(node: ProfileNode): number {
  if (node.callFrame.functionName === "flushPerf") return 0;

  const engine = PER_FRAME.test(node.callFrame.url) && node.callFrame.functionName !== "";
  const own = engine ? node.selfSize : 0;

  return node.children.reduce((sum, child) => sum + perFrameBytes(child), own);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await session?.post("HeapProfiler.disable");
});

describe("the per-frame path", () => {
  it("allocates under 1 KiB over 20 000 frames (skipped without a HeapProfiler, as in Bun)", async ({
    skip
  }) => {
    if (session === undefined) skip("the runtime's inspector has no HeapProfiler domain");

    const agent = await startAgent({ scene: { passes: 2, batches: 2, draws: 1 } });
    const record: Partial<FrameMeasure> = {
      gapMs: 8.3,
      capMs: 8.33,
      rateMs: 8.33,
      workMs: 2,
      phaseMs: Float32Array.of(0.2, 0.1, 0.1, 0.4, 0.1, 1)
    };
    const run = (count: number, from: number): void => {
      for (let index = 0; index < count; index += 1) {
        record.at = (from + index) * 8.33;
        agent.frame(record);
      }
    };

    run(5000, 0);

    // Three recordings, the smallest kept: a one-time event of the runtime (a tier-up, a
    // collection) lands in one of them; an allocation of every frame lands in all three.
    const sampled: number[] = [];

    for (let round = 0; round < 3; round += 1) {
      // The collected objects too: without them the profile holds only what is still alive, and
      // a per-frame allocation is garbage by the end of the run.
      await session?.post("HeapProfiler.startSampling", {
        samplingInterval: 64,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true
      });
      run(20_000, 5000 + round * 20_000);

      const answer = (await session?.post("HeapProfiler.stopSampling")) as {
        profile: { head: ProfileNode };
      };

      sampled.push(perFrameBytes(answer.profile.head));
    }

    expect(Math.min(...sampled)).toBeLessThanOrEqual(1024);
  }, 60_000);
});
