import { describe, expect, it } from "vitest";
import { stopInput } from "../../lifecycle";
import { addPointerListener, attach, detach, record } from "../../pointer";
import type { RawSample } from "../../types";
import { createMockInput, createStubCanvas } from "./mock-input";

const move = (pointerId: number, clientX: number): RawSample => ({
  kind: "move",
  pointerType: "touch",
  pointerId,
  clientX,
  clientY: 0
});

describe("record", () => {
  it("keeps every sample of different kinds in order", () => {
    const mock = createMockInput();

    record(mock.state, {
      kind: "down",
      pointerType: "touch",
      pointerId: 1,
      clientX: 10,
      clientY: 10
    });
    record(mock.state, move(1, 20));
    record(mock.state, {
      kind: "up",
      pointerType: "touch",
      pointerId: 1,
      clientX: 30,
      clientY: 10
    });

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
  it("adds the six pointer listeners and takes the browser gestures away", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    attach(canvas.element, mock.input);

    expect(canvas.names()).toEqual([
      "lostpointercapture",
      "pointercancel",
      "pointerdown",
      "pointerleave",
      "pointermove",
      "pointerup"
    ]);
    expect(canvas.style.touchAction).toBe("none");
  });

  it("turns every listened event into one raw sample and nothing else", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    attach(canvas.element, mock.input);
    canvas.dispatch("pointerdown", {
      pointerType: "touch",
      pointerId: 3,
      clientX: 100,
      clientY: 200
    });
    canvas.dispatch("pointerup", { pointerId: 3, clientX: 100, clientY: 200 });
    canvas.dispatch("pointercancel", { pointerId: 3, clientX: 0, clientY: 0 });
    canvas.dispatch("lostpointercapture", { pointerId: 3, clientX: 0, clientY: 0 });

    expect(mock.state.samples.map(sample => sample.kind)).toEqual(["down", "up", "cancel", "lost"]);
    expect(mock.state.samples[0]).toEqual({
      kind: "down",
      pointerType: "touch",
      pointerId: 3,
      clientX: 100,
      clientY: 200
    });
    expect(mock.calls).toEqual([]);
  });

  it("queues the device of the event: a mouse, a touch or a pen, and a mouse when it is unknown", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    attach(canvas.element, mock.input);
    canvas.dispatch("pointerdown", { pointerType: "pen", pointerId: 1, clientX: 0, clientY: 0 });
    canvas.dispatch("pointerup", { pointerType: "touch", pointerId: 1, clientX: 0, clientY: 0 });
    canvas.dispatch("pointerdown", { pointerType: "mouse", pointerId: 2, clientX: 0, clientY: 0 });
    canvas.dispatch("pointerup", { pointerType: "", pointerId: 2, clientX: 0, clientY: 0 });

    expect(mock.state.samples.map(sample => sample.pointerType)).toEqual([
      "pen",
      "touch",
      "mouse",
      "mouse"
    ]);
  });

  it("turns the pointer leaving the canvas into a leave sample", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    attach(canvas.element, mock.input);
    canvas.dispatch("pointerleave", { pointerType: "mouse", pointerId: 1, clientX: 5, clientY: 6 });

    expect(mock.state.samples).toEqual([
      { kind: "leave", pointerType: "mouse", pointerId: 1, clientX: 5, clientY: 6 }
    ]);
  });

  it("removes every listener and restores the touch action", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    attach(canvas.element, mock.input);
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
    record(mock.state, {
      kind: "down",
      pointerType: "touch",
      pointerId: 1,
      clientX: 10,
      clientY: 10
    });
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

describe("pointerdown keeps the focus of a text field", () => {
  it("prevents the default of pointerdown once and of no other pointer event", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();

    attach(canvas.element, mock.input);

    const down = canvas.dispatch("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    const others = [
      "pointermove",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
      "pointerleave"
    ].map(name => canvas.dispatch(name, { pointerId: 1, clientX: 0, clientY: 0 }));

    expect(down.preventDefault).toHaveBeenCalledTimes(1);
    for (const event of others) expect(event.preventDefault).not.toHaveBeenCalled();
    expect(canvas.style.touchAction).toBe("none");
  });
});

describe("onPointer, the one synchronous door", () => {
  it("runs the listeners inside the DOM listener for down, up and cancel only", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();
    const kinds: string[] = [];

    attach(canvas.element, mock.input);
    addPointerListener(mock.state, sample => kinds.push(sample.kind));

    for (const name of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
      "pointerleave"
    ]) {
      canvas.dispatch(name, { pointerType: "touch", pointerId: 4, clientX: 30, clientY: 40 });
    }

    expect(kinds).toEqual(["down", "up", "cancel"]);
  });

  it("hands the raw sample, already queued, before any frame step", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();
    const seen: Array<{ sample: unknown; queued: number; frame: number }> = [];

    mock.start();
    attach(canvas.element, mock.input);
    addPointerListener(mock.state, sample => {
      seen.push({ sample, queued: mock.state.samples.length, frame: mock.time.frame });
    });
    canvas.dispatch("pointerup", { pointerType: "pen", pointerId: 2, clientX: 11, clientY: 22 });

    expect(seen).toEqual([
      {
        sample: { kind: "up", pointerType: "pen", pointerId: 2, clientX: 11, clientY: 22 },
        queued: 1,
        frame: 0
      }
    ]);
    expect(mock.answers).toEqual([]);
  });

  it("runs the listeners in registration order", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();
    const order: string[] = [];

    attach(canvas.element, mock.input);
    addPointerListener(mock.state, () => order.push("first"));
    addPointerListener(mock.state, () => order.push("second"));
    canvas.dispatch("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });

    expect(order).toEqual(["first", "second"]);
  });

  it("drops only the listener whose remover ran, and lets a listener remove itself", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();
    const order: string[] = [];
    const offFirst = addPointerListener(mock.state, () => order.push("first"));
    const offSelf = addPointerListener(mock.state, () => {
      order.push("self");
      offSelf();
    });

    addPointerListener(mock.state, () => order.push("last"));
    attach(canvas.element, mock.input);
    offFirst();
    offFirst();
    canvas.dispatch("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
    canvas.dispatch("pointerup", { pointerId: 1, clientX: 0, clientY: 0 });

    expect(order).toEqual(["self", "last", "last"]);
  });

  it("logs a throwing listener with the kind and still runs the next one", () => {
    const mock = createMockInput();
    const canvas = createStubCanvas();
    const error = new Error("broken");
    const kinds: string[] = [];

    attach(canvas.element, mock.input);
    addPointerListener(mock.state, () => {
      throw error;
    });
    addPointerListener(mock.state, sample => kinds.push(sample.kind));
    canvas.dispatch("pointercancel", { pointerId: 1, clientX: 0, clientY: 0 });

    expect(kinds).toEqual(["cancel"]);
    expect(mock.log.error).toHaveBeenCalledWith("input: an onPointer listener threw", {
      kind: "cancel",
      error
    });
  });

  it("is never called by record alone, the path a frame or a test takes", () => {
    const mock = createMockInput();
    const kinds: string[] = [];

    addPointerListener(mock.state, sample => kinds.push(sample.kind));
    record(mock.state, {
      kind: "down",
      pointerType: "touch",
      pointerId: 1,
      clientX: 0,
      clientY: 0
    });

    expect(kinds).toEqual([]);
  });

  it("empties the listener list on stop", () => {
    const mock = createMockInput();

    addPointerListener(mock.state, () => undefined);
    stopInput(mock.state);

    expect(mock.state.pointerListeners).toEqual([]);
  });
});
