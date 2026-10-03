import { afterEach, describe, expect, it, vi } from "vitest";
import { createInputApi } from "../../api";
import { addKeyListener, attachKeys, detachKeys, keyFromTextInput, runKeys } from "../../keys";
import { stopInput } from "../../lifecycle";
import { createMockInput, createStubCanvas } from "./mock-input";

/** One keydown the fake window hands its listeners. */
type FakeKeyEvent = {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
  target?: EventTarget | null;
  isComposing?: boolean;
  keyCode?: number;
};

/** What a text field adds to a keydown: where it was typed and whether an IME composes. */
type TextFacts = { target: EventTarget | null; isComposing?: boolean; keyCode?: number };

/**
 * A fake event target with the fields an editable check reads.
 *
 * @param fields - The tag name and the content-editable flag of the fake element.
 * @param fields.tagName - The upper-case tag name, such as `"INPUT"`.
 * @param fields.isContentEditable - True for a content-editable element.
 * @returns The fake, typed as the DOM target it stands for.
 */
function fakeTarget(fields: { tagName: string; isContentEditable?: boolean }): EventTarget {
  return { isContentEditable: false, ...fields } as unknown as EventTarget;
}

/**
 * A fake keydown for `keyFromTextInput`.
 *
 * @param key - The DOM `KeyboardEvent.key`.
 * @param facts - The target and the composition flags.
 * @returns The fake, typed as the event fields the function reads.
 */
function fakeKey(
  key: string,
  facts: TextFacts
): Pick<KeyboardEvent, "key" | "target" | "isComposing" | "keyCode"> {
  return { isComposing: false, keyCode: 0, ...facts, key };
}

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
    press: (key: string, shiftKey = false, facts?: TextFacts): FakeKeyEvent => {
      const event = { ...facts, key, shiftKey, preventDefault: vi.fn() };

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

describe("keyFromTextInput", () => {
  const field = fakeTarget({ tagName: "INPUT" });
  const area = fakeTarget({ tagName: "TEXTAREA" });
  const editable = fakeTarget({ tagName: "DIV", isContentEditable: true });
  const canvas = fakeTarget({ tagName: "CANVAS" });

  it("skips every key typed into an editable element but Enter and Escape", () => {
    for (const target of [field, area, editable]) {
      for (const key of ["a", " ", "Tab", "ArrowLeft", "Backspace"]) {
        expect(keyFromTextInput(fakeKey(key, { target }))).toBe("skip");
      }
    }
  });

  it("skips an Enter that commits an IME composition", () => {
    expect(keyFromTextInput(fakeKey("Enter", { target: field, isComposing: true }))).toBe("skip");
    expect(keyFromTextInput(fakeKey("Enter", { target: field, keyCode: 229 }))).toBe("skip");
  });

  it("passes Enter and Escape typed into an editable element", () => {
    expect(keyFromTextInput(fakeKey("Enter", { target: field, keyCode: 13 }))).toBe("pass");
    expect(keyFromTextInput(fakeKey("Escape", { target: area }))).toBe("pass");
    expect(keyFromTextInput(fakeKey("Escape", { target: editable }))).toBe("pass");
  });

  it("passes every key of any other target, as before", () => {
    expect(keyFromTextInput(fakeKey("Tab", { target: canvas }))).toBe("pass");
    expect(keyFromTextInput(fakeKey(" ", { target: fakeTarget({ tagName: "BUTTON" }) }))).toBe(
      "pass"
    );
    expect(keyFromTextInput(fakeKey("Enter", { target: canvas, isComposing: true }))).toBe("pass");
    expect(keyFromTextInput(fakeKey("a", { target: fakeTarget({ tagName: "BODY" }) }))).toBe(
      "pass"
    );
  });
});

describe("the window listener and a text field", () => {
  it("prevents the default of an Enter passed from a field that a listener handled", () => {
    const fake = createFakeWindow();
    const mock = createMockInput();
    const field = fakeTarget({ tagName: "INPUT" });

    vi.stubGlobal("window", fake);
    attachKeys(mock.input);
    addKeyListener(mock.state, key => key.key === "Enter");

    expect(
      fake.press("Enter", false, { target: field, keyCode: 13 }).preventDefault
    ).toHaveBeenCalledTimes(1);
  });

  it("never hands a Tab typed into a field to a listener, and keeps its default", () => {
    const fake = createFakeWindow();
    const mock = createMockInput();
    const listener = vi.fn(() => true);

    vi.stubGlobal("window", fake);
    attachKeys(mock.input);
    addKeyListener(mock.state, listener);

    const event = fake.press("Tab", false, { target: fakeTarget({ tagName: "INPUT" }) });

    expect(listener).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("drops a composing Enter before any listener sees it", () => {
    const fake = createFakeWindow();
    const mock = createMockInput();
    const listener = vi.fn(() => true);

    vi.stubGlobal("window", fake);
    attachKeys(mock.input);
    addKeyListener(mock.state, listener);
    fake.press("Enter", false, { target: fakeTarget({ tagName: "INPUT" }), isComposing: true });

    expect(listener).not.toHaveBeenCalled();
  });
});
