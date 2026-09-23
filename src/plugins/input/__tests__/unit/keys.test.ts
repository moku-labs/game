import { afterEach, describe, expect, it, vi } from "vitest";
import { createInputApi } from "../../api";
import { addKeyListener, attachKeys, detachKeys, runKeys } from "../../keys";
import { stopInput } from "../../lifecycle";
import { createMockInput, createStubCanvas } from "./mock-input";

/** One keydown the fake window hands its listeners. */
type FakeKeyEvent = { key: string; shiftKey: boolean; preventDefault: () => void };

/**
 * A fake `window` that records its listeners by event name.
 *
 * @returns The fake and helpers to read and fire its listeners.
 */
function createFakeWindow() {
  const listeners = new Map<string, Array<(event: FakeKeyEvent) => void>>();

  return {
    addEventListener: (name: string, fn: (event: FakeKeyEvent) => void): void => {
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    },
    removeEventListener: (name: string, fn: (event: FakeKeyEvent) => void): void => {
      const left = (listeners.get(name) ?? []).filter(entry => entry !== fn);

      if (left.length === 0) listeners.delete(name);
      else listeners.set(name, left);
    },
    count: (name: string): number => listeners.get(name)?.length ?? 0,
    press: (key: string, shiftKey = false): FakeKeyEvent => {
      const event = { key, shiftKey, preventDefault: vi.fn() };

      for (const fn of listeners.get("keydown") ?? []) fn(event);

      return event;
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runKeys", () => {
  it("runs the listeners in registration order with the key and the shift flag", () => {
    const mock = createMockInput();
    const seen: string[] = [];

    addKeyListener(mock.state, key => {
      seen.push(`a:${key.key}:${String(key.shift)}`);
    });
    addKeyListener(mock.state, key => {
      seen.push(`b:${key.key}:${String(key.shift)}`);
    });

    expect(runKeys(mock.input, { key: "Tab", shift: true })).toBe(false);
    expect(seen).toEqual(["a:Tab:true", "b:Tab:true"]);
  });

  it("answers true when one listener handled the key, and still runs the rest", () => {
    const mock = createMockInput();
    const later = vi.fn();

    addKeyListener(mock.state, key => key.key === "Escape");
    addKeyListener(mock.state, later);

    expect(runKeys(mock.input, { key: "Escape", shift: false })).toBe(true);
    expect(later).toHaveBeenCalledTimes(1);
    expect(runKeys(mock.input, { key: "a", shift: false })).toBe(false);
  });

  it("logs a listener that throws and runs the listeners after it", () => {
    const mock = createMockInput();
    const error = new Error("broken");

    addKeyListener(mock.state, () => {
      throw error;
    });
    addKeyListener(mock.state, () => true);

    expect(runKeys(mock.input, { key: "Enter", shift: false })).toBe(true);
    expect(mock.log.error).toHaveBeenCalledWith("input: an onKey listener threw", {
      key: "Enter",
      error
    });
  });

  it("drops only the listener whose remover ran", () => {
    const mock = createMockInput();
    const kept = vi.fn();
    const off = addKeyListener(mock.state, () => true);

    addKeyListener(mock.state, kept);
    off();
    off();

    expect(runKeys(mock.input, { key: " ", shift: false })).toBe(false);
    expect(kept).toHaveBeenCalledTimes(1);
  });
});

describe("attachKeys and detachKeys", () => {
  it("puts one keydown listener on window and takes it off again", () => {
    const fake = createFakeWindow();
    const mock = createMockInput();

    vi.stubGlobal("window", fake);
    attachKeys(mock.input);
    attachKeys(mock.input);

    expect(fake.count("keydown")).toBe(1);

    detachKeys(mock.state);
    detachKeys(mock.state);

    expect(fake.count("keydown")).toBe(0);
    expect(mock.state.detachKeys).toBeUndefined();
  });

  it("prevents the browser default only for a handled key", () => {
    const fake = createFakeWindow();
    const mock = createMockInput();

    vi.stubGlobal("window", fake);
    attachKeys(mock.input);
    addKeyListener(mock.state, key => key.key === "Tab" && key.shift);

    expect(fake.press("Tab", true).preventDefault).toHaveBeenCalledTimes(1);
    expect(fake.press("Tab").preventDefault).not.toHaveBeenCalled();
  });

  it("is a no-op without a window", () => {
    const mock = createMockInput();

    attachKeys(mock.input);

    expect(mock.state.detachKeys).toBeUndefined();
  });
});

describe("the key listener lifecycle", () => {
  it("listens on window only while a canvas is attached, until stop", () => {
    const fake = createFakeWindow();
    const mock = createMockInput();

    vi.stubGlobal("window", fake);
    mock.canvas.current = createStubCanvas().element;
    mock.start();

    expect(fake.count("keydown")).toBe(1);

    stopInput(mock.state);

    expect(fake.count("keydown")).toBe(0);
    expect(mock.state.keyListeners).toEqual([]);
  });

  it("puts nothing on window without a canvas", () => {
    const fake = createFakeWindow();
    const mock = createMockInput();

    vi.stubGlobal("window", fake);
    mock.start();

    expect(fake.count("keydown")).toBe(0);
  });
});

describe("app.input.onKey and app.input.pressKey", () => {
  it("runs the same listeners headless and reports whether one handled the key", () => {
    const mock = createMockInput();
    const api = createInputApi(mock.ctx);
    const seen: Array<{ key: string; shift: boolean }> = [];
    const off = api.onKey(key => {
      seen.push(key);

      return key.key === "Enter";
    });

    expect(api.pressKey("Enter")).toBe(true);
    expect(api.pressKey("Tab", { shift: true })).toBe(false);
    expect(seen).toEqual([
      { key: "Enter", shift: false },
      { key: "Tab", shift: true }
    ]);

    off();

    expect(api.pressKey("Enter")).toBe(false);
  });
});
