/**
 * @file renderer/demand — types of the demand module: why a frame is drawn, the marks since the last decision, and the
 * module's internal API.
 */
import type { Entity } from "../../world/types";
import type { DEMAND_REASONS } from "../reasons";
import type { PixiBounds, PixiContainer } from "../types";
import type { MarkList } from "./marks";

/**
 * Why the render phase drew a frame, or `"none"` when it did not. Internal: `monitor` and the agent log read it.
 */
export type DemandReason = (typeof DEMAND_REASONS)[number];

/**
 * Where the walk of `shown` stopped (spec 26 R1.7.3): `"shown"` when the view is drawn; `"alpha-above"` at a view
 * above it hidden by `"alpha"`; `"alpha-own"` at its own view hidden by `"alpha"`; `"off-screen"` for a leaf whose
 * padded bounds miss the screen; `"other"` for anything else (empty, kept, a hidden layer, a game's object at alpha 0,
 * out of the tree, no view). Internal: `sync.loopsHeld` reads it.
 */
export type Unseen = "shown" | "alpha-above" | "alpha-own" | "off-screen" | "other";

/**
 * The change marks of one kind of the running decision, read: each entity once, in mark order. What a `Set` offered
 * its readers, kept in a list that empties without allocating (`MarkList`). Internal.
 */
export type Marks = {
  /** Entities marked in this decision. */
  readonly size: number;
  /**
   * Tells whether an entity is marked in this decision.
   *
   * @param entity - The entity.
   * @returns True when it is.
   */
  has(entity: Entity): boolean;
  /**
   * The entity marked `index`-th in this decision: a walk by index makes no iterator.
   *
   * @param index - 0 to `size - 1`.
   * @returns The entity; 0 past the end.
   */
  at(index: number): Entity;
  /** Walks the marks, allocating an iterator: for a test or a spread, never per frame. */
  [Symbol.iterator](): Iterator<Entity>;
};

/**
 * The last decision of the render phase, one object reused every frame.
 */
export type DemandFrame = { drawn: boolean; reason: DemandReason; marks: number };

/**
 * demand module state, `ctx.state.demand`.
 */
export type DemandState = {
  /** Entities marked by a compared or structural write since the last decision. */
  marked: MarkList;
  /** Marked entities whose view was not drawn at mark time; counted at the decision when drawn then. */
  pending: MarkList;
  /** Entities a display adapter reported after its `update` (not `false`): counted unless an ancestor is hidden. */
  loose: MarkList;
  /** Marked by a write that changes what the view draws (`mark`): the kept cache retakes its picture. */
  visual: MarkList;
  /** Marked by a write of the view's own transform or depth (`markMoved`): a kept picture only moves. */
  moved: MarkList;
  /** Marked through the public `invalidate`: a filter value or a self-drawn object about to change. */
  published: MarkList;
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
  /** The node at alpha 0 where the last walk of a chain stopped; one object, rewritten by every walk (R1.7.3). */
  stop: { node: PixiContainer | undefined };
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
  /** Before a write of the transform or the depth of the view's own top: `mark` for the decision, a move for `kept`. */
  markMoved(entity: Entity): void;
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
  /** The F6/F18a predicate: `unseenBy(entity) === "shown"`. */
  shown(entity: Entity): boolean;
  /** Where the walk of `shown` stopped for the entity's view, for `sync.loopsHeld` (spec 26 R1.7.3). */
  unseenBy(entity: Entity): Unseen;
  /** Marks of the current decision. */
  marked(): Marks;
  /** The adapter marks of the current decision, as `marked()` for the others. */
  loose(): Marks;
  /** The marks of the current decision made by `mark`: what a view draws changed. */
  visual(): Marks;
  /** The marks of the current decision made by `markMoved`: a view's own transform or depth changed. */
  moved(): Marks;
  /** The marks of the current decision made through the public `invalidate`. */
  published(): Marks;
  /** The pixel oracle switch, behind `DebugApi.verifyFrames`. */
  verifyFrames(on: boolean): void;
  /** Whether the pixel oracle is on. */
  verifying(): boolean;
  /** The body of the public `renderer.invalidate`: a mark of an entity that has a view. */
  invalidate(entity: Entity): void;
};
