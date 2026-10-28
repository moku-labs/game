/**
 * @file `fadeBoot`, the fade of the boot picture, over fakes of `app.time`, `app.scenes` and the
 * `<img id="moku-boot">` element, on fake timers: nothing changes before the first scene, the first
 * render frame with a scene fades the picture once and unsubscribes, and whichever of
 * `transitionend` and the timer fallback comes first removes it, once, leaving no timer behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fadeBoot } from "../../../src/app/boot";

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
