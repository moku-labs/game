import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { createInputApi } from "../../api";
import {
  Draggable,
  DropTarget,
  PointerOver,
  Pressed,
  Scrollable,
  Tappable,
  Touchable,
  Traceable,
  Traced
} from "../../components";
import { lockedOut } from "../../hit";
import { stopInput } from "../../lifecycle";
import { record } from "../../pointer";
import type { RawSample } from "../../types";
import { createMockInput, type MockInput } from "./mock-input";

// ---------------------------------------------------------------------------
// Unit test: the input lock of a guide (F98). Raw pointer samples go through
// the real gesture machine and the fake hit test of the mock: a press outside
// the window reaches no view and answers the guide's `blocked`; inside it, the
// finger works as before. The doors `tap`, `press` and `drag` do no hit test.
// ---------------------------------------------------------------------------

/** The window of the guide: the button `inside` at 0..100, 0..100, padded by nothing. */
const WINDOW = { x: 0, y: 0, w: 100, h: 100 };

/** The answer a press outside the window gives. */
const BLOCKED = { intent: "tutorialBlocked", payload: { step: 2 } };

/**
 * One touch sample.
 *
 * @param kind - The sample kind.
 * @param x - Client x, equal to reference x in the mock.
 * @param y - Client y.
 * @param pointerType - The device.
 * @returns The sample.
 */
function sample(
  kind: RawSample["kind"],
  x: number,
  y: number,
  pointerType: RawSample["pointerType"] = "touch"
): RawSample {
  return { kind, pointerType, pointerId: 1, clientX: x, clientY: y };
}

/**
 * Feeds samples to the machine, one frame each.
 *
 * @param mock - The mock plugin.
 * @param samples - The samples, in order.
 */
function play(mock: MockInput, samples: readonly RawSample[]): void {
  for (const each of samples) {
    record(mock.state, each);
    mock.frame();
  }
}

/**
 * A tap at a point: a down and an up a frame later.
 *
 * @param mock - The mock plugin.
 * @param x - Reference x.
 * @param y - Reference y.
 */
function tapAt(mock: MockInput, x: number, y: number): void {
  play(mock, [sample("down", x, y), sample("up", x, y)]);
}

/**
 * The board of the tutorial: the button `inside` in the window, the button `outside` at 200..300,
 * 0..100, a local-state button (`Touchable` only, as ui spawns it) at 0..100, 200..300, and a
 * moving scroll at 200..300, 200..300. The plugin is started with the lock on the window.
 *
 * @param blocked - The answer of a blocked press the gate reports, if any.
 * @returns The mock and the views.
 */
function board(blocked?: typeof BLOCKED) {
  const mock = createMockInput();
  const inside = mock.spawn([Tappable({ intent: "merge" })]);
  const outside = mock.spawn([Tappable({ intent: "shop" })]);
  const local = mock.spawn([Touchable()]);
  const scroll = mock.spawn([Touchable(), Scrollable({ axis: "y", moving: true })]);

  mock.boxes.push(
    { entity: inside, x: 0, y: 0, width: 100, height: 100 },
    { entity: outside, x: 200, y: 0, width: 100, height: 100 },
    { entity: local, x: 0, y: 200, width: 100, height: 100 },
    { entity: scroll, x: 200, y: 200, width: 100, height: 100 }
  );
  mock.gate.blocked = blocked;
  mock.start();

  const api = createInputApi(mock.ctx);
  const tapped: number[] = [];

  api.onTap(entity => tapped.push(entity));
  api.lock.window(WINDOW);

  return { mock, api, inside, outside, local, scroll, tapped };
}

describe("lockedOut", () => {
  it("keeps everything outside the window, the edges inside, and nothing without a lock", () => {
    const mock = createMockInput();

    expect(lockedOut(mock.state, 500, 500)).toBe(false);

    mock.state.lock = WINDOW;

    expect(lockedOut(mock.state, 100, 100)).toBe(false);
    expect(lockedOut(mock.state, 0, 0)).toBe(false);
    expect(lockedOut(mock.state, 100.5, 50)).toBe(true);
    expect(lockedOut(mock.state, 50, -0.5)).toBe(true);

    // eslint-disable-next-line unicorn/no-null -- `null` locks everything.
    mock.state.lock = null;

    expect(lockedOut(mock.state, 50, 50)).toBe(true);
  });
});

describe("a press outside the window of a guide", () => {
  // Bug caught: the tutorial's veil is drawn but the button under it still answers.
  it("reaches no view and answers the guide's blocked answer, once", () => {
    const { mock, outside, tapped } = board(BLOCKED);

    tapAt(mock, 250, 50);

    expect(mock.answers).toEqual([BLOCKED]);
    expect(mock.has(outside, Pressed)).toBe(false);
    expect(tapped).toEqual([]);
  });

  it("is dropped when the guide names no blocked answer", () => {
    const { mock, tapped } = board();

    tapAt(mock, 250, 50);

    expect(mock.answers).toEqual([]);
    expect(tapped).toEqual([]);
    expect(mock.calls).toContain("state");
  });

  // Bug caught: a button with local state (a tab, a toggle) changes under the veil.
  it("runs no onTap listener, so no local write applies", () => {
    const { mock, local, tapped } = board(BLOCKED);

    tapAt(mock, 50, 250);

    expect(tapped).toEqual([]);
    expect(mock.has(local, Pressed)).toBe(false);
  });

  // Bug caught: a finger outside the window stops a list that is flinging under the veil.
  it("stops no scroll", () => {
    const { mock, scroll } = board();

    play(mock, [sample("down", 250, 250)]);

    expect(mock.state.caught).toBe(false);
    expect(mock.has(scroll, Pressed)).toBe(false);
  });

  it("starts no drag", () => {
    const { mock } = board();
    const item = mock.spawn(
      [Draggable({ payload: { from: "c9" } }), Transform({ x: 450, y: 50 })],
      {
        projection: "board.items",
        key: "c9"
      }
    );

    mock.boxes.push({ entity: item, x: 400, y: 0, width: 100, height: 100 });
    play(mock, [sample("down", 450, 50), sample("move", 480, 50), sample("move", 520, 50)]);

    expect(mock.state.phase).toBe("pressed");
    expect(mock.calls).not.toContain("tag:Held");
  });

  it("hovers nothing: the cursor stays idle over a control outside", () => {
    const { mock, outside } = board();

    play(mock, [sample("move", 250, 50, "mouse")]);

    expect(mock.has(outside, PointerOver)).toBe(false);
  });
});

describe("a press inside the window of a guide", () => {
  // Bug caught: the lock refuses the one press the tutorial asks for.
  it("works as before: the view is pressed and the tap answers it", () => {
    const { mock, inside, tapped } = board(BLOCKED);

    play(mock, [sample("down", 100, 100)]);

    expect(mock.has(inside, Pressed)).toBe(true);

    play(mock, [sample("up", 100, 100)]);

    expect(tapped).toEqual([inside]);
    expect(mock.answers).toEqual([{ intent: "merge", payload: {} }]);
  });

  // Bug caught: a drag from inside the window drops onto a target the veil covers.
  it("drops onto nothing outside the window: the item settles home", () => {
    const { mock } = board();
    const item = mock.spawn([Draggable({ payload: { from: "c2" } }), Transform({ x: 50, y: 50 })], {
      projection: "board.items",
      key: "c2"
    });
    const target = mock.spawn([DropTarget({ intent: "merge", payload: { to: "c5" } })]);

    mock.boxes.push(
      { entity: target, x: 400, y: 0, width: 100, height: 100 },
      { entity: item, x: 0, y: 0, width: 100, height: 100 }
    );
    play(mock, [sample("down", 50, 50), sample("move", 450, 50), sample("up", 450, 50)]);

    expect(mock.answers).toEqual([]);
    expect(mock.calls).toContain("settle");
  });

  // Bug caught: a word drawn from inside the window takes letters under the veil.
  it("traces no cell outside the window", () => {
    const { mock } = board();
    const first = mock.spawn([
      Transform({ x: 50, y: 400 }),
      Traceable({ intent: "word", payload: { cell: 0 } })
    ]);
    const second = mock.spawn([
      Transform({ x: 150, y: 400 }),
      Traceable({ intent: "word", payload: { cell: 1 } })
    ]);

    mock.boxes.push(
      { entity: first, x: 0, y: 350, width: 100, height: 100 },
      { entity: second, x: 100, y: 350, width: 100, height: 100 }
    );
    mock.setHitBox(first, { x: -50, y: -50, width: 100, height: 100 });
    mock.setHitBox(second, { x: -50, y: -50, width: 100, height: 100 });
    mock.state.lock = { x: 0, y: 350, w: 100, h: 100 };
    play(mock, [sample("down", 50, 400), sample("move", 150, 400)]);

    expect(mock.has(first, Traced)).toBe(true);
    expect(mock.has(second, Traced)).toBe(false);
  });
});

describe("the lock window", () => {
  // Bug caught: the window is copied once, so a target that moves leaves the lock behind.
  it("is kept by reference: a window written in place moves the lock", () => {
    const { mock, api, outside } = board();
    const window = { x: 0, y: 0, w: 100, h: 100 };

    api.lock.window(window);
    window.x = 200;
    play(mock, [sample("down", 250, 50)]);

    expect(mock.has(outside, Pressed)).toBe(true);
  });

  it("locks every press with null, and none once lifted", () => {
    const { mock, api, inside } = board(BLOCKED);

    // eslint-disable-next-line unicorn/no-null -- `null` locks everything: a guide with no target.
    api.lock.window(null);
    tapAt(mock, 50, 50);

    expect(mock.answers).toEqual([BLOCKED]);

    api.lock.window(undefined);
    play(mock, [sample("down", 50, 50)]);

    expect(mock.has(inside, Pressed)).toBe(true);
  });

  // Bug caught: a test or an agent that taps through the door is refused by the screen's lock.
  it("leaves the doors alone: app.input.tap does no hit test", () => {
    const { mock, api, outside } = board(BLOCKED);

    expect(api.tap(outside)).toBe(true);
    expect(mock.answers).toEqual([{ intent: "shop", payload: {} }]);
  });

  it("is forgotten when the plugin stops", () => {
    const { mock } = board();

    stopInput(mock.state);

    expect(mock.state.lock).toBeUndefined();
  });
});
