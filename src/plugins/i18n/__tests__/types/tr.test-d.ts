import { expectTypeOf } from "vitest";
import type { Strings as MiniStrings } from "../../../../../tests/fixtures/mini-game/generated/strings";
import { createPlugin } from "../../../../config";
import { i18nPlugin } from "../../index";
import { i18nFor, tr as looseTr } from "../../tr";
import type {
  DurationStyle,
  ElementNode,
  Events,
  I18nApi,
  I18nCtx,
  Message,
  TextKey
} from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. It stands in for what `defineGame<Types>()` hands a game.
// ---------------------------------------------------------------------------

/** What `compileStrings` would generate for a game with five messages. */
type Strings = {
  "chest.opens": { left: number };
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

// ─── the own event reaches the plugin context ─────────────────

// `emit` is the kernel's, typed with i18n's event map: no narrowing, no cast.
declare const i18nCtx: I18nCtx;

expectTypeOf(i18nCtx.emit).parameter(0).toEqualTypeOf<"i18n:locale-changed">();

i18nCtx.emit("i18n:locale-changed", { locale: "en" });

// @ts-expect-error — the payload of "i18n:locale-changed" is { locale: string }, not a number.
i18nCtx.emit("i18n:locale-changed", { locale: 1 });

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

// ─── a duration parameter is milliseconds ─────────────────────

tr("chest.opens", { left: 95_000 });

// @ts-expect-error — `{left, duration}` takes milliseconds as a number, not a string.
tr("chest.opens", { left: "95" });

// ─── app.i18n.duration takes one of the four styles ───────────

declare const i18n: I18nApi;

expectTypeOf(i18n.duration(95_000)).toEqualTypeOf<string>();
expectTypeOf<DurationStyle>().toEqualTypeOf<"long" | "short" | "narrow" | "digital">();

i18n.duration(95_000, "digital");

// @ts-expect-error — "tiny" is not a duration style.
i18n.duration(95_000, "tiny");

// ─── keys that come from data ─────────────────────────────────

const { key } = i18nFor<Strings>();

// The keys without parameters, derived from the table: a data table or a save holds one of these.
expectTypeOf<TextKey<Strings>>().toEqualTypeOf<"orders.complete">();

// A real generated table writes `Record<string, never>` for a message without parameters: its only
// key is a TextKey, so no list has to be generated next to `Strings`.
expectTypeOf<TextKey<MiniStrings>>().toEqualTypeOf<"home.note">();

expectTypeOf(key("orders.complete")).toEqualTypeOf<"orders.complete">();
expectTypeOf(tr(key("orders.complete"))).toEqualTypeOf<
  Message<"orders.complete", Record<string, never>>
>();

// @ts-expect-error — "hud.orders" takes { n }, so a table of keys alone cannot hold it.
key("hud.orders");

// @ts-expect-error — "nope" is not a key of this game.
key("nope");

declare const saved: string;
declare const fromSave: unknown;

// @ts-expect-error — a plain string read from a save is no key: tr stays strict.
tr(saved);

// One isKey, one signature: the app of a game types app.i18n as I18nApi<TextKey<Strings>>
// (WithGameState), so the value read from the save narrows to a key tr takes alone.
declare const gameI18n: I18nApi<TextKey<Strings>>;

if (gameI18n.isKey(fromSave)) {
  expectTypeOf(fromSave).toEqualTypeOf<"orders.complete">();
  tr(fromSave);
}

// An engine plugin's ctx.require(i18nPlugin) has no table: the same guard narrows to string only.
declare const engineI18n: I18nApi;
declare const fromData: unknown;

if (engineI18n.isKey(fromData)) {
  expectTypeOf(fromData).toEqualTypeOf<string>();
  // @ts-expect-error — a string is not a key of this game: only the game's I18nApi narrows to one.
  tr(fromData);
}

// The table types the guard only: a game's I18nApi passes where the engine's is expected.
expectTypeOf<I18nApi<TextKey<Strings>>>().toExtend<I18nApi>();

// The kit has no isKey of its own: the app's i18n is the one form.
expectTypeOf(i18nFor<Strings>()).not.toHaveProperty("isKey");
