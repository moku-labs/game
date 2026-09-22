import { afterEach, describe, expect, it, vi } from "vitest";
import { playMusic } from "../../playback";
import { createFakeContext, installFakeWindow } from "../fake-audio-context";
import { createMockAudio } from "./mock-audio";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startAudio", () => {
  it("registers both fx handlers, neither of them for fast mode", () => {
    const mock = createMockAudio();

    mock.start();

    expect(mock.flow.registered.map(entry => entry.kind)).toEqual(["sfx", "music"]);
    expect(mock.flow.registered.every(entry => entry.runInFast)).toBe(false);
  });

  it("stays headless when no context factory is configured and no global exists", () => {
    const mock = createMockAudio();

    mock.start();

    expect(mock.state.context).toBeUndefined();
    expect(mock.api.unlocked()).toBe(false);
  });

  it("asks the context factory exactly once and builds the graph with the configured volumes", () => {
    const context = createFakeContext();
    const factory = vi.fn(() => context);
    const mock = createMockAudio({ config: { context: factory } });

    mock.start();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.gains).toHaveLength(3);
    expect(context.gains[1]?.gain.ramps).toEqual([[0.6, 0]]);
  });

  it("builds the context from the global AudioContext when a browser provides one", () => {
    const context = createFakeContext();
    const built: string[] = [];

    vi.stubGlobal("AudioContext", function FakeAudioContext(this: unknown) {
      built.push("new");

      return context;
    });

    const mock = createMockAudio();

    mock.start();

    expect(built).toEqual(["new"]);
    expect(mock.state.context).toBe(context);
  });
});

describe("stopAudio", () => {
  it("removes both handlers, the window listeners, and closes the context", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    await mock.stop();

    expect(mock.flow.removed).toEqual(["sfx", "music"]);
    expect(fakeWindow.listeners).toHaveLength(0);
    expect(context.closes).toBe(1);
    expect(mock.state.context).toBeUndefined();
    expect(mock.state.removers).toEqual([]);
  });

  it("stops the music and empties the decode cache", async () => {
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    mock.state.unlocked = true;
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    await mock.stop();

    expect(context.sources[0]?.stoppedAt).toBe(0);
    expect(mock.state.music).toBeUndefined();
    expect(mock.state.decoded.size).toBe(0);
  });

  it("closes nothing headless", async () => {
    const mock = createMockAudio();

    mock.start();

    await expect(mock.stop()).resolves.toBeUndefined();
  });
});
