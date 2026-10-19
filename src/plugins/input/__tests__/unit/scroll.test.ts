import { describe, expect, it } from "vitest";
import { Parent, Transform } from "../../../renderer/components";
import { Exiting } from "../../../world/ecs/define";
import { createInputApi } from "../../api";
import {
  Draggable,
  Held,
  Pressed,
  Scrollable,
  type ScrollableValue,
  Swipeable,
  Tappable,
  Touchable
} from "../../components";
import { record } from "../../pointer";
import type { RawSample } from "../../types";
import { createMockInput, type MockInput } from "./mock-input";

const down = (clientX: number, clientY: number): RawSample => ({
  kind: "down",
  pointerType: "touch",
  pointerId: 1,
  clientX,
  clientY
});

const moved = (clientX: number, clientY: number): RawSample => ({
  kind: "move",
  pointerType: "touch",
  pointerId: 1,
  clientX,
  clientY
});

const up = (clientX: number, clientY: number): RawSample => ({
  kind: "up",
  pointerType: "touch",
  pointerId: 1,
  clientX,
  clientY
});

/** A scroll container as ui spawns it: `Touchable` gives it a hit box, `Scrollable` its axis. */
function scrollOf(
  mock: MockInput,
  value: Partial<ScrollableValue>,
  box: { x: number; y: number; width: number; height: number },
  extra: Parameters<MockInput["spawn"]>[0] = []
): number {
  const entity = mock.spawn([Touchable(), Scrollable(value), ...extra]);

  mock.boxes.push({ entity, ...box });

  return entity;
}

/**
 * A strip of shop items: an x scroll at (0..400, 0..100) and one button in it at (20..120,
 * 20..80), drawn over the scroll and hung under it by `Parent`, the way ui hangs a child under its
 * scroll. The plugin is started.
 */
function buttonInScroll(
  mock: MockInput,
  scroll: Partial<ScrollableValue> = {},
  extra: Parameters<MockInput["spawn"]>[0] = []
): { scroll: number; button: number } {
  const strip = scrollOf(
    mock,
    { axis: "x", ...scroll },
    { x: 0, y: 0, width: 400, height: 100 },
    extra
  );
  const button = mock.spawn(
    [Tappable({ intent: "buy", payload: { id: "s1" } }), Parent({ entity: strip })],
    { projection: "shop.items", key: "s1" }
  );

  mock.boxes.push({ entity: button, x: 20, y: 20, width: 100, height: 60 });
  mock.start();

  return { scroll: strip, button };
}

/**
 * A popup button drawn over a scroll from another root: its box lies over the scroll's, pushed
 * last so it is the topmost, and no `Parent` hangs it under the scroll. The plugin is started.
 */
function popupOverScroll(
  mock: MockInput,
  scroll: Partial<ScrollableValue>
): { scroll: number; button: number } {
  const list = scrollOf(mock, scroll, { x: 0, y: 0, width: 400, height: 400 });
  const button = mock.spawn([Tappable({ intent: "close", payload: {} })], {
    projection: "popup.rename",
    key: "close"
  });

  mock.boxes.push({ entity: button, x: 20, y: 20, width: 100, height: 60 });
  mock.start();

  return { scroll: list, button };
}

describe("the hand-off of a press to the scroll it pans", () => {
  it("moves Pressed from the button to the x scroll once the finger leaves the slop along x, and the button answers nothing", () => {
    // Bug caught: the button keeps the press, so the strip never follows the finger and a finger
    // that comes back to its start buys the item.
    const mock = createMockInput();
    const { scroll, button } = buttonInScroll(mock);

    record(mock.state, down(60, 50));
    mock.frame();

    expect(mock.has(button, Pressed)).toBe(true);

    record(mock.state, moved(80, 50));
    mock.frame();

    expect(mock.has(scroll, Pressed)).toBe(true);
    expect(mock.has(button, Pressed)).toBe(false);
    expect(mock.state.entity).toBe(scroll);
    expect(mock.state.key).toBeUndefined();

    // Back inside the slop of the start: a button that still held the press would answer its tap.
    record(mock.state, up(62, 50));
    mock.frame();

    expect(mock.answers).toEqual([]);
    expect(mock.has(scroll, Pressed)).toBe(false);
  });

  it("runs no onTap listener when a handed-off press comes back inside the slop and lets go", () => {
    // Bug caught: the pan of a strip that ends near its start is heard as a tap of the strip, so
    // ui runs its tap handling (a local write, a focus change) after a scroll gesture.
    const mock = createMockInput();
    const { scroll } = buttonInScroll(mock);
    const tapped: number[] = [];

    createInputApi(mock.ctx).onTap(entity => tapped.push(entity));

    record(mock.state, down(60, 50));
    record(mock.state, moved(80, 50));
    mock.frame();

    expect(mock.has(scroll, Pressed)).toBe(true);

    record(mock.state, moved(61, 50));
    record(mock.state, up(61, 50));
    mock.frame();

    expect(tapped).toEqual([]);
    expect(mock.answers).toEqual([]);
  });

  it("leaves a press inside the slop on the button, so the release taps it", () => {
    // Bug caught: the hand-off fires before the finger left the slop and steals the tap of a
    // finger that trembled.
    const mock = createMockInput();
    const { scroll, button } = buttonInScroll(mock);

    record(mock.state, down(60, 50));
    mock.frame();
    record(mock.state, moved(68, 50));
    mock.frame();

    expect(mock.has(button, Pressed)).toBe(true);
    expect(mock.has(scroll, Pressed)).toBe(false);

    record(mock.state, up(68, 50));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "buy", payload: { id: "s1" } }]);
  });

  it("gives the press to the innermost scroll of the move's axis, once per press", () => {
    // Bug caught: the axis is read the wrong way round, the outer scroll is taken over the inner
    // one, or a later move of the same press hands it on again.
    const mock = createMockInput();
    const page = scrollOf(mock, { axis: "y" }, { x: 0, y: 0, width: 400, height: 400 });
    const strip = scrollOf(mock, { axis: "x" }, { x: 0, y: 100, width: 400, height: 100 }, [
      Parent({ entity: page })
    ]);
    const button = mock.spawn([Tappable({ intent: "buy" }), Parent({ entity: strip })]);

    mock.boxes.push({ entity: button, x: 20, y: 120, width: 100, height: 60 });
    mock.start();

    record(mock.state, down(60, 150));
    record(mock.state, moved(64, 170));
    mock.frame();

    expect(mock.has(page, Pressed)).toBe(true);
    expect(mock.has(strip, Pressed)).toBe(false);
    expect(mock.has(button, Pressed)).toBe(false);

    record(mock.state, up(64, 170));
    record(mock.state, down(60, 150));
    record(mock.state, moved(80, 154));
    mock.frame();

    expect(mock.has(strip, Pressed)).toBe(true);
    expect(mock.has(page, Pressed)).toBe(false);

    record(mock.state, moved(82, 300));
    mock.frame();

    expect(mock.has(strip, Pressed)).toBe(true);
    expect(mock.has(page, Pressed)).toBe(false);
  });

  it("keeps the press on the button when no scroll moves on the move's axis", () => {
    // Bug caught: a scroll of any axis takes the press, so a vertical move inside a lone
    // horizontal strip drags the strip sideways.
    const mock = createMockInput();
    const { scroll, button } = buttonInScroll(mock);

    record(mock.state, down(60, 50));
    record(mock.state, moved(62, 70));
    mock.frame();

    expect(mock.has(button, Pressed)).toBe(true);
    expect(mock.has(scroll, Pressed)).toBe(false);
    expect(mock.state.entity).toBe(button);
  });

  it("leaves the press on a popup button drawn over a y list when the finger drifts past the slop along y", () => {
    // Bug caught: the hand-off hit-tests the start point and finds the list under the modal, so a
    // finger that drifts on the popup's button pans the list behind it and the button never answers.
    const mock = createMockInput();
    const { scroll, button } = popupOverScroll(mock, { axis: "y" });

    record(mock.state, down(60, 50));
    record(mock.state, moved(60, 70));
    mock.frame();

    expect(mock.has(button, Pressed)).toBe(true);
    expect(mock.has(scroll, Pressed)).toBe(false);
    expect(mock.state.caught).toBe(false);

    // Back inside the slop: the button still answers its tap.
    record(mock.state, up(61, 52));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "close", payload: {} }]);
  });

  it("lets a Draggable inside a scroll drag", () => {
    // Bug caught: the hand-off takes the press of a draggable item, so the item never lifts.
    const mock = createMockInput();
    const scroll = scrollOf(mock, { axis: "x" }, { x: 0, y: 0, width: 400, height: 100 });
    const item = mock.spawn(
      [Draggable({}), Transform({ x: 20, y: 20 }), Parent({ entity: scroll })],
      { projection: "board.items", key: "i5" }
    );

    mock.boxes.push({ entity: item, x: 20, y: 20, width: 100, height: 60 });
    mock.start();

    record(mock.state, down(60, 50));
    mock.frame();
    record(mock.state, moved(80, 50));
    mock.frame();

    expect(mock.state.phase).toBe("dragging");
    expect(mock.has(item, Held)).toBe(true);
    expect(mock.has(scroll, Pressed)).toBe(false);
  });

  it("lets a Swipeable inside a scroll swipe", () => {
    // Bug caught: the hand-off takes the press of a swipeable cell, so the swipe answers nothing.
    const mock = createMockInput();
    const scroll = scrollOf(mock, { axis: "x" }, { x: 0, y: 0, width: 400, height: 100 });
    const cell = mock.spawn([
      Swipeable({ intent: "swap", payload: { cell: "c2" } }),
      Parent({ entity: scroll })
    ]);

    mock.boxes.push({ entity: cell, x: 20, y: 20, width: 100, height: 60 });
    mock.start();

    record(mock.state, down(60, 50));
    mock.frame();
    record(mock.state, moved(80, 50));
    mock.frame();

    expect(mock.has(scroll, Pressed)).toBe(false);

    record(mock.state, up(120, 50));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "swap", payload: { cell: "c2", direction: "right" } }]);
  });
});

describe("a finger on a moving scroll", () => {
  it("stops it: the scroll takes the press, and the release answers nothing and runs no onTap listener", () => {
    // Bug caught: the finger that stops a fling buys the item under it; or the catch outlives its
    // press and the next tap on a still strip is lost.
    const mock = createMockInput();
    const { scroll, button } = buttonInScroll(mock, { moving: true });
    const tapped: number[] = [];

    createInputApi(mock.ctx).onTap(entity => tapped.push(entity));

    record(mock.state, down(60, 50));
    mock.frame();

    expect(mock.has(scroll, Pressed)).toBe(true);
    expect(mock.has(button, Pressed)).toBe(false);

    record(mock.state, up(60, 50));
    mock.frame();

    expect(mock.answers).toEqual([]);
    expect(tapped).toEqual([]);
    expect(mock.has(scroll, Pressed)).toBe(false);
    expect(mock.state.caught).toBe(false);

    // ui writes `moving: false` once the strip stands still: the next tap buys the item.
    mock.attachTo(scroll, Scrollable({ axis: "x", moving: false }));
    record(mock.state, down(60, 50));
    record(mock.state, up(60, 50));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "buy", payload: { id: "s1" } }]);
    expect(tapped).toEqual([button]);
  });

  it("leaves a tap on a button of another root drawn over a moving scroll to that button", () => {
    // Bug caught: the catch hit-tests for a moving scroll before the view on top, skips the HUD or
    // popup button drawn over a flinging list, and the list eats the tap on that button.
    const mock = createMockInput();
    const { scroll, button } = popupOverScroll(mock, { axis: "y", moving: true });
    const tapped: number[] = [];

    createInputApi(mock.ctx).onTap(entity => tapped.push(entity));

    record(mock.state, down(60, 50));
    mock.frame();

    expect(mock.has(button, Pressed)).toBe(true);
    expect(mock.has(scroll, Pressed)).toBe(false);

    record(mock.state, up(60, 50));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "close", payload: {} }]);
    expect(tapped).toEqual([button]);
  });

  it("keeps the press on the caught scroll when the finger then pans along another scroll's axis", () => {
    // Bug caught: a finger that stopped the page jumps to the strip under it as soon as it moves
    // sideways, so one press drives two scrolls.
    const mock = createMockInput();
    const page = scrollOf(
      mock,
      { axis: "y", moving: true },
      { x: 0, y: 0, width: 400, height: 400 }
    );
    const strip = scrollOf(mock, { axis: "x" }, { x: 0, y: 100, width: 400, height: 100 }, [
      Parent({ entity: page })
    ]);

    mock.start();
    record(mock.state, down(60, 150));
    record(mock.state, moved(90, 150));
    mock.frame();

    expect(mock.has(page, Pressed)).toBe(true);
    expect(mock.has(strip, Pressed)).toBe(false);
  });
});

describe("a scroll that plays its exit", () => {
  it("catches nothing and takes no hand-off", () => {
    // Bug caught: a strip on its way out still swallows presses and pans.
    const moving = createMockInput();
    const caught = buttonInScroll(moving, { moving: true }, [Exiting()]);

    record(moving.state, down(60, 50));
    moving.frame();

    expect(moving.has(caught.button, Pressed)).toBe(true);
    expect(moving.has(caught.scroll, Pressed)).toBe(false);

    record(moving.state, up(60, 50));
    moving.frame();

    expect(moving.answers).toEqual([{ intent: "buy", payload: { id: "s1" } }]);

    const still = createMockInput();
    const panned = buttonInScroll(still, {}, [Exiting()]);

    record(still.state, down(60, 50));
    record(still.state, moved(80, 50));
    still.frame();

    expect(still.has(panned.button, Pressed)).toBe(true);
    expect(still.has(panned.scroll, Pressed)).toBe(false);
  });
});
