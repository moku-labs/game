import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { Exiting } from "../../../world/ecs/define";
import { Draggable, DropTarget, Held, Hovered } from "../../components";
import { abortDrag, grab, moveHeld, moveHover, release } from "../../drag";
import { createMockInput, type MockInput } from "./mock-input";

// Spawns a draggable item with a projection key and grabs it at the given point.
function grabbed(
  mock: MockInput,
  at: { x: number; y: number },
  point: { x: number; y: number }
): number {
  const entity = mock.spawn(
    [Draggable({ payload: { from: "c2" } }), Transform({ x: at.x, y: at.y })],
    { projection: "board.items", key: "i5" }
  );

  mock.state.entity = entity;
  mock.state.phase = "dragging";
  grab(mock.input, entity, point);

  return entity;
}

describe("grab", () => {
  it("tags, mutes, lifts and tells the gate, in that order", () => {
    const mock = createMockInput();

    grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });

    expect(mock.calls).toEqual(["tag:Held", "mute", "lift:true", "pointer:true"]);
  });

  it("keeps the offset between the view and the finger, so a sliding view does not jump", () => {
    const mock = createMockInput();
    const entity = grabbed(mock, { x: 80, y: 20 }, { x: 50, y: 50 });

    expect(mock.state.grabOffset).toEqual({ x: 30, y: -30 });

    moveHeld(mock.input, { x: 150, y: 150 });

    expect(mock.read(entity, Transform)).toMatchObject({ x: 180, y: 120 });
  });

  it("falls back to the finger when the view carries no Transform", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Draggable({})], { projection: "board.items", key: "i5" });

    mock.state.entity = entity;
    grab(mock.input, entity, { x: 40, y: 60 });

    expect(mock.state.grabOffset).toEqual({ x: 0, y: 0 });
  });
});

describe("moveHeld", () => {
  it("does nothing when no view is held", () => {
    const mock = createMockInput();

    expect(() => moveHeld(mock.input, { x: 10, y: 10 })).not.toThrow();
    expect(mock.calls).toEqual([]);
  });
});

describe("moveHover", () => {
  it("moves the tag to the topmost drop target and never onto the held view", () => {
    const mock = createMockInput();
    const held = grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });
    const left = mock.spawn([DropTarget({ intent: "move" })]);
    const right = mock.spawn([DropTarget({ intent: "merge" })]);

    mock.boxes.push(
      { entity: held, x: 0, y: 0, width: 100, height: 100 },
      { entity: left, x: 100, y: 0, width: 100, height: 100 },
      { entity: right, x: 200, y: 0, width: 100, height: 100 }
    );

    moveHover(mock.input, { x: 50, y: 50 });
    expect(mock.state.hovered).toBeUndefined();

    moveHover(mock.input, { x: 150, y: 50 });
    expect(mock.state.hovered).toBe(left);
    expect(mock.has(left, Hovered)).toBe(true);

    moveHover(mock.input, { x: 250, y: 50 });
    expect(mock.has(left, Hovered)).toBe(false);
    expect(mock.has(right, Hovered)).toBe(true);

    moveHover(mock.input, { x: 250, y: 50 });
    expect(mock.calls.filter(call => call === "tag:Hovered")).toHaveLength(2);
  });
});

describe("release", () => {
  it("answers the drop, unmutes and leaves the settle out when the gate took it", () => {
    const mock = createMockInput();
    const held = grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });
    const cell = mock.spawn([DropTarget({ intent: "merge", payload: { to: "c3" } })]);

    mock.boxes.push({ entity: cell, x: 100, y: 0, width: 100, height: 100 });
    mock.calls.length = 0;

    release(mock.input, { x: 150, y: 50 });

    expect(mock.answers).toEqual([{ intent: "merge", payload: { from: "c2", to: "c3" } }]);
    expect(mock.calls).toEqual(["answer", "unmute", "lift:false", "untag:Held", "pointer:false"]);
    expect(mock.has(held, Held)).toBe(false);
  });

  it("settles the view home when the gate refused the answer, after the unmute", () => {
    const mock = createMockInput();

    grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });

    const cell = mock.spawn([DropTarget({ intent: "merge" })]);

    mock.boxes.push({ entity: cell, x: 100, y: 0, width: 100, height: 100 });
    mock.gate.open = false;
    mock.calls.length = 0;

    release(mock.input, { x: 150, y: 50 });

    expect(mock.calls.indexOf("unmute")).toBeLessThan(mock.calls.indexOf("settle"));
    expect(mock.calls).toContain("settle");
  });

  it("settles the view home when the finger let go over nothing", () => {
    const mock = createMockInput();

    grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });
    mock.calls.length = 0;

    release(mock.input, { x: 900, y: 900 });

    expect(mock.answers).toEqual([]);
    expect(mock.calls).toEqual(["unmute", "settle", "lift:false", "untag:Held", "pointer:false"]);
  });

  it("settles the view home when the release carries no point at all", () => {
    const mock = createMockInput();

    grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });
    mock.calls.length = 0;

    release(mock.input, undefined);

    expect(mock.answers).toEqual([]);
    expect(mock.calls).toContain("settle");
  });

  it("drops the hover tag it set", () => {
    const mock = createMockInput();
    const held = grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });
    const cell = mock.spawn([DropTarget({ intent: "merge" })]);

    mock.boxes.push(
      { entity: held, x: 0, y: 0, width: 100, height: 100 },
      { entity: cell, x: 100, y: 0, width: 100, height: 100 }
    );
    moveHover(mock.input, { x: 150, y: 50 });
    release(mock.input, { x: 150, y: 50 });

    expect(mock.has(cell, Hovered)).toBe(false);
    expect(mock.state.hovered).toBeUndefined();
  });

  it("does nothing when no view is held", () => {
    const mock = createMockInput();

    release(mock.input, { x: 0, y: 0 });

    expect(mock.calls).toEqual([]);
  });
});

describe("abortDrag", () => {
  it("unmutes, untags and frees the gate without answering or settling", () => {
    const mock = createMockInput();
    const held = grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });

    mock.spawn([Exiting()]);
    mock.calls.length = 0;
    abortDrag(mock.input);

    expect(mock.answers).toEqual([]);
    expect(mock.calls).toEqual(["unmute", "untag:Held", "pointer:false"]);
    expect(mock.has(held, Held)).toBe(false);
  });

  it("is safe after the entity left the world", () => {
    const mock = createMockInput();
    const held = grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });

    mock.kill(held);
    mock.calls.length = 0;

    expect(() => abortDrag(mock.input)).not.toThrow();
    expect(mock.calls).toEqual(["unmute", "pointer:false"]);
  });
});
