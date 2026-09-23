/**
 * @file The wobble of the daily gift (design §6 B6): while the gift waits, its round button shakes
 * on its middle now and then, like a parcel something moves in, and rests between the shakes. It
 * is a loop motion of the element around the button: one keyframe track of rotation offsets added
 * to the rest pose, played forever from the moment Home enters. Under reduced motion `anim` stands
 * it on its first key, which is the rest pose.
 */
import type { Ui } from "@moku-labs/game";
import { defineMotion } from "@moku-labs/game";

/** One cycle of the wobble: a rest, then a shake that dies down. */
export const GIFT_WOBBLE_MS = 2400;

/** The shake at the end of the cycle: the turn of each swing, in radians, and where it peaks. */
const shake = [
  { at: 0.72, rotation: 0.14 },
  { at: 0.8, rotation: -0.12 },
  { at: 0.87, rotation: 0.08 },
  { at: 0.93, rotation: -0.04 }
] as const;

/** The gift button shakes after a rest, and ends where it started. */
export const giftWobble: Ui.ElementMotion = defineMotion({
  keyframes: {
    wobble: [
      { at: 0, Transform: { rotation: 0 } },
      { at: 0.64, Transform: { rotation: 0 } },
      ...shake.map(swing => ({
        at: swing.at,
        ease: "inOut" as const,
        Transform: { rotation: swing.rotation }
      })),
      { at: 1, ease: "out", Transform: { rotation: 0 } }
    ]
  },
  loop: { track: "wobble", ms: GIFT_WOBBLE_MS },
  on: {}
});

/** The gift button once the gift is claimed: it stands still. */
export const giftStill: Ui.ElementMotion = {};
