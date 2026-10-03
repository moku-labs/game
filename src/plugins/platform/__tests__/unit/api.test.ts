import { describe, expect, it } from "vitest";
import { createMockPlatform } from "./mock-platform";

describe("back", () => {
  it("answers none and presses nothing without a provider", () => {
    const mock = createMockPlatform({ provider: false });

    mock.input.escape = true;
    mock.gate.accepts = true;

    expect(mock.api.back()).toBe("none");
    expect(mock.input.pressed).toEqual([]);
    expect(mock.gate.answers).toEqual([]);
  });

  it("answers popup when Escape tapped a ui button, and stops before the gate", () => {
    const mock = createMockPlatform();

    mock.input.escape = true;
    mock.gate.accepts = true;

    expect(mock.api.back()).toBe("popup");
    expect(mock.input.pressed).toEqual(["Escape"]);
    expect(mock.gate.answers).toEqual([]);
    expect(mock.fake.provider.exit).not.toHaveBeenCalled();
  });

  it("answers intent when the resting node lists back, and does not exit", () => {
    const mock = createMockPlatform();

    mock.gate.accepts = true;

    expect(mock.api.back()).toBe("intent");
    expect(mock.input.pressed).toEqual(["Escape"]);
    expect(mock.gate.answers).toEqual([{ intent: "back" }]);
    expect(mock.fake.provider.exit).not.toHaveBeenCalled();
  });

  it("falls to exit when neither the popup nor the gate took the press", () => {
    const mock = createMockPlatform();

    expect(mock.api.back()).toBe("exit");
    expect(mock.gate.answers).toEqual([{ intent: "back" }]);
    expect(mock.fake.provider.exit).toHaveBeenCalledTimes(1);
  });

  // Found at V6 build: a press while the graph moves between nodes met a closed gate and left the
  // app. The gate holds the answer for a frame, so the press counts as taken.
  it("never exits while the gate is closed between nodes", () => {
    const mock = createMockPlatform();

    mock.gate.open = false;

    expect(mock.api.back()).toBe("intent");
    expect(mock.gate.answers).toEqual([{ intent: "back" }]);
    expect(mock.fake.provider.exit).not.toHaveBeenCalled();
  });

  it("logs an exit that throws and still answers exit", () => {
    const mock = createMockPlatform();
    const failure = new Error("no permission");

    mock.fake.provider.exit.mockImplementation(() => {
      throw failure;
    });

    expect(mock.api.back()).toBe("exit");
    expect(mock.log.error).toHaveBeenCalledWith(
      "platform: the provider failed",
      { method: "exit" },
      failure
    );
  });

  it("wraps a thrown value that is not an Error before it logs it", () => {
    const mock = createMockPlatform();

    mock.fake.provider.exit.mockImplementation(() => {
      throw "denied";
    });

    expect(mock.api.back()).toBe("exit");
    expect(mock.log.error).toHaveBeenCalledWith(
      "platform: the provider failed",
      { method: "exit" },
      new Error("denied")
    );
  });
});
