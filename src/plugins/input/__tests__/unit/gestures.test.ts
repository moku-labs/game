import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { Exiting } from "../../../world/ecs/define";
import {
  Draggable,
  DropTarget,
  Pointer,
  type PointerValue,
  Pressable,
  Pressed,
  Swipeable,
  Tappable
} from "../../components";
import { direction, distance } from "../../gestures";
import { record } from "../../pointer";
import type { Direction, RawSample } from "../../types";
import { createMockInput, type MockInput } from "./mock-input";

const down = (clientX: number, clientY: number, pointerId = 1): RawSample => ({
  kind: "down",
  pointerId,
  clientX,
  clientY
});

const moved = (clientX: number, clientY: number, pointerId = 1): RawSample => ({
  kind: "move",
  pointerId,
  clientX,
  clientY
});

const up = (clientX: number, clientY: number, pointerId = 1): RawSample => ({
  kind: "up",
  pointerId,
  clientX,
  clientY
});

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
    record(mock.state, { kind: "cancel", pointerId: 1, clientX: 50, clientY: 50 });
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
