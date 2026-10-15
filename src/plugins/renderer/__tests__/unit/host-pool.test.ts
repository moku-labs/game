import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../types";
import type { FakeTexturePool } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: the pool trim (spec 25 C14) on the fake host and a fake clock. A frame
// is `host.afterFrame(drawn)` at a clock moment; the targets `host.textures()`
// reads are scripted, the idle ones are dropped by the fake pool's `clear`.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Bytes of one MiB. */
const MB = 1024 * 1024;

/** The payload of `lifecycle:changed` when the page goes to the background. */
const PAUSED = {
  reason: "background",
  action: "push",
  reasons: ["background"],
  paused: true,
  resumed: false
} as const;

/**
 * A render target as Pixi's texture system lists it: no upload method, no resource, `mb` MiB.
 *
 * @param mb - Its size in MiB.
 * @returns The source fields `host.textures()` reads.
 */
function target(mb: number): object {
  return {
    pixelWidth: 512,
    pixelHeight: 512 * mb,
    mipLevelCount: 1,
    uploadMethodId: "unknown",
    // eslint-disable-next-line unicorn/no-null -- a render target's resource is null in Pixi.
    resource: null
  };
}

/** A started mock renderer with scripted render targets and a frame driver. */
type PoolRig = {
  mock: MockRenderer;
  /** The argument of every `TexturePool.clear`, in order. */
  clears: Array<boolean | undefined>;
  /** Scripts `mb` MiB of idle pooled targets: a clear frees them. */
  idle(mb: number): void;
  /** Scripts `mb` MiB of targets handed out: a clear leaves them. */
  held(mb: number): void;
  /** One frame closes at a clock moment, drawn or skipped. */
  frame(at: number, drawn: boolean): void;
  /** The game goes to the background. */
  pause(): void;
};

/**
 * Starts a mock renderer whose fake pool drops the scripted idle targets on `clear`.
 *
 * @param options - What differs from the mock's defaults.
 * @param options.config - Config overrides; the default trim is `{ restMs: 1000, aboveMb: 16 }`.
 * @param options.kind - The backend.
 * @returns The rig.
 */
async function startedPool(
  options: { config?: Partial<Config>; kind?: "webgpu" | "webgl" } = {}
): Promise<PoolRig> {
  const mock = createMockRenderer(options);

  await mock.start();

  const managed = mock.pixi.last().renderer.texture.managedTextures as unknown[];
  const pool = mock.pixi.module.TexturePool as unknown as FakeTexturePool;
  const idle = new Set<object>();

  pool.onClear = () => {
    for (const source of idle) managed.splice(managed.indexOf(source), 1);
    idle.clear();
  };

  return {
    mock,
    clears: pool.clears,
    idle: mb => {
      const source = target(mb);

      idle.add(source);
      managed.push(source);
    },
    held: mb => {
      managed.push(target(mb));
    },
    frame: (at, drawn) => {
      mock.setNow(at);
      mock.modules.host.afterFrame(drawn);
    },
    pause: () => mock.hooks["lifecycle:changed"]({ ...PAUSED, reasons: [...PAUSED.reasons] })
  };
}

describe("the pool trim at rest", () => {
  it("trims once a still screen has drawn nothing for restMs, not a millisecond before", async () => {
    const rig = await startedPool();

    rig.idle(32);
    rig.frame(0, true);
    rig.frame(999, false);

    expect(rig.clears).toEqual([]);

    rig.frame(1000, false);

    expect(rig.clears).toEqual([true]);
    expect(rig.mock.api.stats().textureMbSplit.targets).toBe(0);

    rig.frame(1016, false);
    rig.frame(5000, false);

    expect(rig.clears).toEqual([true]);
  });

  it("trims again only after a frame was drawn and the screen rested again", async () => {
    const rig = await startedPool();

    rig.idle(32);
    rig.frame(0, true);
    rig.frame(1000, false);
    // The same rest: the targets a capture took again stay until the next rest.
    rig.idle(32);
    rig.frame(2500, false);

    expect(rig.clears).toEqual([true]);

    rig.frame(3000, true);
    rig.frame(3999, false);

    expect(rig.clears).toEqual([true]);

    rig.frame(4000, false);

    expect(rig.clears).toEqual([true, true]);
  });

  it("never trims a screen that draws every frame, without a scene change", async () => {
    const rig = await startedPool();

    rig.idle(64);
    for (let index = 0; index < 600; index += 1) rig.frame(index * 16, true);

    expect(rig.clears).toEqual([]);
  });

  it("answers the bytes a trim freed and logs the MiB with the reason", async () => {
    const rig = await startedPool();

    rig.idle(32);
    rig.held(3);

    expect(rig.mock.modules.host.trimPool("scene")).toBe(32 * MB);
    expect(rig.mock.log.debug).toHaveBeenCalledWith("renderer:pool-trim", {
      reason: "scene",
      freedMb: 32
    });
  });
});

describe("the pool trim after a scene change", () => {
  it("trims restMs after a scene change even while every frame is drawn, once; a second change moves the moment", async () => {
    const rig = await startedPool();
    const trimmedAt: number[] = [];

    rig.idle(32);
    rig.mock.setNow(0);
    rig.mock.modules.host.sceneChanged();

    for (let at = 0; at <= 4000; at += 16) {
      // Another scene half a second later: the trim waits a full restMs after it.
      if (at === 496) {
        rig.mock.setNow(at);
        rig.mock.modules.host.sceneChanged();
      }

      const before = rig.clears.length;

      rig.frame(at, true);
      if (rig.clears.length > before) trimmedAt.push(at);
    }

    // The first frame at least restMs after the second change: 496 + 1000 falls between the frames 1488 and 1504.
    expect(trimmedAt).toEqual([1504]);
  });
});

describe("the pool trim: aboveMb", () => {
  it("skips a trim when the targets grew less than aboveMb since the last trim, and does not look again in that rest", async () => {
    const rig = await startedPool();

    rig.idle(15);
    rig.frame(0, true);
    rig.frame(1000, false);
    // 16 MiB now, in the same rest: the rest was judged once.
    rig.idle(1);
    rig.frame(1100, false);

    expect(rig.clears).toEqual([]);

    rig.frame(1200, true);
    rig.frame(2200, false);

    // Exactly aboveMb trims.
    expect(rig.clears).toEqual([true]);
  });

  it("measures the growth from what the targets held right after the last trim", async () => {
    const rig = await startedPool();

    // 20 MiB a capture or a cached group holds: the trim cannot free them.
    rig.held(20);
    rig.idle(20);
    rig.frame(0, true);
    rig.frame(1000, false);

    expect(rig.clears).toEqual([true]);

    rig.frame(1500, true);
    rig.frame(2500, false);

    expect(rig.clears).toEqual([true]);
  });
});

describe("the pool trim on a pause", () => {
  it("a pause trims whatever grew, below aboveMb too", async () => {
    const rig = await startedPool();

    rig.idle(1);
    rig.pause();

    expect(rig.clears).toEqual([true]);
  });

  it("a pause with no growth since the last trim does nothing", async () => {
    const rig = await startedPool();

    rig.held(4);
    rig.idle(1);
    rig.pause();
    rig.pause();

    expect(rig.clears).toEqual([true]);
  });
});

describe("the pool trim: off, and while nothing draws", () => {
  it("with poolTrim false nothing is ever cleared: no rest, no scene change, no pause", async () => {
    const rig = await startedPool({ config: { poolTrim: false } });

    rig.idle(64);
    rig.frame(0, true);
    rig.frame(2000, false);
    rig.mock.modules.host.sceneChanged();
    rig.frame(4000, true);
    rig.pause();

    expect(rig.clears).toEqual([]);
  });

  it("a host that is not ready or is restoring is never trimmed", async () => {
    const inert = createMockRenderer({ dom: false });
    const inertPool = inert.pixi.module.TexturePool as unknown as FakeTexturePool;

    await inert.start();
    inert.modules.host.afterFrame(true);
    inert.setNow(5000);
    inert.modules.host.afterFrame(false);
    inert.hooks["lifecycle:changed"]({ ...PAUSED, reasons: ["background"] });

    expect(inert.modules.host.trimPool("rest")).toBe(0);
    expect(inertPool.clears).toEqual([]);

    const rig = await startedPool({ kind: "webgl" });
    const canvas = rig.mock.pixi.last().canvas;

    rig.idle(32);
    rig.frame(0, true);
    canvas.dispatch("webglcontextlost", { preventDefault: () => undefined });
    rig.frame(2000, false);
    rig.pause();

    expect(rig.mock.modules.host.trimPool("rest")).toBe(0);
    expect(rig.clears).toEqual([]);

    // Restored, the same screen still rests: the trim comes at the next frame.
    canvas.dispatch("webglcontextrestored");
    rig.frame(2016, false);

    expect(rig.clears).toEqual([true]);
  });
});
