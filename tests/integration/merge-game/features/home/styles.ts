/**
 * @file The look of Home (design §5.9, §6 A2), measured on the approved screenshot: the top bar 50
 * units under the top safe edge, the centre group — the logo sign, the yard and the Play sign on
 * its two posts — scaled down as one when the space between the bar and the gift is short, and
 * the gift corner 44 units above the bottom safe edge.
 *
 * The bar is drawn last, on a layer of its own over the screen, so the ropes of the logo sign
 * come down from the top of the screen behind the coin pill and the gear.
 */
import { defineStyle } from "../../kit";
import { pointerStates, safeEdges } from "../ui/kit";
import { logo } from "./logo";

/** The top bar: 50 units under the safe edge, 144 tall. */
const bar = { top: 50, height: 144 } as const;

/** The yard illustration: 960 units wide at the art's own ratio (960 × 924). */
const yard = { width: 960, height: 924 } as const;

/** The Play sign and its posts: 276 units either side of its middle, 150 below its lip. */
export const playSign = {
  width: 880,
  height: 220,
  post: { width: 48, top: 40, below: 150, fromMiddle: 276 }
} as const;

/** The gap between the logo, the yard and the Play sign. */
const groupGap = 30;

/** The room the top bar keeps free in the column of the screen. */
export const homeBarRoom = defineStyle({ height: bar.height, margin: { top: bar.top } });

/** The layer of the top bar: the whole screen, its content kept inside the safe area. */
export const homeTop = defineStyle({
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  direction: "column",
  padding: safeEdges,
  reason: "the bar is drawn over the ropes of the logo sign, which hang from the screen top"
});

/** The top bar: the coin pill on the left, the gear on the right. */
export const homeBar = defineStyle({
  direction: "row",
  align: "center",
  justify: "between",
  alignSelf: "stretch",
  height: bar.height,
  margin: { top: bar.top },
  padding: { left: 48, right: 44 }
});

/** The space between the top bar and the gift: the centre group is centred in it. */
export const homeMiddle = defineStyle({
  grow: 1,
  alignSelf: "stretch",
  align: "center",
  justify: "center"
});

/** The centre group: the logo sign, the yard and the Play sign, scaled down as one. */
export const homeCentre = defineStyle({
  width: 1000,
  height: logo.height + yard.height + playSign.height + 2 * groupGap,
  fit: "contain",
  direction: "column",
  align: "center",
  gap: groupGap
});

/** The yard illustration under the logo sign. */
export const homeYard = defineStyle({ ...yard });

/** The Play sign: the posts behind the plank, a sprig on each end. */
export const playSignStyle = defineStyle({
  width: playSign.width,
  height: playSign.height
});

/** Where a post sits, from its edge of the sign. */
const postInset = playSign.width / 2 - playSign.post.fromMiddle - playSign.post.width / 2;

/**
 * The style of one post, from under the plank down into the grass.
 *
 * @param side - Which post.
 * @returns The frozen style.
 */
function postStyle(side: "left" | "right") {
  return defineStyle({
    ...(side === "left" ? { left: postInset } : { right: postInset }),
    position: "absolute",
    top: playSign.post.top,
    width: playSign.post.width,
    height: playSign.height - playSign.post.top + playSign.post.below,
    reason: "the posts stand behind the Play sign and reach below it (design §6 A2)"
  });
}

/** The two posts, built once. */
export const playPosts = { left: postStyle("left"), right: postStyle("right") } as const;

/** The green plank of the Play sign, with its word in the middle. */
export const playButton = defineStyle({
  width: playSign.width,
  height: playSign.height,
  position: "absolute",
  left: 0,
  top: 0,
  direction: "row",
  align: "center",
  justify: "center",
  nineSlice: "ui.button-green",
  is: pointerStates,
  reason: "the plank lies over its two posts"
});

/** The size of a sprig on an end of the Play sign. */
const sprig = { width: 170, height: 184 } as const;

/** The sprig over the top-left corner of the Play sign. */
export const playSprigLeft = defineStyle({
  position: "absolute",
  left: -62,
  top: -40,
  ...sprig,
  reason: "the sprig is pinned over the end of the sign"
});

/** The sprig over the lower right end of the Play sign. */
export const playSprigRight = defineStyle({
  position: "absolute",
  right: -66,
  bottom: -70,
  ...sprig,
  reason: "the sprig is pinned over the end of the sign"
});

/** The bottom row: the daily gift on the left, 44 units above the safe edge. */
export const homeBottom = defineStyle({
  direction: "row",
  alignSelf: "stretch",
  justify: "start",
  margin: { bottom: 44 },
  padding: { left: 60 }
});

/** The gift button, a round wood button 260 units wide, with its label under it. */
export const giftCorner = defineStyle({ direction: "column", align: "center", gap: 12 });
