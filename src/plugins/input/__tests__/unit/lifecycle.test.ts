import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { Draggable, Tappable } from "../../components";
import { initInput, stopInput } from "../../lifecycle";
import { record } from "../../pointer";
import { createMockInput, createStubCanvas } from "./mock-input";

describe("initInput", () => {
  it("registers the frame step in phase input", () => {
    const mock = createMockInput();

    initInput(mock.ctx);

    expect(mock.frames).toHaveLength(1);
    expect(mock.frames[0]?.phase).toBe("input");
    expect(mock.state.offFrame).toBeInstanceOf(Function);
  });
});

describe("startInput", () => {
  it("stays inert without a canvas and still answers through the API", () => {
    const mock = createMockInput();

    mock.start();

    expect(mock.state.canvas).toBeUndefined();
    expect(mock.state.detach).toBeUndefined();
    expect(() => mock.frame()).not.toThrow();
  });

  it("attaches the pointer listeners to the canvas the host offers", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    mock.canvas.current = canvas.element;
    mock.start();

    expect(mock.state.canvas).toBe(canvas.element);
    expect(canvas.names()).toHaveLength(5);

    canvas.dispatch("pointerdown", { pointerId: 1, clientX: 10, clientY: 10 });
    expect(mock.state.samples).toHaveLength(1);
  });
});

describe("the frame step against a changing canvas", () => {
  it("re-attaches when a device restore handed over a new canvas", () => {
    const mock = createMockInput();
    const first = createStubCanvas();
    const second = createStubCanvas();

    mock.canvas.current = first.element;
    mock.start();
    mock.canvas.current = second.element;
    mock.frame();

    expect(first.names()).toEqual([]);
    expect(second.names()).toHaveLength(5);
    expect(mock.state.canvas).toBe(second.element);
  });

  it("detaches when the host lost its canvas", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    mock.canvas.current = canvas.element;
    mock.start();
    mock.canvas.current = undefined;
    mock.frame();

    expect(canvas.names()).toEqual([]);
    expect(canvas.style.touchAction).toBe("auto");
    expect(mock.state.canvas).toBeUndefined();
  });

  it("cancels a running drag when the canvas is replaced, so the view settles home", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();
    const entity = mock.spawn([Draggable({}), Transform({ x: 50, y: 50 })], {
      projection: "board.items",
      key: "i5"
    });

    mock.boxes.push({ entity, x: 0, y: 0, width: 200, height: 200 });
    mock.canvas.current = canvas.element;
    mock.start();

    record(mock.state, { kind: "down", pointerId: 1, clientX: 50, clientY: 50 });
    mock.frame();
    record(mock.state, { kind: "move", pointerId: 1, clientX: 90, clientY: 50 });
    mock.frame();

    expect(mock.state.phase).toBe("dragging");

    mock.canvas.current = createStubCanvas().element;
    mock.frame();

    expect(mock.state.phase).toBe("idle");
    expect(mock.calls).toContain("settle");
  });

  it("captures the pointer on the new canvas and survives a pointer that is already gone", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    mock.canvas.current = canvas.element;
    mock.start();
    mock.spawn([Tappable({ intent: "found" })]);
    canvas.flags.capturable = false;
    record(mock.state, { kind: "down", pointerId: 7, clientX: 10, clientY: 10 });

    expect(() => mock.frame()).not.toThrow();
    expect(canvas.captured).toEqual([]);

    canvas.flags.capturable = true;
    record(mock.state, { kind: "up", pointerId: 7, clientX: 10, clientY: 10 });
    mock.frame();

    expect(canvas.released).toEqual([7]);
  });
});

describe("stopInput", () => {
  it("removes the listeners, the frame callback and a mute a drag still holds", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    mock.canvas.current = canvas.element;
    mock.start();
    mock.state.unmute = () => mock.calls.push("unmute");
    stopInput(mock.state);

    expect(canvas.names()).toEqual([]);
    expect(mock.frames).toHaveLength(0);
    expect(mock.calls).toEqual(["unmute"]);
    expect(mock.state.canvas).toBeUndefined();
    expect(mock.state.samples).toEqual([]);
    expect(mock.state.phase).toBe("idle");
  });

  it("is safe when the plugin stayed inert", () => {
    const mock = createMockInput();

    mock.start();

    expect(() => stopInput(mock.state)).not.toThrow();
  });
});
