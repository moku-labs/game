/**
 * @file renderer plugin — the reasons a frame is drawn and a canvas pass begins, in ring order: the monitor stores a
 * reason by its index. A plain module of the plugin root, so the monitor reads the order without importing the demand
 * module's run-time code (L1), and `host/render-pass.ts` names a begin without importing the monitor; `DemandReason`
 * in `demand/types.ts` is derived from it.
 */

/**
 * Every reason in ring order: the monitor stores the index (spec 11 `FrameColumns.reason`), 255 for a frame without a
 * decision. New reasons are only ever appended (block 3B: `"overlay"`, `"retake"` after `"none"`), so stored indices
 * keep their meaning. There is no whole-frame reason for `renderer.invalidate`: it always names an entity
 * (LEAD-FIXES-4). A root export, so a reader of the ring names a reason without building a record.
 *
 * @example
 * ```ts
 * // An overlay names why the newest frame of a debug build was drawn: a piece moved, a counted change mark.
 * const ring = app.renderer.monitor.frames();
 * DEMAND_REASONS[ring.columns.reason[ring.newest] ?? 255]; // "mark"
 * ```
 */
export const DEMAND_REASONS = [
  "always", // onDemand is off: every frame is drawn
  "first", // nothing was drawn since the host came up
  "resize", // the viewport was applied for a new size (and, with C-d, a new resolution)
  "restore", // the device came back and the tree was rebuilt
  "layers", // the scene handed out a new list of layers
  "debug", // a debug switch moved (the nine-slice outline)
  "wake", // time.wakes() moved since the last decision
  "capture", // a capture waits for a drawn frame
  "request", // the engine asked for a frame itself (block 4: the warm-up probe of F4)
  "mark", // a counted change mark
  "verify", // the pixel oracle found a missed frame and drew it (D6.3)
  "none",
  "overlay", // a range was hidden or shown, a dim moved
  "retake" // a picture was taken or retaken
] as const;

/**
 * Why a canvas pass began: `"none"` on a pass that is no canvas pass (and on WebGL, where the reason is not known),
 * `"first"` the first begin of a render call, `"filter"` a begin after a pass into another target, `"mask"` a restart
 * for a stencil push, `"depth"` a restart for the first depth use, `"empty"` an owed clear or a settle with no draw.
 *
 * @example
 * ```ts
 * // A frame of a debug build drew on the canvas, went through one filter and came back to the canvas.
 * const reason: CanvasRestart = "filter";
 * ```
 */
export type CanvasRestart = "none" | "first" | "filter" | "mask" | "depth" | "empty";

/**
 * The reasons a canvas pass began, by their index in the pass ring's `restart` column: new ones are only ever appended.
 * A root export, so a reader of the ring names a reason without building a record.
 *
 * @example
 * ```ts
 * // The editor's pass strip says why the newest pass of a debug build began.
 * const { passes } = app.renderer.monitor.frames();
 * CANVAS_RESTARTS[passes.restart[passes.newest] ?? 0]; // "filter"
 * ```
 */
export const CANVAS_RESTARTS: readonly CanvasRestart[] = [
  "none",
  "first",
  "filter",
  "mask",
  "depth",
  "empty"
];

/** The index of each reason in `CANVAS_RESTARTS`: what the lazy canvas pass hands the monitor, no string per pass. */
export const RESTART = { none: 0, first: 1, filter: 2, mask: 3, depth: 4, empty: 5 } as const;
