/**
 * @file The look of the settings popup (design §6 E2, D1) and of the two popups stacked on it, the
 * confirm (E3) and the rename: the folder tabs that sit on the parchment, the sound rows on two
 * lines with their − and +, the 10-segment level bar that grows to fill, the language column, the
 * name pane, the text link with its wave, the button row of the confirm, and the name field in its
 * frame with its counter. The board, the ropes, the X and the parchment are the kit's.
 */
import { defineStyle } from "../../kit";
import { theme } from "../ui/kit";

/**
 * How tall the open tab is, and how far it reaches down over the border of the parchment. Three
 * tabs of this width and their gaps fit the 806 units of the parchment.
 */
const tab = { height: 120, idleHeight: 100, width: 250, overlap: 12 } as const;

/**
 * The padding above the settings pane: the lower half of the title plaque, the room between it
 * and the tabs, and the tabs themselves, which stand on the parchment.
 */
export const settingsTop = 266;

/**
 * The tab strip: it stands on the top edge of the parchment, centred over it, so the open tab
 * reaches down over the border and becomes one sheet with the paper (design §6 D1). It is a child
 * of the parchment, drawn after it, which is what lets the open tab cover the border.
 */
export const tabRow = defineStyle({
  position: "absolute",
  top: tab.overlap - tab.height,
  left: 0,
  right: 0,
  height: tab.height,
  direction: "row",
  align: "end",
  justify: "center",
  gap: 18,
  reason: "the folder tabs stand on the top edge of the parchment (design §6 D1)"
});

/** The pointer states of a tab: it lifts under the mouse and sinks when pressed. */
const tabStates = { hover: { offsetY: -4 }, pressed: { offsetY: 4 } } as const;

/** The open tab: the paper tab, taller, down over the border of the parchment. */
export const tabOpen = defineStyle({
  width: tab.width,
  height: tab.height,
  align: "center",
  justify: "center",
  padding: { bottom: tab.overlap },
  nineSlice: "ui.tab-active",
  is: tabStates
});

/**
 * An idle tab: the darker wood, shorter, standing on the border. Selected is not disabled: a tap
 * on it writes the local state of the popup.
 */
export const tabIdle = defineStyle({
  width: tab.width,
  height: tab.idleHeight,
  margin: { bottom: tab.overlap },
  align: "center",
  justify: "center",
  nineSlice: "ui.tab-idle",
  is: tabStates
});

/** One sound row: its name and percent on the first line, −, the bar and + on the second. */
export const volumeRow = defineStyle({
  direction: "column",
  alignSelf: "stretch",
  gap: 20
});

/** The first line of a sound row: the icon and the name on the left, the percent on the right. */
export const volumeLine = defineStyle({
  direction: "row",
  align: "center",
  justify: "between",
  height: 64
});

/** The icon and the name of a bus, side by side. */
export const rowName = defineStyle({ direction: "row", align: "center", gap: theme.space.md });

/** The note or the speaker in front of the name. */
export const rowIcon = defineStyle({ width: 60, height: 60 });

/** The percent at the right end of the first line. */
export const rowPercent = defineStyle({ height: 64, justify: "center" });

/** The second line of a sound row: −, the bar, +. */
export const volumeControls = defineStyle({
  direction: "row",
  align: "center",
  gap: theme.space.md,
  height: 124
});

/** The − and the + of a row: square wood planks with the states of every control. */
export const stepStyle = defineStyle({
  width: 120,
  height: 120,
  align: "center",
  justify: "center",
  nineSlice: "ui.button-wood",
  is: {
    hover: { offsetY: -4, scale: 1.03 },
    pressed: { offsetY: 6, scale: 0.97 },
    disabled: { nineSlice: "ui.button-disabled" }
  }
});

/**
 * The bars of the − and + glyph (design §6 E2): bold cream strokes about 40 % of the button, in an
 * ink outline drawn inside their rect.
 */
const glyphBar = { long: 50, thick: 24, outline: 5.5 } as const;

/** The box of the − and + glyph, centred on the step button. */
export const stepGlyph = defineStyle({ width: glyphBar.long, height: glyphBar.long });

/** What every glyph bar shares: cream, rounded, placed by its own position in the box. */
const bar = {
  position: "absolute",
  radius: 4,
  fill: theme.color.cream,
  reason: "the bars of − and + cross in the middle of the glyph box"
} as const;

/** The outline of a glyph bar: the ink around the cream. */
const outline = { stroke: theme.color.ink, strokeWidth: glyphBar.outline } as const;

/** Where the bars lie across the box: the middle band of its height, or of its width. */
const middle = (glyphBar.long - glyphBar.thick) / 2;

/** The horizontal bar of − and +, with its ink outline. */
export const glyphAcross = defineStyle({
  ...bar,
  ...outline,
  left: 0,
  top: middle,
  width: glyphBar.long,
  height: glyphBar.thick
});

/** The vertical bar of +, with its ink outline. */
export const glyphDown = defineStyle({
  ...bar,
  ...outline,
  left: middle,
  top: 0,
  width: glyphBar.thick,
  height: glyphBar.long
});

/**
 * The cream inside the outline of the horizontal bar, laid again over the crossing of +: it hides
 * the outline of the vertical bar where the two bars meet, so the plus has one outline.
 */
export const glyphJoin = defineStyle({
  ...bar,
  left: glyphBar.outline,
  top: middle + glyphBar.outline,
  width: glyphBar.long - 2 * glyphBar.outline,
  height: glyphBar.thick - 2 * glyphBar.outline
});

/** The track of the level bar: it grows to fill what − and + leave. */
export const barTrack = defineStyle({
  direction: "row",
  align: "center",
  grow: 1,
  gap: 8,
  height: 90,
  padding: { left: 22, right: 22 },
  nineSlice: "ui.bar-track"
});

/** One segment of the bar: a honey capsule when lit, a dark one when not. */
const segment = { grow: 1, height: 54, radius: 16 } as const;

/** A lit segment. */
export const segmentOn = defineStyle({
  ...segment,
  fill: theme.color.honey,
  stroke: 0xc7_84_1c,
  strokeWidth: 3
});

/** A dark segment. */
export const segmentOff = defineStyle({ ...segment, fill: 0x7a_4a_28, alpha: 0.75 });

/** The two language planks, one over the other, across the paper. */
export const languageColumn = defineStyle({
  direction: "column",
  alignSelf: "stretch",
  gap: 36
});

/** The name pane: the player's name over the plank that opens the Rename popup. */
export const profileColumn = defineStyle({
  direction: "column",
  alignSelf: "stretch",
  align: "center",
  gap: 36
});

/**
 * How much the tap box of the reset link reaches past its words and wave, above and below. The
 * link draws 99 units tall (words 65, gap 2, wave 16, padding 16), so its box is 143: over the 140
 * of a tap target (`TAP_MIN`), 44 pt on the smallest phone.
 */
const linkReach = 22;

/**
 * The "Сбросить прогресс" link: no plank, the berry words with the wave under them. The padding
 * grows the box that takes the tap and the negative margins give it back, so the words and the
 * wave stand where they stood.
 */
export const linkStyle = defineStyle({
  direction: "column",
  align: "center",
  gap: 2,
  padding: { top: 8 + linkReach, bottom: 8 + linkReach },
  margin: { top: -linkReach, bottom: -linkReach },
  is: { pressed: { offsetY: 3 } }
});

/** The wave under the link: as wide as its words. */
export const linkWave = defineStyle({ alignSelf: "stretch", height: 16 });

/** The Reset and Cancel of the confirm, side by side at the same width. */
export const confirmButtons = defineStyle({
  direction: "row",
  align: "center",
  alignSelf: "stretch",
  gap: theme.space.md
});

/** The field and its counter on the paper of the Rename popup, one under the other. */
export const nameColumn = defineStyle({
  direction: "column",
  alignSelf: "stretch",
  gap: theme.space.xs
});

/**
 * The frame of the name field: a cream slot with an ink rim, as wide as the paper. The frame draws
 * the slot, not the field: a field clips what it holds to its box, its own rim included, and the
 * clip would cut the outer half of the rim and leave its rounded corners stepped.
 */
export const nameFrame = defineStyle({
  direction: "row",
  align: "stretch",
  alignSelf: "stretch",
  height: 120,
  fill: theme.color.cream,
  stroke: theme.color.ink,
  strokeWidth: 5,
  radius: 24
});

/**
 * The name field inside its frame: the whole frame, with no fill and no rim of its own. The words
 * start 32 units in from its left edge and stand in its middle.
 */
export const nameField = defineStyle({
  grow: 1,
  padding: { left: 32, right: 32 }
});

/** The counter under the field, at its right end: "4/16". */
export const nameCountRow = defineStyle({
  direction: "row",
  alignSelf: "stretch",
  justify: "end"
});
