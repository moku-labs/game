import { afterEach, describe, expect, it, vi } from "vitest";
import type { Descriptor } from "../../../flow/types";
import type { Json } from "../../../model/types";
import type { Config } from "../../types";
import {
  createFakeContext,
  type FakeContext,
  installFakeWindow,
  keyOf
} from "../fake-audio-context";
import { createMockAudio, type MockAudio } from "./mock-audio";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The `sfx` descriptor `anim` builds; `id` and `fadeMs` only when given, as `anim` writes them. */
function sfx(key: string, options: { id?: string; fadeMs?: number } = {}): Descriptor {
  return { kind: "sfx", payload: { key, bus: "sfx", ...options }, cosmetic: true };
}

/** The `stopSfx` descriptor `anim` builds. */
function stopSfx(id: string, fadeMs?: number): Descriptor {
  const payload: Json = fadeMs === undefined ? { id } : { id, fadeMs };

  return { kind: "stopSfx", payload, cosmetic: true };
}

/** A started plugin over the fake context, with the unlock already through. */
function unlocked(config: Partial<Config> = {}): MockAudio & { context: FakeContext } {
  const context = createFakeContext();
  const mock = createMockAudio({ context, config });

  mock.start();
  mock.state.unlocked = true;

  return { ...mock, context };
}

/** Yields the microtask queue, the way a test waits for `resume()` without a timer. */
async function tick(times = 10): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe("a sound with an id", () => {
  it("fades the sound with its id over the new fadeMs, stops it at the fade's end, and plays through its own gain", async () => {
    // Bug caught: two lines of the narrator are heard over each other.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", sfx("story.line1", { id: "voice", fadeMs: 150 }));
    context.currentTime = 10;
    await mock.fx("sfx", sfx("story.line2", { id: "voice", fadeMs: 300 }));

    const [first, second] = context.sources;
    const bus = context.gains[2];
    const firstGain = context.gains[3];
    const secondGain = context.gains[4];

    expect(first?.connectedTo).toBe(firstGain);
    expect(firstGain?.connectedTo).toBe(bus);
    expect(firstGain?.gain.sets).toEqual([[1, 10]]);
    expect(firstGain?.gain.ramps).toEqual([[0, 10.3]]);
    expect(first?.stoppedAt).toBe(10.3);
    expect(keyOf(second?.buffer)).toBe("story.line2");
    expect(second?.connectedTo).toBe(secondGain);
    expect(secondGain?.connectedTo).toBe(bus);
    expect(secondGain?.gain.value).toBe(1);
    expect(second?.startedAt).toBe(0);
    expect(second?.stoppedAt).toBeUndefined();
    expect(mock.state.named.get("voice")?.source).toBe(second);
  });

  it("fades the replaced sound over config.sfxFadeMs when the new one names no fadeMs", async () => {
    // Bug caught: a line without fadeMs cuts the one before it, or fades it over musicFadeMs.
    const { context, ...mock } = unlocked({ sfxFadeMs: 250 });

    await mock.fx("sfx", sfx("story.line1", { id: "voice" }));
    await mock.fx("sfx", sfx("story.line2", { id: "voice" }));

    expect(context.gains[3]?.gain.ramps).toEqual([[0, 0.25]]);
    expect(context.sources[0]?.stoppedAt).toBe(0.25);
  });

  it("leaves a sound without an id on the bus itself and fades nothing", async () => {
    // Bug caught: two ui clicks cut each other, or a click cuts the narrator.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", sfx("story.line1", { id: "voice" }));
    await mock.fx("sfx", sfx("ui.click"));
    await mock.fx("sfx", sfx("ui.click"));

    const [line, click, again] = context.sources;

    expect(context.gains).toHaveLength(4);
    expect(click?.connectedTo).toBe(context.gains[2]);
    expect(again?.connectedTo).toBe(context.gains[2]);
    expect([line?.stoppedAt, click?.stoppedAt, again?.stoppedAt]).toEqual([
      undefined,
      undefined,
      undefined
    ]);
    expect(context.gains[3]?.gain.ramps).toEqual([]);
    expect(mock.state.named.size).toBe(1);
  });

  it("starts nothing when its id is stopped while it decodes", async () => {
    // Bug caught: a line the game already stopped plays late, once its file decoded.
    const { context, ...mock } = unlocked();
    const play = mock.fx("sfx", sfx("story.line1", { id: "voice" }));

    await mock.fx("stopSfx", stopSfx("voice"));
    await play;

    expect(context.sources).toHaveLength(0);
    expect(context.gains).toHaveLength(3);
    expect(mock.state.named.size).toBe(0);
  });

  it("starts only the last of two sounds with one id that decode together", async () => {
    // Bug caught: the replaced line starts after all, when its buffer arrives.
    const { context, ...mock } = unlocked();

    await Promise.all([
      mock.fx("sfx", sfx("story.line1", { id: "voice" })),
      mock.fx("sfx", sfx("story.line2", { id: "voice" }))
    ]);

    expect(context.sources.map(source => keyOf(source.buffer))).toEqual(["story.line2"]);
    expect(mock.state.named.get("voice")?.source).toBe(context.sources[0]);
  });

  it("frees its id when its file is missing, and warns once", async () => {
    // Bug caught: a missing line keeps its id taken by an entry that never plays.
    const { context, ...mock } = unlocked();

    mock.assets.missing.add("story.gone");
    await mock.fx("sfx", sfx("story.gone", { id: "voice" }));

    expect(context.sources).toHaveLength(0);
    expect(mock.state.named.size).toBe(0);
    expect(mock.log.warn).toHaveBeenCalledWith("audio: no audio for key", { key: "story.gone" });
  });

  it("disconnects its gain and frees its id when it ends", async () => {
    // Bug caught: every line that ended leaks its gain node and keeps its id.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", sfx("story.line1", { id: "voice" }));
    context.sources[0]?.end();

    expect(context.gains[3]?.disconnects).toBe(1);
    expect(mock.state.named.size).toBe(0);
  });

  it("keeps the new sound's id when the sound it replaced ends", async () => {
    // Bug caught: the old line's end forgets the new line, so the next stop misses it.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", sfx("story.line1", { id: "voice" }));
    await mock.fx("sfx", sfx("story.line2", { id: "voice" }));
    context.sources[0]?.end();

    expect(context.gains[3]?.disconnects).toBe(1);
    expect(mock.state.named.get("voice")?.source).toBe(context.sources[1]);

    mock.api.stop("voice", { fadeMs: 0 });

    expect(context.sources[1]?.stoppedAt).toBe(0);
  });
});

describe("stopSfx and app.audio.stop", () => {
  it("fade the sound out over the fadeMs given, else config.sfxFadeMs, and free the id", async () => {
    // Bug caught: a stop ignores its fadeMs, cuts at once without one, or keeps the id taken.
    const { context, ...mock } = unlocked({ sfxFadeMs: 250 });

    await mock.fx("sfx", sfx("story.line1", { id: "voice" }));
    await mock.fx("sfx", sfx("story.wind", { id: "ambience" }));
    await mock.fx("sfx", sfx("story.rain", { id: "weather" }));
    context.currentTime = 5;
    await mock.fx("stopSfx", stopSfx("voice", 200));
    await mock.fx("stopSfx", stopSfx("ambience"));
    mock.api.stop("weather");

    expect(context.gains.slice(3).map(gain => gain.gain.ramps)).toEqual([
      [[0, 5.2]],
      [[0, 5.25]],
      [[0, 5.25]]
    ]);
    expect(context.sources.map(source => source.stoppedAt)).toEqual([5.2, 5.25, 5.25]);
    expect(mock.state.named.size).toBe(0);
  });

  it("change nothing for an id nothing plays under, or a stop without an id", async () => {
    // Bug caught: a stop of an unknown id throws, or fades the sound of another id.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", sfx("story.line1", { id: "voice" }));
    await mock.fx("stopSfx", stopSfx("other"));
    await mock.fx("stopSfx", { kind: "stopSfx", payload: {}, cosmetic: true });
    mock.api.stop("other");

    expect(context.gains[3]?.gain.ramps).toEqual([]);
    expect(context.sources[0]?.stoppedAt).toBeUndefined();
    expect(mock.state.named.has("voice")).toBe(true);
  });

  it("resolve headless and play nothing", async () => {
    // Bug caught: a node that awaits a stop hangs or throws in plain Bun.
    const mock = createMockAudio();

    mock.start();

    await expect(mock.fx("sfx", sfx("story.line1", { id: "voice" }))).resolves.toBeUndefined();
    await expect(mock.fx("stopSfx", stopSfx("voice"))).resolves.toBeUndefined();
    expect(() => mock.api.stop("voice", { fadeMs: 0 })).not.toThrow();
    expect(mock.state.named.size).toBe(0);
  });
});

describe("a sound with an id during the unlock", () => {
  it("waits as the latest one per id, apart from the sounds without one", async () => {
    // Bug caught: two lines of the narrator queued behind the tap both play once it unlocks.
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    fakeWindow.dispatch("pointerdown");
    const plays = [
      mock.fx("sfx", sfx("story.line1", { id: "voice" })),
      mock.fx("sfx", sfx("story.line2", { id: "voice" })),
      mock.fx("sfx", sfx("ui.click"))
    ];

    expect([...mock.state.pendingSfx.keys()]).toEqual(["#voice", "ui.click"]);

    await Promise.all(plays);
    await tick();

    expect(context.sources.map(source => keyOf(source.buffer)).toSorted()).toEqual([
      "story.line2",
      "ui.click"
    ]);
  });

  it("is dropped by a stop of its id before the context runs", async () => {
    // Bug caught: a line the game stopped during the unlock plays once the context runs.
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    fakeWindow.dispatch("pointerdown");
    const play = mock.fx("sfx", sfx("story.line1", { id: "voice" }));

    mock.api.stop("voice");

    expect(mock.state.pendingSfx.size).toBe(0);

    await play;
    await tick();

    expect(mock.api.unlocked()).toBe(true);
    expect(context.sources).toHaveLength(0);
  });
});
