/**
 * @file renderer/viewport — the safe area: one hidden probe whose padding is `env(safe-area-inset-*)`,
 * read with `getComputedStyle` and cut down to the part that really covers the frame.
 */
import type { Rect, SafeArea } from "./types";

const NONE: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * What `clipToFrame` needs to decide how much of an inset lands on the drawn frame.
 */
export type ClipOptions = {
  insets: SafeArea;
  frame: Rect;
  /** Where the canvas sits in the window. */
  canvas: { left: number; top: number };
  /** Size of the window. */
  window: { width: number; height: number };
  scale: number;
};

/**
 * Reads one CSS length in pixels.
 *
 * @param value - Something like `"47px"`.
 * @returns The number, or 0 when the browser answered nothing.
 * @example
 * ```ts
 * pixels("47px"); // 47
 * ```
 */
function pixels(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");

  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Creates the hidden probe whose padding carries the four insets, and appends it to the body.
 *
 * @returns The probe, or `undefined` without a document.
 */
export function createSafeAreaProbe(): HTMLElement | undefined {
  if (typeof globalThis.document === "undefined") return undefined;

  const probe = globalThis.document.createElement("div");

  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "fixed";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.style.width = "0";
  probe.style.height = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingTop = "env(safe-area-inset-top)";
  probe.style.paddingRight = "env(safe-area-inset-right)";
  probe.style.paddingBottom = "env(safe-area-inset-bottom)";
  probe.style.paddingLeft = "env(safe-area-inset-left)";
  globalThis.document.body.append(probe);

  return probe;
}

/**
 * Reads the four insets the browser resolved on the probe.
 *
 * @param probe - The probe element, or `undefined` while there is none.
 * @returns The insets in CSS pixels.
 */
export function readInsets(probe: HTMLElement | undefined): SafeArea {
  if (probe === undefined || typeof globalThis.getComputedStyle !== "function") return { ...NONE };

  const style = globalThis.getComputedStyle(probe);

  return {
    top: pixels(style.paddingTop),
    right: pixels(style.paddingRight),
    bottom: pixels(style.paddingBottom),
    left: pixels(style.paddingLeft)
  };
}

/**
 * Cuts the insets down to the part that overlaps the drawn frame, still in CSS pixels. A bar
 * already covers the notch: then nothing is left for the game to avoid. The viewport scale is fit
 * to what is left, so this runs before the scale exists.
 *
 * @param options - Insets, frame, canvas origin and window size.
 * @returns The insets that cover the frame, in CSS pixels.
 */
export function clipInsets(options: Omit<ClipOptions, "scale">): SafeArea {
  const { insets, frame, canvas } = options;

  if (frame.width <= 0 || frame.height <= 0) return { ...NONE };

  const left = canvas.left + frame.x;
  const top = canvas.top + frame.y;
  const right = left + frame.width;
  const bottom = top + frame.height;

  return {
    top: Math.max(0, insets.top - top),
    right: Math.max(0, right - (options.window.width - insets.right)),
    bottom: Math.max(0, bottom - (options.window.height - insets.bottom)),
    left: Math.max(0, insets.left - left)
  };
}

/**
 * Cuts the insets down to the part that overlaps the drawn frame and converts them to reference
 * units.
 *
 * @param options - Insets, frame, canvas origin, window size and the scale.
 * @returns The safe area in reference units.
 */
export function clipToFrame(options: ClipOptions): SafeArea {
  const { scale } = options;

  if (scale <= 0) return { ...NONE };

  const clipped = clipInsets(options);

  return {
    top: clipped.top / scale,
    right: clipped.right / scale,
    bottom: clipped.bottom / scale,
    left: clipped.left / scale
  };
}
