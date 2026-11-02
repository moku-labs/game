/**
 * @file flow/fx — descriptor helpers. Pure: they produce plain data.
 */
import type { Json } from "../../model/types";
import { guidePayload } from "../guide";
import type { Descriptor, GuideOptions, Hint } from "./types";

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
export function schedule(moment: number | undefined): Descriptor<void> {
  if (moment === undefined) return { kind: "schedule", payload: {} };

  return { kind: "schedule", payload: { moment } };
}

/**
 * Creates the tutorial descriptor: it narrows the gate to one answer, and to the `blocked` one a
 * press outside the window gives, until the node exits. Its visual part is drawn by `ui`: a veil
 * over the screen with a window cut over the targets (one or the union of a list), grown by `pad`,
 * and the input lock outside that window; `veil: false` draws nothing and still locks. The targets,
 * the veil and the highlight list are copied, so a later change of the caller's objects cannot
 * reach the descriptor.
 *
 * @param options - The allowed answer, the targets, the veil and the answer of a blocked press.
 * @returns The descriptor a node awaits.
 * @example
 * ```ts
 * // A tutorial node: the popup lists two intents, the guide lets only "ok" through.
 * await fx(guide({ allow: { intent: "ok" }, target: { projection: "hud", key: "play" } }));
 * await fx({ kind: "popup", answers: ["ok", "cancel"] });
 * // app.flow.gate.answer({ intent: "cancel" }) is false until the node exits
 * ```
 */
export function guide(options: GuideOptions): Descriptor<void> {
  return { kind: "guide", payload: guidePayload(options) };
}
