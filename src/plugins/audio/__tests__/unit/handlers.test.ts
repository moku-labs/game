import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../model/types";
import { playMusic } from "../../playback";
import type { Bus, Config, LifecycleChanged, Volumes } from "../../types";
import { createFakeContext, type FakeContext } from "../fake-audio-context";
import { type FakeAudio, type FakeUrls, installFakeAudio, installFakeUrl } from "../fake-media";
import { createMockAudio, type MockAudio } from "./mock-audio";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Reads `player.settings.audio`, the way the fixture game configures it. */
const volumes: Volumes = (player: Json) =>
  (player as { settings: { audio: Partial<Record<Bus, number>> } }).settings.audio;

/** A started plugin over the fake context, with the volumes seam wired. */
function started(config: Partial<Config> = {}): {
  mock: MockAudio;
  context: FakeContext;
} {
  const context = createFakeContext();
  const mock = createMockAudio({ context, config });

  mock.start();
  mock.state.unlocked = true;

  return { mock, context };
}

describe("model:committed", () => {
  it("applies every bus the volumes function named and keeps the others", () => {
    const { mock, context } = started({ volumes });

    mock.model.player = { settings: { audio: { music: 0.2 } } };
    mock.hooks["model:committed"]({ roots: ["player"], cause: "edge" });

    expect(mock.api.volume("music")).toBe(0.2);
    expect(mock.api.volume("sfx")).toBe(1);
    expect(context.gains[1]?.gain.ramps.at(-1)).toEqual([0.2, 0]);
  });

  it("clamps what the player state carries, through the same rule as setVolume", () => {
    const { mock } = started({ volumes });

    mock.model.player = { settings: { audio: { master: 4, sfx: -2 } } };
    mock.hooks["model:committed"]({ roots: ["player"], cause: "load" });

    expect(mock.api.volume("master")).toBe(1);
    expect(mock.api.volume("sfx")).toBe(0);
  });

  it("warns once when the volumes function throws", () => {
    const { mock } = started({
      volumes: () => {
        throw new Error("no settings yet");
      }
    });

    mock.hooks["model:committed"]({ roots: ["player"], cause: "edge" });
    mock.hooks["model:committed"]({ roots: ["player"], cause: "edge" });

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("audio: the volumes function failed");
  });

  it("leaves the buses alone when no volumes function is configured", () => {
    const { mock, context } = started();
    const before = context.gains[1]?.gain.ramps.length;

    mock.model.player = { settings: { audio: { music: 0.2 } } };
    mock.hooks["model:committed"]({ roots: ["player"], cause: "edge" });

    expect(mock.api.volume("music")).toBe(0.6);
    expect(context.gains[1]?.gain.ramps).toHaveLength(before ?? 0);
  });

  it("keeps the stored volume headless, where there is no gain", () => {
    const mock = createMockAudio({ config: { volumes } });

    mock.start();
    mock.model.player = { settings: { audio: { music: 0.3 } } };
    mock.hooks["model:committed"]({ roots: ["player"], cause: "edge" });

    expect(mock.api.volume("music")).toBe(0.3);
  });
});

describe("lifecycle:changed", () => {
  it("holds every bus at zero on a push and keeps the stored volumes", () => {
    const { mock, context } = started();

    mock.hooks["lifecycle:changed"]({
      reason: "background",
      action: "push",
      reasons: ["background"],
      paused: true,
      resumed: false
    });

    expect(context.gains.map(gain => gain.gain.ramps.at(-1))).toEqual([
      [0, 0],
      [0, 0],
      [0, 0]
    ]);
    expect(mock.api.volume("music")).toBe(0.6);
    expect(mock.state.paused).toBe(true);
  });

  it("puts the volumes back on a pop and leaves a muted bus muted", () => {
    const { mock, context } = started();

    mock.api.mute("sfx", true);
    mock.hooks["lifecycle:changed"]({
      reason: "background",
      action: "push",
      reasons: ["background"],
      paused: true,
      resumed: false
    });
    mock.hooks["lifecycle:changed"]({
      reason: "background",
      action: "pop",
      reasons: [],
      paused: false,
      resumed: true
    });

    expect(context.gains[1]?.gain.ramps.at(-1)).toEqual([0.6, 0]);
    expect(context.gains[2]?.gain.ramps.at(-1)).toEqual([0, 0]);
    expect(mock.state.paused).toBe(false);
  });

  it("resumes a context iOS interrupted while the game was away", () => {
    const { mock, context } = started();

    context.state = "interrupted";
    mock.hooks["lifecycle:changed"]({
      reason: "background",
      action: "pop",
      reasons: [],
      paused: false,
      resumed: true
    });

    expect(context.resumes).toBe(1);
  });

  it("leaves a running context alone", () => {
    const { mock, context } = started();

    context.state = "running";
    mock.hooks["lifecycle:changed"]({
      reason: "background",
      action: "pop",
      reasons: [],
      paused: false,
      resumed: true
    });

    expect(context.resumes).toBe(0);
  });
});

describe("scenes:changed", () => {
  it("starts the track the next scene declared", async () => {
    const { mock, context } = started();

    mock.hooks["scenes:changed"]({ from: undefined, to: "board", music: "board.theme" });
    await Promise.resolve();
    await Promise.resolve();

    expect(context.sources).toHaveLength(1);
    expect(mock.state.music?.key).toBe("board.theme");
  });

  it("keeps the current track when the next scene declares none", async () => {
    const { mock, context } = started();

    mock.hooks["scenes:changed"]({ from: undefined, to: "board", music: "board.theme" });
    await Promise.resolve();
    await Promise.resolve();
    mock.hooks["scenes:changed"]({ from: "board", to: "info", music: undefined });
    await Promise.resolve();
    await Promise.resolve();

    expect(context.sources).toHaveLength(1);
    expect(mock.state.music?.key).toBe("board.theme");
  });

  it("does not restart the track when the next scene declares the same key", async () => {
    const { mock, context } = started();

    mock.hooks["scenes:changed"]({ from: undefined, to: "board", music: "board.theme" });
    await Promise.resolve();
    await Promise.resolve();
    mock.hooks["scenes:changed"]({ from: "board", to: "shop", music: "board.theme" });
    await Promise.resolve();
    await Promise.resolve();

    expect(context.sources).toHaveLength(1);
  });
});

describe("assets:bundle-unloaded", () => {
  it("evicts exactly the keys of the bundle that left", async () => {
    const { mock } = started();

    mock.assets.missing.add("ui.gone");
    await mock.fx("sfx", { kind: "sfx", payload: { key: "board.hit" }, cosmetic: true });
    await mock.fx("sfx", { kind: "sfx", payload: { key: "ui.gone" }, cosmetic: true });
    await mock.fx("sfx", { kind: "sfx", payload: { key: "ui.click" }, cosmetic: true });

    mock.hooks["assets:bundle-unloaded"]({
      bundle: "board",
      tier: "scene",
      mb: 1,
      reason: "budget",
      keys: ["board.hit", "ui.gone"]
    });

    expect([...mock.state.decoded.keys()]).toEqual(["ui.click"]);
    expect([...mock.state.warned]).toEqual([]);
  });
});

/** The pause payload `lifecycle` emits for a push of the background reason. */
const push: LifecycleChanged = {
  reason: "background",
  action: "push",
  reasons: ["background"],
  paused: true,
  resumed: false
};

/** The pause payload `lifecycle` emits for the pop that ends the pause. */
const pop: LifecycleChanged = {
  reason: "background",
  action: "pop",
  reasons: [],
  paused: false,
  resumed: true
};

/** A started plugin at `music: "stream"` with "board.theme" playing through one element. */
async function streaming(): Promise<{
  mock: MockAudio;
  context: FakeContext;
  audio: FakeAudio;
  urls: FakeUrls;
}> {
  const audio = installFakeAudio();
  const urls = installFakeUrl();
  const { mock, context } = started({ music: "stream" });

  context.state = "running";
  await playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

  return { mock, context, audio, urls };
}

describe('lifecycle:changed at music: "stream"', () => {
  it("pauses the playing element once every bus is at zero", async () => {
    const { mock, context, audio } = await streaming();
    const element = audio.elements[0];
    const masterAtPause: Array<[number, number] | undefined> = [];

    if (element !== undefined) {
      const pause = element.pause;

      element.pause = (): void => {
        masterAtPause.push(context.gains[0]?.gain.ramps.at(-1));
        pause();
      };
    }

    mock.hooks["lifecycle:changed"](push);

    expect(element?.pauses).toBe(1);
    expect(masterAtPause).toEqual([[0, 0]]);
  });

  it("plays the element again on the pop that ends the pause", async () => {
    const { mock, audio } = await streaming();

    mock.hooks["lifecycle:changed"](push);
    mock.hooks["lifecycle:changed"](pop);
    await Promise.resolve();

    expect(audio.elements[0]?.plays).toBe(2);
  });

  it("warns once and keeps the track when play() is refused on a pop", async () => {
    const { mock, audio } = await streaming();
    const element = audio.elements[0];
    const stream = mock.state.music?.stream;

    if (element !== undefined) element.playFails = true;

    for (let round = 0; round < 2; round += 1) {
      mock.hooks["lifecycle:changed"](push);
      mock.hooks["lifecycle:changed"](pop);
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("audio: the music element did not play", {
      key: "board.theme"
    });
    expect(mock.state.music?.stream).toBe(stream);
  });

  it("pauses an element whose play() resolves during a push, and the pop plays it", async () => {
    const audio = installFakeAudio();
    installFakeUrl();
    const { mock, context } = started({ music: "stream" });

    context.state = "running";
    const pending = playMusic(mock.audio, { key: "board.theme", fadeMs: 600 });

    mock.hooks["lifecycle:changed"](push);
    await pending;

    const element = audio.elements[0];

    expect(mock.state.music?.stream?.element).toBe(element);
    expect(element?.plays).toBe(1);
    expect(element?.pauses).toBe(1);

    mock.hooks["lifecycle:changed"](pop);
    await Promise.resolve();

    expect(element?.plays).toBe(2);
  });
});

describe('assets:bundle-unloaded at music: "stream"', () => {
  it("leaves the playing element alone and revokes nothing", async () => {
    const { mock, audio, urls } = await streaming();

    mock.hooks["assets:bundle-unloaded"]({
      bundle: "board",
      tier: "scene",
      mb: 1,
      reason: "budget",
      keys: ["board.theme"]
    });

    expect(audio.elements[0]?.pauses).toBe(0);
    expect(urls.revoked).toEqual([]);
    expect(mock.state.music?.stream?.element).toBe(audio.elements[0]);
  });
});
