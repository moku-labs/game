import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playMusic, stopMusic } from "../../playback";
import type { Config } from "../../types";
import { installUnlock } from "../../unlock";
import {
  bytesOf,
  createFakeContext,
  type FakeContext,
  installFakeWindow
} from "../fake-audio-context";
import { type FakeAudio, type FakeUrls, installFakeAudio, installFakeUrl } from "../fake-media";
import { createMockAudio, type MockAudio } from "./mock-audio";

/** Everything one streaming test drives and reads. */
type Streaming = { mock: MockAudio; context: FakeContext; audio: FakeAudio; urls: FakeUrls };

/** Yields the microtask queue, the way a test waits for `play()` without a timer. */
async function tick(times = 10): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/** A started plugin at `music: "stream"` over the fake context, the unlock already through. */
function streaming(config: Partial<Config> = {}): Streaming {
  const audio = installFakeAudio();
  const urls = installFakeUrl();
  const context = createFakeContext();
  const mock = createMockAudio({ context, config: { music: "stream", ...config } });

  mock.start();
  mock.state.unlocked = true;

  return { mock, context, audio, urls };
}

/** Moves the fake context clock. */
function at(context: FakeContext, seconds: number): void {
  context.currentTime = seconds;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('music: "stream" — a new key', () => {
  it("makes one looping element on a blob: URL of the asset bytes, typed from asset.mime", async () => {
    const { mock, audio, urls } = streaming();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(audio.elements).toHaveLength(1);
    expect(audio.elements[0]?.src).toBe("blob:test/1");
    expect(audio.elements[0]?.loop).toBe(true);
    expect(audio.elements[0]?.preload).toBe("auto");
    expect(urls.created).toEqual([
      { url: "blob:test/1", type: "audio/mpeg", size: bytesOf("board.theme").byteLength }
    ]);
    expect(mock.context?.sources).toHaveLength(0);
  });

  it("streams an .m4a key as audio/mp4", async () => {
    const { mock, urls } = streaming();

    mock.assets.mimes.set("board.theme", "audio/mp4");
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(urls.created[0]?.type).toBe("audio/mp4");
  });

  it("routes the element through a new gain into the music bus", async () => {
    const { mock, context, audio } = streaming();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(context.mediaSources).toHaveLength(1);
    expect(context.mediaSources[0]?.element).toBe(audio.elements[0]);
    expect(context.mediaSources[0]?.connectedTo).toBe(context.gains[3]);
    expect(context.gains[3]?.connectedTo).toBe(context.gains[1]);
    expect(mock.state.music?.stream?.gain).toBe(context.gains[3]);
  });

  it("ramps the new gain 0 to 1 over the fade only once play() fulfilled", async () => {
    const { mock, context, audio } = streaming();
    const pending = playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(audio.elements[0]?.plays).toBe(1);
    expect(context.gains[3]?.gain.ramps).toEqual([]);
    expect(mock.state.music).toBeUndefined();

    await pending;

    expect(context.gains[3]?.gain.sets).toEqual([[0, 0]]);
    expect(context.gains[3]?.gain.ramps).toEqual([[1, 0.6]]);
    expect(mock.state.music?.key).toBe("board.theme");
  });

  it("journals the track when play() fulfilled, stamped with the game time", async () => {
    const { mock } = streaming({ journal: 10 });

    mock.time.elapsed = 1600;
    const pending = playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(mock.api.journal()).toEqual([]);

    await pending;

    expect(mock.api.journal()).toEqual([
      { key: "board.theme", bus: "music", kind: "music", at: 1600 }
    ]);
  });

  it("does nothing for the key that is playing", async () => {
    const { mock, audio } = streaming();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(audio.elements).toHaveLength(1);
    expect(audio.elements[0]?.plays).toBe(1);
  });

  it("warns once for a key the assets do not carry and lets the current track play on", async () => {
    const { mock, audio } = streaming();

    mock.assets.missing.add("home.gone");
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    await playMusic(mock.audio, { key: "home.gone", fadeMs: 600 });
    await playMusic(mock.audio, { key: "home.gone", fadeMs: 600 });

    expect(audio.elements).toHaveLength(1);
    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("audio: no audio for key", { key: "home.gone" });
    expect(mock.state.music?.key).toBe("board.theme");
  });
});

describe('music: "stream" — cross-fade and dispose', () => {
  it("fades the old element out and disposes it after the fade, not before", async () => {
    const { mock, context, audio, urls } = streaming();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    at(context, 10);
    await playMusic(mock.audio, { key: "home.theme", fadeMs: 600 });

    const old = audio.elements[0];

    expect(context.gains[3]?.gain.ramps.at(-1)).toEqual([0, 10.6]);
    expect(context.gains[4]?.gain.ramps).toEqual([[1, 10.6]]);
    expect(mock.state.retiring.size).toBe(1);

    vi.advanceTimersByTime(599);

    expect(old?.pauses).toBe(0);
    expect(urls.revoked).toEqual([]);

    vi.advanceTimersByTime(1);

    expect(old?.pauses).toBe(1);
    expect(old?.srcRemoved).toBe(true);
    expect(old?.loads).toBe(1);
    expect(context.mediaSources[0]?.disconnects).toBe(1);
    expect(context.gains[3]?.disconnects).toBe(1);
    expect(urls.revoked).toEqual(["blob:test/1"]);
    expect(mock.state.retiring.size).toBe(0);
    expect(audio.elements[1]?.pauses).toBe(0);
    expect(mock.state.music?.key).toBe("home.theme");
  });

  it("fades the element out and disposes it after the fade for a null key", async () => {
    const { mock, context, audio, urls } = streaming();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    // eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
    await playMusic(mock.audio, { key: null, fadeMs: 600 });

    expect(context.gains[3]?.gain.ramps.at(-1)).toEqual([0, 0.6]);
    expect(mock.state.music).toBeUndefined();

    vi.advanceTimersByTime(600);

    expect(audio.elements[0]?.pauses).toBe(1);
    expect(urls.revoked).toEqual(["blob:test/1"]);
  });

  it("disposes the playing element at once on stopMusic", async () => {
    const { mock, audio, urls } = streaming();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    stopMusic(mock.state);

    expect(audio.elements[0]?.pauses).toBe(1);
    expect(urls.revoked).toEqual(["blob:test/1"]);
    expect(mock.state.music).toBeUndefined();
  });

  it("never writes the element volume: every level goes through the track gain", async () => {
    const { mock, audio } = streaming();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(Object.hasOwn(audio.elements[0] ?? {}, "volume")).toBe(false);
  });
});

describe('music: "stream" — a refused play()', () => {
  it("warns once per key, disposes the element and leaves the old track un-faded", async () => {
    const { mock, context, audio, urls } = streaming();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    audio.playFails = true;
    await playMusic(mock.audio, { key: "home.theme", fadeMs: 600 });
    await playMusic(mock.audio, { key: "home.theme", fadeMs: 600 });

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("audio: the music element did not play", {
      key: "home.theme"
    });
    expect(audio.elements[1]?.pauses).toBe(1);
    expect(urls.revoked).toEqual(["blob:test/2", "blob:test/3"]);
    expect(context.gains[3]?.gain.ramps).toEqual([[1, 0.6]]);
    expect(audio.elements[0]?.pauses).toBe(0);
    expect(mock.state.music?.key).toBe("board.theme");
  });

  it("remembers the key when nothing played, so the next switch retries it", async () => {
    const { mock, audio } = streaming();

    audio.playFails = true;
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(mock.state.music).toEqual({
      key: "board.theme",
      gain: undefined,
      source: undefined,
      stream: undefined
    });

    audio.playFails = false;
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(audio.elements).toHaveLength(2);
    expect(mock.state.music?.stream?.element).toBe(audio.elements[1]);
  });
});

describe('music: "stream" — requests that overlap', () => {
  it("disposes the loser when a later key is asked during a pending play()", async () => {
    const { mock, context, audio, urls } = streaming();

    await Promise.all([
      playMusic(mock.audio, { key: "board.theme", fadeMs: 600 }),
      playMusic(mock.audio, { key: "home.theme", fadeMs: 600 })
    ]);

    expect(audio.elements).toHaveLength(2);
    expect(audio.elements[0]?.pauses).toBe(1);
    expect(urls.revoked).toEqual(["blob:test/1"]);
    expect(context.gains[3]?.gain.ramps).toEqual([]);
    expect(mock.state.music?.key).toBe("home.theme");
    expect(mock.state.musicPending).toBeUndefined();
  });

  it("starts one element for the same key asked twice during a pending play()", async () => {
    const { mock, audio } = streaming();

    await Promise.all([
      playMusic(mock.audio, { key: "board.theme", fadeMs: 600 }),
      playMusic(mock.audio, { key: "board.theme", fadeMs: 600 })
    ]);

    expect(audio.elements).toHaveLength(1);
  });

  it("disposes the pending element when null is asked during its play()", async () => {
    const { mock, urls } = streaming();

    await Promise.all([
      playMusic(mock.audio, { key: "board.theme", fadeMs: 600 }),
      // eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
      playMusic(mock.audio, { key: null, fadeMs: 600 })
    ]);

    expect(urls.revoked).toEqual(["blob:test/1"]);
    expect(mock.state.music).toBeUndefined();
  });
});

describe('music: "stream" — where there is nothing to stream with', () => {
  it("decodes the key and warns once per key where the runtime has no Audio constructor", async () => {
    const urls = installFakeUrl();
    const context = createFakeContext();
    const mock = createMockAudio({ context, config: { music: "stream" } });

    vi.stubGlobal("Audio", undefined);
    mock.start();
    mock.state.unlocked = true;
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    // eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
    await playMusic(mock.audio, { key: null, fadeMs: 600 });
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]?.loop).toBe(true);
    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("audio: no media element, music decodes", {
      key: "board.theme"
    });
    expect(urls.created).toEqual([]);
  });

  it("makes no element and no URL headless, and remembers the key", async () => {
    const audio = installFakeAudio();
    const urls = installFakeUrl();
    const mock = createMockAudio({ config: { music: "stream" } });

    mock.start();
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(audio.elements).toEqual([]);
    expect(urls.created).toEqual([]);
    expect(mock.state.music?.key).toBe("board.theme");
  });

  it("makes no element while the context is locked, and the first touch starts the key", async () => {
    const fakeWindow = installFakeWindow();
    const audio = installFakeAudio();

    installFakeUrl();

    const mock = createMockAudio({ context: createFakeContext(), config: { music: "stream" } });

    mock.start();
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(audio.elements).toEqual([]);

    fakeWindow.dispatch("pointerdown");
    await tick();

    expect(audio.elements).toHaveLength(1);
    expect(mock.state.music?.stream?.element).toBe(audio.elements[0]);
  });

  it("does not restart a playing element on a second unlock", async () => {
    const fakeWindow = installFakeWindow();
    const { mock, context, audio } = streaming();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    context.state = "suspended";
    installUnlock(mock.audio);
    fakeWindow.dispatch("pointerdown");
    await tick();

    expect(audio.elements).toHaveLength(1);
  });
});
