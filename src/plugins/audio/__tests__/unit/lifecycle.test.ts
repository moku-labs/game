import { afterEach, describe, expect, it, vi } from "vitest";
import { playMusic } from "../../playback";
import { createFakeContext, installFakeWindow } from "../fake-audio-context";
import { installFakeAudio, installFakeNavigator, installFakeUrl } from "../fake-media";
import { createMockAudio } from "./mock-audio";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

describe("the audio session", () => {
  it("writes the configured type before the context is made", () => {
    const order: string[] = [];
    const context = createFakeContext();

    installFakeNavigator({ type: "auto", order });

    const mock = createMockAudio({
      config: {
        context: () => {
          order.push("context");

          return context;
        }
      }
    });

    mock.start();

    expect(order).toEqual(["session:ambient", "context"]);
  });

  it.each(["playback", "auto"] as const)("writes %s as given", type => {
    const session = installFakeNavigator({ type: "ambient" });
    const mock = createMockAudio({ context: createFakeContext(), config: { session: type } });

    mock.start();

    expect(session.writes).toEqual([type]);
  });

  it("writes the type headless too, where a navigator has the API", () => {
    const session = installFakeNavigator({ type: "auto" });
    const mock = createMockAudio();

    mock.start();

    expect(session.writes).toEqual(["ambient"]);
  });

  it("does nothing and logs nothing where the navigator has no audioSession", () => {
    installFakeNavigator();

    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();

    expect(mock.state.session).toBeUndefined();
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("does nothing and logs nothing where there is no navigator at all", () => {
    vi.stubGlobal("navigator", undefined);

    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();

    expect(mock.state.session).toBeUndefined();
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("ignores an audioSession without a string type", () => {
    vi.stubGlobal("navigator", { audioSession: { type: 3 } });

    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();

    expect(mock.state.session).toBeUndefined();
  });

  it("warns once when the setter refuses the type", () => {
    installFakeNavigator({ type: "auto", refuse: true });

    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("audio: the audio session was refused", {
      type: "ambient"
    });
    expect(mock.state.session).toBeUndefined();
  });

  it("writes auto back on stop", async () => {
    const session = installFakeNavigator({ type: "auto" });
    const mock = createMockAudio({ context: createFakeContext(), config: { session: "playback" } });

    mock.start();
    await mock.stop();

    expect(session.writes).toEqual(["playback", "auto"]);
    expect(mock.state.session).toBeUndefined();
  });
});

describe("the audio session on stop", () => {
  it("forgets the session and resolves when the setter refuses auto", async () => {
    let current = "auto";

    vi.stubGlobal("navigator", {
      audioSession: {
        get type(): string {
          return current;
        },
        set type(value: string) {
          if (value === "auto") throw new Error("NotAllowedError");

          current = value;
        }
      }
    });

    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();

    await expect(mock.stop()).resolves.toBeUndefined();
    expect(current).toBe("ambient");
    expect(mock.state.session).toBeUndefined();
  });
});

describe('stopAudio at music: "stream"', () => {
  it("disposes the playing element and every retiring one, timers cleared, before close", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const audio = installFakeAudio();
    const urls = installFakeUrl();
    const context = createFakeContext();
    const mock = createMockAudio({ context, config: { music: "stream" } });
    const seen: { revoked: string[]; retiring: number; timers: number } = {
      revoked: [],
      retiring: -1,
      timers: -1
    };
    const close = context.close;

    context.close = (): Promise<void> => {
      seen.revoked = [...urls.revoked];
      seen.retiring = mock.state.retiring.size;
      seen.timers = vi.getTimerCount();

      return close();
    };

    mock.start();
    mock.state.unlocked = true;
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    await playMusic(mock.audio, { key: "home.theme", fadeMs: 600 });
    await mock.stop();

    expect(seen).toEqual({ revoked: ["blob:test/2", "blob:test/1"], retiring: 0, timers: 0 });
    expect(audio.elements.map(element => element.pauses)).toEqual([1, 1]);
  });
});
