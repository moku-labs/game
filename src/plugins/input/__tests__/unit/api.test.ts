import { describe, expect, expectTypeOf, it } from "vitest";
import { createInputApi } from "../../api";
import { Draggable, DropTarget, Pressable, Swipeable, Tappable } from "../../components";
import type { Direction, Target } from "../../types";
import { createMockInput } from "./mock-input";

describe("app.input.tap", () => {
  it("answers the intent of the Tappable under a projection key", () => {
    const mock = createMockInput();

    mock.spawn([Tappable({ intent: "found", payload: { id: "o1" } })], {
      projection: "board.items",
      key: "i5"
    });

    const api = createInputApi(mock.ctx);

    expect(api.tap({ projection: "board.items", key: "i5" })).toBe(true);
    expect(mock.answers).toEqual([{ intent: "found", payload: { id: "o1" } }]);
  });

  it("takes an entity as a target too", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Tappable({ intent: "found" })]);
    const api = createInputApi(mock.ctx);

    expect(api.tap(entity)).toBe(true);
  });

  it("warns and answers false when the view carries no Tappable", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Draggable({})]);
    const api = createInputApi(mock.ctx);

    expect(api.tap(entity)).toBe(false);
    expect(mock.log.warn).toHaveBeenCalledWith("input: target has no Tappable", { target: entity });
    expect(mock.answers).toEqual([]);
  });

  it("warns and answers false for a key no live view carries", () => {
    const mock = createMockInput();
    const api = createInputApi(mock.ctx);

    expect(api.tap({ projection: "board.items", key: "gone" })).toBe(false);
    expect(mock.answers).toEqual([]);
  });

  it("returns what the gate returned", () => {
    const mock = createMockInput();

    mock.gate.open = false;

    const entity = mock.spawn([Tappable({ intent: "found" })]);
    const api = createInputApi(mock.ctx);

    expect(api.tap(entity)).toBe(false);
  });
});

describe("app.input.press", () => {
  it("answers the intent of the Pressable", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Pressable({ intent: "info", payload: { id: "o1" } })]);
    const api = createInputApi(mock.ctx);

    expect(api.press(entity)).toBe(true);
    expect(mock.answers).toEqual([{ intent: "info", payload: { id: "o1" } }]);
  });

  it("warns and answers false when the view carries no Pressable", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Tappable({ intent: "found" })]);
    const api = createInputApi(mock.ctx);

    expect(api.press(entity)).toBe(false);
    expect(mock.log.warn).toHaveBeenCalledWith("input: target has no Pressable", {
      target: entity
    });
  });
});

describe("app.input.drag", () => {
  it("answers the intent of the drop target with both payloads merged", () => {
    const mock = createMockInput();

    mock.spawn([Draggable({ payload: { from: "c2" } })], {
      projection: "board.items",
      key: "i5"
    });
    mock.spawn(
      [
        Draggable({ payload: { from: "c3" } }),
        DropTarget({ intent: "merge", payload: { to: "c3" } })
      ],
      {
        projection: "board.items",
        key: "i7"
      }
    );

    const api = createInputApi(mock.ctx);

    expect(
      api.drag({ projection: "board.items", key: "i5" }, { projection: "board.items", key: "i7" })
    ).toBe(true);
    expect(mock.answers).toEqual([{ intent: "merge", payload: { from: "c2", to: "c3" } }]);
  });

  it("moves nothing: no tag, no mute, no settle", () => {
    const mock = createMockInput();
    const from = mock.spawn([Draggable({})]);
    const to = mock.spawn([DropTarget({ intent: "merge" })]);
    const api = createInputApi(mock.ctx);

    api.drag(from, to);

    expect(mock.calls).toEqual(["answer"]);
  });

  it("warns and answers false when the source carries no Draggable", () => {
    const mock = createMockInput();
    const from = mock.spawn([Tappable({ intent: "found" })]);
    const to = mock.spawn([DropTarget({ intent: "merge" })]);
    const api = createInputApi(mock.ctx);

    expect(api.drag(from, to)).toBe(false);
    expect(mock.log.warn).toHaveBeenCalledWith("input: target has no Draggable", { target: from });
  });

  it("warns and answers false when the destination carries no DropTarget", () => {
    const mock = createMockInput();
    const from = mock.spawn([Draggable({})]);
    const to = mock.spawn([Tappable({ intent: "found" })]);
    const api = createInputApi(mock.ctx);

    expect(api.drag(from, to)).toBe(false);
    expect(mock.log.warn).toHaveBeenCalledWith("input: target has no DropTarget", { target: to });
    expect(mock.answers).toEqual([]);
  });
});

describe("app.input.swipe", () => {
  it("answers the intent of the Swipeable with the direction in the payload", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Swipeable({ intent: "swap", payload: { cell: "c2" } })]);
    const api = createInputApi(mock.ctx);

    expect(api.swipe(entity, "left")).toBe(true);
    expect(mock.answers).toEqual([{ intent: "swap", payload: { cell: "c2", direction: "left" } }]);
  });

  it("warns and answers false when the view carries no Swipeable", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Tappable({ intent: "found" })]);
    const api = createInputApi(mock.ctx);

    expect(api.swipe(entity, "up")).toBe(false);
    expect(mock.log.warn).toHaveBeenCalledWith("input: target has no Swipeable", {
      target: entity
    });
  });
});

describe("the types of the door", () => {
  it("takes a projection key and an entity as a target, and nothing else", () => {
    const mock = createMockInput();
    const api = createInputApi(mock.ctx);

    expectTypeOf<Target>().toEqualTypeOf<{ projection: string; key: string } | number>();
    expectTypeOf(api.tap).parameter(0).toEqualTypeOf<Target>();
    expectTypeOf(api.drag).parameter(1).toEqualTypeOf<Target>();

    // @ts-expect-error -- a target is a projection key or an entity, never a bare key
    api.tap("i5");
  });

  it("takes only the four directions of a swipe", () => {
    const mock = createMockInput();
    const api = createInputApi(mock.ctx);

    expectTypeOf<Direction>().toEqualTypeOf<"up" | "down" | "left" | "right">();

    // @ts-expect-error -- there is no diagonal swipe
    api.swipe(1, "diagonal");
  });

  it("answers with a boolean, never a promise", () => {
    const mock = createMockInput();
    const api = createInputApi(mock.ctx);

    expectTypeOf(api.tap).returns.toEqualTypeOf<boolean>();
    expectTypeOf(api.press).returns.toEqualTypeOf<boolean>();
    expectTypeOf(api.drag).returns.toEqualTypeOf<boolean>();
    expectTypeOf(api.swipe).returns.toEqualTypeOf<boolean>();
  });
});
