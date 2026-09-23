/**
 * @file The look of the settings popup (design §6 E2, D1) and of the confirm stacked on it (E3):
 * the folder tabs, the sound rows with their − and + and the 10-segment level bar, the language
 * column, the text link, and the button row of the confirm. The board, the ropes, the X and the
 * parchment are the kit's.
 */
import { defineStyle } from "../../kit";
import { theme } from "../ui/kit";

/** The tab strip over the pane. */
export const tabRow = defineStyle({ direction: "row", align: "end", gap: theme.space.sm });

/**
 * One folder tab: darker wood while idle, the paper tab when it is the pane on show. Selected is
 * not disabled: a tap on the current tab still writes the same local state.
 */
export const tabStyle = defineStyle({
  width: 320,
  height: 112,
  align: "center",
  justify: "center",
  nineSlice: "ui.tab-idle",
  is: { selected: { nineSlice: "ui.tab-active" }, hover: { offsetY: -4 }, pressed: { offsetY: 4 } }
});

/** One sound row: icon, name, −, the level bar, +, the percent. */
export const volumeRow = defineStyle({
  direction: "row",
  align: "center",
  gap: 8,
  height: 140
});

/** The note or the speaker at the left of a row. */
export const rowIcon = defineStyle({ width: 56, height: 56 });

/** The name of the bus, one fixed width, so the bars of both rows line up. */
export const rowName = defineStyle({ width: 220, height: 60, justify: "center" });

/** The percent at the right end of a row, one fixed width for the same reason. */
export const rowPercent = defineStyle({ width: 116, height: 60, justify: "center" });

/** The − and the + of a row: small square planks with the states of every control. */
export const stepStyle = defineStyle({
  width: 88,
  height: 88,
  align: "center",
  justify: "center",
  nineSlice: "ui.button-wood",
  is: {
    hover: { offsetY: -4, scale: 1.03 },
    pressed: { offsetY: 6, scale: 0.97 },
    disabled: { nineSlice: "ui.button-disabled" }
  }
});

/** The track of the level bar. */
export const barTrack = defineStyle({
  direction: "row",
  align: "center",
  justify: "center",
  gap: 4,
  width: 184,
  height: 64,
  nineSlice: "ui.bar-track"
});

/** One segment of the bar: honey when lit, walnut when not. */
const segment = {
  width: 12,
  height: 36,
  radius: 4,
  stroke: theme.color.ink,
  strokeWidth: 2
} as const;

/** A lit segment. */
export const segmentOn = defineStyle({ ...segment, fill: theme.color.honey });

/** A dark segment. */
export const segmentOff = defineStyle({ ...segment, fill: theme.color.walnut });

/** The two language planks, one over the other. */
export const languageColumn = defineStyle({
  direction: "column",
  align: "center",
  gap: theme.space.md
});

/** The "Сбросить прогресс" link: no plank, only the berry words. */
export const linkStyle = defineStyle({
  height: 88,
  align: "center",
  justify: "center",
  padding: { left: 24, right: 24 },
  is: { pressed: { offsetY: 3 } }
});

/** The Reset and Cancel of the confirm, side by side. */
export const confirmButtons = defineStyle({
  direction: "row",
  align: "center",
  justify: "center",
  gap: theme.space.md
});
