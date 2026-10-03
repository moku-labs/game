import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { haptic } from "../../../anim/timeline/steps";
import { kindOf } from "../../haptic";
import { createMockPlatform, type MockPlatform } from "./mock-platform";

/** A started mock with a provider. */
function started(): MockPlatform {
  const mock = createMockPlatform();

  mock.start();

  return mock;
}

describe("kindOf", () => {
  it("reads the kind of the descriptor anim builds", () => {
    expect(kindOf(haptic("success"))).toBe("success");
  });

  it("names a missing or non-string kind by its text", () => {
    expect(kindOf({ kind: "haptic" })).toBe("undefined");
    expect(kindOf({ kind: "haptic", payload: { kind: 3 } })).toBe("3");
    expect(kindOf({ kind: "haptic", payload: ["light"] })).toBe("undefined");
    // eslint-disable-next-line unicorn/no-null -- a JSON payload may be null.
    expect(kindOf({ kind: "haptic", payload: null })).toBe("undefined");
  });
});

describe("the haptic handler", () => {
  beforeEach(() => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands a known kind to the provider and resolves at once", () => {
    const mock = started();

    expect(mock.fx(haptic("success"))).toBeUndefined();
    expect(mock.fake.provider.haptic).toHaveBeenCalledWith("success");
  });

  it("plays every one of the seven kinds", () => {
    const mock = started();

    for (const kind of ["light", "medium", "heavy", "selection", "success", "warning", "error"]) {
      mock.fx({ kind: "haptic", payload: { kind } });
    }

    expect(mock.fake.provider.haptic).toHaveBeenCalledTimes(7);
  });

  it("warns once per unknown kind in a dev build and plays nothing", () => {
    const mock = started();

    mock.fx({ kind: "haptic", payload: { kind: "buzz" } });
    mock.fx({ kind: "haptic", payload: { kind: "buzz" } });
    mock.fx({ kind: "haptic", payload: { kind: "rumble" } });
    mock.fx({ kind: "haptic" });

    expect(mock.fake.provider.haptic).not.toHaveBeenCalled();
    expect(mock.log.warn).toHaveBeenCalledTimes(3);
    expect(mock.log.warn).toHaveBeenNthCalledWith(1, "platform: unknown haptic kind", {
      kind: "buzz"
    });
    expect(mock.log.warn).toHaveBeenNthCalledWith(2, "platform: unknown haptic kind", {
      kind: "rumble"
    });
    expect(mock.log.warn).toHaveBeenNthCalledWith(3, "platform: unknown haptic kind", {
      kind: "undefined"
    });
  });

  it("stays silent about an unknown kind in a production build", () => {
    vi.unstubAllGlobals();

    const mock = started();

    mock.fx({ kind: "haptic", payload: { kind: "buzz" } });

    expect(mock.log.warn).not.toHaveBeenCalled();
    expect(mock.fake.provider.haptic).not.toHaveBeenCalled();
  });

  it("logs a provider that throws instead of throwing into the frame", () => {
    const mock = started();
    const failure = new Error("no motor");

    mock.fake.provider.haptic.mockImplementation(() => {
      throw failure;
    });

    expect(() => mock.fx(haptic("light"))).not.toThrow();
    expect(mock.log.error).toHaveBeenCalledWith(
      "platform: the provider failed",
      { method: "haptic" },
      failure
    );
  });
});
