/**
 * @file input plugin — the Answer of a gesture. The three builders are pure, so the finger and
 * `app.input.*` produce the very same answer; `submit` is the one door to `flow.gate`.
 */
import type { Answer } from "../flow/types";
import type { Json } from "../model/types";
import type { Entity } from "../world/ecs/types";
import type { CarryValue, IntentValue } from "./components";
import type { Direction, InputCtx } from "./types";

/**
 * Reads a component payload as a record. A payload that is not a plain JSON object is dropped:
 * the answer of a gesture is always an object, so a game can merge keys into it.
 *
 * @param payload - What the component carries.
 * @returns The payload as a record, or an empty one.
 * @example
 * ```ts
 * asRecord({ from: "c2" }); // { from: "c2" }
 * asRecord(7); // {}
 * ```
 */
function asRecord(payload: Json): Record<string, Json> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return {};

  return payload;
}

/**
 * Builds the answer of a tap or of a long press: the component's own intent and payload.
 *
 * @param gesture - The `Tappable` or `Pressable` value of the view.
 * @returns The answer to hand to the gate.
 * @example
 * ```ts
 * tapAnswer({ intent: "found", payload: { id: "lamp" } });
 * // { intent: "found", payload: { id: "lamp" } }
 * ```
 */
export function tapAnswer(gesture: IntentValue): Answer {
  return { intent: gesture.intent, payload: gesture.payload };
}

/**
 * Builds the answer of a drop: the drop TARGET names the intent, and its payload wins a key the
 * carried view also brought.
 *
 * @param draggable - The `Draggable` value of the carried view.
 * @param target - The `DropTarget` value of the view under the finger.
 * @returns The answer to hand to the gate.
 * @example
 * ```ts
 * dropAnswer({ payload: { from: "c2" } }, { intent: "merge", payload: { to: "c3" } });
 * // { intent: "merge", payload: { from: "c2", to: "c3" } }
 * ```
 */
export function dropAnswer(draggable: CarryValue, target: IntentValue): Answer {
  return {
    intent: target.intent,
    payload: { ...asRecord(draggable.payload), ...asRecord(target.payload) }
  };
}

/**
 * Builds the answer of a swipe: the component's intent, with the direction added to the payload.
 *
 * @param gesture - The `Swipeable` value of the view.
 * @param direction - The dominant axis of the move.
 * @returns The answer to hand to the gate.
 * @example
 * ```ts
 * swipeAnswer({ intent: "swap", payload: { cell: "c2" } }, "right");
 * // { intent: "swap", payload: { cell: "c2", direction: "right" } }
 * ```
 */
export function swipeAnswer(gesture: IntentValue, direction: Direction): Answer {
  return { intent: gesture.intent, payload: { ...asRecord(gesture.payload), direction } };
}

/**
 * Hands one answer to `flow.gate`. An empty intent is a dev mistake — the view declared a gesture
 * and forgot to name it — so it is reported with the projection it came from and still offered,
 * which keeps the return value honest.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The view the answer came from, for the warning.
 * @param answer - The answer one of the builders produced.
 * @returns What `flow.gate.answer` returned.
 */
export function submit(ctx: InputCtx, entity: Entity, answer: Answer): boolean {
  if (answer.intent === "") {
    ctx.log.warn("input: empty intent", { view: ctx.deps.world.projection.keyOf(entity) });
  }

  return ctx.deps.flow.gate.answer(answer);
}
