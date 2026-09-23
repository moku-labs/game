/**
 * @file The marching ring around the selected cell (design §6 F9): cream dashes with a thin ink
 * edge, drawn as a picture, because a `Shape` strokes a solid line. Four pictures of the same
 * ring hold the dashes a quarter of a dash period apart, and `marchRing` shows them in turn, so
 * the dashes walk clockwise around the cell.
 */
import { Sprite, system } from "@moku-labs/game";
import type { AssetKey } from "../generated/assets";
import { SelectionRing } from "./components";
import { cellSize } from "./layout";

/**
 * The four dash phases, in the order they are shown. Each picture is the ring 300 px square:
 * 32 cream dashes of 22 px, 9 px thick, on a rounded square 8 px outside the cell.
 */
export const ringFrames = [
  "board.selection-ring-0",
  "board.selection-ring-1",
  "board.selection-ring-2",
  "board.selection-ring-3"
] as const satisfies readonly AssetKey[];

/** Edge of the ring picture: the cell and 14 units on every side, so the dashes lie in the gap. */
export const ringSize = cellSize + 28;

/** How long one dash phase stays on the screen, in milliseconds. */
export const ringStepMs = 250;

/**
 * The dash phase the ring shows at one moment of the game.
 *
 * @param elapsed - The game time, in milliseconds.
 * @returns The asset key of the picture to show.
 * @example
 * ```ts
 * ringFrameAt(600); // "board.selection-ring-2"
 * ```
 */
export function ringFrameAt(elapsed: number): AssetKey {
  const step = Math.floor(elapsed / ringStepMs) % ringFrames.length;

  return ringFrames[step] ?? ringFrames[0];
}

/**
 * Walks the dashes of the ring: every step of `ringStepMs` the ring shows the next picture. A
 * ring that already shows the phase of the frame is not written.
 */
export const marchRing = system({
  name: "marchRing",
  phase: "animate",
  // `Sprite` first, so the row reads `[entity, sprite]` and the tag stays the trailing hole.
  query: [Sprite, SelectionRing],
  run: (rings, { world, time }) => {
    const texture = ringFrameAt(time.elapsed);

    for (const [entity, sprite] of rings) {
      if (sprite.texture !== texture) world.set(entity, Sprite, { texture });
    }
  }
});
