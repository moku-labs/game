import { describe, expect, it, vi } from "vitest";
import { Parent, Transform } from "../../../renderer/components";
import { rootPoseOf } from "../../../renderer/sync/pose";
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
  Touchable,
  Traceable,
  Traced
} from "../../components";
import { direction, distance } from "../../gestures";
import { record } from "../../pointer";
import type { Direction, RawSample } from "../../types";
import { createMockInput, createStubCanvas, type MockInput } from "./mock-input";

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

  it("a resting finger on a button gives way: the second press is heard and the first button taps nothing", () => {
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

    expect(mock.answers).toEqual([{ intent: "second", payload: {} }]);
    expect(mock.has(first, Pressed)).toBe(false);

    record(mock.state, up(50, 50, 1));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "second", payload: {} }]);
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

  it("hit-tests once per frame, at the last of several idle mouse moves", () => {
    const mock = createMockInput();
    const { button, item } = twoViews(mock);
    const hitTest = vi.spyOn(mock.input.deps.renderer.sync, "hitTest");

    // Pushed past `record`, which folds only a trailing move of the same pointer.
    mock.state.samples.push(
      sample("move", "mouse", 50, 50),
      sample("lost", "mouse", 60, 50),
      sample("move", "mouse", 200, 50),
      sample("move", "mouse", 350, 50)
    );
    mock.frame();

    expect(hitTest).toHaveBeenCalledTimes(1);
    expect(hitTest).toHaveBeenCalledWith(350, 50, expect.any(Function));
    expect(mock.has(button, PointerOver)).toBe(false);
    expect(mock.has(item, PointerOver)).toBe(true);
    expect(pointerOf(mock)).toMatchObject({ x: 350, y: 50 });
  });

  it("ends with no hover when a leave follows the moves in the same frame", () => {
    const mock = createMockInput();
    const { button } = twoViews(mock);
    const hitTest = vi.spyOn(mock.input.deps.renderer.sync, "hitTest");

    record(mock.state, sample("move", "mouse", 50, 50));
    record(mock.state, sample("leave", "mouse", 50, 50));
    mock.frame();

    expect(hitTest).not.toHaveBeenCalled();
    expect(mock.has(button, PointerOver)).toBe(false);
    expect(mock.state.pointerOver).toBeUndefined();
  });

  it("hovers again when a move follows a clear in the same frame", () => {
    const mock = createMockInput();
    const { button, item } = twoViews(mock);

    record(mock.state, sample("move", "mouse", 50, 50));
    mock.frame();
    record(mock.state, sample("move", "touch", 50, 50, 2));
    record(mock.state, sample("move", "pen", 350, 50));
    mock.frame();

    expect(mock.has(button, PointerOver)).toBe(false);
    expect(mock.has(item, PointerOver)).toBe(true);
    expect(mock.calls.filter(call => call === "untag:PointerOver")).toHaveLength(1);
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

// A pile fanned 30 px: the finger takes c2 at (100, 130), c3 and c4 ride along at 160 and 190.
// The rest poses are recorded, so a settle lands each card on its own rest.
function fannedPile(mock: MockInput): { held: number; c3: number; c4: number } {
  const card = (key: string, y: number, extra: Parameters<MockInput["spawn"]>[0] = []): number => {
    const entity = mock.spawn([Transform({ x: 100, y }), ...extra], {
      projection: "pile.cards",
      key
    });

    mock.setRest(entity, Transform({ x: 100, y }));

    return entity;
  };
  const held = card("c2", 130, [Draggable({ payload: { from: "c2" }, carry: ["c3", "c4"] })]);
  const c3 = card("c3", 160);
  const c4 = card("c4", 190);

  mock.boxes.push({ entity: held, x: 68, y: 98, width: 64, height: 64 });
  mock.start();

  return { held, c3, c4 };
}

describe("the carried stack through the frame step", () => {
  it("grabs at dragStartPx, carries the fan rigidly for two frames and sends it home on a cancel", () => {
    const mock = createMockInput();
    const { held, c3, c4 } = fannedPile(mock);
    const rootY = (entity: number): number => rootPoseOf(mock.input.deps.world.ecs, entity).y;

    record(mock.state, down(100, 130));
    mock.frame();
    record(mock.state, moved(100, 140));
    mock.frame();

    expect(mock.state.phase).toBe("dragging");
    expect(mock.read(c3, Parent)).toEqual({ entity: held });
    expect([rootY(held), rootY(c3), rootY(c4)]).toEqual([130, 160, 190]);

    record(mock.state, moved(300, 240));
    mock.frame();

    expect(mock.read(held, Transform)).toMatchObject({ x: 300, y: 230 });
    expect([rootY(held), rootY(c3), rootY(c4)]).toEqual([230, 260, 290]);

    record(mock.state, moved(400, 340));
    mock.frame();

    expect([rootY(held), rootY(c3), rootY(c4)]).toEqual([330, 360, 390]);

    record(mock.state, sample("cancel", "touch", 400, 340));
    mock.frame();

    expect(mock.state.phase).toBe("idle");
    expect(mock.has(c3, Parent)).toBe(false);
    expect([rootY(held), rootY(c3), rootY(c4)]).toEqual([130, 160, 190]);
    expect(mock.answers).toEqual([]);
  });

  it.each([
    "paused",
    "fast"
  ] as const)("sends the whole stack home when the world turns %s", mode => {
    const mock = createMockInput();
    const { held, c3, c4 } = fannedPile(mock);

    record(mock.state, down(100, 130));
    mock.frame();
    record(mock.state, moved(300, 330));
    mock.frame();
    mock.world.mode = mode;
    mock.trail.length = 0;
    mock.frame();

    expect(mock.state.phase).toBe("idle");
    expect(mock.trail).toEqual(
      expect.arrayContaining([`settle:${held}`, `settle:${c3}`, `settle:${c4}`])
    );
    expect(mock.has(c3, Parent)).toBe(false);
    expect(mock.has(c4, Parent)).toBe(false);
    expect(mock.state.carried).toEqual([]);
  });
});

describe("Traceable over the other gestures", () => {
  it("wins over Tappable with one warning, and the tap listeners never run", () => {
    const mock = createMockInput();
    const entity = view(
      mock,
      [Traceable({ intent: "word", payload: { cell: "b3" } }), Tappable({ intent: "pick" })],
      { projection: "board.cells", key: "b3" }
    );
    const tapped = vi.fn();

    mock.setHitBox(entity, { x: 0, y: 0, width: 200, height: 200 });
    createInputApi(mock.ctx).onTap(tapped);
    record(mock.state, down(50, 50));
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("input: Traceable wins", {
      view: { projection: "board.cells", key: "b3" }
    });
    expect(mock.has(entity, Traced)).toBe(true);

    record(mock.state, up(50, 50));
    mock.frame();

    expect(tapped).not.toHaveBeenCalled();
    expect(mock.answers).toEqual([{ intent: "word", payload: { path: [{ cell: "b3" }] } }]);
  });
});

describe("a finger that has not started a gesture", () => {
  /** A press view at the top left and a `Tappable` button `play` at x 300..400. */
  type Board = { mock: MockInput; surface: number; button: number };

  // A view of the given components covering x 0..200, y 0..200, and the `play` button beside it.
  function board(values: Parameters<MockInput["spawn"]>[0]): Board {
    const mock = createMockInput();
    const surface = mock.spawn(values);
    const button = mock.spawn([Tappable({ intent: "play" })]);

    mock.boxes.push(
      { entity: surface, x: 0, y: 0, width: 200, height: 200 },
      { entity: button, x: 300, y: 0, width: 100, height: 100 }
    );
    mock.start();

    return { mock, surface, button };
  }

  // A tap of another finger on the `play` button, in one frame.
  function tapPlay(mock: MockInput, pointerId: number): void {
    record(mock.state, down(350, 50, pointerId));
    record(mock.state, up(350, 50, pointerId));
    mock.frame();
  }

  const play = { intent: "play", payload: {} };

  it("gives way to the next finger: a press of pointer 2 on a Tappable answers its tap while pointer 7 rests on the background", () => {
    const mock = createMockInput();

    view(mock, [Tappable({ intent: "play" })]);
    record(mock.state, down(500, 500, 7));
    mock.frame();
    record(mock.state, down(50, 50, 2));
    record(mock.state, up(50, 50, 2));
    mock.frame();

    expect(mock.answers).toEqual([play]);
  });

  it("a finger that is tracing keeps its gesture: a second finger's press is not heard", () => {
    const mock = createMockInput();
    const cell = mock.spawn(
      [Transform({ x: 50, y: 50 }), Traceable({ intent: "word", payload: { cell: "a1" } })],
      { projection: "board.cells", key: "a1" }
    );
    const button = mock.spawn([Tappable({ intent: "play" })]);

    mock.boxes.push(
      { entity: cell, x: 0, y: 0, width: 100, height: 100 },
      { entity: button, x: 300, y: 0, width: 100, height: 100 }
    );
    mock.setHitBox(cell, { x: -50, y: -50, width: 100, height: 100 });
    mock.start();
    record(mock.state, down(50, 50, 1));
    mock.frame();

    expect(mock.state.phase).toBe("tracing");

    tapPlay(mock, 2);

    expect(mock.answers).toEqual([]);
    expect(mock.state.phase).toBe("tracing");

    record(mock.state, up(50, 50, 1));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "word", payload: { path: [{ cell: "a1" }] } }]);
  });

  it("moves the capture: the pointer that gave way is released before the new one is captured", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    mock.canvas.current = canvas.element;
    mock.start();
    record(mock.state, down(500, 500, 7));
    mock.frame();

    expect(canvas.order).toEqual(["capture:7"]);

    record(mock.state, down(500, 600, 2));
    mock.frame();

    expect(canvas.order).toEqual(["capture:7", "release:7", "capture:2"]);

    record(mock.state, up(500, 600, 2));
    mock.frame();

    expect(canvas.order).toEqual(["capture:7", "release:7", "capture:2", "release:2"]);
  });

  it("the pointer that gave way is not heard while the new finger's gesture runs: its move, its lost capture and its lift end nothing", () => {
    const mock = createMockInput();
    const item = mock.spawn([Draggable({ payload: { from: "i1" } }), Transform({ x: 50, y: 50 })], {
      projection: "board.items",
      key: "i1"
    });
    const cell = mock.spawn([DropTarget({ intent: "merge", payload: { to: "c3" } })]);

    mock.boxes.push(
      { entity: cell, x: 300, y: 0, width: 100, height: 100 },
      { entity: item, x: 0, y: 0, width: 100, height: 100 }
    );
    mock.start();
    record(mock.state, down(500, 500, 7));
    mock.frame();
    record(mock.state, down(50, 50, 2));
    mock.frame();
    record(mock.state, moved(70, 50, 2));
    mock.frame();

    expect(mock.has(item, Held)).toBe(true);

    record(mock.state, moved(510, 500, 7));
    record(mock.state, sample("lost", "touch", 510, 500, 7));
    record(mock.state, up(510, 500, 7));
    mock.frame();

    expect(mock.has(item, Held)).toBe(true);
    expect(mock.state.phase).toBe("dragging");

    record(mock.state, moved(350, 50, 2));
    record(mock.state, up(350, 50, 2));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "merge", payload: { from: "i1", to: "c3" } }]);
  });

  it("forgets the pointer that gave way: a mouse whose up never arrived is heard on its next press", () => {
    const mock = createMockInput();

    view(mock, [Tappable({ intent: "play" })]);
    record(mock.state, sample("down", "mouse", 500, 500, 1));
    mock.frame();
    record(mock.state, down(600, 600, 2));
    record(mock.state, up(600, 600, 2));
    mock.frame();

    expect(mock.state.pointerId).toBeUndefined();

    record(mock.state, sample("down", "mouse", 50, 50, 1));
    record(mock.state, sample("up", "mouse", 50, 50, 1));
    mock.frame();

    expect(mock.answers).toEqual([play]);
  });

  it("Pointer.id follows the pressed pointer and is -1 at rest", () => {
    const mock = createMockInput();

    view(mock, [Tappable({ intent: "play" })]);
    record(mock.state, down(50, 50, 3));
    mock.frame();

    expect(pointerOf(mock).id).toBe(3);

    record(mock.state, up(50, 50, 3));
    mock.frame();

    expect(pointerOf(mock).id).toBe(-1);

    record(mock.state, down(50, 50, 4));
    record(mock.state, up(50, 50, 4));
    mock.frame();

    expect(pointerOf(mock)).toMatchObject({ id: -1, justPressed: true, justReleased: true });
  });

  it("on a takeover, id, x and y switch to the new finger in the same frame, justPressed is true again and justReleased stays false", () => {
    const mock = createMockInput();

    mock.start();
    record(mock.state, down(500, 500, 7));
    mock.frame();
    mock.frame();

    expect(pointerOf(mock)).toMatchObject({ id: 7, justPressed: false });

    record(mock.state, down(50, 50, 2));
    mock.frame();

    expect(pointerOf(mock)).toEqual({
      id: 2,
      x: 50,
      y: 50,
      down: true,
      justPressed: true,
      justReleased: false
    });
  });

  it("a paused world reports no followed pointer", () => {
    const mock = createMockInput();

    mock.start();
    record(mock.state, down(50, 50, 3));
    mock.frame();

    expect(pointerOf(mock).id).toBe(3);

    mock.world.mode = "paused";
    mock.frame();

    expect(pointerOf(mock)).toMatchObject({ id: -1, down: false });
  });

  it("a finger that panned past the tap slop keeps the gesture against a second finger", () => {
    const { mock, surface } = board([Touchable()]);

    record(mock.state, down(50, 50, 1));
    mock.frame();
    record(mock.state, moved(50, 70, 1));
    mock.frame();

    expect(mock.state.moved).toBe(true);

    tapPlay(mock, 2);

    expect(mock.answers).toEqual([]);
    expect(mock.has(surface, Pressed)).toBe(true);
    expect(pointerOf(mock).id).toBe(1);

    // Back near its start, the finger has still started a gesture.
    record(mock.state, moved(50, 52, 1));
    mock.frame();
    tapPlay(mock, 2);

    expect(mock.answers).toEqual([]);
    expect(pointerOf(mock).id).toBe(1);
  });

  it("starts the next press at rest: a finger that panned before does not make the next one keep the pointer", () => {
    const { mock } = board([Touchable()]);

    record(mock.state, down(50, 50, 1));
    mock.frame();
    record(mock.state, moved(50, 70, 1));
    mock.frame();
    record(mock.state, up(50, 70, 1));
    mock.frame();
    record(mock.state, down(50, 50, 3));
    mock.frame();
    tapPlay(mock, 2);

    expect(mock.answers).toEqual([play]);
  });

  it("a long press keeps the gesture", () => {
    const { mock } = board([Pressable({ intent: "inspect" })]);

    record(mock.state, down(50, 50, 1));
    mock.frame();
    mock.frame(450);

    expect(mock.state.phase).toBe("longPressed");
    expect(mock.answers).toEqual([{ intent: "inspect", payload: {} }]);

    tapPlay(mock, 2);

    expect(mock.answers).toEqual([{ intent: "inspect", payload: {} }]);
  });

  it("a move inside the tap slop is still a rest", () => {
    const { mock } = board([Touchable()]);

    record(mock.state, down(50, 50, 1));
    mock.frame();
    record(mock.state, moved(50, 58, 1));
    mock.frame();
    tapPlay(mock, 2);

    expect(mock.answers).toEqual([play]);
  });
});
