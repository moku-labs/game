/**
 * @file The clock badge of a generator that cannot give (design §6 F11): a small clock in the
 * top-right corner of its cell, over the greyed cabin, while it has no charge or the bar holds no
 * energy. The art set has no clock icon, so the badge is the round level badge — its four notches
 * read as the hours — with two ink hands and a pin on it. Every part is one keyed item of one
 * projection, hosted by the board slot like the generator it belongs to.
 */
import { Order, Shape, Transform } from "@moku-labs/game";
import { projection, Sprite } from "../kit";
import type { CellId } from "../rules";
import type { Player } from "../state";
import type { Point } from "./layout";
import { cellBox, depth } from "./layout";
import { generatorsOf } from "./projections";

/** The badge: the size of the disc and how far its edge keeps from the corner of the cell. */
const badge = { size: 96, inset: 14 } as const;

/** The ink the hands and the pin are drawn in (design §2). */
const ink = 0x3a_22_12;

/** The two hands: how long and wide they are, and the hour they point at (twelve and three). */
const hands = {
  minute: { length: 34, width: 8, angle: 0 },
  hour: { length: 24, width: 8, angle: Math.PI / 2 }
} as const;

/** The pin that holds the hands, over their inner ends. */
const pinSize = 14;

/** The parts of the badge, in draw order. */
const parts = ["disc", "minute", "hour", "pin"] as const;

/**
 * One part of the clock badge of one generator.
 *
 * @example
 * ```ts
 * const part: ClockPart = { key: "sawmill.disc", part: "disc", cell: "c0_0", order: 4 };
 * ```
 */
export type ClockPart = {
  key: string;
  part: (typeof parts)[number];
  cell: CellId;
  order: number;
};

/**
 * Lists the parts of the clock badge of every generator that cannot give. A generator that can
 * give has no badge.
 *
 * @param player - The saved player.
 * @returns Four parts per greyed generator.
 */
function clockPartsOf(player: Player): ClockPart[] {
  return generatorsOf(player)
    .filter(generator => !generator.ready)
    .flatMap(generator =>
      parts.map((part, index) => ({
        key: `${generator.id}.${part}`,
        part,
        cell: generator.cell,
        order: depth.clock + index
      }))
    );
}

/**
 * The middle of the badge of one cell, in the slot's own space: the top-right corner of the cell,
 * the disc inside it.
 *
 * @param cell - The cell of the generator.
 * @returns The middle of the disc.
 */
function badgeMiddle(cell: CellId): Point {
  const box = cellBox(cell);
  const offset = badge.inset + badge.size / 2;

  return { x: box.x + box.size - offset, y: box.y + offset };
}

/**
 * The components of one part: the disc is the level badge drawn on its middle, a hand is an ink
 * bar turned about its inner end, which sits on the middle, and the pin is an ink dot on it.
 *
 * @param part - The part to draw.
 * @returns Its components.
 */
function partView(part: ClockPart) {
  const middle = badgeMiddle(part.cell);
  const order = Order({ value: part.order });

  if (part.part === "disc") {
    return [
      Sprite({ texture: "ui.badge-level", width: badge.size, height: badge.size, fit: "contain" }),
      Transform({ x: middle.x, y: middle.y }),
      order
    ];
  }

  if (part.part === "pin") {
    return [
      Shape({ w: pinSize, h: pinSize, fill: ink, radius: pinSize / 2 }),
      Transform({ x: middle.x, y: middle.y, pivot: { x: pinSize / 2, y: pinSize / 2 } }),
      order
    ];
  }

  const hand = hands[part.part];

  return [
    Shape({ w: hand.width, h: hand.length, fill: ink, radius: hand.width / 2 }),
    Transform({
      x: middle.x,
      y: middle.y,
      rotation: hand.angle,
      pivot: { x: hand.width / 2, y: hand.length - hand.width / 2 }
    }),
    order
  ];
}

/**
 * The clock badge (design §6 F11): the disc, the two hands and the pin of every greyed generator.
 * It takes no press, so a tap goes through it to the generator, which still answers.
 */
export const boardClock = projection({
  name: "board.clock",
  layer: "items",
  from: clockPartsOf,
  key: part => part.key,
  view: partView
});
