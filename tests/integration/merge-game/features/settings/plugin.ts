/**
 * @file The one plugin this game writes: the handler of the `locale` effect. A node cannot call
 * `i18n` — its context is the save and the effects — so the feature that owns the language owns
 * the one line that switches it.
 */
import type { Flow } from "@moku-labs/game";
import { createPlugin, flowPlugin, i18nPlugin } from "@moku-labs/game";

/**
 * Reads the locale out of the descriptor the node awaited.
 *
 * @param descriptor - What `fx({ kind: "locale", … })` carried.
 * @returns The locale, or `undefined` when the payload carries none.
 */
function localeOf(descriptor: Flow.Descriptor): string | undefined {
  const payload = descriptor.payload as { locale?: string } | undefined;

  return typeof payload?.locale === "string" ? payload.locale : undefined;
}

/**
 * Switches the language of the interface when a node asks for it. Registered in `onStart`, so
 * the handler exists before the graph runs; a composition without it — the headless game — sees
 * the effect resolve at once and plays on.
 */
export const settingsLocalePlugin = createPlugin("settingsLocale", {
  depends: [flowPlugin, i18nPlugin],
  onStart: ctx => {
    ctx.require(flowPlugin).fx.handle("locale", async descriptor => {
      const locale = localeOf(descriptor);

      if (locale !== undefined) await ctx.require(i18nPlugin).setLocale(locale);
    });
  }
});
