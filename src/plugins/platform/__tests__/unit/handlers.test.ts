import { describe, expect, it } from "vitest";
import type { LifecycleChanged } from "../../types";
import { createMockPlatform, type MockPlatform } from "./mock-platform";

/** The first push of a reason: the game pauses. */
const pausing: LifecycleChanged = {
  reason: "background",
  action: "push",
  reasons: ["background"],
  paused: true,
  resumed: false
};

/** The pop of the last reason: the game runs again. */
const resuming: LifecycleChanged = {
  reason: "background",
  action: "pop",
  reasons: [],
  paused: false,
  resumed: true
};

/** A pop that leaves another reason on the stack. */
const stillPaused: LifecycleChanged = {
  reason: "ad",
  action: "pop",
  reasons: ["background"],
  paused: true,
  resumed: false
};

/**
 * A started mock that keeps the screen on, its start call already counted out.
 *
 * @returns The mock, awake.
 */
function awake(): MockPlatform {
  const mock = createMockPlatform({ config: { keepAwake: true } });

  mock.start();
  mock.fake.provider.keepAwake.mockClear();

  return mock;
}

describe("lifecycle:changed", () => {
  it("lets the screen sleep on a push that pauses", () => {
    const mock = awake();

    mock.hooks["lifecycle:changed"](pausing);

    expect(mock.fake.provider.keepAwake).toHaveBeenCalledWith(false);
    expect(mock.state.awake).toBe(false);
  });

  it("asks once: a second pausing push while asleep changes nothing", () => {
    const mock = awake();

    mock.hooks["lifecycle:changed"](pausing);
    mock.hooks["lifecycle:changed"]({ ...pausing, reason: "ad", reasons: ["background", "ad"] });

    expect(mock.fake.provider.keepAwake).toHaveBeenCalledTimes(1);
  });

  it("keeps the screen on again when the game resumes", () => {
    const mock = awake();

    mock.hooks["lifecycle:changed"](pausing);
    mock.hooks["lifecycle:changed"](resuming);

    expect(mock.fake.provider.keepAwake).toHaveBeenLastCalledWith(true);
    expect(mock.state.awake).toBe(true);
  });

  it("ignores a pop that leaves the game paused", () => {
    const mock = awake();

    mock.hooks["lifecycle:changed"](pausing);
    mock.hooks["lifecycle:changed"](stillPaused);

    expect(mock.fake.provider.keepAwake).toHaveBeenCalledTimes(1);
    expect(mock.state.awake).toBe(false);
  });

  it("does nothing when keepAwake is off", () => {
    const mock = createMockPlatform();

    mock.start();
    mock.hooks["lifecycle:changed"](pausing);
    mock.hooks["lifecycle:changed"](resuming);

    expect(mock.fake.provider.keepAwake).not.toHaveBeenCalled();
  });

  it("does nothing without a provider", () => {
    const mock = createMockPlatform({ provider: false, config: { keepAwake: true } });

    mock.start();
    mock.hooks["lifecycle:changed"](resuming);

    expect(mock.fake.provider.keepAwake).not.toHaveBeenCalled();
    expect(mock.state.awake).toBe(false);
  });

  it("does nothing before the start and after the stop", () => {
    const mock = createMockPlatform({ config: { keepAwake: true } });

    mock.hooks["lifecycle:changed"](resuming);
    expect(mock.fake.provider.keepAwake).not.toHaveBeenCalled();

    mock.start();
    mock.stop();
    mock.fake.provider.keepAwake.mockClear();
    mock.hooks["lifecycle:changed"](resuming);

    expect(mock.fake.provider.keepAwake).not.toHaveBeenCalled();
  });

  it("logs a keepAwake that throws and keeps the flag where it was", () => {
    const mock = awake();
    const failure = new Error("wake lock refused");

    mock.fake.provider.keepAwake.mockImplementation(() => {
      throw failure;
    });
    mock.hooks["lifecycle:changed"](pausing);

    expect(mock.state.awake).toBe(true);
    expect(mock.log.error).toHaveBeenCalledWith(
      "platform: the provider failed",
      { method: "keepAwake" },
      failure
    );
  });
});
