/**
 * @file The toast "Доска заполнена" (design §6 C1, §5.8): a berry sign that swings in 33 units
 * under the HUD when the sawmill is tapped on a full board, hangs for 1.6 s and swings out. It
 * never blocks input: it is two entities the animation spawns — the sign and its words — and
 * both are despawned when the timeline ends.
 *
 * Both turn around the same point, the middle of the sign's top edge: the sign has its pivot
 * there, and the words carry the same point as a pivot above their middle.
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
import { hudRowHeight } from "../hud/styles";

/** The sign: a berry plank. */
const sign = { width: 620, height: 130 } as const;

/** How far under the HUD row the sign hangs (design §5.8). */
const gapUnderHud = 33;

/** How long the toast stays (design §6 C1). */
export const TOAST_HOLD_MS = 1600;

/** How long it swings in, and how long it swings out. */
const swing = { inMs: 380, outMs: 240 } as const;

/** The pose it hangs in before and after: tilted on its top edge, and gone. */
const hidden = { rotation: -0.25, scale: 0 } as const;

/** The two entities of the toast. */
const parts = [spawned("toastSign"), spawned("toastText")] as const;

/**
 * The toast: spawn the sign and its words tilted and folded away under the HUD, swing them in,
 * hold, swing them out. The slot is the HUD row, so the toast hangs under it on every phone.
 */
export const toastBoardFull = defineAnimation("board.toastBoardFull", {
  slots: { under: type<Anim.Target>() },
  build: ({ under }, { at }) => {
    const hud = at(under);
    const top = { x: hud.x, y: hud.y + (hudRowHeight / 2) * hud.scale + gapUnderHud };

    return sequence(
      spawn(
        "toastSign",
        [
          NineSlice({ texture: "ui.button-berry", width: sign.width, height: sign.height }),
          Transform({ ...top, ...hidden, pivot: { x: sign.width / 2, y: 0 } })
        ],
        { layer: "fx", order: 1 }
      ),
      spawn(
        "toastText",
        [
          Text({ content: tr("board.full"), style: "ui.button" }),
          Transform({ ...top, ...hidden, pivot: { x: 0, y: -sign.height / 2 } })
        ],
        { layer: "fx", order: 2 }
      ),
      parallel(
        ...parts.map(part =>
          tween(part, Transform, { rotation: 0, scale: 1 }, { ms: swing.inMs, ease: "outBack" })
        )
      ),
      wait(TOAST_HOLD_MS),
      parallel(
        ...parts.map(part => tween(part, Transform, hidden, { ms: swing.outMs, ease: "in" }))
      )
    );
  }
});
