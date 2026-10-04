/**
 * @file input plugin — behaviour as data: the six gesture components, the tags a game system
 * reads and the `Pointer` resource. Pure: no ctx, no state, no DOM. Made with the
 * `component()`, `tag()` and `resource()` helpers of `world`, so nothing has to be registered.
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
 * that lie on a solitaire card.
 *
 * @example
 * ```ts
 * const value: CarryValue = { payload: { from: "c7" }, carry: ["c8", "c9"] };
 * ```
 */
export type CarryValue = { payload: Json; carry: readonly string[] };

/**
 * Where the one pointer is, in reference units. `justPressed` and `justReleased` are true for
 * exactly one frame.
 *
 * @example
 * ```ts
 * const value: PointerValue = {
 *   x: 540, y: 960, down: true, justPressed: false, justReleased: false
 * };
 * ```
 */
export type PointerValue = {
  x: number;
  y: number;
  down: boolean;
  justPressed: boolean;
  justReleased: boolean;
};

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
  justReleased: false
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
 * whose keys `carry` lists hang under it from the grab to the release and fly home with it.
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
 * Where the one pointer is, in reference units. Written once per frame by the frame step.
 */
export const Pointer = /*#__PURE__*/ resource("Pointer", pointerDefaults);
