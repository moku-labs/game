/**
 * @file input plugin — the keyboard. One `keydown` listener on `window` while the canvas is
 * attached turns a DOM key into a `KeyInput` and hands it to the `onKey` listeners. Input knows
 * no focus and no key meaning; `app.input.pressKey` runs the very same listeners headless.
 */
import type { Log } from "@moku-labs/common/browser";
import type { KeyInput, KeyListener, State } from "./types";

/** What running the listeners needs: the state that holds them and the log for a throw. */
type KeysCtx = { readonly state: State; readonly log: Log.LogApi };

/** The fields of a `keydown` the text-field check reads. */
type KeyFacts = Pick<KeyboardEvent, "key" | "target" | "isComposing" | "keyCode">;

/** The IME `keyCode` of a key that belongs to a composition. */
const COMPOSING_KEY_CODE = 229;

/**
 * Whether a key event was typed into an element that edits text: an `<input>`, a `<textarea>` or
 * a content-editable element. Read from the target alone, so a fake target works the same.
 *
 * @param target - `KeyboardEvent.target`.
 * @returns True for an editable element.
 */
function isEditable(target: EventTarget | null): boolean {
  if (typeof target !== "object" || target === null) return false;
  if ("isContentEditable" in target && target.isContentEditable === true) return true;
  if (!("tagName" in target)) return false;

  return target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

/**
 * Whether the window `keydown` listener hands a key on to the `onKey` listeners. A key typed into
 * a text field stays with the browser, so typing, Space, Tab, the arrows and Backspace keep their
 * default; Enter and Escape pass, so a field can submit and end the editing. An Enter that commits
 * an IME composition is skipped: it is not a submit.
 *
 * @param event - The `keydown`.
 * @returns `"skip"` keeps the key away from the listeners, `"pass"` hands it on as before.
 */
export function keyFromTextInput(event: KeyFacts): "skip" | "pass" {
  if (!isEditable(event.target)) return "pass";
  if (event.key === "Escape") return "pass";
  if (event.key !== "Enter") return "skip";

  const composing = event.isComposing || event.keyCode === COMPOSING_KEY_CODE;

  return composing ? "skip" : "pass";
}

/**
 * Registers one `onKey` listener at the end of the list.
 *
 * @param state - State of the input plugin.
 * @param fn - What to run with every key.
 * @returns The remover; it drops that one listener and leaves the rest.
 */
export function addKeyListener(state: State, fn: KeyListener): () => void {
  state.keyListeners.push(fn);

  return (): void => {
    const at = state.keyListeners.indexOf(fn);

    if (at !== -1) state.keyListeners.splice(at, 1);
  };
}

/**
 * Runs every `onKey` listener with one key, in registration order. A listener that throws is
 * reported with its key and the listeners after it still run. The list is copied first, so a
 * listener may remove itself while it runs.
 *
 * @param ctx - The input state and the log.
 * @param key - The key that was pressed.
 * @returns True when at least one listener returned `true`.
 */
export function runKeys(ctx: KeysCtx, key: KeyInput): boolean {
  const listeners = [...ctx.state.keyListeners];
  let handled = false;

  for (const listener of listeners) {
    try {
      if (listener(key) === true) handled = true;
    } catch (error) {
      ctx.log.error("input: an onKey listener threw", { key: key.key, error });
    }
  }

  return handled;
}

/**
 * Puts the one `keydown` listener on `window`; a handled key has its browser default prevented,
 * so Tab does not leave the canvas. A key `keyFromTextInput` skips never reaches the listeners. Without a `window` it does nothing. A second call replaces
 * the first listener instead of adding another.
 *
 * @param ctx - The input state and the log.
 */
export function attachKeys(ctx: KeysCtx): void {
  if (typeof globalThis.window === "undefined") return;

  const target = globalThis.window;
  const listener = (event: KeyboardEvent): void => {
    if (keyFromTextInput(event) === "skip") return;
    if (runKeys(ctx, { key: event.key, shift: event.shiftKey })) event.preventDefault();
  };

  detachKeys(ctx.state);
  target.addEventListener("keydown", listener);
  ctx.state.detachKeys = (): void => target.removeEventListener("keydown", listener);
}

/**
 * Takes the `keydown` listener off `window`. A no-op when nothing was attached.
 *
 * @param state - State of the input plugin.
 */
export function detachKeys(state: State): void {
  state.detachKeys?.();
  state.detachKeys = undefined;
}
