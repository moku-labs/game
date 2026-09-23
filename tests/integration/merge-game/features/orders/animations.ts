/**
 * @file The "Готово!" stamp (design §6 F6): when a delivery finishes an order, a berry stamp with
 * the word on it hits the order card before the reward popup opens. The stamp is two entities the
 * animation spawns — the berry sign and its words — scaled in together around the middle of the
 * card, held for a moment, and despawned when the timeline ends.
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

/** How long the stamp takes to hit the card, and how long it stays before the popup opens. */
const timing = { hitMs: 260, holdMs: 450 } as const;

/** Above the board screen in the `ui` layer, like the coins. */
const STAMP_ORDER = 1000;

/**
 * The stamp: the sign and its words appear at nothing on the middle of the card, scale in with an
 * overshoot, and hold. The slot is the card element, so the stamp lands on it on every phone.
 */
export const deliverStamp = defineAnimation("orders.deliverStamp", {
  slots: { card: type<Anim.Target>() },
  build: ({ card }, { at }) => {
    const middle = at(card);
    const pose = { x: middle.x, y: middle.y, rotation: stamp.rotation, scale: 0 };

    return sequence(
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
