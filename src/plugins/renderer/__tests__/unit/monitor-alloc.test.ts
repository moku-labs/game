import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { FrameMeasure } from "../../../time/types";
import { Layer } from "../../../world/ecs/define";
import { Sprite, Transform } from "../../components";
import type { PerfLogLine } from "../../monitor/log-types";
import type { PixiFilter } from "../../types";
import {
  FakeFilter,
  FakeFilterSystem,
  type FakeGpuEncoderSystem,
  type FakeGpuTextureSystem,
  fakeExtensions,
  WEBGPU_SYSTEM
} from "../fake-pixi";
import { type AgentRenderer, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the per-frame path allocates nothing (spec 11, LEAD-FIXES-2). A dev-only probe: 5 000 warm-up frames, then the
// heap sampler of the runtime records 20 000 frames of 8.33 ms three times, the smallest recording of each sum kept: a
// one-time event of the runtime (a tier-up, a collection) lands in one of them, an allocation of every frame in all
// three. It runs with no stream listener, and with one attached as the editor's recorder attaches it (`monitor.stream`,
// here through the harness's `listen()`): then every flush builds the sample line and reads the window's columns. One
// frame of every 120 comes late, a gap spike a second, whose line the flush builds.
//
// What one recording may allocate, in the engine's own functions:
// - a steady frame, everything outside the flush and outside the annotation of a spike: 1 KiB in all, sampling noise.
//   One boxed double a frame is 20 000 heap numbers, over 300 KiB.
// - a spike frame, the annotation of its causes (`annotate`, `gapJudged`): 256 bytes a spike. That code runs once a
//   second, too seldom to be optimized, and an unoptimized read of a double boxes it: measured at about 60 bytes. The
//   spike's line is built at the flush; built at the commit it would be over 2 KiB a spike.
// - the flush, once a second, the monitor's code under `flushPerf`: 12 KiB a flush. With a listener it builds the
//   sample line, the spike line of the second, the problem judgment, and freezes them: measured at about 10.4 KiB. One
//   heap number for every frame of the window, 120 of them, adds about 2 KiB a flush. The column reader the monitor
//   shared by every array kind went generic once the flush read a fifth kind, and boxed every double it read: about
//   100 KiB a flush, and 1.2 KiB a steady frame.
// Bun's inspector has no HeapProfiler domain: there the test is skipped and the review list of "The per-frame path
// allocates nothing" stands alone.
// ---------------------------------------------------------------------------

/** A node of a sampled heap profile. */
type ProfileNode = {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: ProfileNode[];
};

/** Where a sampled allocation belongs: a steady frame, the annotation of a spike, the flush. */
type Part = "frame" | "spike" | "flush";

/** What one recording sampled: the bytes of each part, and the heaviest functions. */
type Sampled = Record<Part, number> & { top: string };

/**
 * The modules whose code runs on the per-frame path: every module of the monitor and of `demand`, the renderer's frame
 * callback, `time` and `world`.
 */
const PER_FRAME =
  /src\/plugins\/(renderer\/(monitor\/[\w-]+|demand\/[\w-]+|lifecycle)|time\/(measure|phases|api|rate-rules)|world\/ecs\/systems)\.ts/;

/** The monitor's modules: what the flush allocates is counted in them, a listener's own work left out. */
const MONITOR = /src\/plugins\/renderer\/monitor\/[\w-]+\.ts/;

/** The function the flush runs in, once a second. */
const FLUSH = "flushPerf";

/** The functions of the commit that run for a spike frame only. */
const SPIKE_ONLY: ReadonlySet<string> = new Set(["annotate", "gapJudged"]);

/** The page clock between two frames, ms. */
const FRAME_MS = 8.33;

/** Frames of one recording. */
const RECORDED = 20_000;

/** One frame of every this many comes late: a gap spike a second at 120 Hz. */
const SPIKE_EVERY = 120;

/** The flushes of one recording: a flush a second. */
const FLUSHES = Math.floor((RECORDED * FRAME_MS) / 1000);

/** The spike frames of one recording. */
const SPIKES = Math.ceil(RECORDED / SPIKE_EVERY);

/** At most this many bytes of one recording on its steady frames: sampling noise. */
const FRAME_BYTES = 1024;

/** At most this many bytes of the annotation of one spike frame. */
const SPIKE_BYTES = 256;

/** At most this many bytes of one flush: its lines, once a second. */
const FLUSH_BYTES = 12 * 1024;

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
 * Sums the bytes sampled in the engine's functions of a profile by part: the flush counts the monitor's modules, a
 * frame the per-frame modules. Vite's module runner, which loads the sources here, reaches every export through an
 * anonymous accessor of its own (`__vite_ssr_exportName__("cellF32", () => { try { return cellF32 } catch {} })`);
 * what is sampled in those is the loader's, not the engine's: a bundle imports directly. Every function of the engine's
 * per-frame path has a name. The sampler books an allocation to the optimized function a callee was inlined into.
 *
 * @param node - A node of the profile.
 * @param part - The part of the node's caller.
 * @param into - The bytes of each part, and of each function, `part file:name`.
 */
function sampleInto(
  node: ProfileNode,
  part: Part,
  into: Record<Part, number> & { by: Map<string, number> }
): void {
  const { functionName, url } = node.callFrame;
  let own = part;

  if (functionName === FLUSH) own = "flush";
  else if (own === "frame" && SPIKE_ONLY.has(functionName)) own = "spike";

  const counted = functionName !== "" && (own === "flush" ? MONITOR : PER_FRAME).test(url);

  if (counted && node.selfSize > 0) {
    const file = url.slice(url.indexOf("/src/") + "/src/".length).split("?")[0] ?? url;
    const key = `${own} ${file}:${functionName}`;

    into[own] += node.selfSize;
    into.by.set(key, (into.by.get(key) ?? 0) + node.selfSize);
  }

  for (const child of node.children) sampleInto(child, own, into);
}

/**
 * Adds the per-frame work of the 0.15 telemetry to every frame: a filtered view whose filter applies with a pass of
 * its own inside (the owner table, the pass detail, the problem run), and a render target Pixi looks up again (the
 * target set's lookup). Made once: the work allocates nothing itself.
 *
 * @param agent - The started agent build.
 */
function filterEveryFrame(agent: AgentRenderer): void {
  const { mock } = agent;
  const Encoder = fakeExtensions.named(WEBGPU_SYSTEM, "encoder") as unknown as new (
    renderer: unknown
  ) => FakeGpuEncoderSystem;
  const Filters = fakeExtensions.named(
    WEBGPU_SYSTEM,
    "filter"
  ) as unknown as new () => FakeFilterSystem;
  const Textures = fakeExtensions.named(
    WEBGPU_SYSTEM,
    "texture"
  ) as unknown as new () => FakeGpuTextureSystem;
  const target = { isRoot: true, pixelWidth: 256, pixelHeight: 256 };
  const encoder = new Encoder({ renderTarget: { renderTarget: target }, drawn: 0 });
  const filters = new Filters();
  const textures = new Textures();
  const fog = new FakeFilter();
  const input = { frame: { width: 256, height: 256 }, source: { resolution: 1 } };
  const source = {
    uploadMethodId: "unknown",
    resource: undefined,
    pixelWidth: 256,
    pixelHeight: 256
  };
  const descriptor = { descriptor: {} };

  encoder.record = false;
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  const entity = mock.world.ecs.spawn({ kind: "plugin", name: "probe" }, [
    Layer({ name: "items" }),
    Transform(),
    Sprite({ texture: "board.fog" })
  ]);

  mock.modules.sync.pass();
  mock.api.sync.filters.set(entity, [
    { filter: fog as unknown as PixiFilter, passes: 1, kind: "fog" }
  ]);
  textures.initSource(source);
  // The fake keeps the filters it applied. Emptied every frame, its list would grow a new backing store at every
  // apply: the fake's allocation, which the sampler books to the engine's `applyFilter` whenever the optimizer inlines
  // the fake into it. One entry stays, and the list is cut back to it, inside its capacity.
  filters.applied.push(fog);
  FakeFilterSystem.onApply = () => {
    encoder.beginRenderPass(descriptor);
    encoder.draw(descriptor);
  };
  mock.frames.unshift({
    phase: "render",
    callback: () => {
      filters.applied.length = 1;
      filters.applyFilter(fog, input, descriptor, true);
      textures.initSource(source);
    }
  });
}

/**
 * Runs the probe on a started agent build: the warm-up, then three recordings.
 *
 * @param agent - The started agent build, its listener attached or not.
 * @returns What each recording sampled.
 */
async function probe(agent: AgentRenderer): Promise<Sampled[]> {
  filterEveryFrame(agent);
  const steady: Partial<FrameMeasure> = {
    gapMs: 8.3,
    capMs: FRAME_MS,
    rateMs: FRAME_MS,
    workMs: 2,
    phaseMs: Float32Array.of(0.2, 0.1, 0.1, 0.4, 0.1, 1)
  };
  const late: Partial<FrameMeasure> = { ...steady, gapMs: 30 };
  const run = (count: number, from: number): void => {
    for (let index = 0; index < count; index += 1) {
      const record = (from + index) % SPIKE_EVERY === 0 ? late : steady;

      record.at = (from + index) * FRAME_MS;
      agent.frame(record);
    }
  };

  run(5000, 0);

  const sampled: Sampled[] = [];

  for (let round = 0; round < 3; round += 1) {
    // The collected objects too: without them the profile holds only what is still alive, and
    // a per-frame allocation is garbage by the end of the run.
    await session?.post("HeapProfiler.startSampling", {
      samplingInterval: 64,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true
    });
    run(RECORDED, 5000 + round * RECORDED);

    const answer = (await session?.post("HeapProfiler.stopSampling")) as {
      profile: { head: ProfileNode };
    };
    const into = { frame: 0, spike: 0, flush: 0, by: new Map<string, number>() };

    sampleInto(answer.profile.head, "frame", into);

    const top = [...into.by]
      .toSorted((first, second) => second[1] - first[1])
      .slice(0, 6)
      .map(([name, bytes]) => `${name} ${bytes}`)
      .join(", ");

    sampled.push({ frame: into.frame, spike: into.spike, flush: into.flush, top });
  }

  return sampled;
}

/**
 * Checks one part against its budget: the smallest of the three recordings, with the heaviest functions of that
 * recording in the message.
 *
 * @param sampled - The recordings.
 * @param part - The part.
 * @param budget - The bytes the part may allocate in one recording.
 */
function expectWithin(sampled: readonly Sampled[], part: Part, budget: number): void {
  const [least] = sampled.toSorted((first, second) => first[part] - second[part]);

  expect(least?.[part], `${part}: ${least?.top}`).toBeLessThanOrEqual(budget);
}

/**
 * Counts the lines of one kind a listener got.
 *
 * @param lines - The lines.
 * @param kind - The kind.
 * @returns How many.
 */
function countOf(lines: readonly PerfLogLine[], kind: PerfLogLine["kind"]): number {
  return lines.filter(line => line.kind === kind).length;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeFilterSystem.onApply = undefined;
});

afterAll(async () => {
  await session?.post("HeapProfiler.disable");
});

describe("the per-frame path", () => {
  it("allocates nothing a steady frame with no stream listener (skipped without a HeapProfiler, as in Bun)", async ({
    skip
  }) => {
    if (session === undefined) skip("the runtime's inspector has no HeapProfiler domain");

    const sampled = await probe(await startAgent({ scene: { passes: 2, batches: 2, draws: 1 } }));

    expectWithin(sampled, "frame", FRAME_BYTES);
    expectWithin(sampled, "spike", SPIKE_BYTES * SPIKES);
    expectWithin(sampled, "flush", FLUSH_BYTES * FLUSHES);
  }, 60_000);

  it("allocates nothing a steady frame with the editor's stream listener, the flush its lines only", async ({
    skip
  }) => {
    if (session === undefined) skip("the runtime's inspector has no HeapProfiler domain");

    const agent = await startAgent({ scene: { passes: 2, batches: 2, draws: 1 } });
    const lines = agent.listen();
    const sampled = await probe(agent);

    // 65 000 frames in all, 541 seconds: a sample line a second, a spike line for every late frame.
    expect(countOf(lines, "sample")).toBeGreaterThan(500);
    expect(countOf(lines, "spike")).toBeGreaterThan(500);
    expectWithin(sampled, "frame", FRAME_BYTES);
    expectWithin(sampled, "spike", SPIKE_BYTES * SPIKES);
    expectWithin(sampled, "flush", FLUSH_BYTES * FLUSHES);
  }, 60_000);
});
