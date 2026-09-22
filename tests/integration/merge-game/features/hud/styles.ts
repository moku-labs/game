/**
 * @file The look of the HUD: the design tokens of the game, the layout styles of the top bar and
 * the three text styles the interface draws with. Styles are data, so the HUD markup reads as
 * structure and nothing else.
 */
import { defineStyle, defineTextStyles, defineTokens } from "../../kit";

/** The design table of this game: four spaces, four colours, two radii. */
export const tokens = defineTokens({
  space: { xs: 8, sm: 16, md: 24 },
  color: { bar: 0x1b_22_30, card: 0x2a_33_42, accent: 0xc9_8b_2e, text: 0xff_e0_82 },
  radius: { card: 16 }
});

/** The top bar: one row across the reference width, its children spread over it. */
export const topBar = defineStyle({
  direction: "row",
  align: "center",
  justify: "between",
  gap: tokens.space.sm,
  padding: tokens.space.sm,
  width: 1080,
  height: 140,
  fill: tokens.color.bar
});

/** The order card: the button a delivered order is given through. */
export const orderCard = defineStyle({
  direction: "column",
  align: "center",
  justify: "center",
  gap: tokens.space.xs,
  width: 420,
  height: 108,
  radius: tokens.radius.card,
  fill: tokens.color.card,
  is: {
    disabled: { alpha: 0.4 },
    pressed: { fill: tokens.color.accent }
  }
});

/** The square button that opens the settings. */
export const iconButton = defineStyle({
  direction: "column",
  align: "center",
  justify: "center",
  width: 180,
  height: 108,
  radius: tokens.radius.card,
  fill: tokens.color.card,
  is: { pressed: { fill: tokens.color.accent } }
});

/** How far the top bar keeps its children from its edge. The coin counter reads it too. */
export const barPadding = tokens.space.sm;

/** How tall a button of the bar is. The coin slot matches it, so the row stays even. */
export const barItemHeight = 108;

/** The space the coin counter is drawn into. The counter is its own projection. */
export const coinSlot = defineStyle({ width: 220, height: barItemHeight });

/** The three text styles of the interface. `body` and `digits` stay as the engine built them. */
export const hudStyles = defineTextStyles({
  "hud.digits": { font: "ui.font-digits", size: 48, fill: tokens.color.text, digits: true },
  "hud.label": { font: "ui.font-body", size: 28, fill: 0xff_ff_ff, align: "center" },
  "hud.title": { font: "ui.font-body", size: 40, fill: tokens.color.text, align: "center" }
});
