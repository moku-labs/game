import { afterEach, describe, expect, it, vi } from "vitest";
import type { Descriptor } from "../../../flow/types";
import type { AudioContextLike, Config, LifecycleChanged } from "../../types";
import {
  createFakeContext,
  type FakeContext,
  installFakeWindow,
  keyOf
} from "../fake-audio-context";
import { installFakeAudio, installFakeNavigator, installFakeUrl } from "../fake-media";
import { createMockAudio, type MockAudio } from "./mock-audio";

// ---------------------------------------------------------------------------
// F239: a named sound that loops, `sfx(key, { id, loop: true, fadeMs })`, until a stop, a sound
// that takes its id, the leave of its scene or `onStop`.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The loop `anim`'s `sfx(key, { id: "rain", loop: true })` builds; the options override the id and add the rest. */
function loop(
  key: string,
  options: { id?: string; fadeMs?: number; bus?: string } = {}
): Descriptor {
  return {
    kind: "sfx",
    payload: { key, bus: "sfx", id: "rain", loop: true, ...options },
    cosmetic: true
  };
}

/** A one-shot `sfx`, with an id when one is given. */
function sfx(key: string, id?: string): Descriptor {
  return {
    kind: "sfx",
    payload: id === undefined ? { key, bus: "sfx" } : { key, bus: "sfx", id },
    cosmetic: true
  };
}

/** A started plugin over the fake context, with the unlock already through. */
function unlocked(config: Partial<Config> = {}): MockAudio & { context: FakeContext } {
  const context = createFakeContext();
  const mock = createMockAudio({ context, config });

  mock.start();
  mock.state.unlocked = true;

  return { ...mock, context };
}

/** A started plugin on a page whose context waits for the first gesture. */
function locked(config: Partial<Config> = {}): MockAudio & {
  context: FakeContext;
  touch: () => Promise<void>;
} {
  const fakeWindow = installFakeWindow();
  const context = createFakeContext();
  const mock = createMockAudio({ context, config });

  mock.start();

  return {
    ...mock,
    context,
    touch: async (): Promise<void> => {
      fakeWindow.dispatch("pointerdown");
      await tick();
    }
  };
}

/** A started plugin on a stand-in iPhone whose factory makes a new running context on each call. */
function phone(journal = 0): { mock: MockAudio; made: FakeContext[] } {
  installFakeNavigator({ type: "auto", touchPoints: 5 });
  installFakeWindow();

  const made: FakeContext[] = [];
  const mock = createMockAudio({
    config: {
      journal,
      context: (): AudioContextLike => {
        const context = createFakeContext({ autoplay: true });

        made.push(context);

        return context;
      }
    }
  });

  mock.start();

  return { mock, made };
}

/** Sends the game to the background and back: the renewal starts a second later. */
function awayAndBack(mock: MockAudio): void {
  const away: LifecycleChanged = {
    reason: "background",
    action: "push",
    reasons: ["background"],
    paused: true,
    resumed: false
  };

  mock.hooks["lifecycle:changed"](away);
  mock.hooks["lifecycle:changed"]({
    ...away,
    action: "pop",
    reasons: [],
    paused: false,
    resumed: true
  });
  vi.advanceTimersByTime(1000);
}

/** Yields the microtask queue, the way a test waits for `resume()` and `close()` without a timer. */
async function tick(times = 10): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/** The key and the loop flag of every source a context made, in order. */
function played(context: FakeContext | undefined): Array<[string | undefined, boolean]> {
  return (context?.sources ?? []).map(source => [keyOf(source.buffer), source.loop]);
}

describe("a loop plays", () => {
  it("as a looping source through its own gain into the sfx bus, and holds its id", async () => {
    // Bug caught: the bed plays once and stops, and its id is freed at its end.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", loop("rain.room"));

    const [source] = context.sources;

    expect(played(context)).toEqual([["rain.room", true]]);
    expect(source?.connectedTo).toBe(context.gains[3]);
    expect(context.gains[3]?.connectedTo).toBe(context.gains[2]);
    expect(mock.state.named.get("rain")?.source).toBe(source);
  });

  it("fades in from 0 over its fadeMs, and the sound it replaces fades out over the same fadeMs", async () => {
    // Bug caught: the bed starts at full gain with a click, or the line it replaces is cut.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", sfx("story.line1", "rain"));
    context.currentTime = 10;
    await mock.fx("sfx", loop("rain.room", { fadeMs: 800 }));

    const [line] = context.sources;

    expect(context.gains[3]?.gain.ramps).toEqual([[0, 10.8]]);
    expect(line?.stoppedAt).toBe(10.8);
    expect(context.gains[4]?.gain.sets).toEqual([[0, 10]]);
    expect(context.gains[4]?.gain.ramps).toEqual([[1, 10.8]]);
  });

  it("fades in over config.sfxFadeMs when it names no fadeMs", async () => {
    // Bug caught: a loop without fadeMs never rises above 0, or jumps to 1.
    const { context, ...mock } = unlocked({ sfxFadeMs: 250 });

    await mock.fx("sfx", loop("rain.room"));

    expect(context.gains[3]?.gain.ramps).toEqual([[1, 0.25]]);
  });

  it("goes through the music bus when it names bus music", async () => {
    // Bug caught: a bed meant for the music slider stays on the sfx bus.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", loop("rain.room", { bus: "music" }));

    expect(context.gains[3]?.connectedTo).toBe(context.gains[1]);
  });

  it("still decodes into a looping buffer source at music: stream", async () => {
    // Bug caught: the stream mode of the music reaches the loops, so the bed gets a gap at every seam.
    const audio = installFakeAudio();

    installFakeUrl();

    const { context, ...mock } = unlocked({ music: "stream" });

    await mock.fx("sfx", loop("rain.room"));

    expect(played(context)).toEqual([["rain.room", true]]);
    expect(context.mediaSources).toEqual([]);
    expect(audio.elements).toEqual([]);
  });

  it("plays once, as a plain sfx, from a hand-written payload with loop and no id", async () => {
    // Bug caught: a loop with no id plays forever and nothing can stop it, or the handler throws.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", {
      kind: "sfx",
      payload: { key: "rain.room", loop: true },
      cosmetic: true
    });

    expect(played(context)).toEqual([["rain.room", false]]);
    expect(context.sources[0]?.connectedTo).toBe(context.gains[2]);
    expect(mock.state.loops.size).toBe(0);
  });

  it("frees its id and is forgotten when its file is missing, with one warning", async () => {
    // Bug caught: a missing bed is tried again at every unlock and keeps its id taken.
    const { context, ...mock } = unlocked();

    mock.assets.missing.add("rain.gone");
    await mock.fx("sfx", loop("rain.gone"));

    expect(context.sources).toEqual([]);
    expect(mock.state.named.size).toBe(0);
    expect(mock.state.loops.size).toBe(0);
    expect(mock.log.warn).toHaveBeenCalledWith("audio: no audio for key", { key: "rain.gone" });
  });

  it("stores nothing and resolves at once headless", async () => {
    // Bug caught: a run with no context at all piles up loops it can never play.
    const mock = createMockAudio();

    mock.start();

    await expect(mock.fx("sfx", loop("rain.room"))).resolves.toBeUndefined();
    expect(mock.state.loops.size).toBe(0);
  });
});

describe("a loop asked for again under its id", () => {
  it("changes nothing for the same key, while it decodes and while it plays", async () => {
    // Bug caught: every panorama of the scene restarts the rain from its start, with a second journal line.
    const { context, ...mock } = unlocked({ journal: 10 });

    await Promise.all([mock.fx("sfx", loop("rain.room")), mock.fx("sfx", loop("rain.room"))]);
    await mock.fx("sfx", loop("rain.room", { fadeMs: 900 }));

    expect(context.sources).toHaveLength(1);
    expect(context.gains).toHaveLength(4);
    expect(context.gains[3]?.gain.ramps).toEqual([[1, 0.12]]);
    expect(context.sources[0]?.stoppedAt).toBeUndefined();
    expect(mock.api.journal()).toHaveLength(1);
  });

  it("keeps the scene the loop was asked for in, so a same-key request does not tie it to the next scene", async () => {
    // Bug caught: a bed started before any scene is cut at the leave of the scene that asked for it again.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", loop("rain.room"));
    mock.hooks["scenes:changed"]({ from: undefined, to: "ward", music: undefined });
    await mock.fx("sfx", loop("rain.room"));
    mock.hooks["scenes:changed"]({ from: "ward", to: "yard", music: undefined });

    expect(context.sources[0]?.stoppedAt).toBeUndefined();
    expect(mock.state.loops.has("rain")).toBe(true);
  });

  it("changes nothing for the same key while it waits for the unlock", async () => {
    // Bug caught: the second request of a remembered bed replaces it, and it starts twice at the unlock.
    const mock = locked();

    await mock.fx("sfx", loop("rain.room"));

    const remembered = mock.state.loops.get("rain");

    await mock.fx("sfx", loop("rain.room", { fadeMs: 900 }));
    await mock.touch();

    expect(mock.state.loops.get("rain")).toBe(remembered);
    expect(played(mock.context)).toEqual([["rain.room", true]]);
  });

  it("cross-fades to another key over the new fadeMs", async () => {
    // Bug caught: the panorama's bed is ignored because the id is taken, or both beds play.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", loop("rain.room"));
    context.currentTime = 3;
    await mock.fx("sfx", loop("rain.car", { fadeMs: 600 }));

    expect(played(context)).toEqual([
      ["rain.room", true],
      ["rain.car", true]
    ]);
    expect(context.sources[0]?.stoppedAt).toBe(3.6);
    expect(mock.state.loops.get("rain")?.key).toBe("rain.car");
  });

  it("is replaced by a one-shot under its id, which forgets the loop", async () => {
    // Bug caught: a line under the bed's id plays, but the bed comes back at the next unlock.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", loop("rain.room"));
    await mock.fx("sfx", sfx("story.line1", "rain"));

    expect(context.sources[0]?.stoppedAt).toBe(0.12);
    expect(mock.state.loops.has("rain")).toBe(false);
  });
});

describe("a loop before the unlock", () => {
  it("is remembered, not queued, and starts once when the first touch unlocks the context", async () => {
    // Bug caught: a bed asked for before the first touch is dropped like a click, or starts twice.
    const mock = locked();

    await mock.fx("sfx", loop("rain.room"));

    expect(mock.state.pendingSfx.size).toBe(0);
    expect(mock.context.sources).toEqual([]);

    await mock.touch();

    expect(played(mock.context)).toEqual([["rain.room", true]]);
  });

  it("drops a one-shot that waits under its id while the touch resumes the context", async () => {
    // Bug caught: the line queued under the id plays over the bed that replaced it.
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    fakeWindow.dispatch("pointerdown");
    const plays = [mock.fx("sfx", sfx("story.line1", "rain")), mock.fx("sfx", loop("rain.room"))];

    expect(mock.state.pendingSfx.has("#rain")).toBe(false);

    await Promise.all(plays);
    await tick();

    expect(played(context)).toEqual([["rain.room", true]]);
  });

  it("is forgotten by a one-shot under its id fired after it", async () => {
    // Bug caught: the remembered bed starts at the unlock although a later sound took its id.
    const mock = locked();

    await mock.fx("sfx", loop("rain.room"));
    await mock.fx("sfx", sfx("story.line1", "rain"));
    await mock.touch();

    expect(mock.state.loops.size).toBe(0);
    expect(mock.context.sources).toEqual([]);
  });

  it("never starts when its id is stopped before the unlock", async () => {
    // Bug caught: a bed the game stopped while the context was locked starts at the first touch.
    const mock = locked();

    await mock.fx("sfx", loop("rain.room"));
    mock.api.stop("rain");
    await mock.touch();

    expect(mock.state.loops.size).toBe(0);
    expect(mock.context.sources).toEqual([]);
  });
});

describe("a loop and the scene", () => {
  it("fades out over musicFadeMs at the leave of the scene it was asked in, and only then", async () => {
    // Bug caught: the rain of the ward goes on in the next scene, or a bed of no scene is cut.
    const { context, ...mock } = unlocked({ musicFadeMs: 500 });

    await mock.fx("sfx", loop("hum.low", { id: "hum" }));
    mock.hooks["scenes:changed"]({ from: undefined, to: "ward", music: undefined });
    await mock.fx("sfx", loop("rain.room"));
    context.currentTime = 2;
    mock.hooks["scenes:changed"]({ from: "ward", to: "yard", music: undefined });
    await mock.fx("sfx", loop("wind.yard", { id: "wind" }));

    const [hum, rain, wind] = context.sources;

    expect(rain?.stoppedAt).toBe(2.5);
    expect(context.gains[4]?.gain.ramps.at(-1)).toEqual([0, 2.5]);
    expect(mock.state.named.has("rain")).toBe(false);
    expect([...mock.state.loops.keys()]).toEqual(["hum", "wind"]);

    mock.hooks["scenes:changed"]({ from: "yard", to: "ward", music: undefined });

    expect(wind?.stoppedAt).toBe(2.5);
    expect(hum?.stoppedAt).toBeUndefined();
  });

  it("keeps playing through a pause, the same source, never stopped or made again", async () => {
    // Bug caught: a pause stops the bed, or the resume starts a second one.
    const { context, ...mock } = unlocked();
    const pause: LifecycleChanged = {
      reason: "system-dialog",
      action: "push",
      reasons: ["system-dialog"],
      paused: true,
      resumed: false
    };

    await mock.fx("sfx", loop("rain.room"));
    mock.hooks["lifecycle:changed"](pause);
    mock.hooks["lifecycle:changed"]({
      ...pause,
      action: "pop",
      reasons: [],
      paused: false,
      resumed: true
    });

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.stoppedAt).toBeUndefined();
    expect(mock.state.named.get("rain")?.source).toBe(context.sources[0]);
  });
});

describe("a loop and the iOS renewal", () => {
  it("starts again in the new context at its bus, but not a loop that was stopped", async () => {
    // Bug caught: the bed is gone after a trip to the background, or a stopped bed comes back.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const { mock, made } = phone();

    await tick();
    await mock.fx("sfx", loop("rain.room"));
    await mock.fx("sfx", loop("hum.low", { id: "hum" }));
    mock.api.stop("hum", { fadeMs: 0 });
    awayAndBack(mock);
    await tick();

    const [old, fresh] = made;

    expect(old?.sources[0]?.stoppedAt).toBe(0);
    expect(played(fresh)).toEqual([["rain.room", true]]);
    expect(fresh?.gains[3]?.connectedTo).toBe(fresh?.gains[2]);
  });

  it("starts in the new context when it is asked for while the old one closes", async () => {
    // Bug caught: a bed fired during the renewal is dropped as a one-shot is.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const { mock, made } = phone();

    await tick();
    awayAndBack(mock);

    expect(mock.state.context).toBeUndefined();

    await mock.fx("sfx", loop("rain.room"));
    await tick();

    expect(played(made[1])).toEqual([["rain.room", true]]);
  });
});

describe("the journal of a loop", () => {
  it("has one entry with loop: true per loop, and a new one for another key under the id", async () => {
    // Bug caught: a test cannot tell the bed started looping, or a same-key request logs it again.
    const mock = unlocked({ journal: 10 });

    mock.time.elapsed = 100;
    await mock.fx("sfx", loop("rain.room"));
    await mock.fx("sfx", loop("rain.room"));
    mock.time.elapsed = 200;
    await mock.fx("sfx", loop("rain.car"));

    expect(mock.api.journal()).toStrictEqual([
      { key: "rain.room", bus: "sfx", kind: "sfx", id: "rain", loop: true, at: 100 },
      { key: "rain.car", bus: "sfx", kind: "sfx", id: "rain", loop: true, at: 200 }
    ]);
  });

  it("is written when a remembered loop really starts at the unlock", async () => {
    // Bug caught: the journal says the bed played at the request, before anything was heard.
    const mock = locked({ journal: 10 });

    mock.time.elapsed = 100;
    await mock.fx("sfx", loop("rain.room"));

    expect(mock.api.journal()).toEqual([]);

    mock.time.elapsed = 300;
    await mock.touch();

    expect(mock.api.journal()).toStrictEqual([
      { key: "rain.room", bus: "sfx", kind: "sfx", id: "rain", loop: true, at: 300 }
    ]);
  });

  it("gets no new entry when the renewal starts the loop again", async () => {
    // Bug caught: every trip to the background adds the same bed to the journal again.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const { mock, made } = phone(10);

    await tick();
    await mock.fx("sfx", loop("rain.room"));
    awayAndBack(mock);
    await tick();

    expect(played(made[1])).toEqual([["rain.room", true]]);
    expect(mock.api.journal()).toHaveLength(1);
  });
});

describe("a loop and onStop", () => {
  it("is stopped at once and forgotten", async () => {
    // Bug caught: the bed outlives the app, or a restarted app plays it again.
    const { context, ...mock } = unlocked();

    await mock.fx("sfx", loop("rain.room"));
    await mock.stop();

    expect(context.sources[0]?.stoppedAt).toBe(0);
    expect(mock.state.loops.size).toBe(0);
  });
});
