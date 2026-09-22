import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { Exiting } from "../../../world/ecs/define";
import { Draggable, DropTarget, Pressable, Swipeable, Tappable, Touchable } from "../../components";
import { acceptDrop, acceptPress, findDropTarget, findPressed, resolveTarget } from "../../hit";
import { createMockInput } from "./mock-input";

describe("resolveTarget", () => {
  it("resolves a projection key through the projection", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Tappable({ intent: "play" })], {
      projection: "board.items",
      key: "i5"
    });

    expect(resolveTarget(mock.input, { projection: "board.items", key: "i5" })).toBe(entity);
  });

  it("gives undefined for a key no live view carries", () => {
    const mock = createMockInput();

    expect(resolveTarget(mock.input, { projection: "board.items", key: "gone" })).toBeUndefined();
  });

  it("takes any other value as an entity", () => {
    const mock = createMockInput();

    expect(resolveTarget(mock.input, 42)).toBe(42);
  });
});

describe("acceptPress", () => {
  it("takes a view that carries any of the four gesture components", () => {
    const mock = createMockInput();
    const tappable = mock.spawn([Tappable({ intent: "found" })]);
    const pressable = mock.spawn([Pressable({ intent: "info" })]);
    const draggable = mock.spawn([Draggable({})]);
    const swipeable = mock.spawn([Swipeable({ intent: "swap" })]);

    expect(acceptPress(mock.input, tappable)).toBe(true);
    expect(acceptPress(mock.input, pressable)).toBe(true);
    expect(acceptPress(mock.input, draggable)).toBe(true);
    expect(acceptPress(mock.input, swipeable)).toBe(true);
  });

  it("refuses a view that only takes drops", () => {
    const mock = createMockInput();
    const entity = mock.spawn([DropTarget({ intent: "merge" })]);

    expect(acceptPress(mock.input, entity)).toBe(false);
  });

  it("refuses a view that plays its exit", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Tappable({ intent: "found" }), Exiting()]);

    expect(acceptPress(mock.input, entity)).toBe(false);
  });

  it("refuses a view with no gesture component at all", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Transform({ x: 0 })]);

    expect(acceptPress(mock.input, entity)).toBe(false);
  });
});

describe("acceptDrop", () => {
  it("takes a drop target that is not the held view", () => {
    const mock = createMockInput();
    const held = mock.spawn([Draggable({}), DropTarget({ intent: "merge" })]);
    const other = mock.spawn([DropTarget({ intent: "merge" })]);
    const accept = acceptDrop(mock.input, held);

    expect(accept(other)).toBe(true);
    expect(accept(held)).toBe(false);
  });

  it("refuses a drop target that plays its exit and a view with no drop target", () => {
    const mock = createMockInput();
    const exiting = mock.spawn([DropTarget({ intent: "merge" }), Exiting()]);
    const plain = mock.spawn([Tappable({ intent: "found" })]);
    const accept = acceptDrop(mock.input, undefined);

    expect(accept(exiting)).toBe(false);
    expect(accept(plain)).toBe(false);
  });
});

describe("findPressed and findDropTarget", () => {
  it("returns the topmost accepted entity under the point", () => {
    const mock = createMockInput();
    const under = mock.spawn([Tappable({ intent: "miss" })]);
    const over = mock.spawn([Tappable({ intent: "found" })]);

    mock.boxes.push(
      { entity: under, x: 0, y: 0, width: 100, height: 100 },
      { entity: over, x: 40, y: 40, width: 20, height: 20 }
    );

    expect(findPressed(mock.input, 50, 50)).toBe(over);
    expect(findPressed(mock.input, 10, 10)).toBe(under);
    expect(findPressed(mock.input, 500, 500)).toBeUndefined();
  });

  it("skips the held view when it looks for a drop target", () => {
    const mock = createMockInput();
    const cell = mock.spawn([DropTarget({ intent: "move" })]);
    const held = mock.spawn([Draggable({}), DropTarget({ intent: "merge" })]);

    mock.boxes.push(
      { entity: cell, x: 0, y: 0, width: 100, height: 100 },
      { entity: held, x: 40, y: 40, width: 20, height: 20 }
    );

    expect(findDropTarget(mock.input, 50, 50, held)).toBe(cell);
    expect(findDropTarget(mock.input, 50, 50, undefined)).toBe(held);
  });
});

describe("acceptPress and the Touchable tag", () => {
  it("takes a view that only carries Touchable, the way a ui button does", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Touchable()]);

    expect(acceptPress(mock.input, entity)).toBe(true);
  });

  it("refuses a Touchable view that plays its exit", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Touchable(), Exiting()]);

    expect(acceptPress(mock.input, entity)).toBe(false);
  });
});
