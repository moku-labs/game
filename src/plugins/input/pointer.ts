/**
 * @file input plugin — the only file that touches the pointer DOM. The six listeners turn a
 * pointer event into a raw sample and queue it; for a down, an up and a cancel they then run the
 * `onPointer` listeners, the one synchronous door. They hit-test nothing, answer nothing and write
 * no component; the frame step owns every decision.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PointerListener, RawSample, State } from "./types";

/** What the DOM listeners need: the state that holds the queue and the log for a throw. */
type PointerCtx = { readonly state: State; readonly log: Log.LogApi };

/** Which DOM event becomes which sample. A lost capture ends the gesture like a cancel. */
const POINTER_EVENTS: ReadonlyArray<{
  name:
    | "pointerdown"
    | "pointermove"
    | "pointerup"
    | "pointercancel"
    | "lostpointercapture"
    | "pointerleave";
  kind: RawSample["kind"];
}> = [
  { name: "pointerdown", kind: "down" },
  { name: "pointermove", kind: "move" },
  { name: "pointerup", kind: "up" },
  { name: "pointercancel", kind: "cancel" },
  { name: "lostpointercapture", kind: "lost" },
  { name: "pointerleave", kind: "leave" }
];

/**
 * The device of a DOM pointer event. A browser that cannot tell reports an empty string, which
 * counts as a mouse.
 *
 * @param type - `PointerEvent.pointerType`.
 * @returns The device the gesture machine knows.
 * @example
 * ```ts
 * pointerTypeOf(""); // "mouse"
 * ```
 */
function pointerTypeOf(type: string): RawSample["pointerType"] {
  return type === "touch" || type === "pen" ? type : "mouse";
}

/**
 * Queues one raw sample and wakes `time`: a finger on the screen always runs at the full frame
 * rate, even when nothing moved for seconds. A move replaces a trailing move of the same pointer,
 * so a burst of pointer events between two frames costs one entry instead of twenty.
 *
 * @param state - State of the input plugin.
 * @param sample - What the listener saw.
 */
export function record(state: State, sample: RawSample): void {
  state.wake?.();

  const last = state.samples.at(-1);

  if (sample.kind === "move" && last?.kind === "move" && last.pointerId === sample.pointerId) {
    state.samples[state.samples.length - 1] = sample;

    return;
  }

  state.samples.push(sample);
}

/**
 * Whether the `onPointer` listeners hear a sample kind: a down, an up and a cancel, the moments a
 * browser still counts as a user gesture.
 *
 * @param kind - The kind of the queued sample.
 * @returns True for `down`, `up` and `cancel`.
 * @example
 * ```ts
 * isDoorKind("move"); // false
 * ```
 */
function isDoorKind(kind: RawSample["kind"]): boolean {
  return kind === "down" || kind === "up" || kind === "cancel";
}

/**
 * Registers one `onPointer` listener at the end of the list.
 *
 * @param state - State of the input plugin.
 * @param fn - What to run with every down, up and cancel sample.
 * @returns The remover; it drops that one listener and leaves the rest.
 */
export function addPointerListener(state: State, fn: PointerListener): () => void {
  state.pointerListeners.push(fn);

  return (): void => {
    const at = state.pointerListeners.indexOf(fn);

    if (at !== -1) state.pointerListeners.splice(at, 1);
  };
}

/**
 * Runs every `onPointer` listener with one sample, in registration order. A listener that throws
 * is reported with the sample kind and the listeners after it still run. The list is copied first,
 * so a listener may remove itself while it runs.
 *
 * @param ctx - The input state and the log.
 * @param sample - The sample the DOM listener just queued.
 */
function runPointerListeners(ctx: PointerCtx, sample: RawSample): void {
  const listeners = [...ctx.state.pointerListeners];

  for (const listener of listeners) {
    try {
      listener(sample);
    } catch (error) {
      ctx.log.error("input: an onPointer listener threw", { kind: sample.kind, error });
    }
  }
}

/**
 * Puts the six pointer listeners on the canvas and takes the browser's own gestures away, so a
 * drag does not scroll the page. `pointerdown` also prevents its default: the compatibility
 * `mousedown` would blur a text field focused by an `onPointer` listener. The remover is kept in
 * the state; it also gives the canvas back the cursor it had.
 *
 * @param canvas - The canvas of the Pixi application.
 * @param ctx - The input state and the log.
 */
export function attach(canvas: HTMLCanvasElement, ctx: PointerCtx): void {
  const { state } = ctx;
  const previousTouchAction = canvas.style.touchAction;
  const previousCursor = canvas.style.cursor;
  const attached = POINTER_EVENTS.map(entry => {
    const listener = (event: PointerEvent): void => {
      if (entry.kind === "down") event.preventDefault();

      const sample: RawSample = {
        kind: entry.kind,
        pointerType: pointerTypeOf(event.pointerType),
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY
      };

      record(state, sample);
      if (isDoorKind(entry.kind)) runPointerListeners(ctx, sample);
    };

    canvas.addEventListener(entry.name, listener);

    return { name: entry.name, listener };
  });

  canvas.style.touchAction = "none";

  state.detach = (): void => {
    for (const entry of attached) canvas.removeEventListener(entry.name, entry.listener);
    canvas.style.touchAction = previousTouchAction;
    canvas.style.cursor = previousCursor;
  };
}

/**
 * Removes the listeners of the attached canvas and restores its touch action and its cursor. A
 * no-op when nothing was attached.
 *
 * @param state - State of the input plugin.
 */
export function detach(state: State): void {
  state.detach?.();
  state.detach = undefined;
  state.cursor = undefined;
}
