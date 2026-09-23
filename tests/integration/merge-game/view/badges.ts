/**
 * @file The badges on the board (design p2, §6 B3): the charges plate at the bottom of every
 * generator's cell, "○○○○ 3/4" on a small walnut plate, and the green check on the top right of
 * every item a ready order takes, the one its Deliver would give. Every part is one keyed item of
 * one projection, hosted by the board slot like the things they sit on, and none takes a press, so
 * a tap goes through to the sawmill or the item.
 */
import { Order, Shape, Text, Transform } from "@moku-labs/game";
import { acceptedItemsOf } from "../features/orders/strip";
import { theme } from "../features/ui/kit";
import { projection, Sprite } from "../kit";
import type { CellId, GeneratorTable } from "../rules";
import type { Player } from "../state";
import { tables } from "../tables";
import type { CellBox } from "./layout";
import { cellBox, depth } from "./layout";
import { generatorsOf } from "./projections";

/**
 * The charges plate: its size, how far its middle sits above the bottom edge of the cell, the
 * pips (size, the middle of the first one from the middle of the cell, the step between two) and
 * where the count starts.
 */
const plate = {
  width: 244,
  height: 64,
  lift: 10,
  pip: { size: 22, first: -86, step: 33 },
  countAt: 44
} as const;

/** The check badge: the size of its disc and of the mark, and where its middle sits in the cell. */
const check = { disc: 68, mark: 46, fromRight: 40, fromTop: 38 } as const;

/** The generator table under the loose key type, so an id read from a save can be looked up. */
const generatorTable: GeneratorTable = tables.generators;

/**
 * One part of one badge. `index` numbers the pips; `full` tells a charge the generator still has
 * from a spent one; `text` is the count.
 *
 * @example
 * ```ts
 * const pip: BadgePart = {
 *   key: "sawmill.pip0", part: "pip", cell: "c0_0", index: 0, full: true, text: ""
 * };
 * ```
 */
export type BadgePart = {
  key: string;
  part: "plate" | "pip" | "count" | "disc" | "mark";
  cell: CellId;
  index: number;
  full: boolean;
  text: string;
};

/**
 * Lists the parts of the charges plate of every generator: the plate, one pip per charge it can
 * hold and the count.
 *
 * @param player - The saved player.
 * @returns The parts, plate first.
 */
function chargePartsOf(player: Player): BadgePart[] {
  return generatorsOf(player).flatMap(generator => {
    const max = generatorTable[generator.id]?.maxCharges ?? 0;
    const charges = player.merge.generators[generator.id]?.charges ?? max;
    const base = { cell: generator.cell, index: 0, full: false, text: "" };

    return [
      { ...base, key: `${generator.id}.plate`, part: "plate" as const },
      ...Array.from({ length: max }, (_unused, index) => ({
        ...base,
        key: `${generator.id}.pip${index}`,
        part: "pip" as const,
        index,
        full: index < charges
      })),
      { ...base, key: `${generator.id}.count`, part: "count" as const, text: `${charges}/${max}` }
    ];
  });
}

/**
 * Lists the parts of the check badge of every item a ready order takes: the disc and the mark.
 *
 * @param player - The saved player.
 * @returns Two parts per accepted item.
 */
function checkPartsOf(player: Player): BadgePart[] {
  const items = player.merge.board.items;

  return acceptedItemsOf(player.merge).flatMap(id => {
    const cell = items.find(item => item.id === id)?.cell;

    if (cell === undefined) return [];

    const base = { cell, index: 0, full: false, text: "" };

    return [
      { ...base, key: `check.${id}.disc`, part: "disc" as const },
      { ...base, key: `check.${id}.mark`, part: "mark" as const }
    ];
  });
}

/**
 * Every badge part on the board: the charges plates, then the checks.
 *
 * @param player - The saved player.
 * @returns The parts.
 */
function badgePartsOf(player: Player): BadgePart[] {
  return [...chargePartsOf(player), ...checkPartsOf(player)];
}

/**
 * The components of one part of a charges plate, drawn on the bottom of its cell.
 *
 * @param part - A plate, a pip or the count.
 * @param box - The cell of the generator.
 * @returns Its components.
 */
function plateView(part: BadgePart, box: CellBox) {
  const middleY = box.y + box.size - plate.lift;

  if (part.part === "plate") {
    return [
      Shape({
        w: plate.width,
        h: plate.height,
        radius: plate.height / 2,
        fill: theme.color.walnut,
        stroke: theme.color.ink,
        strokeWidth: 5
      }),
      Transform({ x: box.middle.x - plate.width / 2, y: middleY - plate.height / 2 }),
      Order({ value: depth.charges })
    ];
  }

  if (part.part === "pip") {
    const size = plate.pip.size;
    const middleX = box.middle.x + plate.pip.first + part.index * plate.pip.step;

    return [
      Shape({
        w: size,
        h: size,
        radius: size / 2,
        fill: part.full ? theme.color.honey : theme.color.ink,
        stroke: theme.color.ink,
        strokeWidth: 3
      }),
      Transform({ x: middleX - size / 2, y: middleY - size / 2 }),
      Order({ value: depth.charges + 1 })
    ];
  }

  return [
    Text({ content: part.text, style: "ui.badge", anchor: { x: 0, y: 0.5 } }),
    Transform({ x: box.middle.x + plate.countAt, y: middleY }),
    Order({ value: depth.charges + 2 })
  ];
}

/**
 * The components of one part of a check badge, on the top right of its cell: a parchment disc
 * with an ink rim, and the green check on it.
 *
 * @param part - The disc or the mark.
 * @param box - The cell of the item.
 * @returns Its components.
 */
function checkView(part: BadgePart, box: CellBox) {
  const middle = { x: box.x + box.size - check.fromRight, y: box.y + check.fromTop };

  if (part.part === "disc") {
    return [
      Shape({
        w: check.disc,
        h: check.disc,
        radius: check.disc / 2,
        fill: theme.color.parchment,
        stroke: theme.color.ink,
        strokeWidth: 4
      }),
      Transform({ x: middle.x - check.disc / 2, y: middle.y - check.disc / 2 }),
      Order({ value: depth.check })
    ];
  }

  return [
    Sprite({ texture: "ui.icon-check", width: check.mark, height: check.mark, fit: "contain" }),
    Transform({ x: middle.x, y: middle.y }),
    Order({ value: depth.check + 1 })
  ];
}

/**
 * The components of one badge part, in the slot's own space.
 *
 * @param part - The part to draw.
 * @returns Its components.
 */
function badgeView(part: BadgePart) {
  const box = cellBox(part.cell);

  return part.part === "disc" || part.part === "mark" ? checkView(part, box) : plateView(part, box);
}

/**
 * The badges of the board (design p2): the charges plate of every generator and the check on
 * every item a ready order takes.
 */
export const boardBadges = projection({
  name: "board.badges",
  layer: "items",
  from: badgePartsOf,
  key: part => part.key,
  view: badgeView
});
