/**
 * @file The motion of an order card (design §6 F10): a card that becomes ready sways once and
 * keeps its honey glow. Becoming ready moves the card's rest pose — its `selected` style stands it
 * a little larger — so `ui` plays the `change.Transform` hook, and the hook adds the sway.
 *
 * The sway is two additive tweens of the rotation that run together and end together: one eases
 * out towards the tilt, the other eases in away from it. Their sum leaves the rest, swings to one
 * side and comes back, and nothing owns the rotation afterwards.
 */
import type { Ui } from "@moku-labs/game";
import { Transform } from "@moku-labs/game";

/** How far the card tilts, in radians, and how long the sway and the way to rest take. */
const sway = { tilt: 0.12, ms: 520, restMs: 240 } as const;

/**
 * The motion of every order card. `ui` hands the `change.Transform` hook the rest poses before
 * and after the change: the card comes to its new pose, and when it grew — it became ready — it
 * sways once on the way.
 */
export const orderCardMotion: Ui.ElementMotion = {
  change: {
    Transform: (view, previous, next) => {
      const home = view.toRest(Transform, { ms: sway.restMs, ease: "outBack" });

      if (next.scale <= previous.scale) return home;

      return view.all([
        home,
        view.tween(
          Transform,
          { rotation: sway.tilt },
          { ms: sway.ms, ease: "out", additive: true }
        ),
        view.tween(Transform, { rotation: -sway.tilt }, { ms: sway.ms, ease: "in", additive: true })
      ]);
    }
  }
};
