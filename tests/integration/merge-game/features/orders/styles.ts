/**
 * @file The look of the orders: the order strip of the board with its three paper cards, and the
 * reward popup with the button that closes it.
 */
import { defineStyle } from "../../kit";
import { tokens } from "../hud/styles";
import { theme } from "../ui/kit";

/** Width and height of one card, in reference units. */
const card = { width: 316, height: 600 } as const;

/** The strip under the HUD: 11 units below it, 660 tall, the cards spread along the rope. */
export const orderStrip = defineStyle({
  direction: "row",
  align: "start",
  justify: "evenly",
  alignSelf: "stretch",
  height: 660,
  margin: { top: 11 },
  padding: { top: 40 }
});

/** The rope the cards hang from, across the whole strip at the height of the clothespins. */
export const ropeStyle = defineStyle({
  position: "absolute",
  left: 0,
  right: 0,
  top: 30,
  height: 10,
  radius: 5,
  fill: theme.color.rope,
  reason: "the rope runs behind the cards, across the strip"
});

/** One order card: the paper tag. A ready card is selected and glows honey (design §6 B2). */
export const orderCard = defineStyle({
  ...card,
  direction: "column",
  align: "center",
  justify: "start",
  gap: 10,
  padding: { top: 64, right: 20, bottom: 28, left: 20 },
  nineSlice: "orders.card-order",
  is: { selected: { tint: theme.color.honeyGlow } }
});

/** The clothespin that holds a card to the rope, over the middle of its top edge. */
export const pinStyle = defineStyle({
  position: "absolute",
  top: -44,
  left: (card.width - 40) / 2,
  width: 40,
  height: 96,
  reason: "the clothespin clips the top edge of the card to the rope"
});

/** The round frame the wanted item sits in. */
export const pictureFrame = defineStyle({
  width: 190,
  height: 190,
  radius: 95,
  fill: theme.color.parchment,
  stroke: theme.color.woodDark,
  strokeWidth: 5,
  align: "center",
  justify: "center"
});

/** The item of a ready card. */
export const cardPicture = defineStyle({ width: 150, height: 150 });

/** The item of a card that waits: only the picture fades, the words stay dark. */
export const waitingPicture = defineStyle({ width: 150, height: 150, alpha: 0.5 });

/** The level badge on the lower right of the frame. */
export const levelBadge = defineStyle({
  position: "absolute",
  right: -10,
  bottom: -10,
  width: 72,
  height: 72,
  align: "center",
  justify: "center",
  reason: "the level badge is pinned over the rim of the frame"
});

/** The disc of the level badge. */
export const levelDisc = defineStyle({ width: 72, height: 72 });

/** The name of the item and, for two, the "×2" next to it. */
export const nameRow = defineStyle({ direction: "row", align: "center", gap: 8 });

/** The coins an order pays: the coin and the number. */
export const rewardRow = defineStyle({ direction: "row", align: "center", gap: 8 });

/** The coin in front of the reward. */
export const rewardIcon = defineStyle({ width: 48, height: 48 });

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
