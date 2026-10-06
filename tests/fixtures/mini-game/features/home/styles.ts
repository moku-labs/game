/**
 * @file The styles of Home: the two text styles of the game, the screen root, and the round info
 * button, whose two styles a function builds by its size.
 */
import { Glow } from "@moku-labs/game";
import { defineStyle, defineTextStyles } from "../../kit";

/** Cream, the words on the dark screen. */
const cream = 0xff_f3_d6;

/** Honey, the button and its glow. */
const honey = 0xf2_b4_3d;

/** The two text styles: the big counter and the wrapped note under it. */
export const homeStyles = defineTextStyles({
  "ui.counter": { font: "ui.font-body", size: 120, fill: cream, align: "center" },
  "ui.note": { font: "ui.font-body", size: 52, fill: cream, align: "center", wrap: 520 }
});

/** The Home screen: one centred column. */
export const screenStyle = defineStyle({
  width: "100%",
  height: "100%",
  direction: "column",
  align: "center",
  justify: "center",
  gap: 48
});

/**
 * The styles of a round button of one size: the honey disc and the picture in it.
 *
 * @param size - The diameter in reference units.
 * @returns The disc and the picture.
 */
function roundStylesOf(size: number) {
  return {
    disc: defineStyle({
      width: size,
      height: size,
      radius: size / 2,
      fill: honey,
      align: "center",
      justify: "center"
    }),
    picture: defineStyle({ width: size * 0.6, height: size * 0.6 })
  };
}

/** The info button of Home. */
export const infoButton = roundStylesOf(200);

/** The glow of the info button, the one primary button of Home. */
export const infoGlow = Glow({ strength: 1.8, distance: 18, color: honey });
