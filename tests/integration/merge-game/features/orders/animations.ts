/**
 * @file The "Готово!" stamp (design §6 F6): when a delivery finishes an order, the delivered item
 * flies into the order card, then a berry stamp with the word on it hits the card before the
 * reward popup opens. The stamp is two entities the animation spawns — the berry sign and its
 * words — scaled in together around the middle of the card, held for a moment, and despawned when
 * the timeline ends.
 *
 * The item is hosted by the board slot, so its `Transform` is slot-local, and `at(card)` is a root
 * pose. The flight names the root space, and `anim` turns the card's pose into the slot's units.
 */
import type { Anim } from "@moku-labs/game";
import {
  parallel,
  sequence,
  spawn,
  spawned,
  Text,
  Transform,
  tween,
  type,
  wait
} from "@moku-labs/game";
import { defineAnimation, NineSlice, tr } from "../../kit";

/** The stamp: a berry plank, turned like a hand-pressed stamp. */
const stamp = { width: 290, height: 116, rotation: -0.2 } as const;

/**
 * How long the item takes into the card, how long the stamp takes to hit it, and how long the stamp
 * stays before the popup opens.
 */
const timing = { flyMs: 300, hitMs: 260, holdMs: 450 } as const;

/** Above the board screen in the `ui` layer, like the coins. */
const STAMP_ORDER = 1000;

/**
 * The flight and the stamp: the item speeds up from its cell onto the middle of the card and
 * takes the card's size; then the sign and its words appear at nothing on the same middle, scale
 * in with an overshoot, and hold. The card slot is the card element, so both land on it on every
 * phone.
 */
export const deliverStamp = defineAnimation("orders.deliverStamp", {
  slots: { item: type<Anim.Target>(), card: type<Anim.Target>() },
  build: ({ item, card }, { at }) => {
    const middle = at(card);
    const pose = { x: middle.x, y: middle.y, rotation: stamp.rotation, scale: 0 };

    return sequence(
      tween(
        item,
        Transform,
        { x: middle.x, y: middle.y, scale: middle.scale },
        { ms: timing.flyMs, ease: "inCubic", space: "root" }
      ),
      spawn(
        "stampSign",
        [
          NineSlice({ texture: "ui.button-berry", width: stamp.width, height: stamp.height }),
          Transform({ ...pose, pivot: { x: stamp.width / 2, y: stamp.height / 2 } })
        ],
        { order: STAMP_ORDER }
      ),
      spawn(
        "stampText",
        [Text({ content: tr("orders.stamp"), style: "ui.button" }), Transform(pose)],
        { order: STAMP_ORDER + 1 }
      ),
      parallel(
        tween(spawned("stampSign"), Transform, { scale: 1 }, { ms: timing.hitMs, ease: "outBack" }),
        tween(spawned("stampText"), Transform, { scale: 1 }, { ms: timing.hitMs, ease: "outBack" })
      ),
      wait(timing.holdMs)
    );
  }
});
