import { describe, expect, it } from "vitest";
import { guardZoom } from "../../../src/app/zoom";

/** A listener the fake window keeps, with the options it was added with. */
type Added = { listener: (event: FakeEvent) => void; options: object };

/** A fake event: the fingers still down, the path, and whether it was cancelled. */
type FakeEvent = {
  touches: { length: number };
  composedPath(): readonly unknown[];
  preventDefault(): void;
  cancelled: boolean;
};

const fakeWindow = () => {
  const added = new Map<string, Added>();

  return {
    added,
    addEventListener: (type: string, listener: (event: FakeEvent) => void, options: object) => {
      added.set(type, { listener, options });
    },
    dispatch: (type: string, event: FakeEvent) => {
      added.get(type)?.listener(event);
    }
  };
};

const touch = (fingers: number, path: readonly unknown[] = [{ tagName: "BUTTON" }]): FakeEvent => {
  const event: FakeEvent = {
    touches: { length: fingers },
    composedPath: () => path,
    preventDefault: () => {
      event.cancelled = true;
    },
    cancelled: false
  };

  return event;
};

const setup = () => {
  const target = fakeWindow();
  let now = 1000;
  // The guard reads only `touches`, `composedPath` and `preventDefault` of an event.
  guardZoom(target as unknown as Window, () => now);

  return {
    target,
    advance: (ms: number) => {
      now += ms;
    }
  };
};

describe("guardZoom", () => {
  // Bug caught: the editor's overlay stops its events from bubbling, so a bubbling listener never
  // sees a pinch on it and the page zooms (F150).
  it("listens in the capture phase and may cancel", () => {
    const { target } = setup();

    for (const type of ["gesturestart", "gesturechange", "touchmove", "touchend"]) {
      expect(target.added.get(type)?.options).toEqual({ capture: true, passive: false });
    }
  });

  // Bug caught: WebKit's pinch zooms the page over a DOM node above the game.
  it("cancels the WebKit pinch gesture", () => {
    const { target } = setup();
    const start = touch(2);
    const change = touch(2);

    target.dispatch("gesturestart", start);
    target.dispatch("gesturechange", change);

    expect([start.cancelled, change.cancelled]).toEqual([true, true]);
  });

  // Bug caught: a pinch inside an overlay's scroll box, which starts its own touch area, zooms;
  // and a one-finger scroll in the same box must still scroll.
  it("cancels a two-finger move and lets a one-finger move scroll", () => {
    const { target } = setup();
    const pinch = touch(2);
    const scroll = touch(1);

    target.dispatch("touchmove", pinch);
    target.dispatch("touchmove", scroll);

    expect([pinch.cancelled, scroll.cancelled]).toEqual([true, false]);
  });

  // Bug caught: a double tap on an overlay button zooms the page; the first tap must still click.
  it("cancels the second tap of a double tap on a node over the game", () => {
    const { target, advance } = setup();
    const first = touch(0);
    const second = touch(0);

    target.dispatch("touchend", first);
    advance(349);
    target.dispatch("touchend", second);

    expect([first.cancelled, second.cancelled]).toEqual([false, true]);
  });

  // Bug caught: two taps 350 ms apart are two taps, not a double tap, and the second would be lost.
  it("lets a tap through 350 ms after the last one", () => {
    const { target, advance } = setup();
    const second = touch(0);

    target.dispatch("touchend", touch(0));
    advance(350);
    target.dispatch("touchend", second);

    expect(second.cancelled).toBe(false);
  });

  // Bug caught: fast tapping on an overlay button cancels every tap after the first.
  it("lets the third tap of a fast run through", () => {
    const { target, advance } = setup();
    const third = touch(0);

    target.dispatch("touchend", touch(0));
    advance(100);
    target.dispatch("touchend", touch(0));
    advance(100);
    target.dispatch("touchend", third);

    expect(third.cancelled).toBe(false);
  });

  // Bug caught: the guard eats the game's own fast taps, or a double tap that selects a word in a
  // text field (F144).
  it.each([
    ["the game", [{ tagName: "CANVAS" }, { id: "game" }]],
    ["an input", [{ tagName: "INPUT" }]],
    ["a textarea", [{ tagName: "TEXTAREA" }]],
    ["an editable element", [{ tagName: "DIV", isContentEditable: true }]]
  ])("keeps the double tap on %s", (_name, path) => {
    const { target, advance } = setup();
    const second = touch(0, path);

    target.dispatch("touchend", touch(0, path));
    advance(100);
    target.dispatch("touchend", second);

    expect(second.cancelled).toBe(false);
  });

  // Bug caught: the lift of one finger of a pinch reads as a tap, so the next real tap is cancelled.
  it("does not count a lift with a finger still down as a tap", () => {
    const { target, advance } = setup();
    const tap = touch(0);

    target.dispatch("touchend", touch(1));
    advance(100);
    target.dispatch("touchend", tap);

    expect(tap.cancelled).toBe(false);
  });
});
