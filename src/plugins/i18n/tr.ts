/**
 * @file i18n plugin — `tr`, the one call a game writes at a label, and the binder `defineGame`
 * spreads. A message is data: no locale is read here, so the same value survives a locale change
 * and can be stored in a component, compared and logged.
 */
import type { Argument, I18nKit, Message, StringTable, TypedTr } from "./types";

/**
 * Builds a message. The result is frozen and the parameters are copied, so the caller's object
 * stays its own and nothing downstream can rewrite a label in place.
 *
 * @param key - The message key, one of the keys `compileStrings` generated.
 * @param params - The parameters the message declares. An element parameter is kept as it is.
 * @returns The message, frozen.
 * @example
 * ```ts
 * tr("hud.orders", { n: 3 }); // { key: "hud.orders", params: { n: 3 } }
 * tr("orders.complete"); // { key: "orders.complete" }
 * ```
 */
export function tr(key: string, params?: Record<string, Argument>): Message {
  if (params === undefined) return Object.freeze({ key });

  return Object.freeze({ key, params: Object.freeze({ ...params }) });
}

/**
 * Binds `tr` to the generated string table of one game. At run time this is the same function;
 * only the type changes, so a wrong key or a missing parameter stops compiling.
 *
 * @returns The helper `defineGame` spreads.
 * @example
 * ```ts
 * const { tr } = i18nFor<{ "hud.orders": { n: number } }>();
 * tr("hud.orders", { n: 3 }).key; // "hud.orders"
 * ```
 */
export function i18nFor<Table extends StringTable>(): I18nKit<Table> {
  return { tr: tr as TypedTr<Table> };
}
