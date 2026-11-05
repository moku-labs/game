/**
 * @file The zoom guard of the page (F150): iOS zooms the page under a pinch or a double tap on any
 * DOM node outside the canvas, such as the editor's overlay, and ignores `user-scalable=no`. The
 * page style takes the double tap and the pinch from `html, body` (`touch-action: pan-x pan-y`);
 * a scroll box inside an overlay starts its own touch area, so the listeners here close the rest.
 * Pure over the window it gets: no global. `startPage` calls it; not exported from any entry.
 */

/** The part of the window the guard listens on. */
type GuardWindow = Pick<Window, "addEventListener" | "removeEventListener">;

/** The longest gap between two taps iOS reads as a double tap, ms. */
const DOUBLE_TAP_MS = 350;

/** The tags that keep their own double tap: it selects a word in a text field (F144). */
const EDITABLE = new Set(["INPUT", "TEXTAREA"]);

/**
 * Tells whether a node of the event path keeps its double tap: the game's own `#game` (its canvas
 * takes no zoom), or a text field.
 *
 * @param node - A node of `composedPath()`.
 * @returns True for `#game`, an `input`, a `textarea` or an editable element.
 * @example
 * ```ts
 * keepsDoubleTap({ id: "game" }); // true
 * ```
 */
export function keepsDoubleTap(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;

  const { id, tagName, isContentEditable } = node as {
    id?: unknown;
    tagName?: unknown;
    isContentEditable?: unknown;
  };

  return (
    id === "game" ||
    (typeof tagName === "string" && EDITABLE.has(tagName)) ||
    isContentEditable === true
  );
}

/**
 * Puts the zoom guard on the window, in the capture phase, so an overlay that stops its events
 * from bubbling is still guarded. `gesturestart` and `gesturechange` (WebKit's pinch) are
 * cancelled, a `touchmove` with two fingers is cancelled, and the second `touchend` of a double
 * tap outside `#game` and outside a text field is cancelled. A single tap, a one-finger scroll
 * and the game's pointer events go through untouched.
 *
 * @param target - The window of the page.
 * @param now - The clock of the double tap, ms.
 * @returns The remover.
 */
export function guardZoom(target: GuardWindow, now: () => number): () => void {
  const options = { capture: true, passive: false };
  let lastTap = Number.NEGATIVE_INFINITY;

  const cancel = (event: Event): void => event.preventDefault();
  const pinch = (event: Event): void => {
    if ((event as TouchEvent).touches.length > 1) event.preventDefault();
  };
  const tap = (event: Event): void => {
    // A finger still down is part of a pinch, not a tap.
    if ((event as TouchEvent).touches.length > 0) return;

    const moment = now();
    const second = moment - lastTap < DOUBLE_TAP_MS;

    lastTap = second ? Number.NEGATIVE_INFINITY : moment;

    if (second && !event.composedPath().some(node => keepsDoubleTap(node))) event.preventDefault();
  };
  const listeners: [string, (event: Event) => void][] = [
    ["gesturestart", cancel],
    ["gesturechange", cancel],
    ["touchmove", pinch],
    ["touchend", tap]
  ];

  for (const [type, listener] of listeners) target.addEventListener(type, listener, options);

  return (): void => {
    for (const [type, listener] of listeners) target.removeEventListener(type, listener, options);
  };
}
