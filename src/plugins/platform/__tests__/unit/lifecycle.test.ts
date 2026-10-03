import { describe, expect, it } from "vitest";
import { createMockPlatform } from "./mock-platform";

describe("startPlatform", () => {
  it("is inert without a provider: no subscription, no haptic handler", () => {
    const mock = createMockPlatform({ provider: false, config: { keepAwake: true } });

    mock.start();

    expect(mock.flow.registered).toEqual([]);
    expect(mock.state.offs).toEqual([]);
    expect(mock.state.awake).toBe(false);
    expect(mock.fake.provider.onPause).not.toHaveBeenCalled();
  });

  it("subscribes to the provider and registers the haptic handler, not for fast walks", () => {
    const mock = createMockPlatform();

    mock.start();

    expect(mock.fake.provider.onPause).toHaveBeenCalledTimes(1);
    expect(mock.fake.provider.onResume).toHaveBeenCalledTimes(1);
    expect(mock.fake.provider.onBack).toHaveBeenCalledTimes(1);
    expect(mock.flow.registered.map(entry => [entry.kind, entry.runInFast])).toEqual([
      ["haptic", false]
    ]);
  });

  it("turns a pause into one background push and a resume into its pop", () => {
    const mock = createMockPlatform();

    mock.start();
    mock.fake.pause();

    expect(mock.lifecycle.pushed).toEqual(["background"]);

    mock.fake.resume();

    expect(mock.lifecycle.popped).toEqual(["background"]);
  });

  it("tells the provider the engine took the press for popup, intent and exit", () => {
    const mock = createMockPlatform();

    mock.start();

    mock.input.escape = true;
    expect(mock.fake.press()).toBe(true);

    mock.input.escape = false;
    mock.gate.accepts = true;
    expect(mock.fake.press()).toBe(true);

    mock.gate.accepts = false;
    expect(mock.fake.press()).toBe(true);
    expect(mock.fake.provider.exit).toHaveBeenCalledTimes(1);
  });

  it("keeps the screen on at start when keepAwake is set and the game runs", () => {
    const mock = createMockPlatform({ config: { keepAwake: true } });

    mock.start();

    expect(mock.fake.provider.keepAwake).toHaveBeenCalledWith(true);
    expect(mock.state.awake).toBe(true);
  });

  it("does not keep the screen on at start while the game is paused", () => {
    const mock = createMockPlatform({ config: { keepAwake: true } });

    mock.lifecycle.paused = true;
    mock.start();

    expect(mock.fake.provider.keepAwake).not.toHaveBeenCalled();
    expect(mock.state.awake).toBe(false);
  });

  it("logs a subscription that throws and still makes the others", () => {
    const mock = createMockPlatform();
    const failure = new Error("no lifecycle plugin");

    mock.fake.provider.onPause.mockImplementation(() => {
      throw failure;
    });
    mock.start();

    expect(mock.log.error).toHaveBeenCalledWith(
      "platform: the provider failed",
      { method: "onPause" },
      failure
    );
    expect(mock.fake.provider.onResume).toHaveBeenCalledTimes(1);
    expect(mock.fake.provider.onBack).toHaveBeenCalledTimes(1);
  });
});

describe("stopPlatform", () => {
  it("removes every subscription and the handler, and lets the screen sleep", () => {
    const mock = createMockPlatform({ config: { keepAwake: true } });

    mock.start();
    mock.stop();

    expect(mock.fake.removers.pause).toHaveBeenCalledTimes(1);
    expect(mock.fake.removers.resume).toHaveBeenCalledTimes(1);
    expect(mock.fake.removers.back).toHaveBeenCalledTimes(1);
    expect(mock.flow.removed).toEqual(["haptic"]);
    expect(mock.fake.provider.keepAwake).toHaveBeenLastCalledWith(false);
    expect(mock.state.awake).toBe(false);
    expect(mock.state.offs).toEqual([]);
  });

  it("does not call keepAwake when the screen was not kept on", () => {
    const mock = createMockPlatform();

    mock.start();
    mock.stop();

    expect(mock.fake.provider.keepAwake).not.toHaveBeenCalled();
  });

  it("logs a remover that throws and still runs the rest", () => {
    const mock = createMockPlatform({ config: { keepAwake: true } });
    const failure = new Error("already gone");

    mock.fake.removers.pause.mockImplementation(() => {
      throw failure;
    });
    mock.start();
    mock.stop();

    expect(mock.log.error).toHaveBeenCalledWith(
      "platform: the provider failed",
      { method: "onPause" },
      failure
    );
    expect(mock.fake.removers.back).toHaveBeenCalledTimes(1);
    expect(mock.fake.provider.keepAwake).toHaveBeenLastCalledWith(false);
  });

  it("is a no-op for a plugin that never started", () => {
    const mock = createMockPlatform();

    expect(() => mock.stop()).not.toThrow();
    expect(mock.fake.removers.pause).not.toHaveBeenCalled();
  });
});
