/**
 * @file ui/jsx — the hidden input, the only ui file that touches the DOM. One `<input>` per app
 * holds the focus, the keyboard and the real text; the canvas draws the field. The page is found
 * through the canvas (`ownerDocument`), so nothing here reads a global and every function takes
 * the element or the window it works on.
 */
import type { PointerListener } from "../../input/types";
import type { Rect } from "../layout/types";
import { clampValue, insetOf } from "./field-layout";
import type { Composing, FieldKind, Mirror } from "./types";

/**
 * The style of the hidden input: fixed, invisible, out of the pointer's way, and 16 px so iOS
 * does not zoom the page when it takes the focus.
 */
export const HIDDEN_STYLE =
  "position: fixed; opacity: 0; pointer-events: none; font-size: 16px; border: 0; " +
  "padding: 0; margin: 0; outline: none; background: transparent; color: transparent; " +
  "caret-color: transparent;";

/** What the hidden input takes from the field it edits. */
export type InputSetup = { kind: FieldKind; maxLength: number | undefined; label: string };

/** What the pointer door takes from the field under the finger: the setup and its value now. */
export type FieldUnder = InputSetup & { value: string };

/**
 * What the listeners of the element call: the mirror, the composing range, its end, and done.
 */
export type InputHandlers = {
  maxLength(): number | undefined;
  mirror(next: Mirror): void;
  compose(range: Composing): void;
  committed(): void;
  done(): void;
};

/** The size of the keyboard, as the watcher reads it. */
export type KeyboardReading = { inset: number; innerHeight: number };

/** The attributes the element always carries: a done key, and no help from the browser. */
const FIXED_ATTRIBUTES: readonly (readonly [string, string])[] = [
  ["enterkeyhint", "done"],
  ["autocomplete", "off"],
  ["autocorrect", "off"],
  ["autocapitalize", "off"],
  ["spellcheck", "false"]
];

/**
 * The `type` and the keyboard (`inputmode`) of each field kind. A text field leaves the keyboard
 * to the browser.
 */
const KIND_ATTRIBUTES: Readonly<
  Record<FieldKind, { type: string; inputMode: string | undefined }>
> = {
  text: { type: "text", inputMode: undefined },
  number: { type: "text", inputMode: "decimal" },
  email: { type: "email", inputMode: "email" }
};

/**
 * The page a canvas lives on.
 *
 * @param canvas - The canvas of the renderer, or nothing while it is inert.
 * @returns The document, or `undefined` headless.
 */
export function documentOf(canvas: HTMLCanvasElement | undefined): Document | undefined {
  return canvas?.ownerDocument ?? undefined;
}

/**
 * Makes the hidden input and appends it to the body. Not inside a `<form>`: Enter must submit
 * nothing but the gate answer.
 *
 * @param document - The page of the canvas.
 * @returns The element.
 */
export function createHiddenInput(document: Document): HTMLInputElement {
  const element = document.createElement("input");

  element.style.cssText = HIDDEN_STYLE;

  for (const [name, value] of FIXED_ATTRIBUTES) element.setAttribute(name, value);

  document.body.append(element);

  return element;
}

/**
 * Takes the hidden input off the page.
 *
 * @param element - The element.
 */
export function removeHiddenInput(element: HTMLInputElement): void {
  element.remove();
}

/**
 * Sets the attribute that differs per field: the type and the keyboard of its kind, its
 * `maxlength` and its label.
 *
 * @param element - The hidden input.
 * @param setup - The kind, the max length and the label of the field.
 */
export function configureInput(element: HTMLInputElement, setup: InputSetup): void {
  // Give the element the type and the keyboard of the field's kind.
  const { type, inputMode } = KIND_ATTRIBUTES[setup.kind];

  element.setAttribute("type", type);

  if (inputMode === undefined) element.removeAttribute("inputmode");
  else element.setAttribute("inputmode", inputMode);

  // Then its max length and its label.
  if (setup.maxLength === undefined) element.removeAttribute("maxlength");
  else element.setAttribute("maxlength", String(setup.maxLength));

  element.setAttribute("aria-label", setup.label);
}

/**
 * Reads the text, the selection and its direction, the value cut to the max length.
 *
 * @param element - The hidden input.
 * @param maxLength - The longest value the field keeps.
 * @returns The mirror.
 */
export function readMirror(element: HTMLInputElement, maxLength: number | undefined): Mirror {
  const value = clampValue(element.value, maxLength);
  const start = Math.min(element.selectionStart ?? value.length, value.length);
  const end = Math.min(element.selectionEnd ?? start, value.length);
  const direction = element.selectionDirection;

  return {
    value,
    selectionStart: start,
    selectionEnd: end,
    direction: direction === "forward" || direction === "backward" ? direction : "none"
  };
}

/**
 * Tells whether the hidden input holds the page focus.
 *
 * @param element - The hidden input.
 * @returns True when it is the active element of its document.
 */
export function hasFocus(element: HTMLInputElement): boolean {
  return element.ownerDocument.activeElement === element;
}

/**
 * Puts the five listeners on the element: `input` fills the mirror, the three composition events
 * the composing range, and `blur` is done. Keys are not listened to here: Enter and Escape reach
 * `ui` through `input.onKey`.
 *
 * @param element - The hidden input.
 * @param handlers - What the listeners call.
 * @returns The remover.
 */
export function listenToInput(element: HTMLInputElement, handlers: InputHandlers): () => void {
  let start = 0;

  const read = (): void => handlers.mirror(readMirror(element, handlers.maxLength()));
  const listeners: [string, (event: Event) => void][] = [
    ["input", read],
    [
      "compositionstart",
      () => {
        start = element.selectionStart ?? 0;
        handlers.compose({ start, end: element.selectionEnd ?? start });
      }
    ],
    [
      "compositionupdate",
      event =>
        handlers.compose({ start, end: start + ((event as CompositionEvent).data ?? "").length })
    ],
    [
      "compositionend",
      () => {
        handlers.committed();
        read();
      }
    ],
    ["blur", () => handlers.done()]
  ];

  for (const [name, listener] of listeners) element.addEventListener(name, listener);

  return (): void => {
    for (const [name, listener] of listeners) element.removeEventListener(name, listener);
  };
}

/**
 * The `onPointer` listener that opens and closes the keyboard inside the DOM listener: a finger
 * lifted on a field focuses the input with `preventScroll`, set up for that field unless it is
 * focused already; a finger put down outside every field blurs it. Nothing else is decided here: the tap resolves in the frame
 * step.
 *
 * @param read - The hidden input, or nothing headless.
 * @param fieldAt - The field under a point in client px, or `undefined`.
 * @returns The listener.
 */
export function pointerDoor(
  read: () => HTMLInputElement | undefined,
  fieldAt: (clientX: number, clientY: number) => FieldUnder | undefined
): PointerListener {
  return sample => {
    const element = read();

    if (element === undefined || sample.kind === "cancel") return;

    const field = fieldAt(sample.clientX, sample.clientY);

    if (sample.kind === "down" && field === undefined) element.blur();
    if (sample.kind !== "up" || field === undefined) return;

    // A focused input already holds the text of the field being edited: the tap that resolves
    // in the frame step moves it to the new field, and a press that slid away loses nothing.
    if (!hasFocus(element)) {
      configureInput(element, field);
      element.value = field.value;
    }

    element.focus({ preventScroll: true });
  };
}

/**
 * Puts the input over the field it edits, so a desktop IME window anchors there.
 *
 * @param element - The hidden input.
 * @param rect - The drawn field in CSS px.
 * @param lift - How far the field's root is lifted, in CSS px.
 */
export function placeInput(element: HTMLInputElement, rect: Rect, lift: number): void {
  element.style.left = `${rect.x}px`;
  element.style.top = `${rect.y - lift}px`;
  element.style.width = `${rect.w}px`;
  element.style.height = `${rect.h}px`;
}

/**
 * The remover of a watcher that put no listener anywhere.
 */
function stopNothing(): void {
  // A window without a visual viewport got no listener, so there is nothing to take off.
}

/**
 * Follows the keyboard through the visual viewport: reads the inset now and on every `resize`
 * and `scroll`. A window without a visual viewport reads an inset of 0 once.
 *
 * @param window - The window of the page.
 * @param onChange - What runs with every reading.
 * @returns The remover.
 */
export function watchKeyboard(
  window: Window,
  onChange: (keyboard: KeyboardReading) => void
): () => void {
  const viewport = window.visualViewport ?? undefined;
  const read = (): void => {
    const innerHeight = window.innerHeight;

    onChange({
      inset:
        viewport === undefined
          ? 0
          : insetOf({ innerHeight, offsetTop: viewport.offsetTop, height: viewport.height }),
      innerHeight
    });
  };

  read();

  if (viewport === undefined) return stopNothing;

  viewport.addEventListener("resize", read);
  viewport.addEventListener("scroll", read);

  return (): void => {
    viewport.removeEventListener("resize", read);
    viewport.removeEventListener("scroll", read);
  };
}
