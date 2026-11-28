/**
 * @file `fadeBoot`, the fade of the boot picture, over fakes of `app.time`, `app.scenes` and the
 * `<img id="moku-boot">` element, on fake timers: nothing changes before the first scene, the first
 * render frame with a scene fades the picture once and unsubscribes, and whichever of
 * `transitionend` and the timer fallback comes first removes it, once, leaving no timer behind.
 * `bootPlacement`, where a placed boot picture stands in a window, and `signalLaunch`, the one call
 * that tells a native shell the first scene drew.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootPlacement, fadeBoot, signalLaunch } from "../../../src/app/boot";
import type { ResolvedPageBoot } from "../../../src/app/types";
import type { Rect } from "../../../src/plugins/renderer/viewport/types";

/** One `addEventListener` call of the fake element. */
type Listened = { type: string; listener: () => void; options: { once: true } };

/**
 * A fake `app.time`: it keeps the frame callbacks by phase and runs them on `frame()`. The list is
 * copy-on-write, as the real one: a callback that unsubscribes while a frame runs is safe.
 *
 * @returns The time, a frame runner, and what is subscribed now.
 */
function fakeTime() {
  const state: { subscribed: { phase: string; callback: () => void }[] } = { subscribed: [] };
  const time = {
    onFrame: (phase: "render", callback: () => void) => {
      const entry = { phase, callback };

      state.subscribed = [...state.subscribed, entry];

      return () => {
        state.subscribed = state.subscribed.filter(other => other !== entry);
      };
    }
  };

  return {
    time,
    subscribed: () => state.subscribed,
    frame: () => {
      for (const entry of state.subscribed) entry.callback();
    }
  };
}

/**
 * A fake boot element: it records its listeners and its removals.
 *
 * @returns The element, its listeners, the removal count and a `transitionend` dispatcher.
 */
function fakeElement() {
  const listened: Listened[] = [];
  const removed = { count: 0 };
  const element = {
    style: { opacity: "" },
    addEventListener: (type: "transitionend", listener: () => void, options: { once: true }) => {
      listened.push({ type, listener, options });
    },
    remove: () => {
      removed.count += 1;
    }
  };

  return {
    element,
    listened,
    removed,
    // A `{ once: true }` listener is dropped as it runs, as the browser does.
    transitionEnd: () => {
      for (const entry of listened.splice(0)) entry.listener();
    }
  };
}

/** What `app.scenes.current()` answers: `undefined` until the test sets a scene. */
const mounted: { scene: string | undefined } = { scene: undefined };

/** The fake `app.scenes`. */
const scenes = { current: () => mounted.scene };

beforeEach(() => {
  vi.useFakeTimers();
  mounted.scene = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fadeBoot", () => {
  // Bug: the picture fades on the first frame, before any scene drew, so the page flashes blank.
  it("changes nothing while no scene is mounted", () => {
    const { time, subscribed, frame } = fakeTime();
    const { element, listened, removed } = fakeElement();

    fadeBoot(time, scenes, element, 300);
    frame();
    frame();

    expect(subscribed().map(entry => entry.phase)).toEqual(["render"]);
    expect(element.style.opacity).toBe("");
    expect(listened).toEqual([]);
    expect(removed.count).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  // Bug: the callback stays subscribed and every later frame pays for it, or fades again.
  it("the first render frame with a scene sets opacity 0 once and unsubscribes", () => {
    const { time, subscribed, frame } = fakeTime();
    const { element, listened } = fakeElement();

    fadeBoot(time, scenes, element, 300);
    frame();
    mounted.scene = "splash";
    frame();

    expect(element.style.opacity).toBe("0");
    expect(subscribed()).toEqual([]);
    expect(listened.map(entry => [entry.type, entry.options])).toEqual([
      ["transitionend", { once: true }]
    ]);

    vi.runAllTimers();
  });

  // Bug: the end of the fade leaves the picture on the page, or its fallback timer still pending.
  it("transitionend removes the picture and clears the timer", () => {
    const { time, frame } = fakeTime();
    const { element, removed, transitionEnd } = fakeElement();

    fadeBoot(time, scenes, element, 300);
    mounted.scene = "splash";
    frame();
    transitionEnd();

    expect(removed.count).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  // Bug: a page in the background ends no transition, and the picture stays over the game forever.
  it("the timer removes the picture fadeMs + 100 ms later when no transition ends, and a late end removes nothing", () => {
    const { time, frame } = fakeTime();
    const { element, removed, transitionEnd } = fakeElement();

    fadeBoot(time, scenes, element, 300);
    mounted.scene = "splash";
    frame();
    vi.advanceTimersByTime(399);

    expect(removed.count).toBe(0);

    vi.advanceTimersByTime(1);

    expect(removed.count).toBe(1);

    transitionEnd();

    expect(removed.count).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  // Bug: fadeMs 0 waits for a transition that never runs, so the picture stays for 100 ms or more.
  it("fadeMs 0 removes the picture in that frame, with no listener and no timer", () => {
    const { time, subscribed, frame } = fakeTime();
    const { element, listened, removed } = fakeElement();

    fadeBoot(time, scenes, element, 0);
    mounted.scene = "splash";
    frame();

    expect(removed.count).toBe(1);
    expect(listened).toEqual([]);
    expect(subscribed()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** The placement of the worked portrait config: the studio still of A Memory Missing. */
const portrait: NonNullable<ResolvedPageBoot["place"]> = {
  frame: { width: 1024, height: 1536 },
  rect: { x: 215, y: 402, width: 600, height: 640 },
  aspect: { min: 0.4, max: 2.6 },
  orientation: "portrait"
};

/** The same placement turned for a landscape game, on the renderer's default aspect. */
const landscape: NonNullable<ResolvedPageBoot["place"]> = {
  frame: { width: 1536, height: 1024 },
  rect: { x: 402, y: 215, width: 640, height: 600 },
  aspect: { min: 4 / 3, max: 21 / 9 },
  orientation: "landscape"
};

/**
 * Rounds a number to 3 decimals, as the spec writes them.
 *
 * @param value - The number.
 * @returns The rounded number.
 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Rounds every side of a placement to 3 decimals.
 *
 * @param rect - The placement.
 * @returns The rounded placement.
 */
function rounded(rect: Rect): Rect {
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height)
  };
}

describe("bootPlacement", () => {
  // Bug: the still stands off the place the game draws it: the cover takes the smaller scale, or
  // the frame is not the one fitFrame gives.
  it("a portrait window inside the aspect range: the frame is the window, the rect covers it", () => {
    expect(rounded(bootPlacement({ width: 384, height: 832 }, portrait))).toEqual({
      x: 31.125,
      y: 217.75,
      width: 325,
      height: 346.667
    });
  });

  // Bug: a window taller than the range places the still on the window, not on the clamped frame.
  it("a portrait window taller than the range: the frame is clamped to 360 × 840 at y 80", () => {
    const place = { ...portrait, aspect: { min: 4 / 3, max: 21 / 9 } };

    expect(bootPlacement({ width: 360, height: 1000 }, place)).toEqual({
      x: 17.578_125,
      y: 299.843_75,
      width: 328.125,
      height: 350
    });
  });

  // Bug: a landscape game measures the range on the wrong sides of the window.
  it("a landscape window: inside the range, and wider than it (frame 840 × 360 at x 80)", () => {
    expect(rounded(bootPlacement({ width: 832, height: 384 }, landscape))).toEqual({
      x: 217.75,
      y: 31.125,
      width: 346.667,
      height: 325
    });
    expect(bootPlacement({ width: 1000, height: 360 }, landscape)).toEqual({
      x: 299.843_75,
      y: 17.578_125,
      width: 350,
      height: 328.125
    });
  });
});

describe("signalLaunch", () => {
  // Bug: the shell drops its still before the first scene drew, and the player sees an empty page.
  it("calls ready once, in the first frame with a scene, and never again", () => {
    const { time, subscribed, frame } = fakeTime();
    const ready = vi.fn();
    const report = vi.fn();

    signalLaunch(time, scenes, ready, report);
    frame();
    frame();

    expect(ready).not.toHaveBeenCalled();

    mounted.scene = "splash";
    frame();

    expect(ready).toHaveBeenCalledTimes(1);
    expect(subscribed()).toEqual([]);

    frame();

    expect(ready).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  // Bug: a shell bridge that throws breaks the frame loop of the running game.
  it("a throwing ready goes to report once and does not throw out of the frame", () => {
    const { time, frame } = fakeTime();
    const failure = new Error("no bridge");
    const report = vi.fn();

    signalLaunch(
      time,
      scenes,
      () => {
        throw failure;
      },
      report
    );
    mounted.scene = "splash";

    expect(frame).not.toThrow();

    frame();

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(failure);
  });
});
