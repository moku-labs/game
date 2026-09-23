/**
 * @file The text styles every screen of Timber Town draws with (design §2). Two voices: Rubik
 * ExtraBold (`ui.font-display`) for titles, buttons, numbers and item names, Pangolin
 * (`ui.font-body`) for the small hand-lettered lines. Cream words sit on painted wood over an ink
 * shadow; ink words sit on paper. Sizes are reference px at the 1080 short side.
 *
 * The hud feature registers this table, as it registers the `ui` bundle the two fonts come in.
 */
import { defineTextStyles } from "../../kit";

/** Cream: the words on wood, planks and buttons. */
const cream = 0xff_f3_d6;

/** Ink: the outline colour of the art, and the words on paper. */
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
    align: "center",
    shadow: { color: ink, dx: 0, dy: 4 }
  },
  "ui.button": {
    font: "ui.font-display",
    size: 54,
    fill: cream,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 3, alpha: 0.55 }
  },
  // The label of a small plank: the Deliver of an order card, 250 units wide.
  "ui.button-small": {
    font: "ui.font-display",
    size: 44,
    fill: cream,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 3, alpha: 0.55 }
  },
  // The label of a popup plank (design §6 E): Claim, Later, Reset, the language planks.
  "ui.plank": {
    font: "ui.font-display",
    size: 60,
    fill: cream,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 4, alpha: 0.6 }
  },
  // The number of a HUD pill and of the info bar: "125", "7/10", "3/4".
  "ui.number": {
    font: "ui.font-display",
    size: 60,
    fill: cream,
    digits: true,
    shadow: { color: ink, dx: 0, dy: 3 }
  },
  // The big amount a reward pays: "+25", "+50".
  "ui.amount": {
    font: "ui.font-display",
    size: 100,
    fill: cream,
    digits: true,
    shadow: { color: ink, dx: 0, dy: 5 }
  },
  // Ink words on paper in the display voice: the open settings tab, the percent of a sound row.
  "ui.tab": { font: "ui.font-display", size: 50, fill: ink, align: "center" },
  "ui.name": { font: "ui.font-display", size: 42, fill: ink, align: "center" },
  // A label drawn straight on the painted scene ("Подарок дня", "Загрузка…"): cream with a shadow.
  "ui.caption": {
    font: "ui.font-display",
    size: 60,
    fill: cream,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 3 }
  },
  // A line on paper: the name of a sound row ("Музыка").
  "ui.body": { font: "ui.font-body", size: 52, fill: ink, align: "center" },
  // The body of a popup on its parchment chip, wrapped to the width of the chip.
  "ui.paragraph": { font: "ui.font-body", size: 52, fill: ink, align: "center", wrap: 520 },
  // The text link of design §6 G: Pangolin in berry ("Сбросить прогресс"), the wave under it.
  "ui.link": { font: "ui.font-body", size: 52, fill: berry, align: "center" },
  "ui.small": { font: "ui.font-body", size: 36, fill: softInk },
  // The number on a level badge and on the red "1" of the gift: small cream digits on a disc.
  "ui.badge": {
    font: "ui.font-display",
    size: 34,
    fill: cream,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 2 }
  },
  // The name of the game on the logo sign of Splash and Home, wrapped to two lines (design §6 A1, A2).
  "ui.logo": {
    font: "ui.font-display",
    size: 130,
    fill: cream,
    align: "center",
    wrap: 760,
    shadow: { color: ink, dx: 0, dy: 7 }
  },
  // The word on the Play sign of Home (design §6 A2): "Играть".
  "ui.sign": {
    font: "ui.font-display",
    size: 110,
    fill: cream,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 6, alpha: 0.6 }
  }
});
