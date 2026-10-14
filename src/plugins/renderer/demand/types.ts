/**
 * @file renderer/demand — types of the demand module: why a frame is drawn, the marks since the last decision, and the
 * module's internal API.
 */
import type { Entity } from "../../world/types";
import type { PixiBounds } from "../types";

/**
 * Every reason in ring order: the monitor stores the index (spec 11 `FrameColumns.reason`). New reasons are only ever
 * appended (block 3B: `"overlay"`, `"retake"` after `"none"`), so stored indices keep their meaning. There is no
 * whole-frame reason for `renderer.invalidate`: it always names an entity (LEAD-FIXES-4).
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
  "none"
] as const;

/**
 * Why the render phase drew a frame, or `"none"` when it did not. Internal: `monitor` and the agent log read it.
 */
export type DemandReason = (typeof DEMAND_REASONS)[number];

/**
 * The last decision of the render phase, one object reused every frame.
 */
export type DemandFrame = { drawn: boolean; reason: DemandReason; marks: number };

/**
 * demand module state, `ctx.state.demand`.
 */
export type DemandState = {
  /** Entities marked by a compared or structural write since the last decision. */
  marked: Set<Entity>;
  /** Marked entities whose view was not drawn at mark time; counted at the decision when drawn then. */
  pending: Set<Entity>;
  /** Entities a display adapter reported after its `update` (not `false`): counted unless an ancestor is hidden. */
  loose: Set<Entity>;
  /**
   * Every whole-frame reason found since the last decision (O17, LEAD-FIXES-3). The first one added is
   * `frame().reason`, as spec 14 says; the set keeps the others visible to the overlay step and `kept.collect`.
   */
  wholes: Set<DemandReason>;
  /** A mark of this decision counted at once: its view was drawn when it was written. */
  counted: boolean;
  /** `time.wakes()` at the last decision. */
  wakes: number;
  /** A frame was drawn since the host came up. */
  drawnOnce: boolean;
  /** Frames the engine asked for itself, not yet drawn. */
  requests: number;
  /** The last decision. */
  frame: DemandFrame;
  /** The Pixi `Bounds` the off-screen test measures into; made on first use. */
  bounds: PixiBounds | undefined;
  /** Every entity marked since the last drawn frame: dev and agent builds only, for the check and the oracle. */
  sinceDraw: Set<Entity>;
  /** The dev missed-mark check: entities already reported, and whether the check switched itself off. */
  check: { warned: Set<Entity>; off: boolean };
  /** The pixel oracle: on or off, and the pixels of the last frame that was (or would have been) drawn. */
  verify: { on: boolean; reference: Uint8ClampedArray | undefined };
};

/**
 * The demand module: change marks, the render phase's decision and the oracles. Internal (no public half: the public
 * member is `Api.invalidate`). Derived from the member table of spec 14 D1.3 plus `invalidate` of D3.2.
 */
export type DemandInternal = {
  /** Before a write that changes what Pixi holds for the entity's view, and before every structural write. */
  mark(entity: Entity): void;
  /** After an adapter `update` that did not answer `false`. */
  markLoose(entity: Entity): void;
  /** Adds a whole-frame reason to `wholes` (O17). */
  whole(reason: DemandReason): void;
  /** Every whole-frame reason of the current decision (O17, LEAD-FIXES-3; replaces spec 14's single `due`). */
  wholes(): ReadonlySet<DemandReason>;
  /** One frame the engine asks for itself (the block 4 warm-up). */
  request(): void;
  /** The render phase's decision; answers whether to draw. */
  decide(captureWaiting: boolean): boolean;
  /** After the frame: the dev check on a skipped frame, the pixel oracle. */
  settle(drawn: boolean): void;
  /** The last decision, for `monitor` and the agent log. */
  frame(): Readonly<DemandFrame>;
  /** The F6/F18a predicate. */
  shown(entity: Entity): boolean;
  /** Marks of the current decision. */
  marked(): ReadonlySet<Entity>;
  /** The pixel oracle switch, behind `DebugApi.verifyFrames`. */
  verifyFrames(on: boolean): void;
  /** Whether the pixel oracle is on. */
  verifying(): boolean;
  /** The body of the public `renderer.invalidate`: a mark of an entity that has a view. */
  invalidate(entity: Entity): void;
};
