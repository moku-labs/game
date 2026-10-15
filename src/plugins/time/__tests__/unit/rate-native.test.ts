/* eslint-disable unicorn/no-null -- the shell's answers are JSON: a field it does not know is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScript, type Script } from "./rate-script";

// ---------------------------------------------------------------------------
// Unit: the adaptive frame rate on the native shell (spec 21 G5, native's names
// of the addendum): the panel follows every switch, `maxHz` teaches the
// display, a stale answer is ignored, a failure is warned once; the thermal
// status drops the rate and blocks returns through spec 11's one listener.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A window as an event target, as the page has one. */
function stubWindow(): { add: ReturnType<typeof vi.fn>; dispatch(detail: unknown): void } {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const add = vi.fn((type: string, listener: (event: Event) => void) => {
    const set = listeners.get(type) ?? new Set();

    set.add(listener);
    listeners.set(type, set);
  });

  vi.stubGlobal("addEventListener", add);
  vi.stubGlobal("removeEventListener", (type: string, listener: (event: Event) => void) => {
    listeners.get(type)?.delete(listener);
  });

  return {
    add,
    dispatch: detail => {
      for (const listener of listeners.get("moku-native:thermal") ?? []) {
        listener(Object.assign(new Event("moku-native:thermal"), { detail }));
      }
    }
  };
}

/**
 * Installs a native shell of contract v1.
 *
 * @param answer - What `setFrameRate` answers for a rate.
 * @param fields - More fields of the global.
 * @returns The `setFrameRate` spy and the global, for a test that fills `maxHz` later.
 */
function stubShell(
  answer: (fps: number | null) => unknown = () => ({ panelHz: 120, maxHz: null }),
  fields: Record<string, unknown> = {}
): { setFrameRate: ReturnType<typeof vi.fn>; display: { maxHz: number | null } } {
  const setFrameRate = vi.fn(answer);
  const display = { setFrameRate, maxHz: null };

  vi.stubGlobal("__MOKU_NATIVE__", { version: 1, display, ...fields });

  return { setFrameRate, display };
}

/** Lets the answers of the shell arrive. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
}

/**
 * A GPU-bound screen: 17 ms intervals at 120, light frames at 60. Runs until `count` changes happened.
 *
 * @param s - The script.
 * @param count - How many `time:rate` changes.
 */
function probeUntil(s: Script, count: number): void {
  for (let index = 0; index < 20_000 && s.changes().length < count; index += 1) {
    s.gap(s.api.rate().fps === 120 ? 17 : 20);
  }
}

describe("the panel follows the rate", () => {
  it("every switch asks the shell for the new rate, and stop hands it back", () => {
    const { setFrameRate } = stubShell();
    const s = createScript();

    s.start();
    s.play(2000);
    probeUntil(s, 2);
    s.stop();

    expect(s.changes().map(change => change.reason)).toEqual(["missed", "headroom"]);
    expect(setFrameRate.mock.calls).toEqual([[120], [60], [120], [null]]);
  });

  it("the shell's maxHz becomes the display rate; panelHz does not", async () => {
    stubShell(() => ({ panelHz: 60, maxHz: 120 }));
    const s = createScript();

    s.start();
    await flush();

    expect(s.api.rate()).toMatchObject({ fps: 120, displayHz: 120, ladder: [120, 60] });
    s.stop();
  });

  it("display.maxHz at start, or once the shell is ready, is the display rate", async () => {
    const atStart = stubShell(() => ({ panelHz: 60, maxHz: null }));

    atStart.display.maxHz = 60;
    const known = createScript();

    known.start();

    expect(known.api.rate()).toMatchObject({ fps: 60, reason: "display", ladder: [60] });
    known.stop();

    const ready = Promise.withResolvers<void>();
    const later = stubShell(() => ({ panelHz: 60, maxHz: null }), { ready: ready.promise });
    const waiting = createScript();

    waiting.start();
    await flush();
    expect(waiting.api.rate().displayHz).toBeNull();

    later.display.maxHz = 90;
    ready.resolve();
    await flush();

    expect(waiting.api.rate()).toMatchObject({ fps: 90, displayHz: 90, ladder: [90] });
    waiting.stop();
  });

  it("a null maxHz leaves the display to the measured ticks", async () => {
    stubShell(() => ({ panelHz: 120, maxHz: null }));
    const s = createScript();

    s.start();
    await flush();
    expect(s.api.rate().displayHz).toBeNull();

    s.play(1200);
    expect(s.api.rate().displayHz).toBe(120);
    s.stop();
  });

  it("a stale answer after a newer request is ignored", async () => {
    const answers: Array<{ resolve(value: unknown): void }> = [];

    stubShell(() => {
      const answer = Promise.withResolvers<unknown>();

      answers.push(answer);

      return answer.promise;
    });
    const s = createScript();

    s.start();
    s.api.setRate(60);
    answers[1]?.resolve({ panelHz: 60, maxHz: 120 });
    await flush();
    answers[0]?.resolve({ panelHz: 90, maxHz: 90 });
    await flush();

    expect(s.api.rate().displayHz).toBe(120);
    s.stop();
  });

  it("a rejecting setFrameRate warns once and the rate still changes", async () => {
    stubShell(() => Promise.reject(new Error("refused")));
    const s = createScript();

    s.start();
    s.play(2000);
    s.untilRate(60, 17);
    await flush();
    s.stop();
    await flush();

    expect(s.api.rate().fps).toBe(60);
    expect(s.log.warn).toHaveBeenCalledTimes(1);
    expect(s.log.warn).toHaveBeenCalledWith("time: the native frame rate failed", {
      error: new Error("refused")
    });
  });
});

describe("the thermal input", () => {
  it("moderate drops one step at once and blocks every return; light lets the return rule run again", () => {
    stubShell();
    const window = stubWindow();
    const s = createScript({ config: { adaptive: { floor: 30 } } });

    s.start();
    s.play(2000);
    window.dispatch({ status: "moderate" });

    expect(s.api.rate()).toMatchObject({ fps: 60, reason: "thermal", thermal: "moderate" });

    s.gaps(20, 400);
    expect(s.api.rate().fps).toBe(60);

    // Android's number for "light", with the status left out at the top.
    window.dispatch({ android: { status: 1 } });
    s.gaps(20, 3);

    expect(s.api.rate()).toMatchObject({ fps: 120, reason: "headroom", thermal: "light" });
    s.stop();
  });

  it("severe drops straight to the floor", () => {
    stubShell();
    const window = stubWindow();
    const s = createScript({ config: { adaptive: { floor: 30 } } });

    s.start();
    s.play(2000);
    window.dispatch({ status: 3 });

    expect(s.api.rate()).toMatchObject({ fps: 30, reason: "thermal", thermal: "severe" });
    expect(s.changes()).toHaveLength(1);
    s.stop();
  });

  it("a thermal reading before the display is known applies when it becomes known", async () => {
    const read = vi.fn(() => Promise.resolve({ status: "moderate", headroom: 0.8, at: 1 }));

    stubShell(undefined, { thermal: { read } });
    stubWindow();
    const s = createScript();

    s.start();
    await flush();

    expect(s.api.rate()).toMatchObject({ fps: 120, displayHz: null, thermal: "moderate" });

    s.play(1200);

    expect(read).toHaveBeenCalledTimes(1);
    expect(s.api.rate()).toMatchObject({ fps: 60, reason: "thermal", displayHz: 120 });
    s.stop();
  });

  it("a forced rate stays under moderate heat, and auto then goes a step below the top", () => {
    stubShell();
    const window = stubWindow();
    const s = createScript();

    s.start();
    s.play(2000);
    s.api.setRate(120);
    window.dispatch({ status: "moderate" });

    expect(s.api.rate()).toMatchObject({ fps: 120, mode: "forced", thermal: "moderate" });
    expect(s.api.setRate("auto")).toMatchObject({ fps: 60, mode: "auto", reason: "auto" });
    s.stop();
  });

  it("without adaptive and without the agent flag no thermal listener is added and no thermal read is made", () => {
    const read = vi.fn(() => ({ status: 2 }));

    stubShell(undefined, { thermal: { read } });
    const window = stubWindow();
    const s = createScript({ config: { adaptive: false } });

    s.start();
    s.stop();

    expect(window.add).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("adaptive adds the one listener without the agent flag, and an agent build still has one for both", () => {
    stubShell();
    const store = stubWindow();
    const s = createScript();

    s.start();
    expect(store.add).toHaveBeenCalledTimes(1);
    s.stop();

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const debug = stubWindow();
    const agent = createScript();

    agent.start();
    agent.play(2000);
    debug.dispatch({ status: 2, headroom: 0.7 });

    expect(debug.add).toHaveBeenCalledTimes(1);
    expect(agent.emit).toHaveBeenCalledWith("time:thermal", {
      status: 2,
      headroom: 0.7,
      at: null,
      android: null
    });
    expect(agent.api.rate()).toMatchObject({ fps: 60, reason: "thermal" });
    agent.stop();
  });

  it("stop removes the thermal listener: an event after stop changes nothing", () => {
    stubShell();
    const window = stubWindow();
    const s = createScript();

    s.start();
    s.play(2000);
    s.stop();
    window.dispatch({ status: "severe" });

    expect(s.api.rate().fps).toBe(120);
    expect(s.changes()).toEqual([]);
  });
});
