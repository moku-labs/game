/**
 * @file flow plugin — the JSON of a guide: what `guide()` puts in its descriptor and what the runner
 * derives from the `guide` of a node, one copy rule for both, and the comparison of two of them.
 * Pure: plain data in, plain data out.
 */
import type { Json } from "../model/types";
import type { AnchorTarget } from "../world/projection/types";
import type { GuideOptions } from "./fx/types";
import type { Allow } from "./gate/types";

/** A JSON object. */
type JsonRecord = { [key: string]: Json };

/**
 * Copies one answer into plain JSON. The `payload` key is absent when there is none, so the
 * descriptor survives `JSON.stringify` unchanged.
 *
 * @param allow - The answer a guide lets through, or the one a press outside its window gives.
 * @returns The answer as plain JSON.
 * @example
 * ```ts
 * allowJson({ intent: "merge" }); // { intent: "merge" }: no payload key
 * ```
 */
function allowJson(allow: Allow): Json {
  if (allow.payload === undefined) return { intent: allow.intent };

  return { intent: allow.intent, payload: allow.payload };
}

/**
 * Tells a list of targets from one target.
 *
 * @param target - What `target` was given.
 * @returns True for a list.
 * @example
 * ```ts
 * isTargetList([{ projection: "board", key: "c3" }]); // true
 * ```
 */
function isTargetList(
  target: AnchorTarget | readonly AnchorTarget[]
): target is readonly AnchorTarget[] {
  return Array.isArray(target);
}

/**
 * Copies one target into plain JSON: its projection and its key, nothing else.
 *
 * @param target - A view or an element by projection and key.
 * @returns The target as plain JSON.
 * @example
 * ```ts
 * targetJson({ projection: "board", key: "c3" }); // { projection: "board", key: "c3" }
 * ```
 */
function targetJson(target: AnchorTarget): Json {
  return { projection: target.projection, key: target.key };
}

/**
 * Copies the veil of a guide into plain JSON: `false`, or the colour and the alpha it names.
 *
 * @param veil - The veil of the options.
 * @returns The veil as plain JSON.
 * @example
 * ```ts
 * veilJson({ alpha: 0 }); // { alpha: 0 }: no colour key
 * ```
 */
function veilJson(veil: NonNullable<GuideOptions["veil"]>): Json {
  if (veil === false) return false;

  const copy: JsonRecord = {};

  if (veil.color !== undefined) copy.color = veil.color;
  if (veil.alpha !== undefined) copy.alpha = veil.alpha;

  return copy;
}

/**
 * Builds the payload of a `guide` descriptor: the answers, the targets, the padding and the veil
 * in plain JSON, a key only for an option that was given. The targets, the veil and the highlight
 * list are copied, so a later change of the caller's objects cannot reach them; an answer's payload
 * is taken as it is, as the gate compares it.
 *
 * @param options - The guide's options.
 * @returns The payload.
 * @example
 * ```ts
 * guidePayload({ allow: { intent: "merge" }, target: [{ projection: "board", key: "c3" }], pad: 4 });
 * // { allow: { intent: "merge" }, target: [{ projection: "board", key: "c3" }], pad: 4 }
 * ```
 */
export function guidePayload(options: GuideOptions): JsonRecord {
  const payload: JsonRecord = { allow: allowJson(options.allow) };
  const { target, pad, veil, blocked, highlight, hand, text } = options;

  if (target !== undefined) {
    payload.target = isTargetList(target)
      ? target.map(entry => targetJson(entry))
      : targetJson(target);
  }

  if (pad !== undefined) payload.pad = pad;
  if (veil !== undefined) payload.veil = veilJson(veil);
  if (blocked !== undefined) payload.blocked = allowJson(blocked);
  if (highlight !== undefined) payload.highlight = [...highlight];
  if (hand !== undefined) payload.hand = hand;
  if (text !== undefined) payload.text = text;

  return payload;
}

/**
 * Compares two JSON values by value: the payload of a guide's answer, which points at one
 * concrete move, and two results of a node's `guide`.
 *
 * @param left - First value, `undefined` when absent.
 * @param right - Second value, `undefined` when absent.
 * @returns True when both sides carry the same data.
 * @example
 * ```ts
 * jsonEquals({ from: "c2" }, { from: "c2" }); // true
 * ```
 */
export function jsonEquals(left: Json | undefined, right: Json | undefined): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left)) return Array.isArray(right) && arrayEquals(left, right);
  if (Array.isArray(right)) return false;

  return objectEquals(left, right);
}

/**
 * Compares two JSON arrays element by element.
 *
 * @param left - First array.
 * @param right - Second array.
 * @returns True when both arrays hold the same elements in the same order.
 * @example
 * ```ts
 * arrayEquals(["c3", 2], ["c3", 2]); // true
 * ```
 */
function arrayEquals(left: readonly Json[], right: readonly Json[]): boolean {
  if (left.length !== right.length) return false;

  return left.every((item, index) => jsonEquals(item, right[index]));
}

/**
 * Compares two JSON objects key by key.
 *
 * @param left - First object.
 * @param right - Second object.
 * @returns True when both objects hold the same keys with the same values.
 * @example
 * ```ts
 * objectEquals({ from: "c2" }, { from: "c2" }); // true
 * ```
 */
function objectEquals(left: JsonRecord, right: JsonRecord): boolean {
  const keys = Object.keys(left);

  if (keys.length !== Object.keys(right).length) return false;

  return keys.every(key => jsonEquals(left[key], right[key]));
}
