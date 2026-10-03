import { describe, expect, it, vi } from "vitest";
import {
  configureInput,
  createHiddenInput,
  documentOf,
  HIDDEN_STYLE,
  hasFocus,
  listenToInput,
  placeInput,
  pointerDoor,
  readMirror,
  removeHiddenInput,
  watchKeyboard
} from "../../jsx/dom-input";
import type { Composing, Mirror } from "../../jsx/types";
import { createFakeCanvas, createFakeDom, type FakeInput } from "../fake-dom";

// ---------------------------------------------------------------------------
// Unit test: the one ui file that touches the DOM, over a fake page — the
// hidden input, its listeners, the pointer door and the visual viewport
// ---------------------------------------------------------------------------

/**
 * Makes the hidden input of a fake page.
 *
 * @returns The page and the fake element.
 */
function hidden(): { dom: ReturnType<typeof createFakeDom>; input: FakeInput } {
  const dom = createFakeDom();

  createHiddenInput(dom.document);

  const input = dom.inputs[0];

  if (input === undefined) throw new Error("no input was made");

  return { dom, input };
}

describe("the hidden input", () => {
  it("is one invisible input on the body, with the style string and the fixed attributes", () => {
    const { dom, input } = hidden();

    expect(dom.body()).toEqual([input.element]);
    expect(input.style.cssText).toBe(HIDDEN_STYLE);
    expect(HIDDEN_STYLE).toBe(
      "position: fixed; opacity: 0; pointer-events: none; font-size: 16px; border: 0; " +
        "padding: 0; margin: 0; outline: none; background: transparent; color: transparent; " +
        "caret-color: transparent;"
    );
    expect(Object.fromEntries(input.attributes)).toEqual({
      enterkeyhint: "done",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false"
    });
  });

  it.each([
    ["text", { type: "text" }],
    ["number", { type: "text", inputmode: "decimal" }],
    ["email", { type: "email", inputmode: "email" }]
  ] as const)("opens the %s keyboard", (kind, attributes) => {
    const { input } = hidden();

    configureInput(input.element, { kind: "email", maxLength: 16, label: "Your name" });
    configureInput(input.element, { kind, maxLength: undefined, label: "Your name" });

    expect(input.attributes.get("type")).toBe(attributes.type);
    expect(input.attributes.get("inputmode")).toBe(
      "inputmode" in attributes ? attributes.inputmode : undefined
    );
    expect(input.attributes.has("maxlength")).toBe(false);
    expect(input.attributes.get("aria-label")).toBe("Your name");
  });

  it("carries the maxlength of the field", () => {
    const { input } = hidden();

    configureInput(input.element, { kind: "text", maxLength: 16, label: "" });

    expect(input.attributes.get("maxlength")).toBe("16");
  });

  it("is taken off the page", () => {
    const { dom, input } = hidden();

    removeHiddenInput(input.element);

    expect(input.removed()).toBe(true);
    expect(dom.body()).toEqual([]);
  });

  it("finds its page through the canvas, and none without one", () => {
    const dom = createFakeDom();

    expect(documentOf(createFakeCanvas(dom).element)).toBe(dom.document);
    expect(documentOf(undefined)).toBeUndefined();
  });
});

describe("the mirror", () => {
  it("reads the value, the selection and its direction, cut to the max length", () => {
    const { input } = hidden();

    input.type("Alexander", 2, 9, "backward");

    expect(readMirror(input.element, 4)).toEqual({
      value: "Alex",
      selectionStart: 2,
      selectionEnd: 4,
      direction: "backward"
    });
    expect(readMirror(input.element, undefined).value).toBe("Alexander");
  });

  // Found by exploratory QA: an IME composition is not held to `maxlength`, so the element can
  // hold 15 letters and an emoji (17 units); the cut keeps the emoji out whole, never half of it.
  it("never cuts an emoji in half at the max length", () => {
    const { input } = hidden();

    input.type("aaaaaaaaaaaaaaa😀", 17, 17, "none");

    const mirror = readMirror(input.element, 16);

    expect(mirror.value).toBe("aaaaaaaaaaaaaaa");
    expect(mirror.value.isWellFormed()).toBe(true);
  });

  it("is filled by the input event, the composing range by the composition events", () => {
    const { input } = hidden();
    const mirrors: Mirror[] = [];
    const ranges: Array<Composing | "committed"> = [];
    const done = vi.fn();
    const off = listenToInput(input.element, {
      maxLength: () => 16,
      mirror: next => mirrors.push(next),
      compose: range => ranges.push(range),
      committed: () => ranges.push("committed"),
      done
    });

    input.type("Al");
    input.element.setSelectionRange(2, 2);
    input.dispatch("compositionstart");
    input.dispatch("compositionupdate", { data: "ex" });
    input.dispatch("compositionend");

    expect(mirrors[0]).toEqual({
      value: "Al",
      selectionStart: 2,
      selectionEnd: 2,
      direction: "none"
    });
    expect(ranges).toEqual([{ start: 2, end: 2 }, { start: 2, end: 4 }, "committed"]);
    expect(done).not.toHaveBeenCalled();

    off();
  });

  it("calls a blur done, and its listeners leave with the remover", () => {
    const { input } = hidden();
    const done = vi.fn();
    const off = listenToInput(input.element, {
      maxLength: () => undefined,
      mirror: () => undefined,
      compose: () => undefined,
      committed: () => undefined,
      done
    });

    expect(input.listeners()).toEqual([
      "blur",
      "compositionend",
      "compositionstart",
      "compositionupdate",
      "input"
    ]);

    input.element.focus();
    input.element.blur();

    expect(done).toHaveBeenCalledOnce();

    off();

    expect(input.listeners()).toEqual([]);
  });

  it("knows whether the element holds the page focus", () => {
    const { input } = hidden();

    expect(hasFocus(input.element)).toBe(false);

    input.element.focus();

    expect(hasFocus(input.element)).toBe(true);
  });
});

describe("the pointer door", () => {
  /** The field the door finds at (100, 100) and nowhere else. */
  const setup = { kind: "email", maxLength: 16, label: "Your name", value: "Al" } as const;

  /**
   * Builds the door over a fake input with one field under (100, 100).
   *
   * @returns The fake input and the listener.
   */
  function door(): { input: FakeInput; listener: ReturnType<typeof pointerDoor> } {
    const { input } = hidden();
    const listener = pointerDoor(
      () => input.element,
      (clientX, clientY) => (clientX === 100 && clientY === 100 ? setup : undefined)
    );

    return { input, listener };
  }

  /**
   * A raw sample of a finger.
   *
   * @param kind - The pointer moment.
   * @param at - Where, in client px.
   * @returns The sample.
   */
  function sample(kind: "down" | "up" | "cancel", at: number) {
    return { kind, pointerType: "touch", pointerId: 1, clientX: at, clientY: at } as const;
  }

  it("focuses the input with preventScroll when a finger lifts on a field", () => {
    const { input, listener } = door();

    listener(sample("up", 100));

    expect(input.focusCalls).toEqual([{ preventScroll: true }]);
    expect(input.element.value).toBe("Al");
    expect(input.attributes.get("type")).toBe("email");
    expect(input.attributes.get("maxlength")).toBe("16");
  });

  it("leaves the text of a focused input alone when a finger lifts on a field", () => {
    const { input, listener } = door();

    input.element.focus();
    input.type("Alexander");
    listener(sample("up", 100));

    expect(input.element.value).toBe("Alexander");
    expect(input.focusCalls).toEqual([undefined, { preventScroll: true }]);
  });

  it("does not focus on a lift outside every field", () => {
    const { input, listener } = door();

    listener(sample("up", 5));
    listener(sample("cancel", 100));

    expect(input.focusCalls).toEqual([]);
  });

  it("blurs on a finger down outside every field, and not on one", () => {
    const { input, listener } = door();

    listener(sample("down", 100));

    expect(input.blurCalls()).toBe(0);

    listener(sample("down", 5));

    expect(input.blurCalls()).toBe(1);
  });

  it("does nothing without an input", () => {
    const listener = pointerDoor(
      () => undefined,
      () => setup
    );

    expect(() => listener(sample("up", 100))).not.toThrow();
  });
});

describe("the place of the input", () => {
  it("lies over the drawn field, raised by the lift", () => {
    const { input } = hidden();

    placeInput(input.element, { x: 10, y: 500, w: 300, h: 40 }, 186);

    expect([input.style.left, input.style.top, input.style.width, input.style.height]).toEqual([
      "10px",
      "314px",
      "300px",
      "40px"
    ]);
  });
});

describe("the keyboard watcher", () => {
  it("reads the inset at once and on every resize, and its listeners leave with the remover", () => {
    const dom = createFakeDom(714);
    const seen: Array<{ inset: number; innerHeight: number }> = [];
    const off = watchKeyboard(dom.window, keyboard => seen.push(keyboard));

    expect(dom.viewport.listeners()).toEqual(["resize", "scroll"]);

    dom.viewport.resize(404);

    expect(seen).toEqual([
      { inset: 0, innerHeight: 714 },
      { inset: 310, innerHeight: 714 }
    ]);

    off();

    expect(dom.viewport.listeners()).toEqual([]);
  });

  it("does nothing on a window without a visual viewport", () => {
    const seen: unknown[] = [];
    const off = watchKeyboard({ innerHeight: 700 } as Window, keyboard => seen.push(keyboard));

    off();

    expect(seen).toEqual([{ inset: 0, innerHeight: 700 }]);
  });
});
