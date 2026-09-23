/**
 * @file The look of the orders: the order strip of the board with its three paper cards on the
 * washing line (design p2). The numbers are measured on the approved screenshot, in reference
 * units. The reward popup is drawn with the kit's signboard and needs no style of its own here.
 */
import { defineStyle } from "../../kit";
import { theme } from "../ui/kit";

/** Width and height of one card, in reference units. */
export const orderCardSize = { width: 300, height: 550 } as const;

/**
 * How far a card hangs under the top of the strip. The rope sags, so the middle card hangs
 * 20 units lower than the two at the ends, and deeper over the tray.
 */
const hang = { end: 74, middle: 94 } as const;

/**
 * How far the cards hang over the top of the tray (p2: the ends 13 px over its rim, the middle
 * one 29 px). The tray keeps 24 units above it (`board/tray.tsx`), so the strip gives those back
 * and the cards at the ends overlap the tray by the rest.
 */
const overTray = 18;

/** The margin the tray keeps above it, which the strip gives back. */
const trayMargin = 24;

/**
 * The strip under the HUD: 11 units below it, as tall as the cards at the ends of the rope hang.
 * Its cards hang over the top of the tray, the ends 18 units and the middle one 38, so it draws
 * over the tray (`zIndex`), as in p2.
 */
export const orderStrip = defineStyle({
  direction: "row",
  align: "start",
  justify: "evenly",
  alignSelf: "stretch",
  height: hang.end + orderCardSize.height,
  margin: { top: 11, bottom: -(trayMargin + overTray) },
  zIndex: 1
});

/** The washing line: one sagging rope across the whole strip, behind the cards. */
export const ropeStyle = defineStyle({
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: 100,
  reason: "the rope runs behind the cards, across the whole strip"
});

/**
 * One order card: the paper tag, hanging from its clothespin. It turns around the clothespin
 * (`origin: "top"`), so its idle sway keeps the pin on the rope.
 */
const cardBase = {
  ...orderCardSize,
  direction: "column",
  align: "center",
  justify: "start",
  gap: 9,
  padding: { top: 42, right: 16, bottom: 0, left: 16 },
  origin: "top",
  nineSlice: "orders.card-order"
} as const;

/** A card at one end of the rope. */
const endCard = defineStyle({ ...cardBase, margin: { top: hang.end } });

/** The middle card, where the rope sags lowest. */
const middleCard = defineStyle({ ...cardBase, margin: { top: hang.middle } });

/**
 * The style of the card in one slot of the rope: the middle one hangs lower.
 *
 * @param slot - The position on the rope, 0 on the left.
 * @returns The frozen style of that card.
 * @example
 * ```ts
 * orderCardStyle(1); // the middle card, 94 units under the top of the strip
 * ```
 */
export function orderCardStyle(slot: number) {
  return slot === 1 ? middleCard : endCard;
}

/** The honey glow of a ready card (design §6 B2, F10): a soft ring just outside the paper. */
export const cardGlow = defineStyle({
  position: "absolute",
  left: -12,
  top: -12,
  width: orderCardSize.width + 24,
  height: orderCardSize.height + 24,
  radius: 42,
  stroke: theme.color.honey,
  strokeWidth: 16,
  alpha: 0.6,
  reason: "the glow rings the paper of a ready card from outside"
});

/** The clothespin that holds a card to the rope, over the middle of its top edge. */
export const pinStyle = defineStyle({
  position: "absolute",
  top: -40,
  left: (orderCardSize.width - 30) / 2,
  width: 30,
  height: 72,
  reason: "the clothespin clips the top edge of the card to the rope"
});

/** The round frame the wanted item sits in. */
export const pictureFrame = defineStyle({
  width: 160,
  height: 160,
  radius: 80,
  fill: theme.color.parchment,
  stroke: theme.color.woodDark,
  strokeWidth: 5,
  align: "center",
  justify: "center"
});

/** The item of a ready card. */
export const cardPicture = defineStyle({ width: 110, height: 110 });

/** The item of a card that waits: only the picture fades, the words stay dark. */
export const waitingPicture = defineStyle({ width: 110, height: 110, alpha: 0.5 });

/** The level badge on the lower right of the frame. */
export const levelBadge = defineStyle({
  position: "absolute",
  right: -10,
  bottom: -6,
  width: 56,
  height: 56,
  align: "center",
  justify: "center",
  reason: "the level badge is pinned over the rim of the frame"
});

/** The disc of the level badge. */
export const levelDisc = defineStyle({ width: 56, height: 56 });

/** The "×2" badge on the lower left of the frame, when an order asks for more than one. */
export const countBadge = defineStyle({
  position: "absolute",
  left: -20,
  bottom: -4,
  width: 84,
  height: 54,
  radius: 27,
  fill: theme.color.honey,
  stroke: theme.color.ink,
  strokeWidth: 4,
  align: "center",
  justify: "center",
  reason: "the count badge is pinned over the rim of the frame, opposite the level"
});

/** The coins an order pays: the coin and the number, with room above the Deliver plank. */
export const rewardRow = defineStyle({
  direction: "row",
  align: "center",
  gap: 8,
  margin: { top: 3, bottom: 17 }
});

/** The coin in front of the reward. */
export const rewardIcon = defineStyle({ width: 48, height: 48 });
