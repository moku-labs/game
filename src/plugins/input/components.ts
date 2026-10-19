/**
 * @file input plugin — behaviour as data: the six gesture components, the tags a game system
 * reads, the `Pointer` resource and the internal `Scrollable` ui puts on a scroll. Pure: no ctx,
 * no state, no DOM. Made with the `component()`, `tag()` and `resource()` helpers of `world`, so
 * nothing has to be registered.
 */
import type { Json } from "../model/types";
import { component, resource, tag } from "../world/ecs/define";

/**
 * A gesture that names an intent. `payload` is a plain JSON object of model keys, never an
 * entity id: the flow graph reads it as the payload of the answer.
 *
 * @example
 * ```ts
 * const value: IntentValue = { intent: "merge", payload: { to: "c3" } };
 * ```
 */
export type IntentValue = { intent: string; payload: Json };

/**
 * A view that can be carried. It names no intent: the drop target does. `carry` lists the
 * projection keys of views of the same projection that ride along on top of it, such as the cards
 * that lie on a solitaire card. `aim` is a point of the view in its own units, the units of its
 * hit box: with it the hover and the drop look the target up under that point of the view in the
 * hand, not under the finger. Absent, the default, or `null`, it looks under the finger; a
 * projection takes an aim away by not giving it. Absent by default, so a view without an aim is
 * stored and serialised exactly as before the aim existed.
 *
 * @example
 * ```ts
 * const value: CarryValue = { payload: { from: "c7" }, carry: ["c8", "c9"] };
 * // A board item whose picture is lifted above the finger: the drop goes to the cell under the picture.
 * const lifted: CarryValue = { payload: { from: "c7" }, carry: [], aim: { x: 25, y: 12 } };
 * ```
 */
export type CarryValue = {
  payload: Json;
  carry: readonly string[];
  /** A point of the view in the hand, in its own units, that aims the drop; absent (the default) or `null` aims with the finger. */
  aim?: { x: number; y: number } | null;
};

/**
 * Where the one pointer is, in reference units. `justPressed` and `justReleased` are true for
 * exactly one frame. `id` is the `pointerId` of the pointer the gesture machine follows, `-1` when
 * it follows none. It changes while `down` stays true when a resting finger (pressed, not moved
 * past the tap slop, no long press, no trace) gives way to another finger: a system that measures
 * the finger's travel from frame to frame starts over then.
 *
 * @example
 * ```ts
 * const value: PointerValue = {
 *   x: 540, y: 960, down: true, justPressed: false, justReleased: false, id: 3
 * };
 * ```
 */
export type PointerValue = {
  x: number;
  y: number;
  down: boolean;
  justPressed: boolean;
  justReleased: boolean;
  /** The `pointerId` the resource follows; `-1` at rest. */
  id: number;
};

/**
 * How a scroll container moves, as input reads it: the axis it moves on, and whether it moves
 * now — held, flinging or gliding.
 *
 * @example
 * ```ts
 * const value: ScrollableValue = { axis: "x", moving: true };
 * ```
 */
export type ScrollableValue = { axis: "x" | "y"; moving: boolean };

const scrollableDefaults: ScrollableValue = { axis: "y", moving: false };

/**
 * Fresh defaults for a component that names an intent. A function, so each component type gets
 * its own payload object instead of sharing one.
 *
 * @returns An empty intent and an empty payload.
 * @example
 * ```ts
 * intentDefaults(); // { intent: "", payload: {} }
 * ```
 */
function intentDefaults(): IntentValue {
  return { intent: "", payload: {} };
}

/**
 * Fresh defaults for the one component that carries a payload without an intent.
 *
 * @returns An empty payload and nothing carried along.
 * @example
 * ```ts
 * carryDefaults(); // { payload: {}, carry: [] }
 * ```
 */
function carryDefaults(): CarryValue {
  return { payload: {}, carry: [] };
}

const pointerDefaults: PointerValue = {
  x: 0,
  y: 0,
  down: false,
  justPressed: false,
  justReleased: false,
  id: -1
};

/**
 * A tap on this view answers `{ intent, payload }`.
 */
export const Tappable = /*#__PURE__*/ component("Tappable", intentDefaults());

/**
 * A long press on this view answers `{ intent, payload }`.
 */
export const Pressable = /*#__PURE__*/ component("Pressable", intentDefaults());

/**
 * This view can be carried by the finger. It names no intent; the drop target does. The views
 * whose keys `carry` lists hang under it from the grab to the release and fly home with it. With
 * an `aim`, the hover and the drop are looked up under that point of the view in the hand.
 */
export const Draggable = /*#__PURE__*/ component("Draggable", carryDefaults());

/**
 * A drop on this view answers THIS intent, with the carried payload merged under it.
 */
export const DropTarget = /*#__PURE__*/ component("DropTarget", intentDefaults());

/**
 * A swipe on this view answers `{ intent, payload: { ...payload, direction } }`.
 */
export const Swipeable = /*#__PURE__*/ component("Swipeable", intentDefaults());

/**
 * A finger drawn through views that carry this answers once, on the release:
 * `{ intent, payload: { path } }`, the payloads of the cells in the order the finger went through
 * them. Going back to the cell before the last takes the last one off. It wins over every other
 * gesture component on the same view.
 */
export const Traceable = /*#__PURE__*/ component("Traceable", intentDefaults());

/**
 * Takes a press without naming a gesture: the hit test accepts a view that carries only this tag,
 * and a tap on it runs the `onTap` listeners and answers nothing. `ui` tags the buttons that
 * write local state and name no intent.
 */
export const Touchable = /*#__PURE__*/ tag("Touchable");

/**
 * On the carried view, from grab to release.
 */
export const Held = /*#__PURE__*/ tag("Held");

/**
 * On the topmost drop target under the finger during a drag. At most one, never the held view.
 */
export const Hovered = /*#__PURE__*/ tag("Hovered");

/**
 * On every view of the trace in progress, from the moment the finger reaches it until it backs
 * off it or the trace ends. A game system draws the line through them.
 */
export const Traced = /*#__PURE__*/ tag("Traced");

/**
 * On the pressed view, from pointer down until a tap, a long press, a grab, a swipe or a cancel.
 */
export const Pressed = /*#__PURE__*/ tag("Pressed");

/**
 * On the topmost view a press would take, while a mouse or a pen moves over it with no press. At
 * most one view carries it, and a touch never hovers. A touch sample, a pointer cancel, the pointer
 * leaving the canvas and a paused world take it away. `ui` reads it as `is.hover`. It is not
 * `Hovered`, which marks the drop target under a drag.
 */
export const PointerOver = /*#__PURE__*/ tag("PointerOver");

/**
 * On every ui scroll container, internal: ui writes it, input reads it, a game never sees it. A
 * press that leaves the tap slop along `axis` goes from the pressed view to the innermost scroll
 * of that axis the view hangs in by its `Parent` chain; a finger that lands on a view inside a
 * scroll that is `moving` stops it and answers nothing.
 */
export const Scrollable = /*#__PURE__*/ component("Scrollable", scrollableDefaults);

/**
 * Where the one pointer is, in reference units. Written once per frame by the frame step. `id`
 * names the pointer it follows, `-1` at rest.
 */
export const Pointer = /*#__PURE__*/ resource("Pointer", pointerDefaults);
