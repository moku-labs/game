import { describe, expect, it } from "vitest";
import { dropAnswer, submit, swipeAnswer, tapAnswer, traceAnswer } from "../../answers";
import { Draggable, DropTarget, Swipeable, Tappable } from "../../components";
import { createMockInput } from "./mock-input";

describe("tapAnswer", () => {
  it("answers with the intent and the payload of the component", () => {
    expect(tapAnswer(Tappable({ intent: "blast", payload: { cell: "c2" } }).value)).toEqual({
      intent: "blast",
      payload: { cell: "c2" }
    });
  });

  it("answers with an empty payload when the component brought none", () => {
    expect(tapAnswer(Tappable({ intent: "pick" }).value)).toEqual({ intent: "pick", payload: {} });
  });

  // Bug caught: a view that asks for the press point (F139) answers without it.
  it("adds the point to the payload of a view that asks for it, the point winning its key", () => {
    const value = Tappable({ intent: "kitTap", payload: { kit: "k1", point: "old" }, point: true });

    expect(tapAnswer(value.value, { x: 10, y: 60 })).toEqual({
      intent: "kitTap",
      payload: { kit: "k1", point: { x: 10, y: 60 } }
    });
  });

  // Bug caught: every tap answers a point, so a view that never asked changes its payload.
  it("ignores a point on a view without the flag and answers its own payload object", () => {
    const value = Tappable({ intent: "found", payload: { id: "lamp" } }).value;
    const answer = tapAnswer(value, { x: 10, y: 60 });

    expect(answer).toEqual({ intent: "found", payload: { id: "lamp" } });
    expect(answer.payload).toBe(value.payload);
  });

  // Bug caught: a flagged view's non-object payload is spread as is, or the point is lost.
  it("turns a payload that is not an object into one that holds only the point", () => {
    expect(tapAnswer({ intent: "kitTap", payload: "lamp", point: true }, { x: 1, y: 2 })).toEqual({
      intent: "kitTap",
      payload: { point: { x: 1, y: 2 } }
    });
  });

  // Bug caught: a flagged view tapped without a point (a keyboard tap) answers `point: undefined`.
  it("answers a flagged view without a point with its payload unchanged", () => {
    const answer = tapAnswer({ intent: "kitTap", payload: { kit: "k1" }, point: true });

    expect(answer.payload).toEqual({ kit: "k1" });
  });
});

describe("Tappable", () => {
  // Bug caught: the point flag gets a default value, so every saved Tappable serialises a new key.
  it("stores no point key unless a view asks for the point", () => {
    expect(Object.keys(Tappable({ intent: "found" }).value)).toEqual(["intent", "payload"]);
  });
});

describe("dropAnswer", () => {
  it("takes the intent from the drop target and merges both payloads", () => {
    const answer = dropAnswer(
      Draggable({ payload: { from: "c2" } }).value,
      DropTarget({ intent: "merge", payload: { to: "c3" } }).value
    );

    expect(answer).toEqual({ intent: "merge", payload: { from: "c2", to: "c3" } });
  });

  it("lets the drop target win a key both payloads carry", () => {
    const answer = dropAnswer(
      Draggable({ payload: { cell: "c2" } }).value,
      DropTarget({ intent: "move", payload: { cell: "c9" } }).value
    );

    expect(answer.payload).toEqual({ cell: "c9" });
  });

  it("treats a payload that is not an object as empty", () => {
    const answer = dropAnswer({ payload: 7 }, { intent: "move", payload: "x" });

    expect(answer).toEqual({ intent: "move", payload: {} });
  });
});

describe("swipeAnswer", () => {
  it("adds the direction to the payload of the component", () => {
    const answer = swipeAnswer(
      Swipeable({ intent: "swap", payload: { cell: "c2" } }).value,
      "left"
    );

    expect(answer).toEqual({ intent: "swap", payload: { cell: "c2", direction: "left" } });
  });

  it("lets the direction win over a payload key of the same name", () => {
    const answer = swipeAnswer(
      Swipeable({ intent: "swap", payload: { direction: "up" } }).value,
      "down"
    );

    expect(answer.payload).toEqual({ direction: "down" });
  });
});

describe("submit", () => {
  it("returns what the gate returned and sends the answer once", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Tappable({ intent: "play" })]);

    expect(submit(mock.input, entity, { intent: "play", payload: {} })).toBe(true);
    expect(mock.answers).toEqual([{ intent: "play", payload: {} }]);
  });

  // Bug caught: every accepted press reads the gate's state, an allocation per press (F108).
  it("reads the gate's state only for a refused answer", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Tappable({ intent: "play" })]);

    mock.gate.blocked = { intent: "tutorialBlocked" };
    mock.calls.length = 0;
    submit(mock.input, entity, { intent: "play", payload: {} });

    expect(mock.calls).toEqual(["answer"]);
  });

  it("returns false when the gate refused, and still counts one call", () => {
    const mock = createMockInput();

    mock.gate.open = false;

    const entity = mock.spawn([Tappable({ intent: "play" })]);

    expect(submit(mock.input, entity, { intent: "play", payload: {} })).toBe(false);
    expect(mock.answers).toHaveLength(1);
  });

  it("warns and names the projection when the intent is empty", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Tappable({})], { projection: "board.items", key: "i5" });

    submit(mock.input, entity, { intent: "", payload: {} });

    expect(mock.log.warn).toHaveBeenCalledWith("input: empty intent", {
      view: { projection: "board.items", key: "i5" }
    });
  });
});

describe("traceAnswer", () => {
  it("keeps the cells in path order under one path key, with the intent of the first cell", () => {
    const answer = traceAnswer([
      { intent: "word", payload: { cell: "b3" } },
      { intent: "word", payload: { cell: "c3" } },
      { intent: "word", payload: { cell: "d3" } }
    ]);

    expect(answer).toEqual({
      intent: "word",
      payload: { path: [{ cell: "b3" }, { cell: "c3" }, { cell: "d3" }] }
    });
  });

  it("answers an empty intent and an empty path for no cell", () => {
    expect(traceAnswer([])).toEqual({ intent: "", payload: { path: [] } });
  });
});
