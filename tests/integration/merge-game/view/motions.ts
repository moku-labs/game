/**
 * @file The motions of the board, written on the tween of `world.projection`. Every hook gets one
 * view and brings it to the rest pose the projection just computed; none of them reads another
 * view. The nodes of the board release no hint, so every hook takes the default path.
 */
import type { World } from "@moku-labs/game";
import { Sprite, Transform } from "@moku-labs/game";
import type { Item as MergeItem } from "../rules";
import { generatorId, tables } from "../tables";
import { Item } from "./components";
import { cellBox } from "./layout";

/** The cell the only generator of this game stands on: a new item starts its arc there. */
const generatorCell = tables.generators[generatorId].cell;

/** How long a new item takes from the generator to its cell. */
const POP_MS = 340;

/**
 * Enter: a new item pops out of the generator (design §6 F5). It starts small on the generator's
 * cell and travels on an arc to the cell the rules gave it: x and y are two tweens with different
 * eases, so the path bends, and the scale springs up with an overshoot. Both points are in the
 * board slot's own space, which is the space the hosted item is drawn in.
 *
 * @param view - The view of the item that entered.
 * @returns The motion that carries it home.
 */
export function itemPopIn(view: World.ViewHandle<MergeItem>): World.Motion {
  const from = cellBox(generatorCell).middle;
  const rest = view.rest(Transform);

  view.set(Transform, { x: from.x, y: from.y, scale: 0.2 });

  if (rest === undefined) return view.toRest(Transform, { ms: POP_MS });

  return view.all([
    view.tween(Transform, { x: rest.x }, { ms: POP_MS, ease: "out" }),
    view.tween(Transform, { y: rest.y }, { ms: POP_MS, ease: "inBack" }),
    view.tween(Transform, { scale: rest.scale }, { ms: POP_MS, ease: "outBack" })
  ]);
}

/**
 * Exit: the dragged item disappears into the item it was merged with. It shrinks and fades where
 * it stands — the merge node releases no hint, so the view never learns the target cell.
 *
 * @param view - The view of the item that left the board.
 * @returns The motion the despawn queue waits for.
 */
export function itemMergeInto(view: World.ViewHandle<MergeItem>): World.Motion {
  return view.all([
    view.tween(Transform, { scale: 0 }, { ms: 160, ease: "in" }),
    view.tween(Sprite, { alpha: 0 }, { ms: 160 })
  ]);
}

/**
 * Change of `Transform`: the item slides to the cell it now stands on.
 *
 * @param view - The view of the item that moved.
 * @returns The motion to the new rest position.
 */
export function itemSlideTo(view: World.ViewHandle<MergeItem>): World.Motion {
  return view.toRest(Transform, { ms: 220 });
}

/**
 * Change of `Item`: the item that took the merge rises by one level. The component is written at
 * once — a level is a whole number and never a fraction of one — and the flourish is a scale that
 * eases back to the rest pose. A rollback lowers the level, and then the item shrinks into it.
 *
 * @param view - The view of the item that changed.
 * @param previous - The item before the commit.
 * @param next - The item after the commit.
 * @returns The motion that brings the scale home.
 */
export function itemLevelUp(
  view: World.ViewHandle<MergeItem>,
  previous: MergeItem,
  next: MergeItem
): World.Motion {
  view.set(Item, { chain: next.chain, level: next.level, cell: next.cell });
  view.set(Transform, { scale: next.level > previous.level ? 1.35 : 0.8 });

  return view.toRest(Transform, { ms: 200 });
}
