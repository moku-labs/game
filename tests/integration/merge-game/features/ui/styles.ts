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

/** The pale yellow of the V3 interface, kept by its three style keys until the views move on. */
const paleHoney = 0xff_e0_82;

/** The six styles of the design, plus the three V3 keys the current views still use. */
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
  "ui.small": { font: "ui.font-body", size: 36, fill: softInk },
  // The three keys the V3 views still draw with: their sizes and colours, on the new fonts.
  "hud.digits": { font: "ui.font-display", size: 48, fill: paleHoney, digits: true },
  "hud.label": { font: "ui.font-body", size: 28, fill: 0xff_ff_ff, align: "center" },
  "hud.title": { font: "ui.font-display", size: 40, fill: paleHoney, align: "center" }
});
