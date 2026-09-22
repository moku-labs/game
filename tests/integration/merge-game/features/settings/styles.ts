/**
 * @file The look of the settings screen: the panel, the tab strip and the small buttons inside.
 */
import { defineStyle } from "../../kit";
import { tokens } from "../hud/styles";

/** The panel of the settings popup. */
export const settingsPanel = defineStyle({
  direction: "column",
  align: "center",
  justify: "start",
  gap: tokens.space.sm,
  padding: tokens.space.md,
  width: 720,
  height: 520,
  radius: tokens.radius.card,
  fill: tokens.color.bar
});

/** A row of buttons: the tab strip and the volume line are both one. */
export const buttonRow = defineStyle({
  direction: "row",
  align: "center",
  justify: "center",
  gap: tokens.space.xs,
  width: 640,
  height: 110
});

/** One tab. The active one is filled, which is the `active` state of the style. */
export const tabButton = defineStyle({
  direction: "column",
  align: "center",
  justify: "center",
  width: 300,
  height: 96,
  radius: tokens.radius.card,
  fill: tokens.color.card,
  is: { active: { fill: tokens.color.accent }, pressed: { fill: tokens.color.accent } }
});

/** One small button: louder, quieter, English, close. */
export const smallButton = defineStyle({
  direction: "column",
  align: "center",
  justify: "center",
  width: 200,
  height: 96,
  radius: tokens.radius.card,
  fill: tokens.color.card,
  is: { pressed: { fill: tokens.color.accent } }
});
