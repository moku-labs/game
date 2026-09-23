/**
 * @file The look of Home (design §5.9): the top bar 50 units under the top safe edge, the centre
 * group that shrinks to fit between it and the gift, and the gift corner 44 units above the bottom
 * safe edge.
 */
import { defineStyle } from "../../kit";

/** The top bar: the coin pill on the left, the gear on the right. */
export const homeBar = defineStyle({
  direction: "row",
  align: "center",
  justify: "between",
  alignSelf: "stretch",
  height: 144,
  margin: { top: 50 },
  padding: { left: 24, right: 24 }
});

/** The space between the top bar and the gift: the centre group is fitted into it. */
export const homeMiddle = defineStyle({
  grow: 1,
  alignSelf: "stretch",
  align: "center",
  justify: "center",
  padding: 12
});

/** The centre group: the logo sign over the Play plank, scaled down as one when space is short. */
export const homeCentre = defineStyle({
  width: 1000,
  height: 900,
  fit: "contain",
  direction: "column",
  align: "center",
  justify: "center",
  gap: 160
});

/** The bottom row: the daily gift on the left. */
export const homeBottom = defineStyle({
  direction: "row",
  alignSelf: "stretch",
  justify: "start",
  margin: { bottom: 44 },
  padding: { left: 40 }
});

/** The gift button with its label under it. */
export const giftCorner = defineStyle({ direction: "column", align: "center", gap: 8 });
