import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { coreConfig, createCore } from "../../../../config";
import { timePlugin } from "../../index";
import type { Config, Time } from "../../types";

// The engine's default plugins are not all built yet, so the test app is a bare framework
// carrying the time plugin alone.
const bare = createCore(coreConfig, { plugins: [] });

function createTestApp(time: Partial<Config> = {}) {
  return bare.createApp({ plugins: [timePlugin], pluginConfigs: { time } });
}

function stubFrameSource(): FrameRequestCallback[] {
  const frames: FrameRequestCallback[] = [];

  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);

    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  return frames;
}

function driveFrames(frames: FrameRequestCallback[], from: number, count: number): number {
  let timestamp = from;

  for (let index = 0; index < count; index += 1) {
    timestamp += 16;
    frames[index]?.(timestamp);
  }

  return timestamp;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── headless ─────────────────────────────────────────────────

describe("time plugin in plain Bun", () => {
  it("starts inert and lets a test drive the frames", async () => {
    const app = createTestApp();
    const seen: number[] = [];

    await app.start();
    app.time.onFrame("animate", time => seen.push(time.frame));

    expect(app.time.isRunning()).toBe(false);

    app.time.step(16);
    app.time.step(16);
    app.time.step(16);

    expect(seen).toEqual([1, 2, 3]);
    expect(app.time.snapshot()).toMatchObject({ frame: 3, elapsed: 48 });

    await app.stop();
  });

  it("stops without a frame source", async () => {
    const app = createTestApp();

    await app.start();

    await expect(app.stop()).resolves.toBeUndefined();
  });
});

// ─── with a frame source ──────────────────────────────────────

describe("time plugin with requestAnimationFrame", () => {
  it("drives the frames from the loop and cancels it on stop", async () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);

      return frames.length;
    });
    const cancelFrame = vi.fn();

    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);

    const app = createTestApp();
    await app.start();

    expect(app.time.isRunning()).toBe(true);
    expect(requestFrame).toHaveBeenCalledTimes(1);

    const seen: number[] = [];
    app.time.onFrame("render", time => seen.push(time.delta));

    frames[0]?.(1000);
    frames[1]?.(1020);

    expect(seen).toEqual([1000 / 60, 20]);
    expect(requestFrame).toHaveBeenCalledTimes(3);

    await app.stop();

    expect(cancelFrame).toHaveBeenCalledWith(3);
    expect(app.time.isRunning()).toBe(false);
  });

  it("honours the maxFps override of the app config", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);

      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const app = createTestApp({ maxFps: 30 });
    await app.start();

    frames[0]?.(1000);
    frames[1]?.(1010);

    expect(app.time.snapshot()).toMatchObject({ frame: 1, delta: 1000 / 30 });

    await app.stop();
  });
});

// ─── the idle cap ─────────────────────────────────────────────

describe("time plugin when nothing wakes the clock", () => {
  it("skips the frames of a 60 Hz source once idle", async () => {
    const frames = stubFrameSource();
    const app = createTestApp({ idleAfterMs: 100 });
    await app.start();

    const last = driveFrames(frames, 1000, 7);

    expect(app.time.snapshot().idle).toBe(true);

    const idleAt = app.time.snapshot().frame;
    frames[7]?.(last + 16);

    expect(app.time.snapshot().frame).toBe(idleAt);

    await app.stop();
  });

  it("runs every frame again after a wake", async () => {
    const frames = stubFrameSource();
    const app = createTestApp({ idleAfterMs: 100 });
    await app.start();

    const last = driveFrames(frames, 1000, 7);
    const idleAt = app.time.snapshot().frame;

    app.time.wake();
    frames[7]?.(last + 16);

    expect(app.time.snapshot()).toMatchObject({ frame: idleAt + 1, idle: false });

    await app.stop();
  });

  it("keeps every frame when the idle cap is off", async () => {
    const frames = stubFrameSource();
    const app = createTestApp({ idleFps: 0, idleAfterMs: 100 });
    await app.start();

    driveFrames(frames, 1000, 12);

    expect(app.time.snapshot()).toMatchObject({ frame: 12, idle: false });

    await app.stop();
  });
});

// ─── types ────────────────────────────────────────────────────

describe("time plugin types", () => {
  it("exposes a typed api on the app", async () => {
    const app = createTestApp();
    await app.start();

    expectTypeOf(app.time.snapshot).returns.toEqualTypeOf<Readonly<Time>>();
    expectTypeOf(app.time.step).parameter(0).toEqualTypeOf<number>();
    expectTypeOf(app.time.wake).toEqualTypeOf<() => void>();
    // @ts-expect-error — "foo" is not a frame phase
    expectTypeOf(app.time.onFrame).toBeCallableWith("foo", () => {});

    expect(app.time.isPaused()).toBe(false);

    await app.stop();
  });
});
