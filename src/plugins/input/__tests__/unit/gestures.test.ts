import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { Exiting } from "../../../world/ecs/define";
import { createInputApi } from "../../api";
import {
  Draggable,
  DropTarget,
  Held,
  Hovered,
  Pointer,
  PointerOver,
  type PointerValue,
  Pressable,
  Pressed,
  Swipeable,
  Tappable,
  Touchable
} from "../../components";
import { direction, distance } from "../../gestures";
import { record } from "../../pointer";
import type { Direction, RawSample } from "../../types";
import { createMockInput, type MockInput } from "./mock-input";

const down = (clientX: number, clientY: number, pointerId = 1): RawSample => ({
  kind: "down",
  pointerType: "touch",
  pointerId,
  clientX,
  clientY
});

const moved = (clientX: number, clientY: number, pointerId = 1): RawSample => ({
  kind: "move",
  pointerType: "touch",
  pointerId,
  clientX,
  clientY
});

const up = (clientX: number, clientY: number, pointerId = 1): RawSample => ({
  kind: "up",
  pointerType: "touch",
  pointerId,
  clientX,
  clientY
});

const sample = (
  kind: RawSample["kind"],
  pointerType: RawSample["pointerType"],
  clientX: number,
  clientY: number,
  pointerId = 1
): RawSample => ({ kind, pointerType, pointerId, clientX, clientY });

const pointerOf = (mock: MockInput): PointerValue =>
  mock.input.deps.world.ecs.resource(Pointer) as PointerValue;

// Spawns one view with a box that holds (50, 50) and starts the plugin.
function view(
  mock: MockInput,
  values: Parameters<MockInput["spawn"]>[0],
  key?: { projection: string; key: string }
): number {
  const entity = mock.spawn(values, key);

  mock.boxes.push({ entity, x: 0, y: 0, width: 200, height: 200 });
  mock.start();

  return entity;
}

describe("distance and direction", () => {
  it("measures the straight line between two points", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });

  it("names the dominant axis of the move", () => {
    const cases: Array<[number, number, Direction]> = [
      [100, 10, "right"],
      [-100, 10, "left"],
      [10, 100, "down"],
      [10, -100, "up"]
    ];

    for (const [dx, dy, expected] of cases) {
      expect(direction({ x: 0, y: 0 }, { x: dx, y: dy })).toBe(expected);
    }
  });
});

describe("the frame step", () => {
  it("answers a tap and leaves nothing tagged", () => {
    const mock = createMockInput();
    const entity = view(mock, [Tappable({ intent: "found", payload: { id: "o1" } })]);

    record(mock.state, down(50, 50));
    mock.frame();

    expect(mock.state.phase).toBe("pressed");
    expect(mock.has(entity, Pressed)).toBe(true);
    expect(pointerOf(mock)).toMatchObject({ x: 50, y: 50, down: true, justPressed: true });

    record(mock.state, up(52, 52));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "found", payload: { id: "o1" } }]);
    expect(mock.state.phase).toBe("idle");
    expect(mock.has(entity, Pressed)).toBe(false);
    expect(pointerOf(mock)).toMatchObject({ down: false, justReleased: true });
  });

  it("clears justPressed and justReleased after one frame", () => {
    const mock = createMockInput();

    view(mock, [Tappable({ intent: "found" })]);
    record(mock.state, down(50, 50));
    mock.frame();
    mock.frame();

    expect(pointerOf(mock)).toMatchObject({ justPressed: false, justReleased: false });
  });

  it("answers a tap whose down and up arrived in the same frame", () => {
    const mock = createMockInput();

    view(mock, [Tappable({ intent: "found" })]);
    record(mock.state, down(50, 50));
    record(mock.state, up(50, 50));
    mock.frame();

    expect(mock.answers).toHaveLength(1);
    expect(mock.state.phase).toBe("idle");
  });

  it("answers nothing when the finger moved further than the tap slop", () => {
    const mock = createMockInput();

    view(mock, [Tappable({ intent: "found" })]);
    record(mock.state, down(50, 50));
    mock.frame();
    record(mock.state, up(80, 50));
    mock.frame();

    expect(mock.answers).toEqual([]);
  });

  it("answers a long press at longPressMs and never a tap after it", () => {
    const mock = createMockInput();
    const entity = view(mock, [Pressable({ intent: "info", payload: { id: "o1" } })]);

    record(mock.state, down(50, 50));
    mock.frame(100);
    expect(mock.answers).toEqual([]);

    mock.frame(400);

    expect(mock.answers).toEqual([{ intent: "info", payload: { id: "o1" } }]);
    expect(mock.state.phase).toBe("longPressed");
    expect(mock.has(entity, Pressed)).toBe(false);

    record(mock.state, up(50, 50));
    mock.frame();

    expect(mock.answers).toHaveLength(1);
    expect(mock.state.phase).toBe("idle");
  });

  it("does not answer a long press when the finger drifted past the tap slop", () => {
    const mock = createMockInput();

    view(mock, [Pressable({ intent: "info" })]);
    record(mock.state, down(50, 50));
    mock.frame(100);
    record(mock.state, moved(80, 50));
    mock.frame(400);

    expect(mock.answers).toEqual([]);
    expect(mock.state.phase).toBe("pressed");
  });

  it("answers a swipe in each of the four directions", () => {
    const cases: Array<[number, number, Direction]> = [
      [150, 50, "right"],
      [-50, 50, "left"],
      [50, 150, "down"],
      [50, -50, "up"]
    ];

    for (const [x, y, expected] of cases) {
      const mock = createMockInput();

      view(mock, [Swipeable({ intent: "swap", payload: { cell: "c2" } })]);
      record(mock.state, down(50, 50));
      record(mock.state, up(x, y));
      mock.frame();

      expect(mock.answers).toEqual([
        { intent: "swap", payload: { cell: "c2", direction: expected } }
      ]);
    }
  });

  it("answers nothing for a swipe that took longer than swipeMaxMs", () => {
    const mock = createMockInput();

    view(mock, [Swipeable({ intent: "swap" })]);
    record(mock.state, down(50, 50));
    mock.frame(400);
    record(mock.state, up(150, 50));
    mock.frame();

    expect(mock.answers).toEqual([]);
  });

  it("answers nothing for a swipe shorter than swipeMinPx", () => {
    const mock = createMockInput();

    view(mock, [Swipeable({ intent: "swap" })]);
    record(mock.state, down(50, 50));
    record(mock.state, up(70, 50));
    mock.frame();

    expect(mock.answers).toEqual([]);
  });

  it("takes the pointer even where no view is, so the press answers nothing", () => {
    const mock = createMockInput();

    mock.start();
    record(mock.state, down(500, 500));
    record(mock.state, up(500, 500));
    mock.frame();

    expect(mock.answers).toEqual([]);
    expect(mock.state.entity).toBeUndefined();
  });

  it("ignores the second finger while a pointer is active", () => {
    const mock = createMockInput();
    const first = mock.spawn([Tappable({ intent: "first" })]);
    const second = mock.spawn([Tappable({ intent: "second" })]);

    mock.boxes.push(
      { entity: first, x: 0, y: 0, width: 100, height: 100 },
      { entity: second, x: 300, y: 0, width: 100, height: 100 }
    );
    mock.start();

    record(mock.state, down(50, 50, 1));
    mock.frame();
    record(mock.state, down(350, 50, 2));
    record(mock.state, up(350, 50, 2));
    mock.frame();

    expect(mock.answers).toEqual([]);
    expect(mock.state.entity).toBe(first);

    record(mock.state, up(50, 50, 1));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "first", payload: {} }]);
  });

  it("untags Pressed on a cancel and answers nothing", () => {
    const mock = createMockInput();
    const entity = view(mock, [Tappable({ intent: "found" })]);

    record(mock.state, down(50, 50));
    mock.frame();
    record(mock.state, {
      kind: "cancel",
      pointerType: "touch",
      pointerId: 1,
      clientX: 50,
      clientY: 50
    });
    mock.frame();

    expect(mock.answers).toEqual([]);
    expect(mock.has(entity, Pressed)).toBe(false);
    expect(mock.state.phase).toBe("idle");
    expect(pointerOf(mock).down).toBe(false);
  });

  it("warns and refuses the grab of a draggable view with no projection key", () => {
    const mock = createMockInput();

    view(mock, [Draggable({}), Transform({ x: 50, y: 50 })]);
    record(mock.state, down(50, 50));
    mock.frame();
    record(mock.state, moved(70, 50));
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledWith("input: draggable view has no projection key", {
      entity: 1
    });
    expect(mock.state.phase).toBe("idle");
    expect(mock.calls).not.toContain("mute");
  });

  it("warns once and lets Draggable win over Swipeable", () => {
    const mock = createMockInput();

    view(mock, [Draggable({}), Swipeable({ intent: "swap" }), Transform({ x: 50, y: 50 })], {
      projection: "board.items",
      key: "i5"
    });

    record(mock.state, down(50, 50));
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledWith("input: Draggable wins over Swipeable", {
      view: { projection: "board.items", key: "i5" }
    });

    record(mock.state, moved(70, 50));
    mock.frame();

    expect(mock.state.phase).toBe("dragging");
  });

  it("gives the drag up when a commit sent the held view into its exit", () => {
    const mock = createMockInput();
    const entity = view(mock, [Draggable({}), Transform({ x: 50, y: 50 })], {
      projection: "board.items",
      key: "i5"
    });

    record(mock.state, down(50, 50));
    mock.frame();
    record(mock.state, moved(70, 50));
    mock.frame();

    expect(mock.state.phase).toBe("dragging");

    mock.attachTo(entity, Exiting());
    mock.calls.length = 0;
    mock.frame();

    expect(mock.state.phase).toBe("idle");
    expect(mock.calls).toEqual(["unmute", "untag:Held", "pointer:false", "untag:Pressed"]);
    expect(mock.calls).not.toContain("settle");
  });

  it("gives the drag up when the held view is gone altogether", () => {
    const mock = createMockInput();
    const entity = view(mock, [Draggable({}), Transform({ x: 50, y: 50 })], {
      projection: "board.items",
      key: "i5"
    });

    record(mock.state, down(50, 50));
    mock.frame();
    record(mock.state, moved(70, 50));
    mock.frame();
    mock.kill(entity);
    mock.calls.length = 0;
    mock.frame();

    expect(mock.state.phase).toBe("idle");
    expect(mock.calls).toEqual(["unmute", "pointer:false", "untag:Pressed"]);
  });
});

describe("the frame step in the other world modes", () => {
  it("drops the samples and cancels a running drag while the world is paused", () => {
    const mock = createMockInput();

    view(mock, [Draggable({}), Transform({ x: 50, y: 50 })], {
      projection: "board.items",
      key: "i5"
    });

    record(mock.state, down(50, 50));
    mock.frame();
    record(mock.state, moved(70, 50));
    mock.frame();

    expect(mock.state.phase).toBe("dragging");

    mock.world.mode = "paused";
    record(mock.state, moved(120, 50));
    mock.frame();

    expect(mock.state.samples).toEqual([]);
    expect(mock.state.phase).toBe("idle");
    expect(mock.calls).toContain("settle");
    expect(mock.answers).toEqual([]);
    expect(pointerOf(mock).down).toBe(false);
  });

  it("writes nothing at all while the world runs fast", () => {
    const mock = createMockInput();

    view(mock, [Tappable({ intent: "found" })]);
    mock.world.mode = "fast";
    record(mock.state, down(50, 50));
    record(mock.state, up(50, 50));
    mock.frame();

    expect(mock.state.samples).toEqual([]);
    expect(mock.state.phase).toBe("idle");
    expect(mock.calls).toEqual([]);
    expect(mock.answers).toEqual([]);
  });

  it("lets a running drag go when the mode turns fast, instead of leaking the hand", () => {
    const mock = createMockInput();
    const entity = view(mock, [Draggable({}), Transform({ x: 50, y: 50 })], {
      projection: "board.items",
      key: "i5"
    });

    record(mock.state, down(50, 50));
    mock.frame();
    record(mock.state, moved(70, 50));
    mock.frame();

    expect(mock.state.phase).toBe("dragging");
    expect(mock.has(entity, Held)).toBe(true);

    mock.world.mode = "fast";
    mock.calls.length = 0;
    mock.frame();

    expect(mock.state.phase).toBe("idle");
    expect(mock.has(entity, Held)).toBe(false);
    expect(mock.state.unmute).toBeUndefined();
    expect(mock.calls).toEqual([
      "unmute",
      "settle",
      "lift:false",
      "untag:Held",
      "pointer:false",
      "untag:Pressed"
    ]);
    expect(mock.answers).toEqual([]);
    expect(pointerOf(mock).down).toBe(false);
  });

  it("writes nothing more on the frames after a fast drag was let go", () => {
    const mock = createMockInput();

    view(mock, [Draggable({}), Transform({ x: 50, y: 50 })], {
      projection: "board.items",
      key: "i5"
    });

    record(mock.state, down(50, 50));
    mock.frame();
    record(mock.state, moved(70, 50));
    mock.frame();

    mock.world.mode = "fast";
    mock.frame();
    mock.calls.length = 0;
    mock.frame();

    expect(mock.calls).toEqual([]);
  });
});

describe("the drop answer through the finger", () => {
  it("builds the same answer the API builds", () => {
    const mock = createMockInput();
    const item = mock.spawn([Draggable({ payload: { from: "c2" } }), Transform({ x: 50, y: 50 })], {
      projection: "board.items",
      key: "i5"
    });
    const cell = mock.spawn([DropTarget({ intent: "merge", payload: { to: "c3" } })], {
      projection: "board.cells",
      key: "c3"
    });

    mock.boxes.push(
      { entity: cell, x: 100, y: 0, width: 100, height: 100 },
      { entity: item, x: 0, y: 0, width: 100, height: 100 }
    );
    mock.start();

    record(mock.state, down(50, 50));
    mock.frame();
    record(mock.state, moved(150, 50));
    mock.frame();
    record(mock.state, up(150, 50));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "merge", payload: { from: "c2", to: "c3" } }]);
  });
});

describe("Touchable and the onTap listeners", () => {
  it("presses a view that only carries Touchable and answers nothing", () => {
    const mock = createMockInput();
    const entity = view(mock, [Touchable()]);
    const seen: number[] = [];

    createInputApi(mock.ctx).onTap(tapped => seen.push(tapped));

    record(mock.state, down(50, 50));
    mock.frame();

    expect(mock.state.entity).toBe(entity);
    expect(mock.has(entity, Pressed)).toBe(true);

    record(mock.state, up(52, 52));
    mock.frame();

    expect(seen).toEqual([entity]);
    expect(mock.answers).toEqual([]);
    expect(mock.state.phase).toBe("idle");
  });

  it("calls the listeners before the Tappable answer, in registration order", () => {
    const mock = createMockInput();
    const entity = view(mock, [Tappable({ intent: "found" })]);
    const api = createInputApi(mock.ctx);
    const seen: number[] = [];

    api.onTap(tapped => {
      seen.push(tapped);
      mock.calls.push("first");
    });
    api.onTap(() => mock.calls.push("second"));

    record(mock.state, down(50, 50));
    record(mock.state, up(52, 52));
    mock.frame();

    expect(seen).toEqual([entity]);
    expect(mock.calls).toEqual(["tag:Pressed", "first", "second", "answer", "untag:Pressed"]);
  });

  it("calls no listener when the finger left the tap slop", () => {
    const mock = createMockInput();

    view(mock, [Tappable({ intent: "found" })]);

    const seen: number[] = [];

    createInputApi(mock.ctx).onTap(tapped => seen.push(tapped));

    record(mock.state, down(50, 50));
    record(mock.state, up(120, 50));
    mock.frame();

    expect(seen).toEqual([]);
    expect(mock.answers).toEqual([]);
  });

  it("logs a throwing listener and still answers the tap", () => {
    const mock = createMockInput();

    view(mock, [Tappable({ intent: "found" })]);

    const api = createInputApi(mock.ctx);

    api.onTap(() => {
      throw new Error("boom");
    });
    api.onTap(() => mock.calls.push("second"));

    record(mock.state, down(50, 50));
    record(mock.state, up(50, 50));
    mock.frame();

    expect(mock.log.error).toHaveBeenCalledWith(
      "input: an onTap listener threw",
      expect.objectContaining({ entity: mock.boxes[0]?.entity })
    );
    expect(mock.answers).toEqual([{ intent: "found", payload: {} }]);
  });

  it("stops calling a listener its remover dropped", () => {
    const mock = createMockInput();

    view(mock, [Tappable({ intent: "found" })]);

    const api = createInputApi(mock.ctx);
    const seen: number[] = [];
    const off = api.onTap(tapped => seen.push(tapped));

    off();
    record(mock.state, down(50, 50));
    record(mock.state, up(50, 50));
    mock.frame();

    expect(seen).toEqual([]);
    expect(mock.answers).toHaveLength(1);
  });
});

// A tappable button at (0..100, 0..100) and a draggable item at (300..400, 0..100).
function twoViews(mock: MockInput): { button: number; item: number } {
  const button = mock.spawn([Tappable({ intent: "found" })]);
  const item = mock.spawn([Draggable({}), Transform({ x: 300, y: 0 })], {
    projection: "board.items",
    key: "i5"
  });

  mock.boxes.push(
    { entity: button, x: 0, y: 0, width: 100, height: 100 },
    { entity: item, x: 300, y: 0, width: 100, height: 100 }
  );
  mock.start();

  return { button, item };
}

describe("PointerOver, the hover of a mouse or a pen", () => {
  it("tags the view a press would take when a mouse moves over it with no press", () => {
    const mock = createMockInput();
    const { button } = twoViews(mock);

    record(mock.state, sample("move", "mouse", 50, 50));
    mock.frame();

    expect(mock.has(button, PointerOver)).toBe(true);
    expect(mock.state.pointerOver).toBe(button);
    expect(pointerOf(mock)).toMatchObject({ x: 50, y: 50, down: false });
    expect(mock.answers).toEqual([]);
  });

  it("hovers with the filter of a press: a view with only a DropTarget is not hovered", () => {
    const mock = createMockInput();
    const cell = mock.spawn([DropTarget({ intent: "move" })]);

    mock.boxes.push({ entity: cell, x: 0, y: 0, width: 100, height: 100 });
    mock.start();
    record(mock.state, sample("move", "mouse", 50, 50));
    mock.frame();

    expect(mock.has(cell, PointerOver)).toBe(false);
    expect(mock.state.pointerOver).toBeUndefined();
  });

  it("moves the tag from one view to the next, so at most one carries it", () => {
    const mock = createMockInput();
    const { button, item } = twoViews(mock);

    record(mock.state, sample("move", "mouse", 50, 50));
    mock.frame();
    record(mock.state, sample("move", "mouse", 60, 60));
    mock.frame();
    record(mock.state, sample("move", "pen", 350, 50));
    mock.frame();

    expect(mock.has(button, PointerOver)).toBe(false);
    expect(mock.has(item, PointerOver)).toBe(true);
    expect(mock.calls.filter(call => call === "tag:PointerOver")).toHaveLength(2);

    record(mock.state, sample("move", "mouse", 900, 900));
    mock.frame();

    expect(mock.has(item, PointerOver)).toBe(false);
    expect(mock.state.pointerOver).toBeUndefined();
  });

  it("never hovers with a touch, and a touch sample takes the tag away", () => {
    const mock = createMockInput();
    const { button } = twoViews(mock);

    record(mock.state, sample("move", "touch", 50, 50));
    mock.frame();

    expect(mock.has(button, PointerOver)).toBe(false);

    record(mock.state, sample("move", "mouse", 50, 50));
    mock.frame();

    expect(mock.has(button, PointerOver)).toBe(true);

    record(mock.state, sample("down", "touch", 900, 900, 2));
    mock.frame();

    expect(mock.has(button, PointerOver)).toBe(false);
    expect(mock.state.pointerOver).toBeUndefined();
  });

  it("takes the tag away when the pointer leaves the canvas", () => {
    const mock = createMockInput();
    const { button } = twoViews(mock);

    record(mock.state, sample("move", "mouse", 50, 50));
    mock.frame();
    record(mock.state, sample("leave", "mouse", 50, 50));
    mock.frame();

    expect(mock.has(button, PointerOver)).toBe(false);
    expect(mock.state.pointerOver).toBeUndefined();
  });

  it("takes the tag away on a pointer cancel and keeps it on the lost capture after a click", () => {
    const mock = createMockInput();
    const { button } = twoViews(mock);

    record(mock.state, sample("move", "mouse", 50, 50));
    mock.frame();
    record(mock.state, sample("down", "mouse", 50, 50));
    record(mock.state, sample("up", "mouse", 50, 50));
    record(mock.state, sample("lost", "mouse", 50, 50));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "found", payload: {} }]);
    expect(mock.has(button, PointerOver)).toBe(true);

    record(mock.state, sample("cancel", "mouse", 50, 50));
    mock.frame();

    expect(mock.has(button, PointerOver)).toBe(false);
  });

  it("takes the tag away while the world is paused", () => {
    const mock = createMockInput();
    const { button } = twoViews(mock);

    record(mock.state, sample("move", "mouse", 50, 50));
    mock.frame();
    mock.world.mode = "paused";
    mock.frame();

    expect(mock.has(button, PointerOver)).toBe(false);
    expect(mock.state.pointerOver).toBeUndefined();
  });

  it("stays on its view while a press runs and follows the mouse again after the release", () => {
    const mock = createMockInput();
    const { button, item } = twoViews(mock);

    record(mock.state, sample("move", "mouse", 50, 50));
    mock.frame();
    record(mock.state, sample("down", "mouse", 50, 50));
    mock.frame();
    record(mock.state, sample("move", "mouse", 350, 50));
    mock.frame();

    expect(mock.has(button, PointerOver)).toBe(true);
    expect(mock.has(item, PointerOver)).toBe(false);

    record(mock.state, sample("up", "mouse", 350, 50));
    mock.frame();
    record(mock.state, sample("move", "mouse", 351, 50));
    mock.frame();

    expect(mock.has(button, PointerOver)).toBe(false);
    expect(mock.has(item, PointerOver)).toBe(true);
  });
});

// A board item that is both tapped (select) and dragged (merge) at (0..60, 0..100), and a drop
// cell at (60..160, 0..100) under it in the draw order.
function boardItem(mock: MockInput): { item: number; cell: number } {
  const item = mock.spawn(
    [
      Tappable({ intent: "select", payload: { id: "i5" } }),
      Draggable({ payload: { from: "c2" } }),
      Transform({ x: 30, y: 50 })
    ],
    { projection: "board.items", key: "i5" }
  );
  const cell = mock.spawn([DropTarget({ intent: "merge", payload: { to: "c3" } })], {
    projection: "board.cells",
    key: "c3"
  });

  mock.boxes.push(
    { entity: cell, x: 60, y: 0, width: 100, height: 100 },
    { entity: item, x: 0, y: 0, width: 60, height: 100 }
  );
  mock.start();

  return { item, cell };
}

describe("a view that carries both Tappable and Draggable", () => {
  it("answers the tap and starts no drag on a press and release without movement", () => {
    const mock = createMockInput();
    const { item } = boardItem(mock);
    const seen: number[] = [];

    createInputApi(mock.ctx).onTap(tapped => seen.push(tapped));
    record(mock.state, down(50, 50));
    mock.frame();

    expect(mock.state.phase).toBe("pressed");

    record(mock.state, up(50, 50));
    mock.frame();

    expect(seen).toEqual([item]);
    expect(mock.answers).toEqual([{ intent: "select", payload: { id: "i5" } }]);
    expect(mock.calls).not.toContain("tag:Held");
    expect(mock.calls).not.toContain("mute");
    expect(mock.calls).not.toContain("pointer:true");
    expect(mock.has(item, Pressed)).toBe(false);
    expect(mock.state.phase).toBe("idle");
  });

  it("answers the drop and not the tap after a 20 px move released over a DropTarget", () => {
    const mock = createMockInput();
    const { item, cell } = boardItem(mock);
    const seen: number[] = [];

    createInputApi(mock.ctx).onTap(tapped => seen.push(tapped));
    record(mock.state, down(50, 50));
    mock.frame();
    record(mock.state, moved(70, 50));
    mock.frame();

    expect(mock.state.phase).toBe("dragging");
    expect(mock.has(item, Held)).toBe(true);
    expect(mock.has(cell, Hovered)).toBe(true);

    record(mock.state, up(70, 50));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "merge", payload: { from: "c2", to: "c3" } }]);
    expect(seen).toEqual([]);
    expect(mock.has(item, Held)).toBe(false);
    expect(mock.state.phase).toBe("idle");
  });

  it("answers the tap after a 6 px move, under dragStartPx and inside tapSlopPx", () => {
    const mock = createMockInput();
    const { item } = boardItem(mock);

    record(mock.state, down(50, 50));
    mock.frame();
    record(mock.state, moved(56, 50));
    mock.frame();

    expect(mock.state.phase).toBe("pressed");
    expect(mock.has(item, Held)).toBe(false);

    record(mock.state, up(56, 50));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "select", payload: { id: "i5" } }]);
    expect(mock.calls).not.toContain("mute");
    expect(mock.state.phase).toBe("idle");
  });

  it("is hovered by a mouse with no press and still answers the click", () => {
    const mock = createMockInput();
    const { item } = boardItem(mock);

    record(mock.state, sample("move", "mouse", 50, 50));
    mock.frame();

    expect(mock.has(item, PointerOver)).toBe(true);
    expect(mock.state.pointerOver).toBe(item);
    expect(mock.answers).toEqual([]);

    record(mock.state, sample("down", "mouse", 50, 50));
    record(mock.state, sample("up", "mouse", 50, 50));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "select", payload: { id: "i5" } }]);
    expect(mock.has(item, PointerOver)).toBe(true);
  });
});
