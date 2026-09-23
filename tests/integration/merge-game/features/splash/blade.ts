/**
 * @file The saw blade of the loader (design §6 A1, F8): the gear icon tinted steel, spinning on the
 * head of the honey fill, so the bar reads as a log being cut. The blade is an element of the
 * track (`view.tsx`), placed by its style on the head of the fill; the spin is a loop motion of
 * that element, one whole turn of rotation offsets added to the rest pose, played forever from
 * the moment the splash enters. A new share moves the rest pose, and the loop turns on with it.
 * Under reduced motion `anim` stands the blade on its first key, which is the rest pose.
 */
import type { Ui } from "@moku-labs/game";
import { defineMotion } from "@moku-labs/game";

/** The blade: its size, one turn in milliseconds, and the steel it is tinted with. */
export const blade = { size: 130, turnMs: 1200, steel: 0xb8_c4_cc } as const;

/** One turn of the blade, clockwise at an even speed: the seam at a whole turn looks the same. */
export const bladeSpin: Ui.ElementMotion = defineMotion({
  keyframes: {
    spin: [
      { at: 0, Transform: { rotation: 0 } },
      { at: 1, ease: "linear", Transform: { rotation: 2 * Math.PI } }
    ]
  },
  loop: { track: "spin", ms: blade.turnMs },
  on: {}
});
