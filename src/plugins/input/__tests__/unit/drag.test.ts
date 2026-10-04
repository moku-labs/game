import { describe, expect, it } from "vitest";
import { Parent, Transform, type TransformValue } from "../../../renderer/components";
import { rootPoseOf } from "../../../renderer/sync/pose";
import { Exiting } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Draggable, DropTarget, Held, Hovered } from "../../components";
import { abortDrag, grab, moveHeld, moveHover, release } from "../../drag";
import { stopInput } from "../../lifecycle";
import { record } from "../../pointer";
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
  it("answers the drop, unmutes and still settles: the node may refuse with no state change", () => {
    const mock = createMockInput();
    const held = grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });
    const cell = mock.spawn([DropTarget({ intent: "merge", payload: { to: "c3" } })]);

    mock.boxes.push({ entity: cell, x: 100, y: 0, width: 100, height: 100 });
    mock.calls.length = 0;

    release(mock.input, { x: 150, y: 50 });

    expect(mock.answers).toEqual([{ intent: "merge", payload: { from: "c2", to: "c3" } }]);
    expect(mock.calls).toEqual([
      "answer",
      "unmute",
      "settle",
      "lift:false",
      "untag:Held",
      "pointer:false"
    ]);
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

// A board slot at (40, 60) scaled 0.5 holds an item at (100, 200): on screen it sits at (90, 160).
function parented(mock: MockInput): { slot: number; item: number } {
  const slot = mock.spawn([Transform({ x: 40, y: 60, scale: 0.5 })]);
  const item = mock.spawn(
    [
      Draggable({ payload: { from: "c2" } }),
      Transform({ x: 100, y: 200 }),
      Parent({ entity: slot })
    ],
    { projection: "board.items", key: "i5" }
  );

  mock.state.entity = item;
  mock.state.phase = "dragging";
  grab(mock.input, item, { x: 90, y: 160 });

  return { slot, item };
}

describe("the drag of a parented view", () => {
  it("takes the view out of its parent at its root pose before the lift, and keeps it Held", () => {
    const mock = createMockInput();
    const { slot, item } = parented(mock);

    expect(mock.has(item, Parent)).toBe(false);
    expect(mock.state.parent).toBe(slot);
    expect(mock.read(item, Transform)).toMatchObject({ x: 90, y: 160, rotation: 0, scale: 0.5 });
    expect(mock.has(item, Held)).toBe(true);
    expect(mock.calls).toEqual([
      "tag:Held",
      "remove:Parent",
      "set:Transform",
      "mute",
      "lift:true",
      "pointer:true"
    ]);
  });

  it("owns the whole root pose while the view is out of its parent; a plain view only x and y", () => {
    const lifted = createMockInput();
    const plain = createMockInput();

    parented(lifted);
    grabbed(plain, { x: 50, y: 50 }, { x: 50, y: 50 });

    expect(lifted.muted).toEqual([["x", "y", "rotation", "scale"]]);
    expect(plain.muted).toEqual([["x", "y"]]);
  });

  it("follows the finger 1:1 in root space although the parent is scaled", () => {
    const mock = createMockInput();
    const { item } = parented(mock);

    moveHeld(mock.input, { x: 190, y: 260 });

    expect(mock.state.grabOffset).toEqual({ x: 0, y: 0 });
    expect(mock.read(item, Transform)).toMatchObject({ x: 190, y: 260, scale: 0.5 });
    expect(mock.has(item, Held)).toBe(true);
  });

  it("hangs the view back under its parent on the drop, at the local pose under the finger", () => {
    const mock = createMockInput();
    const { slot, item } = parented(mock);

    moveHeld(mock.input, { x: 190, y: 260 });
    mock.calls.length = 0;
    release(mock.input, { x: 900, y: 900 });

    expect(mock.read(item, Parent)).toEqual({ entity: slot });
    expect(mock.read(item, Transform)).toMatchObject({ x: 300, y: 400, rotation: 0, scale: 1 });
    expect(mock.state.parent).toBeUndefined();
    expect(mock.calls).toEqual([
      "add:Parent",
      "set:Transform",
      "unmute",
      "settle",
      "lift:false",
      "untag:Held",
      "pointer:false"
    ]);
  });

  it("hangs the view back before the drop answer, so a commit retargets it from under the finger", () => {
    const mock = createMockInput();
    const { item } = parented(mock);
    const cell = mock.spawn([DropTarget({ intent: "merge", payload: { to: "c3" } })]);

    mock.boxes.push({ entity: cell, x: 100, y: 0, width: 100, height: 100 });
    moveHeld(mock.input, { x: 150, y: 50 });
    mock.calls.length = 0;
    release(mock.input, { x: 150, y: 50 });

    expect(mock.answers).toEqual([{ intent: "merge", payload: { from: "c2", to: "c3" } }]);
    expect(mock.calls.indexOf("add:Parent")).toBeLessThan(mock.calls.indexOf("answer"));
    expect(mock.read(item, Transform)).toMatchObject({ x: 220, y: -20, scale: 1 });
  });

  it("hangs the view back on a cancel, right where it was picked up", () => {
    const mock = createMockInput();
    const { slot, item } = parented(mock);

    release(mock.input);

    expect(mock.read(item, Parent)).toEqual({ entity: slot });
    expect(mock.read(item, Transform)).toMatchObject({ x: 100, y: 200, rotation: 0, scale: 1 });
  });

  it("round-trips a view whose parent turns, scales and has a pivot", () => {
    const mock = createMockInput();
    const slot = mock.spawn([
      Transform({ x: 500, y: 300, rotation: Math.PI / 2, scale: 2, pivot: { x: 10, y: 0 } })
    ]);
    const item = mock.spawn(
      [Draggable({}), Transform({ x: 30, y: 40, pivot: { x: 5, y: 5 } }), Parent({ entity: slot })],
      { projection: "board.items", key: "i5" }
    );

    mock.state.entity = item;
    grab(mock.input, item, { x: 420, y: 340 });

    const root = mock.read(item, Transform) as { x: number; y: number; rotation: number };

    expect(root.x).toBeCloseTo(420);
    expect(root.y).toBeCloseTo(340);
    expect(root.rotation).toBeCloseTo(Math.PI / 2);

    release(mock.input);

    const local = mock.read(item, Transform) as { x: number; y: number; rotation: number };

    expect(local.x).toBeCloseTo(30);
    expect(local.y).toBeCloseTo(40);
    expect(local.rotation).toBeCloseTo(0);
    expect(mock.read(item, Transform)).toMatchObject({ scale: 1, pivot: { x: 5, y: 5 } });
  });

  it("hangs a view that plays its exit back under its parent when the drag is given up", () => {
    const mock = createMockInput();
    const { slot, item } = parented(mock);

    mock.attachTo(item, Exiting());
    mock.calls.length = 0;
    abortDrag(mock.input);

    expect(mock.read(item, Parent)).toEqual({ entity: slot });
    expect(mock.calls).toEqual([
      "unmute",
      "add:Parent",
      "set:Transform",
      "untag:Held",
      "pointer:false"
    ]);
  });

  it("forgets the parent when the held view is gone", () => {
    const mock = createMockInput();
    const { item } = parented(mock);

    mock.kill(item);
    mock.calls.length = 0;
    abortDrag(mock.input);

    expect(mock.state.parent).toBeUndefined();
    expect(mock.calls).toEqual(["unmute", "pointer:false"]);
  });

  it("keeps the root pose when the parent left the world during the drag", () => {
    const mock = createMockInput();
    const { slot, item } = parented(mock);

    mock.kill(slot);
    release(mock.input, { x: 900, y: 900 });

    expect(mock.has(item, Parent)).toBe(false);
    expect(mock.read(item, Transform)).toMatchObject({ x: 90, y: 160, scale: 0.5 });
    expect(mock.state.parent).toBeUndefined();
  });

  it("carries a parented view with the finger through the frame step and hangs it back on the up", () => {
    const mock = createMockInput();
    const slot = mock.spawn([Transform({ x: 40, y: 60, scale: 0.5 })]);
    const item = mock.spawn(
      [Draggable({}), Transform({ x: 100, y: 200 }), Parent({ entity: slot })],
      { projection: "board.items", key: "i5" }
    );
    const at = (kind: "down" | "move" | "up", x: number, y: number): void =>
      record(mock.state, { kind, pointerType: "touch", pointerId: 1, clientX: x, clientY: y });

    mock.boxes.push({ entity: item, x: 80, y: 150, width: 20, height: 20 });
    mock.start();
    at("down", 90, 160);
    mock.frame();
    at("move", 140, 210);
    mock.frame();

    // The grab keeps the offset of the drag start: the view stays put, 50 px behind the finger.
    expect(mock.has(item, Parent)).toBe(false);
    expect(mock.read(item, Transform)).toMatchObject({ x: 90, y: 160, scale: 0.5 });

    at("move", 190, 260);
    mock.frame();

    // The finger moved 50 px, so did the view: 1:1, not 0.5 times.
    expect(mock.read(item, Transform)).toMatchObject({ x: 140, y: 210 });

    at("up", 190, 260);
    mock.frame();

    expect(mock.read(item, Parent)).toEqual({ entity: slot });
    expect(mock.read(item, Transform)).toMatchObject({ x: 200, y: 300, scale: 1 });
    expect(mock.has(item, Held)).toBe(false);
  });
});

describe("the lifted look of the view in the hand (heldScale)", () => {
  it("carries a plain view at its scale times heldScale and owns the scale for the drag", () => {
    const mock = createMockInput({ heldScale: 1.08 });
    const item = grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });

    expect(mock.read(item, Transform)).toMatchObject({ x: 50, y: 50 });
    expect((mock.read(item, Transform) as { scale: number }).scale).toBeCloseTo(1.08, 10);
    expect(mock.muted).toEqual([["x", "y", "scale"]]);
    expect(mock.calls).toEqual(["tag:Held", "set:Transform", "mute", "lift:true", "pointer:true"]);
  });

  it("carries a parented view at its root scale times heldScale, where it was picked up", () => {
    const mock = createMockInput({ heldScale: 1.08 });
    const { item } = parented(mock);

    expect(mock.read(item, Transform)).toMatchObject({ x: 90, y: 160, rotation: 0 });
    expect((mock.read(item, Transform) as { scale: number }).scale).toBeCloseTo(0.54, 10);
    expect(mock.muted).toEqual([["x", "y", "rotation", "scale"]]);
  });

  it("keeps the lifted scale while the finger moves the view", () => {
    const mock = createMockInput({ heldScale: 1.08 });
    const { item } = parented(mock);

    moveHeld(mock.input, { x: 190, y: 260 });

    expect(mock.read(item, Transform)).toMatchObject({ x: 190, y: 260 });
    expect((mock.read(item, Transform) as { scale: number }).scale).toBeCloseTo(0.54, 10);
  });

  it("writes the scale of the grab back on the drop, so the way home starts unscaled", () => {
    const plain = createMockInput({ heldScale: 1.08 });
    const lifted = createMockInput({ heldScale: 1.08 });
    const item = grabbed(plain, { x: 50, y: 50 }, { x: 50, y: 50 });
    const { slot, item: hosted } = parented(lifted);

    release(plain.input, { x: 900, y: 900 });
    moveHeld(lifted.input, { x: 190, y: 260 });
    release(lifted.input, { x: 900, y: 900 });

    expect(plain.read(item, Transform)).toMatchObject({ x: 50, y: 50, scale: 1 });
    expect(lifted.read(hosted, Parent)).toEqual({ entity: slot });
    expect(lifted.read(hosted, Transform)).toMatchObject({ x: 300, y: 400, rotation: 0, scale: 1 });
    expect(lifted.state.restScale).toBeUndefined();
  });

  it("writes the scale back before the drop answer, so a commit retargets an unscaled view", () => {
    const mock = createMockInput({ heldScale: 1.08 });
    const item = grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });
    const cell = mock.spawn([DropTarget({ intent: "merge", payload: { to: "c3" } })]);

    mock.boxes.push({ entity: cell, x: 100, y: 0, width: 100, height: 100 });
    mock.calls.length = 0;
    release(mock.input, { x: 150, y: 50 });

    expect(mock.calls.indexOf("set:Transform")).toBeLessThan(mock.calls.indexOf("answer"));
    expect(mock.read(item, Transform)).toMatchObject({ scale: 1 });
  });

  it("writes the scale back on a cancel and when the drag is given up", () => {
    const cancelled = createMockInput({ heldScale: 1.08 });
    const aborted = createMockInput({ heldScale: 1.08 });
    const { item } = parented(cancelled);
    const { slot, item: exiting } = parented(aborted);

    release(cancelled.input);
    aborted.attachTo(exiting, Exiting());
    abortDrag(aborted.input);

    expect(cancelled.read(item, Transform)).toMatchObject({ x: 100, y: 200, scale: 1 });
    expect(aborted.read(exiting, Parent)).toEqual({ entity: slot });
    expect(aborted.read(exiting, Transform)).toMatchObject({ x: 100, y: 200, scale: 1 });
    expect(aborted.state.restScale).toBeUndefined();
  });

  it("keeps the unscaled root pose when the parent left the world during the drag", () => {
    const mock = createMockInput({ heldScale: 1.08 });
    const { slot, item } = parented(mock);

    mock.kill(slot);
    release(mock.input, { x: 900, y: 900 });

    expect(mock.has(item, Parent)).toBe(false);
    expect(mock.read(item, Transform)).toMatchObject({ x: 90, y: 160, scale: 0.5 });
  });

  it("forgets the scale when the held view is gone", () => {
    const mock = createMockInput({ heldScale: 1.08 });
    const item = grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });

    mock.kill(item);
    mock.calls.length = 0;
    abortDrag(mock.input);

    expect(mock.state.restScale).toBeUndefined();
    expect(mock.calls).toEqual(["unmute", "pointer:false"]);
  });

  it("scales nothing on a view that carries no Transform", () => {
    const mock = createMockInput({ heldScale: 1.08 });
    const entity = mock.spawn([Draggable({})], { projection: "board.items", key: "i5" });

    mock.state.entity = entity;
    grab(mock.input, entity, { x: 40, y: 60 });

    expect(mock.state.restScale).toBeUndefined();
    expect(mock.calls).toEqual(["tag:Held", "mute", "lift:true", "pointer:true"]);
  });

  it("lifts a view squashed at the grab from its rest scale, and sets it down at rest", () => {
    const plain = createMockInput({ heldScale: 1.08 });
    const item = plain.spawn([Draggable({}), Transform({ x: 50, y: 50, scale: 0.94 })], {
      projection: "board.items",
      key: "i5"
    });

    plain.setRest(item, Transform({ x: 50, y: 50 }));
    plain.state.entity = item;
    grab(plain.input, item, { x: 50, y: 50 });

    expect((plain.read(item, Transform) as { scale: number }).scale).toBeCloseTo(1.08, 10);

    release(plain.input, { x: 900, y: 900 });

    expect(plain.read(item, Transform)).toMatchObject({ scale: 1 });
  });

  it("lifts a parented view squashed at the grab from its rest scale in root space", () => {
    const mock = createMockInput({ heldScale: 1.08 });
    const slot = mock.spawn([Transform({ x: 40, y: 60, scale: 0.5 })]);
    const item = mock.spawn(
      [Draggable({}), Transform({ x: 100, y: 200, scale: 0.94 }), Parent({ entity: slot })],
      { projection: "board.items", key: "i5" }
    );

    mock.setRest(item, Transform({ x: 100, y: 200 }));
    mock.state.entity = item;
    grab(mock.input, item, { x: 90, y: 160 });

    expect(mock.read(item, Transform)).toMatchObject({ x: 90, y: 160 });
    expect((mock.read(item, Transform) as { scale: number }).scale).toBeCloseTo(0.54, 10);

    release(mock.input);

    expect(mock.read(item, Parent)).toEqual({ entity: slot });
    expect(mock.read(item, Transform)).toMatchObject({ x: 100, y: 200, scale: 1 });
  });

  it("lifts a view with no recorded rest from the scale it has at the grab", () => {
    const mock = createMockInput({ heldScale: 1.08 });
    const item = mock.spawn([Draggable({}), Transform({ x: 50, y: 50, scale: 0.94 })], {
      projection: "board.items",
      key: "i5"
    });

    mock.state.entity = item;
    grab(mock.input, item, { x: 50, y: 50 });

    expect((mock.read(item, Transform) as { scale: number }).scale).toBeCloseTo(0.94 * 1.08, 10);
  });

  it("changes nothing with heldScale 1: no scale write, only x and y owned", () => {
    const mock = createMockInput({ heldScale: 1 });
    const item = grabbed(mock, { x: 50, y: 50 }, { x: 50, y: 50 });

    expect(mock.calls).toEqual(["tag:Held", "mute", "lift:true", "pointer:true"]);
    expect(mock.muted).toEqual([["x", "y"]]);
    expect(mock.state.restScale).toBeUndefined();

    mock.calls.length = 0;
    release(mock.input, { x: 900, y: 900 });

    expect(mock.read(item, Transform)).toMatchObject({ x: 50, y: 50, scale: 1 });
    expect(mock.calls).toEqual(["unmute", "settle", "lift:false", "untag:Held", "pointer:false"]);
  });

  it("carries the view lifted through the frame step and sets it down unscaled on the up", () => {
    const mock = createMockInput({ heldScale: 1.08 });
    const slot = mock.spawn([Transform({ x: 40, y: 60, scale: 0.5 })]);
    const item = mock.spawn(
      [Draggable({}), Transform({ x: 100, y: 200 }), Parent({ entity: slot })],
      { projection: "board.items", key: "i5" }
    );
    const at = (kind: "down" | "move" | "up", x: number, y: number): void =>
      record(mock.state, { kind, pointerType: "touch", pointerId: 1, clientX: x, clientY: y });

    mock.boxes.push({ entity: item, x: 80, y: 150, width: 20, height: 20 });
    mock.start();
    at("down", 90, 160);
    mock.frame();
    at("move", 140, 210);
    mock.frame();

    expect((mock.read(item, Transform) as { scale: number }).scale).toBeCloseTo(0.54, 10);

    at("up", 140, 210);
    mock.frame();

    expect(mock.read(item, Parent)).toEqual({ entity: slot });
    expect(mock.read(item, Transform)).toMatchObject({ x: 100, y: 200, scale: 1 });
  });
});

// A solitaire pile fanned 30 px: the finger takes c2 at (100, 130); c3 and c4 lie on top of it at
// 160 and 190 and ride along. Every card is a drop target, as in a real pile. The rest poses are
// recorded, so a settle lands each card on its own rest.
type Pile = { held: Entity; c3: Entity; c4: Entity };

/**
 * Spawns the pile; the held card carries the keys it is given.
 *
 * @param mock - The mock plugin.
 * @param carry - The projection keys the held card carries.
 * @returns The three cards.
 */
function pile(mock: MockInput, carry: readonly string[] = ["c3", "c4"]): Pile {
  const card = (key: string, y: number, extra: Parameters<MockInput["spawn"]>[0] = []): Entity => {
    const entity = mock.spawn(
      [Transform({ x: 100, y }), DropTarget({ intent: "stack", payload: { to: key } }), ...extra],
      { projection: "pile.cards", key }
    );

    mock.setRest(entity, Transform({ x: 100, y }));

    return entity;
  };
  const held = card("c2", 130, [Draggable({ payload: { from: "c2" }, carry })]);

  return { held, c3: card("c3", 160), c4: card("c4", 190) };
}

/**
 * Grabs the held card of a pile where it lies.
 *
 * @param mock - The mock plugin.
 * @param held - The held card.
 */
function grabPile(mock: MockInput, held: Entity): void {
  mock.state.entity = held;
  mock.state.phase = "dragging";
  grab(mock.input, held, { x: 100, y: 130 });
}

/**
 * Where a card really is.
 *
 * @param mock - The mock plugin.
 * @param entity - The card.
 * @returns Its pose in root space.
 */
function rootOf(mock: MockInput, entity: Entity): TransformValue {
  return rootPoseOf(mock.input.deps.world.ecs, entity);
}

describe("the carried stack", () => {
  it("hangs every carried card under the held card at its root pose, its pose muted", () => {
    const mock = createMockInput();
    const { held, c3, c4 } = pile(mock);

    grabPile(mock, held);

    expect(mock.trail).toEqual([
      `tag:Held:${held}`,
      `mute:${c3}`,
      `add:Parent:${c3}`,
      `set:Transform:${c3}`,
      `mute:${c4}`,
      `add:Parent:${c4}`,
      `set:Transform:${c4}`,
      `mute:${held}`,
      `lift:true:${held}`
    ]);
    expect(mock.read(c3, Parent)).toEqual({ entity: held });
    expect(mock.read(c3, Transform)).toMatchObject({ x: 0, y: 30 });
    expect(mock.read(c4, Transform)).toMatchObject({ x: 0, y: 60 });
    expect(mock.muted).toEqual([
      ["x", "y", "rotation", "scale"],
      ["x", "y", "rotation", "scale"],
      ["x", "y"]
    ]);
    expect(mock.state.carried.map(follower => [follower.entity, follower.parent])).toEqual([
      [c3, undefined],
      [c4, undefined]
    ]);
    expect(mock.has(c3, Held)).toBe(false);
  });

  it("writes the held card once per move and no follower at all: the wrapper carries them", () => {
    const mock = createMockInput();
    const { held, c3, c4 } = pile(mock);

    grabPile(mock, held);
    mock.trail.length = 0;
    moveHeld(mock.input, { x: 400, y: 300 });

    expect(mock.trail).toEqual([`set:Transform:${held}`]);
    expect(rootOf(mock, c3)).toMatchObject({ x: 400, y: 330 });
    expect(rootOf(mock, c4)).toMatchObject({ x: 400, y: 360 });
  });

  it("P17 bug 1 regression: a cancel sends each card to its own rest, never rest plus held rest", () => {
    const mock = createMockInput();
    const { held, c3, c4 } = pile(mock);

    grabPile(mock, held);
    moveHeld(mock.input, { x: 400, y: 300 });
    release(mock.input);

    expect(mock.has(c3, Parent)).toBe(false);
    expect(mock.has(c4, Parent)).toBe(false);
    expect(rootOf(mock, held).y).toBe(130);
    expect(rootOf(mock, c3).y).toBe(160);
    expect(rootOf(mock, c4).y).toBe(190);
    expect(mock.state.carried).toEqual([]);
  });

  it("P17 bug 2 regression: the drop lookup skips the whole stack and finds the target under it", () => {
    const mock = createMockInput();
    const { held, c3, c4 } = pile(mock);
    const column = mock.spawn([DropTarget({ intent: "move", payload: { to: "col3" } })]);

    mock.boxes.push(
      { entity: column, x: 0, y: 0, width: 300, height: 400 },
      { entity: held, x: 68, y: 98, width: 64, height: 64 },
      { entity: c3, x: 68, y: 128, width: 64, height: 64 },
      { entity: c4, x: 68, y: 158, width: 64, height: 64 }
    );
    grabPile(mock, held);
    moveHover(mock.input, { x: 100, y: 200 });

    expect(mock.state.hovered).toBe(column);
    expect(mock.has(c4, Hovered)).toBe(false);
    expect(mock.has(c3, Hovered)).toBe(false);

    release(mock.input, { x: 100, y: 200 });

    expect(mock.answers).toEqual([{ intent: "move", payload: { from: "c2", to: "col3" } }]);
  });

  it("names no carried key in the drop answer", () => {
    const mock = createMockInput();
    const { held } = pile(mock);
    const column = mock.spawn([DropTarget({ intent: "move", payload: { to: "col3" } })]);

    mock.boxes.push({ entity: column, x: 500, y: 0, width: 100, height: 100 });
    grabPile(mock, held);
    release(mock.input, { x: 550, y: 50 });

    expect(mock.answers).toEqual([{ intent: "move", payload: { from: "c2", to: "col3" } }]);
  });

  it("unparents every card before any settle, and unmutes each before its settle", () => {
    const mock = createMockInput();
    const { held, c3, c4 } = pile(mock);

    grabPile(mock, held);
    mock.trail.length = 0;
    release(mock.input);

    expect(mock.trail).toEqual([
      `remove:Parent:${c3}`,
      `set:Transform:${c3}`,
      `lift:true:${c3}`,
      `remove:Parent:${c4}`,
      `set:Transform:${c4}`,
      `lift:true:${c4}`,
      `unmute:${held}`,
      `unmute:${c3}`,
      `unmute:${c4}`,
      `settle:${held}`,
      `settle:${c3}`,
      `settle:${c4}`,
      `lift:false:${held}`,
      `lift:false:${c3}`,
      `lift:false:${c4}`,
      `untag:Held:${held}`
    ]);
  });

  it("warns once for an unknown key, the held key and a view with no Transform, and carries the rest", () => {
    const mock = createMockInput();
    const { held, c3 } = pile(mock, ["ghost", "c2", "c5", "c3"]);

    mock.spawn([DropTarget({ intent: "stack" })], { projection: "pile.cards", key: "c5" });
    grabPile(mock, held);

    const view = { projection: "pile.cards", key: "c2" };

    expect(mock.log.warn).toHaveBeenCalledTimes(3);
    expect(mock.log.warn).toHaveBeenCalledWith("input: carried key has no view", {
      view,
      key: "ghost"
    });
    expect(mock.log.warn).toHaveBeenCalledWith("input: carried key has no view", {
      view,
      key: "c2"
    });
    expect(mock.log.warn).toHaveBeenCalledWith("input: carried key has no view", {
      view,
      key: "c5"
    });
    expect(mock.state.carried.map(follower => follower.entity)).toEqual([c3]);
  });

  it("hangs the followers before the lifted scale, so the fan scales around the held pivot", () => {
    const mock = createMockInput({ heldScale: 1.08 });
    const { held, c3, c4 } = pile(mock);

    grabPile(mock, held);

    expect(mock.trail.indexOf(`add:Parent:${c4}`)).toBeLessThan(
      mock.trail.indexOf(`set:Transform:${held}`)
    );
    expect(rootOf(mock, c3).y).toBeCloseTo(130 + 30 * 1.08, 10);
    expect(rootOf(mock, c4).y).toBeCloseTo(130 + 60 * 1.08, 10);
    expect(rootOf(mock, c4).scale).toBeCloseTo(1.08, 10);

    release(mock.input);

    expect(rootOf(mock, c4)).toMatchObject({ x: 100, y: 190, scale: 1 });
  });

  it("takes a parented follower out at its root pose and hangs it back under its parent on the drop", () => {
    const mock = createMockInput();
    const { held, c3 } = pile(mock, ["c3"]);
    const slot = mock.spawn([Transform({ x: 40, y: 60, scale: 0.5 })]);

    // c3 sits in the slot: local (120, 200) is root (100, 160).
    mock.attachTo(c3, Parent({ entity: slot }));
    mock.attachTo(c3, Transform({ x: 120, y: 200 }));
    mock.setRest(c3, Transform({ x: 120, y: 200 }));
    grabPile(mock, held);

    expect(mock.read(c3, Parent)).toEqual({ entity: held });
    expect(rootOf(mock, c3)).toMatchObject({ x: 100, y: 160, scale: 0.5 });
    expect(mock.state.carried[0]?.parent).toBe(slot);

    moveHeld(mock.input, { x: 400, y: 300 });
    release(mock.input, { x: 900, y: 900 });

    expect(mock.read(c3, Parent)).toEqual({ entity: slot });
    expect(rootOf(mock, c3)).toMatchObject({ x: 100, y: 160, scale: 0.5 });
  });

  it("uncarries first when the drag is given up, settles the followers, and keeps the held steps", () => {
    const mock = createMockInput();
    const { held, c3, c4 } = pile(mock);

    grabPile(mock, held);
    mock.attachTo(held, Exiting());
    mock.trail.length = 0;
    abortDrag(mock.input);

    expect(mock.trail).toEqual([
      `remove:Parent:${c3}`,
      `set:Transform:${c3}`,
      `lift:true:${c3}`,
      `remove:Parent:${c4}`,
      `set:Transform:${c4}`,
      `lift:true:${c4}`,
      `unmute:${c3}`,
      `settle:${c3}`,
      `lift:false:${c3}`,
      `unmute:${c4}`,
      `settle:${c4}`,
      `lift:false:${c4}`,
      `unmute:${held}`,
      `untag:Held:${held}`
    ]);
    expect(rootOf(mock, c3).y).toBe(160);
    expect(mock.state.carried).toEqual([]);
  });

  it("lets a follower that left go mid-drag and carries on with the rest", () => {
    const mock = createMockInput();
    const { held, c3, c4 } = pile(mock);
    const at = (kind: "down" | "move", x: number, y: number): void =>
      record(mock.state, { kind, pointerType: "touch", pointerId: 1, clientX: x, clientY: y });

    mock.boxes.push({ entity: held, x: 68, y: 98, width: 64, height: 64 });
    mock.start();
    at("down", 100, 130);
    mock.frame();
    at("move", 120, 130);
    mock.frame();

    expect(mock.state.carried).toHaveLength(2);

    mock.kill(c3);
    mock.attachTo(c4, Exiting());
    mock.trail.length = 0;
    mock.frame();

    expect(mock.state.phase).toBe("dragging");
    expect(mock.state.carried).toEqual([]);
    expect(mock.trail).toEqual([
      `unmute:${c3}`,
      `unmute:${c4}`,
      `remove:Parent:${c4}`,
      `set:Transform:${c4}`,
      `set:Transform:${held}`
    ]);
    expect(mock.has(c4, Parent)).toBe(false);
    expect(rootOf(mock, c4)).toMatchObject({ x: 100, y: 190 });
  });

  it("lifts the followers' mutes on stop", () => {
    const mock = createMockInput();
    const { held, c3, c4 } = pile(mock);

    grabPile(mock, held);
    mock.trail.length = 0;
    stopInput(mock.state);

    expect(mock.trail).toEqual([`unmute:${held}`, `unmute:${c3}`, `unmute:${c4}`]);
    expect(mock.state.carried).toEqual([]);
  });
});
