/* eslint-disable unicorn/no-null -- a thermal reading is JSON: a missing field is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the thermal line and the shell in the header (spec 11 R11.3, review
// points 6 and 10, native's answer): `time`'s one listener emits
// `time:thermal`, the renderer's hook writes the line; the header reads the
// shell's thermal reading and device model through `nativeShell()`.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A native shell of contract v1 with the given fields. */
function stubShell(fields: Record<string, unknown>): void {
  vi.stubGlobal("__MOKU_NATIVE__", {
    version: 1,
    display: { setFrameRate: () => ({ panelHz: 120, maxHz: 120 }), maxHz: 120 },
    ...fields
  });
}

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; SM-A266B Build/AP3A.240905.015) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36";

describe("the thermal line", () => {
  it("is written from a time:thermal reading, with source shell and null for a missing field", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.mock.hooks["time:thermal"]({ status: 2, headroom: 0.71, at: null, android: null });

    expect(linesOf(lines, "thermal")[0]).toMatchObject({
      kind: "thermal",
      status: 2,
      headroom: 0.71,
      at: null,
      android: null,
      source: "shell",
      device: null,
      batteryC: null,
      sensors: null
    });
  });

  it("needs no window listener of the renderer's own", async () => {
    const add = vi.fn();

    stubShell({});
    const agent = await startAgent();

    vi.stubGlobal("addEventListener", add);
    agent.listen();
    agent.mock.hooks["time:thermal"]({ status: 1, headroom: null, at: null, android: null });

    expect(add.mock.calls.some(([type]) => type === "moku-native:thermal")).toBe(false);
  });

  it("is not written after the renderer stopped", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.mock.stop();
    agent.mock.hooks["time:thermal"]({ status: 3, headroom: null, at: null, android: null });

    expect(linesOf(lines, "thermal")).toHaveLength(0);
  });
});

describe("the shell in the header", () => {
  it("carries the shell's thermal reading and its device model, normalized", async () => {
    stubShell({
      thermal: { read: () => ({ status: 1, headroom: 0.9 }) },
      device: { model: " sm a266b ", manufacturer: "samsung", sdk: 35 }
    });
    vi.stubGlobal("navigator", { userAgent: ANDROID_UA, hardwareConcurrency: 8, deviceMemory: 4 });
    const agent = await startAgent();
    const header = linesOf(agent.listen(), "header")[0];

    expect(header?.thermal).toEqual({ status: 1, headroom: 0.9, at: null, android: null });
    expect(header?.device).toEqual({
      userAgent: ANDROID_UA,
      model: "SM-A266B",
      modelFrom: "shell",
      webview: "131",
      cores: 8,
      memoryGb: 4
    });
  });

  it("reads the model from the user agent without a shell", async () => {
    vi.stubGlobal("navigator", { userAgent: ANDROID_UA });
    const agent = await startAgent();
    const header = linesOf(agent.listen(), "header")[0];

    expect(header?.device).toMatchObject({ model: "SM-A266B", modelFrom: "ua", cores: null });
    expect(header?.thermal).toBeNull();
  });

  it("writes null for a reading that comes as a promise, and a thermal line once it resolves", async () => {
    stubShell({ thermal: { read: () => Promise.resolve({ status: 4 }) } });
    const agent = await startAgent();
    const lines = agent.listen();

    expect(linesOf(lines, "header")[0]?.thermal).toBeNull();

    await Promise.resolve();
    await Promise.resolve();

    expect(linesOf(lines, "thermal")[0]).toMatchObject({ status: 4, source: "shell" });
  });

  it("waits for the shell to answer, and writes the header after 500 ms when it never does", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stubShell({ ready: new Promise(() => undefined) });
    const agent = await startAgent();
    const lines = agent.listen();

    expect(lines).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(500);

    expect(lines.map(line => line.kind)).toEqual(["header"]);
  });
});
