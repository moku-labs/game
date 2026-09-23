import { describe, expect, it } from "vitest";
import type { Descriptor } from "../../../flow/types";
import { playMusic, stopMusic } from "../../playback";
import { createFakeContext, keyOf } from "../fake-audio-context";
import { createMockAudio, type MockAudio } from "./mock-audio";

/** The descriptor `anim`'s `sfx` helper builds. */
function sfx(key: string, bus?: string): Descriptor {
  return {
    kind: "sfx",
    payload: bus === undefined ? { key } : { key, bus },
    cosmetic: true
  };
}

/** A started plugin over the fake context, with the unlock already through. */
function unlocked(): MockAudio {
  const mock = createMockAudio({ context: createFakeContext() });

  mock.start();
  mock.state.unlocked = true;

  return mock;
}

describe("playSfx", () => {
  it("decodes one key once for two plays that are in flight together", async () => {
    const mock = unlocked();

    await Promise.all([mock.fx("sfx", sfx("ui.click")), mock.fx("sfx", sfx("ui.click"))]);

    expect(mock.context?.decodes).toEqual(["ui.click"]);
    expect(mock.state.decoded.size).toBe(1);
  });

  it("makes a new source per play and connects it to the sfx bus", async () => {
    const mock = unlocked();

    await mock.fx("sfx", sfx("ui.click"));
    await mock.fx("sfx", sfx("ui.click"));

    const sources = mock.context?.sources ?? [];

    expect(sources).toHaveLength(2);
    expect(keyOf(sources[0]?.buffer)).toBe("ui.click");
    expect(sources[0]?.loop).toBe(false);
    expect(sources[0]?.startedAt).toBe(0);
    expect(sources[0]?.connectedTo).toBe(mock.context?.gains[2]);
  });

  it("sends a sound to the bus the descriptor named", async () => {
    const mock = unlocked();

    await mock.fx("sfx", sfx("board.theme", "music"));

    expect(mock.context?.sources[0]?.connectedTo).toBe(mock.context?.gains[1]);
  });

  it("warns once for a key the assets do not carry, and resolves", async () => {
    const mock = unlocked();

    mock.assets.missing.add("ui.gone");

    await expect(mock.fx("sfx", sfx("ui.gone"))).resolves.toBeUndefined();
    await mock.fx("sfx", sfx("ui.gone"));

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("audio: no audio for key", { key: "ui.gone" });
    expect(mock.context?.sources).toHaveLength(0);
  });

  it("warns once for a file that does not decode, and resolves", async () => {
    const mock = unlocked();

    await expect(mock.fx("sfx", sfx("ui.bad"))).resolves.toBeUndefined();
    await mock.fx("sfx", sfx("ui.bad"));

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("audio: the audio file did not decode", {
      key: "ui.bad"
    });
  });

  it("warns for a bus that does not exist and plays nothing", async () => {
    const mock = unlocked();

    await mock.fx("sfx", sfx("ui.click", "voice"));

    expect(mock.log.warn).toHaveBeenCalledWith("audio: unknown bus", { bus: "voice" });
    expect(mock.context?.sources).toHaveLength(0);
  });

  it("resolves at once while the context is not unlocked", async () => {
    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();

    await expect(mock.fx("sfx", sfx("ui.click"))).resolves.toBeUndefined();
    expect(mock.context?.sources).toHaveLength(0);
  });

  it("resolves at once headless", async () => {
    const mock = createMockAudio();

    mock.start();

    await expect(mock.fx("sfx", sfx("ui.click"))).resolves.toBeUndefined();
  });

  it("plays nothing for a descriptor without a key", async () => {
    const mock = unlocked();

    await mock.fx("sfx", { kind: "sfx", payload: {}, cosmetic: true });

    expect(mock.context?.sources).toHaveLength(0);
  });
});

describe("playMusic", () => {
  it("starts a looping track on its own gain, ramped up over the fade", async () => {
    const mock = unlocked();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    const track = mock.context?.gains[3];
    const source = mock.context?.sources[0];

    expect(track?.connectedTo).toBe(mock.context?.gains[1]);
    expect(track?.gain.sets).toEqual([[0, 0]]);
    expect(track?.gain.ramps).toEqual([[1, 0.6]]);
    expect(source?.loop).toBe(true);
    expect(source?.connectedTo).toBe(track);
    expect(keyOf(source?.buffer)).toBe("board.theme");
    expect(mock.state.music?.key).toBe("board.theme");
  });

  it("does nothing when the key is the one that is playing", async () => {
    const mock = unlocked();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(mock.context?.sources).toHaveLength(1);
  });

  it("fades the old track out, stops it at the end of the fade and fades the new one in", async () => {
    const mock = unlocked();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    const context = mock.context;

    if (context !== undefined) context.currentTime = 10;

    await playMusic(mock.audio, { key: "home.theme", fadeMs: 600 });

    expect(context?.gains[3]?.gain.ramps.at(-1)).toEqual([0, 10.6]);
    expect(context?.sources[0]?.stoppedAt).toBe(10.6);
    expect(context?.gains[4]?.gain.ramps).toEqual([[1, 10.6]]);
    expect(mock.state.music?.key).toBe("home.theme");
  });

  it("fades the track out and forgets it for a null key", async () => {
    const mock = unlocked();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    // eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
    await playMusic(mock.audio, { key: null, fadeMs: 600 });

    expect(mock.context?.gains[3]?.gain.ramps.at(-1)).toEqual([0, 0.6]);
    expect(mock.context?.sources[0]?.stoppedAt).toBe(0.6);
    expect(mock.state.music).toBeUndefined();
  });

  it("remembers the key while the context is locked and starts it after the unlock", async () => {
    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(mock.state.music).toEqual({ key: "board.theme", source: undefined, gain: undefined });
    expect(mock.context?.sources).toHaveLength(0);

    mock.state.unlocked = true;
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(mock.state.music?.source).toBeDefined();
    expect(mock.context?.sources).toHaveLength(1);
  });

  it("keeps the current track when the new key has no file", async () => {
    const mock = unlocked();

    mock.assets.missing.add("home.gone");
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    await playMusic(mock.audio, { key: "home.gone", fadeMs: 600 });

    expect(mock.state.music?.key).toBe("board.theme");
    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.context?.sources).toHaveLength(1);
  });

  it("starts one source for the same key requested twice while the first is decoding", async () => {
    const mock = unlocked();

    await Promise.all([
      playMusic(mock.audio, { key: "ui.theme", fadeMs: 600 }),
      playMusic(mock.audio, { key: "ui.theme", fadeMs: 600 })
    ]);

    expect(mock.context?.sources).toHaveLength(1);
    expect(mock.state.music?.key).toBe("ui.theme");
    expect(mock.state.musicPending).toBeUndefined();
  });

  it("plays only the second key when it is requested while the first is decoding", async () => {
    const mock = unlocked();

    await Promise.all([
      playMusic(mock.audio, { key: "board.theme", fadeMs: 600 }),
      playMusic(mock.audio, { key: "home.theme", fadeMs: 600 })
    ]);

    const sources = mock.context?.sources ?? [];

    expect(sources).toHaveLength(1);
    expect(keyOf(sources[0]?.buffer)).toBe("home.theme");
    expect(mock.state.music?.key).toBe("home.theme");
  });

  it("plays nothing when null is requested while a key is decoding", async () => {
    const mock = unlocked();

    await Promise.all([
      playMusic(mock.audio, { key: "board.theme", fadeMs: 600 }),
      // eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
      playMusic(mock.audio, { key: null, fadeMs: 600 })
    ]);

    expect(mock.context?.sources).toHaveLength(0);
    expect(mock.state.music).toBeUndefined();
  });

  it("keeps the playing key and drops the pending one when the playing key is asked again", async () => {
    const mock = unlocked();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    await Promise.all([
      playMusic(mock.audio, { key: "home.theme", fadeMs: 600 }),
      playMusic(mock.audio, { key: "board.theme", fadeMs: 600 })
    ]);

    expect(mock.context?.sources).toHaveLength(1);
    expect(mock.context?.sources[0]?.stoppedAt).toBeUndefined();
    expect(mock.state.music?.key).toBe("board.theme");
  });

  it("starts nothing when the music is stopped while a key is decoding", async () => {
    const mock = unlocked();
    const pending = playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    stopMusic(mock.state);
    await pending;

    expect(mock.context?.sources).toHaveLength(0);
    expect(mock.state.music).toBeUndefined();
  });

  it("remembers the key headless and starts nothing", async () => {
    const mock = createMockAudio();

    mock.start();
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    expect(mock.state.music?.key).toBe("board.theme");
  });
});

describe("stopMusic", () => {
  it("stops the running source and forgets the track", async () => {
    const mock = unlocked();

    await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });
    stopMusic(mock.state);

    expect(mock.context?.sources[0]?.stoppedAt).toBe(0);
    expect(mock.state.music).toBeUndefined();
  });

  it("does nothing when no track is playing", () => {
    const mock = createMockAudio();

    expect(() => stopMusic(mock.state)).not.toThrow();
  });
});
