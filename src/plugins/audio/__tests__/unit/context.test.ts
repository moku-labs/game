import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Descriptor } from "../../../flow/types";
import type { AudioContextLike, AudioSessionType, LifecycleChanged } from "../../types";
import {
  createFakeContext,
  type FakeContext,
  type FakeWindow,
  installFakeWindow,
  keyOf
} from "../fake-audio-context";
import { installFakeNavigator } from "../fake-media";
import { createMockAudio, type MockAudio } from "./mock-audio";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Yields the microtask queue, the way a test waits for `close()` and `resume()` without a timer. */
async function tick(times = 10): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/** The push of a trip to the background. */
const AWAY: LifecycleChanged = {
  reason: "background",
  action: "push",
  reasons: ["background"],
  paused: true,
  resumed: false
};

/** The pop of the return, which empties the stack. */
const BACK: LifecycleChanged = {
  reason: "background",
  action: "pop",
  reasons: [],
  paused: false,
  resumed: true
};

/** An `sfx` descriptor, with an id when one is given. */
function sfx(key: string, id?: string): Descriptor {
  return { kind: "sfx", payload: id === undefined ? { key } : { key, id }, cosmetic: true };
}

/** A started plugin on a stand-in iPhone, with the record of what the renewal did, in order. */
type Phone = {
  mock: MockAudio;
  fakeWindow: FakeWindow;
  /** Every context the factory made, oldest first. */
  made: FakeContext[];
  /** Session writes, `create:N` and `close:N`, in the order they happened. */
  order: string[];
};

/**
 * Starts the plugin on a stand-in iPhone: WebKit's `audioSession`, five touch points, a window,
 * and a factory that makes a new context on each call, born suspended in a shell that asks for no
 * gesture, as the game's native shell is.
 */
function phone(
  options: { session?: AudioSessionType; touchPoints?: number; audioSession?: boolean } = {}
): Phone {
  const order: string[] = [];
  const made: FakeContext[] = [];

  if (options.audioSession === false) vi.stubGlobal("navigator", { maxTouchPoints: 5 });
  else installFakeNavigator({ type: "auto", order, touchPoints: options.touchPoints ?? 5 });

  const fakeWindow = installFakeWindow();
  const factory = (): AudioContextLike => {
    const context = createFakeContext({ autoplay: true });
    const index = made.length;
    const close = context.close;

    context.close = (): Promise<void> => {
      order.push(`close:${index}`);

      return close();
    };
    made.push(context);
    order.push(`create:${index}`);

    return context;
  };
  const mock = createMockAudio({
    config: { context: factory, session: options.session ?? "ambient" }
  });

  mock.start();

  return { mock, fakeWindow, made, order };
}

/** Sends the game to the background and back. */
function awayAndBack(mock: MockAudio): void {
  mock.hooks["lifecycle:changed"](AWAY);
  mock.hooks["lifecycle:changed"](BACK);
}

describe("the renewal after a return from the background (F149)", () => {
  it("lifts the session, closes the old context, writes ambient again and makes a new one, a second after the return", async () => {
    const { mock, made, order } = phone();

    await tick();
    order.length = 0;
    awayAndBack(mock);
    vi.advanceTimersByTime(999);
    await tick();

    // Still too early: iOS refuses an activation before the app is active.
    expect(order).toEqual([]);

    vi.advanceTimersByTime(1);
    await tick();

    expect(order).toEqual(["session:auto", "close:0", "session:ambient", "create:1"]);
    expect(made[1]?.state).toBe("running");
    expect(mock.api.unlocked()).toBe(true);
  });

  it("keeps the volumes, reuses the decoded track and starts the scene's music again", async () => {
    const { mock, made } = phone();

    await tick();
    mock.api.setVolume("music", 0.3);
    mock.hooks["scenes:changed"]({ from: undefined, to: "board", music: "board.theme" });
    await tick();
    awayAndBack(mock);
    vi.advanceTimersByTime(1000);
    await tick();

    const [old, fresh] = made;

    expect(old?.sources[0]?.stoppedAt).toBeDefined();
    // The music bus of the new graph, at the volume the game set.
    expect(fresh?.gains[1]?.gain.ramps.at(-1)).toEqual([0.3, 0]);
    // The buffer is bound to no context: nothing is decoded again.
    expect(fresh?.decodes).toEqual([]);
    expect(keyOf(fresh?.sources[0]?.buffer)).toBe("board.theme");
    expect(fresh?.sources[0]?.loop).toBe(true);
  });

  it("drops the sounds in flight", async () => {
    const { mock, made } = phone();

    await tick();
    await mock.fx("sfx", sfx("story.line1", "voice"));
    awayAndBack(mock);
    vi.advanceTimersByTime(1000);
    await tick();

    expect(made[0]?.sources[0]?.stoppedAt).toBeDefined();
    expect(mock.state.named.size).toBe(0);
    expect(made[1]?.sources).toEqual([]);
  });

  it("decodes again a sound whose decode the closing context rejected", async () => {
    const { mock, made } = phone();

    await tick();

    let reject: (error: Error) => void = () => undefined;
    const old = made[0] as FakeContext;

    old.decodeAudioData = (): Promise<AudioBuffer> =>
      new Promise<AudioBuffer>((_resolve, fail) => {
        reject = fail;
      });
    const lost = mock.fx("sfx", sfx("ui.click"));

    awayAndBack(mock);
    vi.advanceTimersByTime(1000);
    await tick();
    reject(new Error("closed"));
    await lost;
    await tick();
    await mock.fx("sfx", sfx("ui.click"));

    expect(made[1]?.decodes).toEqual(["ui.click"]);
    expect(keyOf(made[1]?.sources[0]?.buffer)).toBe("ui.click");
  });

  it("renews at once on a touch that comes before the second, and only once", async () => {
    const { mock, fakeWindow, made, order } = phone();

    await tick();
    awayAndBack(mock);
    fakeWindow.dispatch("touchend");
    await tick();

    expect(order).toContain("close:0");

    vi.advanceTimersByTime(2000);
    await tick();

    expect(made).toHaveLength(2);
    expect(fakeWindow.listeners).toHaveLength(0);
  });

  it("renews nothing when the game goes away again before the second", async () => {
    const { mock, made } = phone();

    await tick();
    awayAndBack(mock);
    vi.advanceTimersByTime(500);
    mock.hooks["lifecycle:changed"](AWAY);
    vi.advanceTimersByTime(2000);
    await tick();

    expect(made).toHaveLength(1);
  });

  it.each([
    ["on a Mac, whose screen takes no touch", { touchPoints: 0 }],
    ["with the playback session, which iOS keeps active", { session: "playback" as const }],
    ["without WebKit's audioSession", { audioSession: false }]
  ])("renews nothing %s", async (_name, options) => {
    const { mock, made } = phone(options);

    await tick();
    awayAndBack(mock);
    vi.advanceTimersByTime(1000);
    await tick();

    expect(made).toHaveLength(1);
    expect(made[0]?.closes).toBe(0);
  });

  it("makes no context when the app stops while the old one closes", async () => {
    const { mock, made } = phone();

    await tick();

    let closed: () => void = () => undefined;
    const old = made[0] as FakeContext;

    old.close = (): Promise<void> =>
      new Promise<void>(resolve => {
        closed = resolve;
      });
    awayAndBack(mock);
    vi.advanceTimersByTime(1000);
    await tick();
    await mock.stop();
    closed();
    await tick();

    expect(made).toHaveLength(1);
    expect(mock.state.context).toBeUndefined();
  });

  it("warns and stays silent when the factory hands back the closed context", async () => {
    installFakeNavigator({ type: "auto", touchPoints: 5 });
    installFakeWindow();

    const context = createFakeContext({ autoplay: true });
    const mock = createMockAudio({ context });

    mock.start();
    await tick();
    awayAndBack(mock);
    vi.advanceTimersByTime(1000);
    await tick();

    expect(mock.log.warn).toHaveBeenCalledWith(
      "audio: no new context after the return, the sound stays off"
    );
    expect(mock.state.context).toBeUndefined();
  });
});
