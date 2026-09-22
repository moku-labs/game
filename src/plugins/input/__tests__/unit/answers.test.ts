import { describe, expect, it } from "vitest";
import { dropAnswer, submit, swipeAnswer, tapAnswer } from "../../answers";
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
