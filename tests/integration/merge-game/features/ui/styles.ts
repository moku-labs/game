/**
 * @file The text styles every screen of Timber Town draws with (design §2). Two voices: Rubik
 * ExtraBold (`ui.font-display`) for titles, buttons, numbers and item names, Pangolin
 * (`ui.font-body`) for the small hand-lettered lines. Cream words sit on painted wood with a thick
 * ink outline and an ink drop shadow under it; ink words sit on paper. Sizes are reference px at
 * the 1080 short side.
 *
 * The outline widths are measured on the design screenshots: 5 to 6 units on 54 to 64 units of
 * text, 9 to 10 on the logo and the Play sign. A shadow is a copy of the bare glyphs, so its `dy` is
 * larger than the outline, or the outline hides it.
 *
 * The hud feature registers this table, as it registers the `ui` bundle the two fonts come in.
 */
import { defineTextStyles } from "../../kit";

/** Cream: the words on wood, planks and buttons. */
const cream = 0xff_f3_d6;

/** Ink: the outline colour of the art and of the cream words, and the words on paper. */
const ink = 0x3a_22_12;

/** Soft ink: the small lines on paper, one step lighter than the body. */
const softInk = 0x5b_3a_20;

/** Berry: danger, and the text link that resets the progress. */
const berry = 0x8f_23_34;

/**
 * The styles of the design: the seven voices, the bigger words of the popups (the plank label,
 * the "+25" of a reward, the ink tab), the wrapped popup body, the text link and the logo.
 */
export const uiStyles = defineTextStyles({
  "ui.title": {
    font: "ui.font-display",
    size: 64,
    fill: cream,
    stroke: ink,
    strokeWidth: 6,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 9 }
  },
  "ui.button": {
    font: "ui.font-display",
    size: 54,
    fill: cream,
    stroke: ink,
    strokeWidth: 5,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 8, alpha: 0.55 }
  },
  // The label of a small plank: the Deliver of an order card, 250 units wide.
  "ui.button-small": {
    font: "ui.font-display",
    size: 44,
    fill: cream,
    stroke: ink,
    strokeWidth: 4,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 7, alpha: 0.55 }
  },
  // The label of a popup plank (design §6 E): Claim, Later, Reset, the language planks.
  "ui.plank": {
    font: "ui.font-display",
    size: 60,
    fill: cream,
    stroke: ink,
    strokeWidth: 6,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 9, alpha: 0.6 }
  },
  // The number of a HUD pill and of the info bar: "125", "7/10", "3/4".
  "ui.number": {
    font: "ui.font-display",
    size: 60,
    fill: cream,
    stroke: ink,
    strokeWidth: 5,
    digits: true,
    shadow: { color: ink, dx: 0, dy: 8 }
  },
  // The big amount a reward pays: "+25", "+50".
  "ui.amount": {
    font: "ui.font-display",
    size: 100,
    fill: cream,
    stroke: ink,
    strokeWidth: 9,
    digits: true,
    shadow: { color: ink, dx: 0, dy: 13 }
  },
  // Ink words on paper in the display voice: the open settings tab, the percent of a sound row.
  "ui.tab": { font: "ui.font-display", size: 50, fill: ink, align: "center" },
  "ui.name": { font: "ui.font-display", size: 42, fill: ink, align: "center" },
  // A label drawn straight on the painted scene ("Подарок дня", "Загрузка…"): outlined cream.
  "ui.caption": {
    font: "ui.font-display",
    size: 60,
    fill: cream,
    stroke: ink,
    strokeWidth: 6,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 9 }
  },
  // A line on paper: the name of a sound row ("Музыка").
  "ui.body": { font: "ui.font-body", size: 52, fill: ink, align: "center" },
  // The body of a popup on its parchment chip, wrapped to the width of the chip.
  "ui.paragraph": { font: "ui.font-body", size: 52, fill: ink, align: "center", wrap: 520 },
  // The text link of design §6 G: Pangolin in berry ("Сбросить прогресс"), the wave under it.
  "ui.link": { font: "ui.font-body", size: 52, fill: berry, align: "center" },
  "ui.small": { font: "ui.font-body", size: 36, fill: softInk },
  // Small cream digits on a dark or red disc: the charges plate of the sawmill, the red "1" of the gift.
  "ui.badge": {
    font: "ui.font-display",
    size: 34,
    fill: cream,
    stroke: ink,
    strokeWidth: 3,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 5 }
  },
  // The digits on the honey badges of an order card, the level and the "×2": ink, no outline (p2).
  "ui.badgeInk": { font: "ui.font-display", size: 34, fill: ink, align: "center" },
  // The name of the game on the logo sign of Splash and Home, wrapped to two lines (design §6 A1, A2).
  "ui.logo": {
    font: "ui.font-display",
    size: 130,
    fill: cream,
    stroke: ink,
    strokeWidth: 10,
    align: "center",
    wrap: 760,
    shadow: { color: ink, dx: 0, dy: 15 }
  },
  // The word on the Play sign of Home (design §6 A2): "Играть".
  "ui.sign": {
    font: "ui.font-display",
    size: 110,
    fill: cream,
    stroke: ink,
    strokeWidth: 9,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 15, alpha: 0.6 }
  }
});
