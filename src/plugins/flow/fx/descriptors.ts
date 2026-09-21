/**
 * @file flow/fx — descriptor helpers skeleton. Pure: they produce plain data.
 */
import type { Json } from "../../model/types";
import type { Descriptor, GuideOptions, Hint } from "./types";

/**
 * Creates a fire-and-forget cosmetic descriptor for `fx.emit`. It is dispatched only after the
 * commit of its transaction and dropped in fast mode.
 *
 * @param _kind - Effect kind a handler is registered for.
 * @param _payload - Plain JSON for the handler.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * fx.emit(hint("sparkle", { cell: "c3" }));
 * ```
 */
export function hint(_kind: string, _payload?: Json): Hint {
  throw new Error("not implemented");
}

/**
 * Creates the awaited effect that asks the clock for one `elapsed` at this moment. `undefined`
 * means nothing is due. Its handler runs in fast mode too.
 *
 * @param _moment - Epoch milliseconds of the next due timer, or `undefined`.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * await fx(schedule(rules.nextDue(player, tables)));
 * ```
 */
export function schedule(_moment: number | undefined): Descriptor {
  throw new Error("not implemented");
}

/**
 * Creates the tutorial descriptor: it narrows the gate to one answer until the node exits. Its
 * visual part (highlight, hand, text) is handled by `ui` later.
 *
 * @param _options - The allowed answer and the visual hints.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * await fx(guide({ allow: { intent: "merge", payload: { from: "c2", to: "c3" } }, hand: "drag" }));
 * ```
 */
export function guide(_options: GuideOptions): Descriptor {
  throw new Error("not implemented");
}
