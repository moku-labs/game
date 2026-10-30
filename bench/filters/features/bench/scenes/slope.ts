/**
 * @file `slope-N`: N tiny live breakers over a full-screen sprite, each one a break of the canvas
 * pass. The slope of the GPU time over N is the price of one break. The `-mask` variant opens with
 * a clip mask, so the canvas carries its stencil through every break after it.
 */
import { Shape, Sprite, Transform, type World } from "../../../../../src/index.ts";
import { Breaker } from "../filters";
import { fullSprite, PICTURE } from "./shared";
import type { BenchScene, Stage } from "./types";

/** The side of a breaker: its filter costs next to nothing, the break is what is left. */
const BREAKER_SIDE = 4;

/** How far apart the breakers stand. */
const BREAKER_STEP = 12;

/** The breaker counts of the spec. */
const SLOPES = [0, 1, 2, 4, 8] as const;

/**
 * A clip panel with content: pushes a stencil mask on the canvas.
 *
 * @param stage - The stage.
 */
function clipPanel(stage: Stage): void {
  const panel = stage.spawn(
    Transform({ x: 40, y: 40 }),
    Shape({ w: 200, h: 120, fill: 0x22_33_44, radius: 16, clip: true })
  );

  stage.child(
    panel,
    Transform({ x: 0, y: 0 }),
    Sprite({ texture: PICTURE, width: 300, height: 200, anchor: { x: 0, y: 0 } })
  );
}

/**
 * The scene of N breakers.
 *
 * @param count - N.
 * @param masked - True for the `-mask` variant.
 * @returns The scene.
 */
function slopeScene(count: number, masked: boolean): BenchScene {
  return {
    name: masked ? `slope-${count}-mask` : `slope-${count}`,
    stands: masked
      ? `${count} breaks with a clip mask on screen: a scroll list on a board with live filters`
      : `${count} breaks: the price of one canvas break, nothing else`,
    mount: stage => {
      fullSprite(stage);
      if (masked) clipPanel(stage);

      const breakers: World.Entity[] = [];

      for (let index = 0; index < count; index += 1) {
        const x = stage.width / 2 + (index - count / 2) * BREAKER_STEP;

        breakers.push(
          stage.spawn(
            Transform({ x, y: stage.height / 2 }),
            Shape({ w: BREAKER_SIDE, h: BREAKER_SIDE, fill: 0xff_ff_ff }),
            Breaker({ phase: 0 })
          )
        );
      }

      // Something is drawn after the last breaker, as a break never ends a real frame.
      stage.spawn(
        Transform({ x: 8, y: 8 }),
        Sprite({ texture: PICTURE, width: 16, height: 16, anchor: { x: 0, y: 0 } })
      );

      return {
        tick: elapsedMs => {
          for (const breaker of breakers) stage.set(breaker, Breaker, { phase: elapsedMs / 100 });
        }
      };
    }
  };
}

/** Every `slope-N`, with and without the mask. */
export const SLOPE_SCENES: readonly BenchScene[] = [false, true].flatMap(masked =>
  SLOPES.map(count => slopeScene(count, masked))
);
