/**
 * @file The motion of an order card (design §6 F10): a card that becomes ready sways once and
 * keeps its honey glow. Becoming ready moves the card's rest pose — its `selected` style stands it
 * a little larger — so `ui` plays the `change.Transform` hook, and the hook adds the sway.
 *
 * The sway is two additive tweens of the rotation that run together and end together: one eases
 * out towards the tilt, the other eases in away from it. Their sum leaves the rest, swings to one
 * side and comes back, and nothing owns the rotation afterwards.
 */
import type { World } from "@moku-labs/game";
import { Transform } from "@moku-labs/game";

/**
 * The scale of a rest pose. `ui` hands a `change.Transform` hook the two rest poses, but the
 * element motion type declares them `unknown` (its change table is an index of
 * `ChangeHook<unknown>`), so the one field the sway reads is checked here.
 *
 * @param pose - A rest pose as the hook receives it.
 * @returns Its scale, 1 when it carries none.
 * @example
 * ```ts
 * scaleOf({ x: 0, y: 0, rotation: 0, scale: 1.04 }); // 1.04
 * ```
 */
function scaleOf(pose: unknown): number {
  if (typeof pose !== "object" || pose === null || !("scale" in pose)) return 1;

  return typeof pose.scale === "number" ? pose.scale : 1;
}

/** How far the card tilts, in radians, and how long the sway and the way to rest take. */
const sway = { tilt: 0.12, ms: 520, restMs: 240 } as const;

/**
 * Change of the card's rest pose: it comes to its new pose, and when it grew — it became ready —
 * it sways once on the way.
 *
 * @param view - The view of the card.
 * @param previous - The rest pose before the change.
 * @param next - The rest pose after it.
 * @returns The motion that brings the card home.
 */
function swayWhenReady(
  view: World.ViewHandle<unknown>,
  previous: unknown,
  next: unknown
): World.Motion {
  const home = view.toRest(Transform, { ms: sway.restMs, ease: "outBack" });

  if (scaleOf(next) <= scaleOf(previous)) return home;

  return view.all([
    home,
    view.tween(Transform, { rotation: sway.tilt }, { ms: sway.ms, ease: "out", additive: true }),
    view.tween(Transform, { rotation: -sway.tilt }, { ms: sway.ms, ease: "in", additive: true })
  ]);
}

/** The motion of every order card. */
export const orderCardMotion = { change: { Transform: swayWhenReady } };
