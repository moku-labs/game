/**
 * @file renderer plugin — the reasons a frame is drawn, in ring order: the monitor stores a reason by its index. A
 * plain module of the plugin root, so the monitor reads the order without importing the demand module's run-time code
 * (L1); `DemandReason` in `demand/types.ts` is derived from it.
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
