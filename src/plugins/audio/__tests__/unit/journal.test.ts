import { describe, expect, it } from "vitest";
import type { Descriptor } from "../../../flow/types";
import { playMusic } from "../../playback";
import { createFakeContext } from "../fake-audio-context";
import { createMockAudio, type MockAudio } from "./mock-audio";

/** The descriptor `anim`'s `sfx` helper builds. */
function sfx(key: string, bus?: string): Descriptor {
  return { kind: "sfx", payload: bus === undefined ? { key } : { key, bus }, cosmetic: true };
}

/** A started, unlocked plugin over the fake context with the given journal size. */
function unlocked(journal: number): MockAudio {
  const mock = createMockAudio({ context: createFakeContext(), config: { journal } });

  mock.start();
  mock.state.unlocked = true;

  return mock;
}

describe("audio journal", () => {
  it("records nothing while the journal is off, the default", async () => {
    const mock = unlocked(0);

    await mock.fx("sfx", sfx("ui.click"));
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 0 });

    expect(mock.context?.sources).toHaveLength(2);
    expect(mock.api.journal()).toEqual([]);
  });

  it("records a started sound with its bus and the elapsed game time", async () => {
    const mock = unlocked(10);

    mock.time.elapsed = 1600;
    await mock.fx("sfx", sfx("ui.click"));
    mock.time.elapsed = 1700;
    await mock.fx("sfx", sfx("board.theme", "music"));

    expect(mock.api.journal()).toEqual([
      { key: "ui.click", bus: "sfx", kind: "sfx", at: 1600 },
      { key: "board.theme", bus: "music", kind: "sfx", at: 1700 }
    ]);
  });

  it("records a music start on the music bus, and not a switch to the same key", async () => {
    const mock = unlocked(10);

    mock.time.elapsed = 320;
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 0 });
    await playMusic(mock.audio, { key: "board.theme", fadeMs: 0 });

    expect(mock.api.journal()).toEqual([
      { key: "board.theme", bus: "music", kind: "music", at: 320 }
    ]);
  });

  it("records nothing for a sound that did not start", async () => {
    const mock = unlocked(10);

    mock.assets.missing.add("ui.gone");
    await mock.fx("sfx", sfx("ui.gone"));
    await mock.fx("sfx", sfx("ui.click", "voice"));
    // eslint-disable-next-line unicorn/no-null -- `null` is the seam: it stops the music.
    await playMusic(mock.audio, { key: null, fadeMs: 0 });

    expect(mock.api.journal()).toEqual([]);
  });

  it("keeps only the newest entries, as many as the journal size", async () => {
    const mock = unlocked(2);

    await mock.fx("sfx", sfx("a"));
    await mock.fx("sfx", sfx("b"));
    await mock.fx("sfx", sfx("c"));

    expect(mock.api.journal().map(entry => entry.key)).toEqual(["b", "c"]);
  });

  it("hands out a copy a caller cannot write into", async () => {
    const mock = unlocked(5);

    await mock.fx("sfx", sfx("ui.click"));
    (mock.api.journal() as unknown[]).length = 0;

    expect(mock.api.journal()).toHaveLength(1);
  });

  it("is cleared when the plugin stops", async () => {
    const mock = unlocked(5);

    await mock.fx("sfx", sfx("ui.click"));
    await mock.stop();

    expect(mock.api.journal()).toEqual([]);
  });
});
