import { expectTypeOf } from "vitest";
import { label as looseLabel, defineTextStyles as looseStyles, textFor } from "../../components";
import type { Size, TextStyles, TextValue } from "../../types";

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

// ─── the loose helpers take any name, as a plugin without a game does ─

looseLabel({ text: "+5", style: "anything", at: { x: 0, y: 0 } });
looseStyles({ anything: { font: "any.font", size: 1, fill: 0 } });

// ─── the API answers a size ───────────────────────────────────

declare const measured: Size;

expectTypeOf(measured).toEqualTypeOf<{ width: number; height: number }>();
