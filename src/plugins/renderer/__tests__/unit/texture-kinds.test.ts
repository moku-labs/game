import * as pixi from "pixi.js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createHostApi } from "../../host/api";
import { idleTargetBytes, sourceBytes, textureUsage } from "../../host/readback";
import { createHostState } from "../../host/state";
import type { SourceKind } from "../../host/types";
import type {
  HostModule,
  PixiApplication,
  PixiModule,
  PixiTexture,
  RendererCtx
} from "../../types";
import { FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: what each texture source the GPU holds is counted as (F236): the art a game loaded, the pages of its fonts,
// the render targets, the kept pictures and everything else, and which of the targets and the kept pictures wait idle
// in a pool. The walk runs at every `stats()` call, so it allocates nothing.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  // The real Pixi pool is global to the file: no idle texture of one test is seen by the next.
  pixi.TexturePool.clear(true);
});

/** A BMFont text file the fake parser reads. */
const BMFONT = "info face=Hud\nchar id=65";

/** The size fields Pixi's texture system lists a source with. */
type Sized = { pixelWidth: number; pixelHeight: number; mipLevelCount: number };

/**
 * Starts a mock renderer on the fake DOM.
 *
 * @returns The started mock.
 */
async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();

  return mock;
}

/**
 * Lists a source on the GPU of the mock's application, at a size.
 *
 * @param mock - The started mock.
 * @param source - The source.
 * @param width - Its width in real pixels.
 * @param height - Its height in real pixels.
 * @returns The source, sized.
 */
function onGpu<Source extends object>(
  mock: MockRenderer,
  source: Source,
  width: number,
  height: number
): Source & Sized {
  const sized = Object.assign(source, { pixelWidth: width, pixelHeight: height, mipLevelCount: 1 });

  mock.pixi.last().renderer.texture.managedTextures.push(sized);

  return sized;
}

/**
 * A render target as Pixi lists it: no upload method, no resource.
 *
 * @param width - Width in real pixels.
 * @param height - Height in real pixels.
 * @returns The source fields.
 */
function targetSource(
  width: number,
  height: number
): Sized & { uploadMethodId: string; resource: null } {
  return {
    pixelWidth: width,
    pixelHeight: height,
    mipLevelCount: 1,
    uploadMethodId: "unknown",
    // eslint-disable-next-line unicorn/no-null -- a render target's resource is null in Pixi.
    resource: null
  };
}

/**
 * An image source as Pixi lists it: an upload method and a resource.
 *
 * @param width - Width in real pixels.
 * @param height - Height in real pixels.
 * @returns The source fields.
 */
function imageSource(
  width: number,
  height: number
): Sized & { uploadMethodId: string; resource: object } {
  return {
    pixelWidth: width,
    pixelHeight: height,
    mipLevelCount: 1,
    uploadMethodId: "image",
    resource: {}
  };
}

/**
 * The weak tables `textureUsage` reads, empty.
 *
 * @returns The tables.
 */
function emptyKinds(): {
  kept: WeakSet<object>;
  marks: WeakMap<object, SourceKind>;
  idle: WeakSet<object>;
} {
  return { kept: new WeakSet(), marks: new WeakMap(), idle: new WeakSet() };
}

/**
 * An application whose texture system lists the given sources.
 *
 * @param sources - The managed sources.
 * @returns The application.
 */
function appOf(sources: readonly unknown[]): PixiApplication {
  return { renderer: { texture: { managedTextures: sources } } } as unknown as PixiApplication;
}

describe("the kind of a texture source", () => {
  // Bug: the art a game loaded through assets was counted with what Pixi made itself.
  it("counts a source made by sync.textures.create as art", async () => {
    const mock = await started();
    const texture = mock.api.sync.textures.create({ width: 256, height: 128 } as never);

    onGpu(mock, texture.source, 256, 128);

    expect(mock.modules.host.textures()).toMatchObject({
      bytes: 256 * 128 * 4,
      art: 256 * 128 * 4,
      text: 0,
      other: 0
    });
  });

  // Bug: a font page, made by createTexture like any image, stayed counted as art.
  it("counts a font page installed with sync.fonts.install as text, not art", async () => {
    const mock = await started();
    const page = mock.api.sync.textures.create({ width: 512, height: 256 } as never);

    mock.api.sync.fonts.install("hud.body", BMFONT, page);
    onGpu(mock, page.source, 512, 256);

    expect(mock.modules.host.textures()).toMatchObject({ art: 0, text: 512 * 256 * 4, other: 0 });
  });

  // Bug: a source nobody marked (a gradient, Pixi's own white texture) was counted as the game's art.
  it("counts a source neither marked, kept nor a target as other", async () => {
    const mock = await started();

    onGpu(mock, new FakeTexture({}).source, 64, 32);

    expect(mock.modules.host.textures()).toMatchObject({
      art: 0,
      text: 0,
      targets: 0,
      kept: 0,
      other: 64 * 32 * 4
    });
  });

  // Bug: the order of the checks changed, so a kept picture read as a target, or a marked target as text.
  it("counts a kept render texture as kept, not target, and a target marked text as target", () => {
    const kinds = emptyKinds();
    const kept = targetSource(16, 16);
    const marked = targetSource(8, 8);

    kinds.kept.add(kept);
    kinds.marks.set(marked, "text");

    expect(textureUsage(appOf([kept, marked]), kinds)).toMatchObject({
      kept: 16 * 16 * 4,
      targets: 8 * 8 * 4,
      text: 0
    });
  });

  // Bug: one kind left out of the sum, or one source counted twice, so the split no longer adds up to textureMb.
  it("splits the bytes so the five kinds add up to them, and the MiB of stats() to textureMb", async () => {
    const mock = await started();
    const art = mock.api.sync.textures.create({ width: 300, height: 200 } as never);
    const page = mock.api.sync.textures.create({ width: 333, height: 129 } as never);
    const kept = targetSource(123, 456);

    mock.api.sync.fonts.install("hud.body", BMFONT, page);
    onGpu(mock, art.source, 1300, 977);
    onGpu(mock, page.source, 333, 129);
    onGpu(mock, targetSource(1000, 333), 1000, 333);
    onGpu(mock, kept, 123, 456);
    onGpu(mock, imageSource(77, 99), 77, 99);
    mock.modules.host.keep(kept, true);

    const usage = mock.modules.host.textures();
    const split = mock.api.stats().textureMbSplit;

    expect(usage.art + usage.text + usage.targets + usage.kept + usage.other).toBe(usage.bytes);
    expect(
      [usage.art, usage.text, usage.targets, usage.kept, usage.other].every(bytes => bytes > 0)
    ).toBe(true);
    expect(split.art + split.text + split.targets + split.kept + split.other).toBeCloseTo(
      mock.api.stats().textureMb,
      1
    );
  });
});

/**
 * The pass counting the test host installs: none.
 *
 * @returns The remover, which does nothing.
 */
function installNothing(): () => void {
  return uninstallNothing;
}

/** Swaps nothing back. */
function uninstallNothing(): void {
  // Nothing was installed.
}

/**
 * A ready host over the real Pixi module, whose application lists the sources the test hands it.
 *
 * @returns The host module, the managed list and the context.
 */
function realHost(): { host: HostModule; managed: unknown[]; ctx: RendererCtx } {
  const state = createHostState();
  const managed: unknown[] = [];

  state.pixi = pixi as unknown as PixiModule;
  state.app = { renderer: { texture: { managedTextures: managed } } } as never;
  state.ready = true;

  const ctx = {
    config: { poolTrim: { restMs: 1000, aboveMb: 16 } },
    state: { host: state },
    deps: { clock: { now: () => 0 } },
    log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as unknown as RendererCtx;

  return {
    host: createHostApi(ctx, { installCounting: undefined, installPasses: installNothing }),
    managed,
    ctx
  };
}

/**
 * Takes a render target from Pixi's pool, as a filter pass does.
 *
 * @param size - Its width and height in CSS pixels.
 * @returns The pooled texture.
 */
function take(size: number): pixi.Texture {
  return pixi.TexturePool.getOptimalTexture({ width: size, height: size, resolution: 1 });
}

describe("the idle targets of a pool", () => {
  // Bug: the textures Pixi's pool keeps for reuse, or the ones the trim holds, were not told from live targets.
  it("counts the idle textures of Pixi's pool buckets and of pool.held, not one handed out, not a kept one", () => {
    const { host, managed, ctx } = realHost();
    const idle = take(64);
    const out = take(32);
    const kept = take(16);
    const held = take(8);
    const gone = take(4);

    managed.push(idle.source, out.source, kept.source, held.source);
    host.keep(kept.source, true);
    pixi.TexturePool.returnTexture(idle);
    pixi.TexturePool.returnTexture(kept);
    ctx.state.host.pool.held.push(held, gone);
    gone.source.destroy();

    expect(host.textures().idleTargets).toBe(64 * 64 * 4 + 8 * 8 * 4);
    expect(sourceBytes(out.source)).toBe(32 * 32 * 4);
  });

  // Bug: a Pixi without the private buckets threw at every stats() call.
  it("answers 0 when Pixi's pool has no buckets map", () => {
    const module = { TexturePool: { _buckets: {} } } as unknown as PixiModule;

    expect(idleTargetBytes(module, [], new WeakSet())).toBe(0);
  });

  // Bug: idle.targets counted textures outside the targets of the same stats call.
  it("reports idle.targets within targets on the same stats call", async () => {
    const mock = await started();
    const idle = onGpu(mock, targetSource(256, 256), 256, 256);

    onGpu(mock, targetSource(512, 512), 512, 512);
    (mock.pixi.module.TexturePool as unknown as { _buckets: Map<number, unknown[]> })._buckets =
      new Map([[1, [{ source: idle }]]]);

    const split = mock.api.stats().textureMbSplit;

    expect(split.idle.targets).toBe(0.25);
    expect(split.idle.targets).toBeLessThanOrEqual(split.targets);
  });
});

// ---------------------------------------------------------------------------
// The walk allocates nothing on a warm call: the heap sampler of the runtime records 20 000 calls of each, three
// times, the smallest recording kept. Bun's inspector has no HeapProfiler domain: there the test is skipped.
// ---------------------------------------------------------------------------

/** A node of a sampled heap profile. */
type ProfileNode = {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: ProfileNode[];
};

/** The module whose functions are counted. */
const READBACK = /src\/plugins\/renderer\/host\/readback\.ts/;

/** Calls of one recording. */
const CALLS = 20_000;

/** At most this many bytes of one recording: sampling noise. One object a call would be over a megabyte. */
const ALLOWED_BYTES = 1024;

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

afterAll(async () => {
  await session?.post("HeapProfiler.disable");
});

/**
 * Sums the bytes sampled in the named functions of `readback.ts`. The anonymous accessors of Vite's module runner are
 * the loader's, not the engine's.
 *
 * @param node - A node of the profile.
 * @returns The bytes.
 */
function readbackBytes(node: ProfileNode): number {
  const { functionName, url } = node.callFrame;
  const own = functionName !== "" && READBACK.test(url) ? node.selfSize : 0;

  return node.children.reduce((sum, child) => sum + readbackBytes(child), own);
}

describe("the texture walk", () => {
  it("allocates nothing on a warm call of textureUsage and idleTargetBytes (skipped without a HeapProfiler, as in Bun)", async ({
    skip
  }) => {
    if (session === undefined) skip("the runtime's inspector has no HeapProfiler domain");

    const kinds = emptyKinds();
    const kept = targetSource(1024, 1024);
    const art = imageSource(2000, 1500);
    const text = imageSource(512, 512);
    // eslint-disable-next-line unicorn/no-null -- Pixi leaves null where a source was unloaded.
    const app = appOf([art, text, kept, targetSource(800, 600), imageSource(3, 3), null]);
    const idle = {
      source: { destroyed: false, pixelWidth: 512, pixelHeight: 512, mipLevelCount: 1 }
    };
    const module = {
      TexturePool: {
        _buckets: new Map([
          [1, [idle, idle]],
          [2, [idle]]
        ])
      }
    } as unknown as PixiModule;
    const held = [idle] as unknown as PixiTexture[];
    let sink = 0;

    kinds.kept.add(kept);
    kinds.idle.add(kept);
    kinds.marks.set(art, "art");
    kinds.marks.set(text, "text");

    const run = (count: number): void => {
      for (let index = 0; index < count; index += 1) {
        sink += textureUsage(app, kinds).bytes + idleTargetBytes(module, held, kinds.kept);
      }
    };

    run(5000);

    const sampled: number[] = [];

    for (let round = 0; round < 3; round += 1) {
      await session?.post("HeapProfiler.startSampling", {
        samplingInterval: 64,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true
      });
      run(CALLS);

      const answer = (await session?.post("HeapProfiler.stopSampling")) as {
        profile: { head: ProfileNode };
      };

      sampled.push(readbackBytes(answer.profile.head));
    }

    expect(sink).toBeGreaterThan(0);
    expect(Math.min(...sampled)).toBeLessThanOrEqual(ALLOWED_BYTES);
  }, 60_000);
});
