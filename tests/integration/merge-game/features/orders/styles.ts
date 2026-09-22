/**
 * @file The look of the reward popup: the panel it is drawn in and the button that closes it.
 */
import { defineStyle } from "../../kit";
import { tokens } from "../hud/styles";

/** The panel of the popup, centred by the layout of the popup layer. */
export const rewardPanel = defineStyle({
  direction: "column",
  align: "center",
  justify: "center",
  gap: tokens.space.sm,
  padding: tokens.space.md,
  width: 640,
  height: 420,
  radius: tokens.radius.card,
  fill: tokens.color.bar,
  stroke: tokens.color.accent,
  strokeWidth: 4
});

/** The one button of the popup: it answers `claim`, which is the outcome of the component. */
export const claimButton = defineStyle({
  direction: "column",
  align: "center",
  justify: "center",
  width: 320,
  height: 120,
  radius: tokens.radius.card,
  fill: tokens.color.card,
  is: { pressed: { fill: tokens.color.accent } }
});
