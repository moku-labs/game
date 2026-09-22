import { expectTypeOf } from "vitest";
import { createPlugin } from "../../../../config";
import { i18nPlugin } from "../../index";
import { i18nFor, tr as looseTr } from "../../tr";
import type { ElementNode, Events, Message } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. It stands in for what `defineGame<Types>()` hands a game.
// ---------------------------------------------------------------------------

/** What `compileStrings` would generate for a game with four messages. */
type Strings = {
  "hud.coins": { icon: string | number | readonly string[] | ElementNode; n: number };
  "hud.orders": { n: number };
  "orders.complete": Record<string, never>;
  "settings.tab": { id: "audio" | "language" };
};

const { tr } = i18nFor<Strings>();

// ─── the key comes from the generated table ───────────────────

expectTypeOf(tr("hud.orders", { n: 3 })).toEqualTypeOf<Message<"hud.orders", { n: number }>>();

// @ts-expect-error — "hud.order" is not a key of this game.
tr("hud.order", { n: 3 });

// ─── params are required exactly when the message takes them ──

expectTypeOf(tr("orders.complete")).toEqualTypeOf<
  Message<"orders.complete", Record<string, never>>
>();

// @ts-expect-error — "hud.orders" takes { n: number }; the call passes none.
tr("hud.orders");

// @ts-expect-error — "n" is a number, not a string.
tr("hud.orders", { n: "3" });

// @ts-expect-error — "orders.complete" takes no parameters.
tr("orders.complete", { n: 3 });

// ─── a select parameter is the union of its options ───────────

tr("settings.tab", { id: "audio" });
tr("settings.tab", { id: "language" });

// @ts-expect-error — "video" is not one of the options the message declares.
tr("settings.tab", { id: "video" });

// ─── an element parameter is accepted where the message allows one ─

const icon: ElementNode = { type: "icon", props: { name: "hud.coin" }, children: [] };

tr("hud.coins", { n: 25, icon });
tr("hud.coins", { n: 25, icon: "25" });

// @ts-expect-error — "hud.coins" needs both parameters.
tr("hud.coins", { n: 25 });

// ─── the loose export stays wide, so a plugin still compiles ──

expectTypeOf(looseTr("anything", { n: 3 })).toEqualTypeOf<Message>();
looseTr("anything");

// ─── the event a plugin above hooks ───────────────────────────

createPlugin("localeProbe", {
  depends: [i18nPlugin],
  hooks: () => ({
    "i18n:locale-changed": payload => {
      expectTypeOf(payload).toEqualTypeOf<Events["i18n:locale-changed"]>();
      expectTypeOf(payload.locale).toEqualTypeOf<string>();
    }
  })
});
