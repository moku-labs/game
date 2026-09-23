/**
 * @file input plugin — the keyboard. One `keydown` listener on `window` while the canvas is
 * attached turns a DOM key into a `KeyInput` and hands it to the `onKey` listeners. Input knows
 * no focus and no key meaning; `app.input.pressKey` runs the very same listeners headless.
 */
import type { Log } from "@moku-labs/common/browser";
import type { KeyInput, KeyListener, State } from "./types";

/** What running the listeners needs: the state that holds them and the log for a throw. */
type KeysCtx = { readonly state: State; readonly log: Log.LogApi };

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
 * so Tab does not leave the canvas. Without a `window` it does nothing. A second call replaces
 * the first listener instead of adding another.
 *
 * @param ctx - The input state and the log.
 */
export function attachKeys(ctx: KeysCtx): void {
  if (typeof globalThis.window === "undefined") return;

  const target = globalThis.window;
  const listener = (event: KeyboardEvent): void => {
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
