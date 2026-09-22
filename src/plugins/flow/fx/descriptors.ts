/**
 * @file flow/fx — descriptor helpers. Pure: they produce plain data.
 */
import type { Json } from "../../model/types";
import type { Allow } from "../gate/types";
import type { Descriptor, GuideOptions, Hint } from "./types";

/**
 * Copies one allowed answer into plain JSON. The `payload` key is absent when there is none, so
 * the descriptor survives `JSON.stringify` unchanged.
 *
 * @param allow - The one answer a guide lets through.
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
 * Creates a fire-and-forget cosmetic descriptor for `fx.emit`. It is dispatched only after the
 * commit of its transaction and dropped in fast mode.
 *
 * @param kind - Effect kind a handler is registered for.
 * @param payload - Plain JSON for the handler.
 * @returns The hint as plain data.
 * @example
 * ```ts
 * // Inside a node body: sparkle on the merged cell, shown once the edge has committed.
 * fx.emit(hint("sparkle", { cell: "c3" }));
 * // hint("sparkle", { cell: "c3" }) is { kind: "sparkle", payload: { cell: "c3" }, hint: true }
 * ```
 */
export function hint(kind: string, payload?: Json): Hint {
  if (payload === undefined) return { kind, hint: true };

  return { kind, payload, hint: true };
}

/**
 * Creates the awaited effect that asks the clock for one `elapsed` at this moment. `undefined`
 * means nothing is due and leaves the `moment` key out, so the descriptor stays plain JSON. Its
 * handler runs in fast mode too.
 *
 * @param moment - Epoch milliseconds of the next due timer, or `undefined`.
 * @returns The descriptor a node awaits.
 * @example
 * ```ts
 * // Inside a node body, after the rules changed a timer: ask for the next `elapsed`.
 * await fx(schedule(1_790_000_060_000)); // payload: { moment: 1790000060000 }
 * await fx(schedule(undefined)); // payload: {}, the pending timer is cancelled
 * ```
 */
export function schedule(moment: number | undefined): Descriptor {
  if (moment === undefined) return { kind: "schedule", payload: {} };

  return { kind: "schedule", payload: { moment } };
}

/**
 * Creates the tutorial descriptor: it narrows the gate to one answer until the node exits. Its
 * visual part (`target`, highlight, hand, text) is drawn by `ui`, which dims the screen and cuts
 * a hole over the target element. The highlight list and the target are copied, so a later change
 * of the caller's objects cannot reach the descriptor.
 *
 * @param options - The allowed answer and the visual hints.
 * @returns The descriptor a node awaits.
 * @example
 * ```ts
 * // A tutorial node: the popup lists two intents, the guide lets only "ok" through.
 * await fx(guide({ allow: { intent: "ok" }, target: { projection: "hud", key: "play" } }));
 * await fx({ kind: "popup", answers: ["ok", "cancel"] });
 * // app.flow.gate.answer({ intent: "cancel" }) is false until the node exits
 * ```
 */
export function guide(options: GuideOptions): Descriptor {
  const payload: { [key: string]: Json } = { allow: allowJson(options.allow) };

  if (options.target !== undefined) {
    payload.target = { projection: options.target.projection, key: options.target.key };
  }

  if (options.highlight !== undefined) payload.highlight = [...options.highlight];
  if (options.hand !== undefined) payload.hand = options.hand;
  if (options.text !== undefined) payload.text = options.text;

  return { kind: "guide", payload };
}
