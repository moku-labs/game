/**
 * @file renderer/viewport — the safe area: two hidden probes whose size is the insets, each a
 * `--moku-safe-*` custom property that falls back to `--moku-device-safe-*` (the editor's device
 * preset, E-I1), then to `env(safe-area-inset-*)`, read with `getComputedStyle` and cut down to the
 * part that really covers the frame.
 */
import type { Rect, SafeArea, SafeAreaProbes } from "./types";

const NONE: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The sizes of the probes: the public contract. A page, a game or the native shell sets `--moku-safe-*`; the editor sets
 * `--moku-device-safe-*` from its device preset, which a page's own value still overrides.
 */
const TOP = "var(--moku-safe-top, var(--moku-device-safe-top, env(safe-area-inset-top, 0px)))";
const RIGHT =
  "var(--moku-safe-right, var(--moku-device-safe-right, env(safe-area-inset-right, 0px)))";
const BOTTOM =
  "var(--moku-safe-bottom, var(--moku-device-safe-bottom, env(safe-area-inset-bottom, 0px)))";
const LEFT = "var(--moku-safe-left, var(--moku-device-safe-left, env(safe-area-inset-left, 0px)))";

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
 * Creates one hidden probe whose content box is the given width by height, and appends it to the
 * body.
 *
 * @param document - The document of the page.
 * @param side - `"start"` or `"end"`, the `data-moku-safe-area` attribute.
 * @param size - The CSS width and height.
 * @param size.width - The CSS width: an inset of the left or of the right.
 * @param size.height - The CSS height: an inset of the top or of the bottom.
 * @returns The probe.
 */
function createProbe(
  document: Document,
  side: "start" | "end",
  size: { width: string; height: string }
): HTMLElement {
  const probe = document.createElement("div");

  probe.setAttribute("aria-hidden", "true");
  probe.dataset.mokuSafeArea = side;
  probe.style.position = "fixed";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.style.margin = "0";
  probe.style.padding = "0";
  probe.style.border = "0";
  probe.style.boxSizing = "content-box";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.width = size.width;
  probe.style.height = size.height;
  document.body.append(probe);

  return probe;
}

/**
 * Creates the two hidden probes whose size is the safe area, and appends them to the body. Two,
 * because one element padded by all four insets measures `left + right` by `top + bottom`: a
 * rotation that swaps the left and the right inset would change nothing a `ResizeObserver` sees.
 * With one inset per axis as the content size of each probe, every inset change is a size change.
 *
 * @returns `start` (left by top) and `end` (right by bottom), or `undefined` without a document.
 */
export function createSafeAreaProbes(): SafeAreaProbes | undefined {
  if (typeof globalThis.document === "undefined") return undefined;

  const { document } = globalThis;

  return {
    start: createProbe(document, "start", { width: LEFT, height: TOP }),
    end: createProbe(document, "end", { width: RIGHT, height: BOTTOM })
  };
}

/**
 * Reads the four insets the browser resolved on the probes: top and left from `start`, right and
 * bottom from `end`.
 *
 * @param probes - The two probes, or `undefined` while there are none.
 * @returns The insets in CSS pixels.
 */
export function readInsets(probes: SafeAreaProbes | undefined): SafeArea {
  if (probes === undefined || typeof globalThis.getComputedStyle !== "function") {
    return { ...NONE };
  }

  const start = globalThis.getComputedStyle(probes.start);
  const end = globalThis.getComputedStyle(probes.end);

  return {
    top: pixels(start.height),
    right: pixels(end.width),
    bottom: pixels(end.height),
    left: pixels(start.width)
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
  // A page with no window size (headless, a stand-in page) has no edges to avoid: measured against a
  // 0 × 0 window the whole frame would count as unsafe.
  if (options.window.width <= 0 || options.window.height <= 0) return { ...NONE };

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
