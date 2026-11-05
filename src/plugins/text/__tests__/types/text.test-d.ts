import { expectTypeOf } from "vitest";
import type { TextFormatsOf } from "../../../flow/types";
import { component } from "../../../world/ecs/define";
import {
  bind,
  Countdown,
  defineTextFormats as looseFormats,
  label as looseLabel,
  defineTextStyles as looseStyles,
  Text,
  textFor
} from "../../components";
import type {
  BindOptions,
  Config,
  CountdownValue,
  FormattedNumber,
  Size,
  TextApi,
  TextBind,
  TextFormat,
  TextFormats,
  TextRunStyle,
  TextStyleInput,
  TextStyles,
  TextValue
} from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. It stands in for what `defineGame<Types>()` hands a game.
// ---------------------------------------------------------------------------

/** The style keys one game registered, as `defineGame` computes them. */
type StyleKey = "body" | "digits" | "hud.digits";

/** The font keys the asset scanner generated for that game. */
type FontKey = "ui.font-body" | "ui.font-digits";

const { label, defineTextStyles } = textFor<StyleKey, FontKey>();

// ─── the style key comes from the game's registered styles ────

label({ text: "+5", style: "hud.digits", at: { x: 0, y: 0 } });

// @ts-expect-error — "hud.title" is not one of the registered styles
label({ text: "+5", style: "hud.title", at: { x: 0, y: 0 } });

// ─── the font of a style is an asset key of the game ──────────

defineTextStyles({ "hud.digits": { font: "ui.font-digits", size: 40, fill: 0 } });

// @ts-expect-error — "ui.font-comic" is not an asset of this game
defineTextStyles({ "hud.digits": { font: "ui.font-comic", size: 40, fill: 0 } });

// @ts-expect-error — a style names its font and its size
defineTextStyles({ "hud.digits": { size: 40, fill: 0 } });

// ─── what the helpers answer ──────────────────────────────────

expectTypeOf(defineTextStyles({})).toEqualTypeOf<TextStyles>();
expectTypeOf(label({ text: "+5", style: "body", at: { x: 0, y: 0 } })[0].value).toEqualTypeOf<
  Readonly<TextValue>
>();

// ─── a Text fades by a number, so a tween can drive it ────────

expectTypeOf<TextValue["alpha"]>().toEqualTypeOf<number>();

// @ts-expect-error — alpha is a number from 0 to 1, not a string
Text({ alpha: "0.5" });

// ─── a bound number comes from bind(), on a numeric field only ─

const Counter = component("Counter", { value: 0, name: "" });

expectTypeOf(bind(Counter, "value")).toEqualTypeOf<TextBind>();
expectTypeOf(bind(Countdown, "left", { format: "mm:ss" })).toEqualTypeOf<TextBind>();
Text({ style: "digits", bind: bind(Counter, "value") });

// @ts-expect-error — `name` is a string field, not a number
bind(Counter, "name");

// @ts-expect-error — a literal lacks the brand only bind() supplies
Text({ bind: { component: "Counter", field: "value", format: "int" } });

// @ts-expect-error — the old two-field literal does not compile either
Text({ bind: { component: "Counter", field: "value" } });

// @ts-expect-error — "ss" is not a TextFormat
bind(Counter, "value", { format: "ss" });

expectTypeOf<TextFormat>().toEqualTypeOf<"int" | "mm:ss" | "h:mm:ss" | "duration">();
expectTypeOf<BindOptions>().toEqualTypeOf<{ format?: TextFormat }>();
expectTypeOf(Countdown().value).toEqualTypeOf<Readonly<CountdownValue>>();

// ─── the loose helpers take any name, as a plugin without a game does ─

looseLabel({ text: "+5", style: "anything", at: { x: 0, y: 0 } });
looseStyles({ anything: { font: "any.font", size: 1, fill: 0 } });

// ─── the API answers a size ───────────────────────────────────

declare const measured: Size;

expectTypeOf(measured).toEqualTypeOf<{ width: number; height: number }>();

// ─── the config names the two boot fonts and nothing else ─────

declare const config: Config;

expectTypeOf(config).toEqualTypeOf<{ fonts: { body: string; digits: string } }>();

// ─── a game's own number format ───────────────────────────────

/** The helpers of a game that named one format. */
const pillKit = textFor<StyleKey, FontKey, "pill.number">();

pillKit.bind(Counter, "value", { format: "pill.number" });
pillKit.bind(Counter, "value", { format: "mm:ss" });

// @ts-expect-error — the game named no format "pill.big"
pillKit.bind(Counter, "value", { format: "pill.big" });

// @ts-expect-error — the root `bind` takes the four built-in formats, no name of a game
bind(Counter, "value", { format: "pill.number" });

// @ts-expect-error — a game that named no format has the four built-in ones
textFor<StyleKey, FontKey>().bind(Counter, "value", { format: "pill.number" });

pillKit.defineTextFormats({ "pill.number": value => ({ content: `${value}`, style: "body" }) });

pillKit.defineTextFormats({
  // @ts-expect-error — "digits.14" is not one of the game's styles
  "pill.number": value => ({ content: `${value}`, style: "digits.14" })
});

// @ts-expect-error — a format owns the style of its label: it must answer one
pillKit.defineTextFormats({ "pill.number": value => ({ content: `${value}` }) });

// The root helper takes any style name: `text` warns once about one it does not know.
expectTypeOf(
  looseFormats({ "pill.number": value => ({ content: `${value}`, style: "digits.14" }) })
).toEqualTypeOf<TextFormats>();

expectTypeOf<TextApi["formatted"]>().returns.toEqualTypeOf<FormattedNumber | undefined>();

// The union `defineGame` binds: no names when a game passed none, so a typo does not compile.
type BareGame = { player: number; session: number; assets: string; strings: Record<string, never> };

expectTypeOf<TextFormatsOf<BareGame & { textFormats: "a" | "b" }>>().toEqualTypeOf<"a" | "b">();
expectTypeOf<TextFormatsOf<BareGame>>().toBeNever();

// ─── F152: the look of <b>, and the first-line indent ─────────

const count: TextRunStyle = { font: "any.bold", size: 16, fill: 0xff_00_00 };

looseStyles({ anything: { font: "any.font", size: 13, fill: 0, boldStyle: count } });
defineTextStyles({
  "hud.digits": {
    font: "ui.font-body",
    size: 13,
    fill: 0,
    boldStyle: { font: "ui.font-digits", size: 16 }
  }
});
defineTextStyles({ "hud.digits": { font: "ui.font-body", size: 13, fill: 0, textIndent: 20 } });

/** A row style of the game with what a case puts in its boldStyle. */
const row = { font: "ui.font-body", size: 13, fill: 0 } as const;

// @ts-expect-error — a bold look is a glyph look: `wrap` is the paragraph's
defineTextStyles({ "hud.digits": { ...row, boldStyle: { wrap: 200 } } });

// @ts-expect-error — "ui.font-comic" is not an asset of this game, in boldStyle either
defineTextStyles({ "hud.digits": { ...row, boldStyle: { font: "ui.font-comic" } } });

// @ts-expect-error — the indent is reference px, not a CSS string
defineTextStyles({ "hud.digits": { font: "ui.font-body", size: 13, fill: 0, textIndent: "20px" } });

expectTypeOf<TextStyleInput["textIndent"]>().toEqualTypeOf<number | undefined>();
expectTypeOf<TextStyleInput["boldStyle"]>().toEqualTypeOf<TextRunStyle | undefined>();
