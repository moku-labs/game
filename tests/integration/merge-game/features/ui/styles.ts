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

/** The styles of the design: seven voices, the wrapped popup body and the text link. */
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
  "ui.number": {
    font: "ui.font-display",
    size: 52,
    fill: cream,
    digits: true,
    shadow: { color: ink, dx: 0, dy: 3 }
  },
  "ui.name": { font: "ui.font-display", size: 42, fill: ink, align: "center" },
  "ui.body": { font: "ui.font-body", size: 44, fill: ink, align: "center" },
  // The body of a popup: the same voice, wrapped to the width of the parchment.
  "ui.paragraph": { font: "ui.font-body", size: 44, fill: ink, align: "center", wrap: 560 },
  // The text link of design §6 G: Pangolin in berry ("Сбросить прогресс").
  "ui.link": { font: "ui.font-body", size: 44, fill: berry, align: "center" },
  "ui.small": { font: "ui.font-body", size: 36, fill: softInk },
  // The number on a level badge and on the red "1" of the gift: small cream digits on a disc.
  "ui.badge": {
    font: "ui.font-display",
    size: 34,
    fill: cream,
    align: "center",
    shadow: { color: ink, dx: 0, dy: 2 }
  }
});
