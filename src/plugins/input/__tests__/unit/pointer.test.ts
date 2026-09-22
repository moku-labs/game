import { describe, expect, it } from "vitest";
import { attach, detach, record } from "../../pointer";
import type { RawSample } from "../../types";
import { createMockInput, createStubCanvas } from "./mock-input";

const move = (pointerId: number, clientX: number): RawSample => ({
  kind: "move",
  pointerId,
  clientX,
  clientY: 0
});

describe("record", () => {
  it("keeps every sample of different kinds in order", () => {
    const mock = createMockInput();

    record(mock.state, { kind: "down", pointerId: 1, clientX: 10, clientY: 10 });
    record(mock.state, move(1, 20));
    record(mock.state, { kind: "up", pointerId: 1, clientX: 30, clientY: 10 });

    expect(mock.state.samples.map(sample => sample.kind)).toEqual(["down", "move", "up"]);
  });

  it("replaces a trailing move of the same pointer, so the queue stays short", () => {
    const mock = createMockInput();

    record(mock.state, move(1, 10));
    record(mock.state, move(1, 20));
    record(mock.state, move(1, 30));

    expect(mock.state.samples).toHaveLength(1);
    expect(mock.state.samples[0]?.clientX).toBe(30);
  });

  it("keeps a move of another pointer instead of replacing", () => {
    const mock = createMockInput();

    record(mock.state, move(1, 10));
    record(mock.state, move(2, 20));

    expect(mock.state.samples).toHaveLength(2);
  });
});

describe("attach and detach", () => {
  it("adds the five pointer listeners and takes the browser gestures away", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    attach(canvas.element, mock.state);

    expect(canvas.names()).toEqual([
      "lostpointercapture",
      "pointercancel",
      "pointerdown",
      "pointermove",
      "pointerup"
    ]);
    expect(canvas.style.touchAction).toBe("none");
  });

  it("turns every listened event into one raw sample and nothing else", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    attach(canvas.element, mock.state);
    canvas.dispatch("pointerdown", { pointerId: 3, clientX: 100, clientY: 200 });
    canvas.dispatch("pointerup", { pointerId: 3, clientX: 100, clientY: 200 });
    canvas.dispatch("pointercancel", { pointerId: 3, clientX: 0, clientY: 0 });
    canvas.dispatch("lostpointercapture", { pointerId: 3, clientX: 0, clientY: 0 });

    expect(mock.state.samples.map(sample => sample.kind)).toEqual([
      "down",
      "up",
      "cancel",
      "cancel"
    ]);
    expect(mock.state.samples[0]).toEqual({
      kind: "down",
      pointerId: 3,
      clientX: 100,
      clientY: 200
    });
    expect(mock.calls).toEqual([]);
  });

  it("removes every listener and restores the touch action", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    attach(canvas.element, mock.state);
    detach(mock.state);

    expect(canvas.names()).toEqual([]);
    expect(canvas.style.touchAction).toBe("auto");

    canvas.dispatch("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    expect(mock.state.samples).toEqual([]);
  });

  it("is a no-op when nothing was attached", () => {
    const mock = createMockInput();

    expect(() => detach(mock.state)).not.toThrow();
    expect(mock.state.detach).toBeUndefined();
  });
});

describe("record and the idle cap", () => {
  it("wakes time once per queued sample, so the loop leaves the idle rate", () => {
    const mock = createMockInput();

    mock.start();
    record(mock.state, { kind: "down", pointerId: 1, clientX: 10, clientY: 10 });
    record(mock.state, move(1, 20));

    expect(mock.wake).toHaveBeenCalledTimes(2);
  });

  it("wakes time for a coalesced move too", () => {
    const mock = createMockInput();

    mock.start();
    record(mock.state, move(1, 10));
    record(mock.state, move(1, 20));

    expect(mock.state.samples).toHaveLength(1);
    expect(mock.wake).toHaveBeenCalledTimes(2);
  });

  it("queues a sample before the plugin started, with nothing to wake", () => {
    const mock = createMockInput();

    expect(() => record(mock.state, move(1, 10))).not.toThrow();
    expect(mock.wake).not.toHaveBeenCalled();
  });
});
