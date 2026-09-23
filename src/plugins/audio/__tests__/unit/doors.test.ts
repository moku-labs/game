import { describe, expect, it } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import type { Descriptor } from "../../../flow/types";
import { soundsSource } from "../../inspect";
import { playMusic } from "../../playback";
import { createFakeContext } from "../fake-audio-context";
import { createMockAudio } from "./mock-audio";

// ---------------------------------------------------------------------------
// Unit test: the audio source of the /inspect door over the real journal of
// the mock plugin
// ---------------------------------------------------------------------------

/**
 * The descriptor `anim`'s `sfx` helper builds.
 *
 * @param key - The sound key.
 * @returns The descriptor.
 */
function sfx(key: string): Descriptor {
  return { kind: "sfx", payload: { key }, cosmetic: true };
}

/**
 * A started, unlocked plugin with a journal of 10 that heard the board theme, a click and a
 * chime, 100 ms apart.
 *
 * @returns The app the source reads.
 */
async function heard() {
  const mock = createMockAudio({ context: createFakeContext(), config: { journal: 10 } });

  mock.start();
  mock.state.unlocked = true;
  await playMusic(mock.audio, { key: "board.theme", fadeMs: 0 });
  mock.time.elapsed = 100;
  await mock.fx("sfx", sfx("ui.click"));
  mock.time.elapsed = 200;
  await mock.fx("sfx", sfx("orders.complete"));

  return { ...createApp(), audio: mock.api };
}

describe("game.sounds", () => {
  it("is a frame source with an optional count", () => {
    expect(soundsSource.id).toBe("game.sounds");
    expect(soundsSource.changes).toBe("frame");
    expect(soundsSource.input).toEqual({ last: "number?" });
  });

  it("reads every started sound, oldest first", async () => {
    const app = await heard();

    expect(read(app, soundsSource)).toEqual([
      { key: "board.theme", bus: "music", kind: "music", at: 0 },
      { key: "ui.click", bus: "sfx", kind: "sfx", at: 100 },
      { key: "orders.complete", bus: "sfx", kind: "sfx", at: 200 }
    ]);
  });

  it("reads the last few", async () => {
    const app = await heard();

    expect(read(app, soundsSource, { last: 2 }).map(entry => entry.key)).toEqual([
      "ui.click",
      "orders.complete"
    ]);
    expect(read(app, soundsSource, { last: 0 })).toEqual([]);
    expect(read(app, soundsSource, { last: 9 })).toHaveLength(3);
  });

  it("reads nothing while the journal is off", () => {
    const mock = createMockAudio({ config: { journal: 0 } });

    expect(read({ ...createApp(), audio: mock.api }, soundsSource)).toEqual([]);
  });
});
