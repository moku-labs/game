/**
 * @file The idle sway of the order cards (design §6 F10, p2): every card swings gently on its
 * clothespin, and a card whose order the board can fill swings wider. The card turns around its
 * pin (`origin: "top"` of its style), so the pin stays on the rope.
 *
 * A swing is a loop motion of the card element: one keyframe track of rotation offsets added to
 * the rest pose, out to one side, across to the other and home, played forever from the moment
 * the card enters. Nothing owns the rotation, so the layout of the card and any other motion of it
 * are never disturbed. The middle card swings mirrored, so the rope never swings in step. Under
 * reduced motion `anim` stands every loop on its first key, which is the rest pose.
 */
import type { Ui } from "@moku-labs/game";
import { defineMotion } from "@moku-labs/game";

/** How far a card swings to each side, in radians: a waiting card 1.5°, a ready one 2.5°. */
const reach = { waiting: 0.026, ready: 0.044 } as const;

/** How long one whole swing takes: out to one side, across to the other and home. */
export const SWAY_MS = 2400;

/**
 * Builds the loop of one card: out to one side a quarter in, across to the other three quarters
 * in, home at the end. The eases make the curve of a pendulum, fastest through the rest pose.
 *
 * @param rotation - How far it reaches, in radians; negative starts to the other side.
 * @returns The motion of the card element.
 */
function swayOf(rotation: number): Ui.ElementMotion {
  return defineMotion({
    keyframes: {
      sway: [
        { at: 0, Transform: { rotation: 0 } },
        { at: 0.25, ease: "out", Transform: { rotation } },
        { at: 0.75, ease: "inOut", Transform: { rotation: -rotation } },
        { at: 1, ease: "in", Transform: { rotation: 0 } }
      ]
    },
    loop: { track: "sway", ms: SWAY_MS },
    on: {}
  });
}

/** Every swing a card can play: gentle or wide, starting to the right or to the left. */
const sways = {
  waiting: swayOf(reach.waiting),
  waitingMirrored: swayOf(-reach.waiting),
  ready: swayOf(reach.ready),
  readyMirrored: swayOf(-reach.ready)
} as const;

/**
 * The swing of a card: wide when it is ready, mirrored for the middle card.
 *
 * @param slot - The position of the card on the rope.
 * @param ready - Whether its order can be filled now.
 * @returns The motion of the card element.
 */
export function cardSwayOf(slot: number, ready: boolean): Ui.ElementMotion {
  const mirrored = slot % 2 === 1;

  if (ready) return mirrored ? sways.readyMirrored : sways.ready;

  return mirrored ? sways.waitingMirrored : sways.waiting;
}
