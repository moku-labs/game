/**
 * @file input plugin — the only file that touches the DOM. The six listeners do one thing: turn
 * a pointer event into a raw sample and queue it. They hit-test nothing, answer nothing and write
 * no component; the frame step owns every decision.
 */
import type { RawSample, State } from "./types";

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
 * Puts the six pointer listeners on the canvas and takes the browser's own gestures away, so a
 * drag does not scroll the page. The remover is kept in the state.
 *
 * @param canvas - The canvas of the Pixi application.
 * @param state - State of the input plugin.
 */
export function attach(canvas: HTMLCanvasElement, state: State): void {
  const previousTouchAction = canvas.style.touchAction;
  const attached = POINTER_EVENTS.map(entry => {
    const listener = (event: PointerEvent): void => {
      record(state, {
        kind: entry.kind,
        pointerType: pointerTypeOf(event.pointerType),
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY
      });
    };

    canvas.addEventListener(entry.name, listener);

    return { name: entry.name, listener };
  });

  canvas.style.touchAction = "none";

  state.detach = (): void => {
    for (const entry of attached) canvas.removeEventListener(entry.name, entry.listener);
    canvas.style.touchAction = previousTouchAction;
  };
}

/**
 * Removes the listeners of the attached canvas and restores its touch action. A no-op when
 * nothing was attached.
 *
 * @param state - State of the input plugin.
 */
export function detach(state: State): void {
  state.detach?.();
  state.detach = undefined;
}
