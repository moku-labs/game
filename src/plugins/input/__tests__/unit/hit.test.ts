import { describe, expect, it } from "vitest";
import { Parent, Transform } from "../../../renderer/components";
import { Exiting } from "../../../world/ecs/define";
import {
  Draggable,
  DropTarget,
  Pressable,
  Swipeable,
  Tappable,
  Touchable,
  Traceable
} from "../../components";
import {
  acceptDrop,
  acceptPress,
  acceptTrace,
  findDropTarget,
  findPressed,
  findTraced,
  resolveTarget
} from "../../hit";
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
    const accept = acceptDrop(mock.input, [held]);

    expect(accept(other)).toBe(true);
    expect(accept(held)).toBe(false);
  });

  it("refuses a drop target that plays its exit and a view with no drop target", () => {
    const mock = createMockInput();
    const exiting = mock.spawn([DropTarget({ intent: "merge" }), Exiting()]);
    const plain = mock.spawn([Tappable({ intent: "found" })]);
    const accept = acceptDrop(mock.input, []);

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

    expect(findDropTarget(mock.input, 50, 50, [held])).toBe(cell);
    expect(findDropTarget(mock.input, 50, 50, [])).toBe(held);
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

describe("acceptDrop and the carried stack", () => {
  it("refuses every entity of the excluded list: the held view and each carried one", () => {
    const mock = createMockInput();
    const held = mock.spawn([DropTarget({ intent: "stack" })]);
    const c3 = mock.spawn([DropTarget({ intent: "stack" })]);
    const c4 = mock.spawn([DropTarget({ intent: "stack" })]);
    const column = mock.spawn([DropTarget({ intent: "move" })]);
    const accept = acceptDrop(mock.input, [held, c3, c4]);

    expect([held, c3, c4].map(entity => accept(entity))).toEqual([false, false, false]);
    expect(accept(column)).toBe(true);
  });
});

// A 64 x 64 cell centred on (100, 100): the inset circle has a radius of 0.4 x 64 = 25.6 px.
function cell(
  mock: ReturnType<typeof createMockInput>,
  values: Parameters<typeof mock.spawn>[0] = []
): number {
  const entity = mock.spawn([
    Transform({ x: 100, y: 100 }),
    Traceable({ intent: "word" }),
    ...values
  ]);

  mock.boxes.push({ entity, x: 68, y: 68, width: 64, height: 64 });
  mock.setHitBox(entity, { x: -32, y: -32, width: 64, height: 64 });

  return entity;
}

describe("acceptTrace and findTraced", () => {
  it("takes a Traceable at the centre and refuses a box corner outside 0.4 x the short side", () => {
    const mock = createMockInput();
    const entity = cell(mock);

    expect(acceptTrace(mock.input, { x: 100, y: 100 })(entity)).toBe(true);
    expect(acceptTrace(mock.input, { x: 125, y: 100 })(entity)).toBe(true);
    expect(acceptTrace(mock.input, { x: 125, y: 125 })(entity)).toBe(false);
    expect(findTraced(mock.input, { x: 100, y: 100 })).toBe(entity);
    expect(findTraced(mock.input, { x: 128, y: 128 })).toBeUndefined();
  });

  it("refuses a cell that plays its exit, a view with no Traceable and a view with no hit box", () => {
    const mock = createMockInput();
    const exiting = cell(mock, [Exiting()]);
    const plain = mock.spawn([Transform({ x: 100, y: 100 }), Tappable({ intent: "pick" })]);
    const unseen = mock.spawn([Transform({ x: 100, y: 100 }), Traceable({ intent: "word" })]);
    const accept = acceptTrace(mock.input, { x: 100, y: 100 });

    mock.setHitBox(plain, { x: -32, y: -32, width: 64, height: 64 });

    expect([exiting, plain, unseen].map(entity => accept(entity))).toEqual([false, false, false]);
  });

  it("reads the point in the cell's own units, through its parent", () => {
    const mock = createMockInput();
    const slot = mock.spawn([Transform({ x: 40, y: 60, scale: 0.5 })]);
    const entity = cell(mock, [Parent({ entity: slot })]);

    // The cell centre (100, 100) inside the slot lands on (90, 110) on screen; the radius halves.
    expect(acceptTrace(mock.input, { x: 90, y: 110 })(entity)).toBe(true);
    expect(acceptTrace(mock.input, { x: 104, y: 110 })(entity)).toBe(false);
  });

  it("lets a Traceable take a press", () => {
    const mock = createMockInput();

    expect(acceptPress(mock.input, cell(mock))).toBe(true);
  });
});
