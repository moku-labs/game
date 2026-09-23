/**
 * @file The two animations of the board (design §6 F4, F5). The merge burst spawns twelve
 * sparkles and leaves on the merged item that fly out and fade; they are despawned when the
 * timeline ends. The sawmill squashes about its middle when it is tapped: its sprite is anchored
 * on its middle, so a scale tween of its `Transform` keeps it standing where it stands.
 *
 * Both aim at views hosted by the board slot. `at()` answers the root pose — the slot's scale
 * included — so the burst is drawn at the size of the board on every phone.
 */
import type { Anim } from "@moku-labs/game";
import {
  parallel,
  Sprite as SpriteComponent,
  sequence,
  spawn,
  spawned,
  Transform,
  tween,
  type
} from "@moku-labs/game";
import { defineAnimation, Sprite } from "../kit";

/** How many pieces a merge bursts into (design §6 F4). */
const PIECES = 12;

/** The size of one piece and how far it flies, in the board slot's units. */
const burst = { size: 72, reach: 190, ms: 480 } as const;

/** The pieces of the burst: every other one a leaf. */
const pieces = Array.from({ length: PIECES }, (_unused, index) => ({
  id: `sparkle${index + 1}`,
  angle: (index / PIECES) * 2 * Math.PI,
  texture: index % 2 === 0 ? ("ui.fx-sparkle" as const) : ("ui.fx-leaf" as const)
}));

/**
 * The merge burst: the pieces appear on the middle of the merged item and fly out on twelve
 * rays, turning and fading. They draw in the `fx` layer, over the board and the HUD.
 */
export const mergeBurst = defineAnimation("board.mergeBurst", {
  slots: { item: type<Anim.Target>() },
  build: ({ item }, { at }) => {
    const middle = at(item);
    const size = burst.size * middle.scale;
    const reach = burst.reach * middle.scale;

    return sequence(
      parallel(
        ...pieces.map((piece, index) =>
          spawn(
            piece.id,
            [
              Sprite({ texture: piece.texture, width: size, height: size, fit: "contain" }),
              Transform({ x: middle.x, y: middle.y, rotation: piece.angle, scale: 0.4 })
            ],
            { layer: "fx", order: index }
          )
        )
      ),
      parallel(
        ...pieces.map(piece =>
          parallel(
            tween(
              spawned(piece.id),
              Transform,
              {
                x: middle.x + Math.cos(piece.angle) * reach,
                y: middle.y + Math.sin(piece.angle) * reach,
                rotation: piece.angle + 1.2,
                scale: 1
              },
              { ms: burst.ms, ease: "out" }
            ),
            tween(spawned(piece.id), SpriteComponent, { alpha: 0 }, { ms: burst.ms, ease: "in" })
          )
        )
      )
    );
  }
});

/** How far the sawmill squashes, and how long the squash and the way back take. */
const squash = { scale: 0.86, downMs: 90, backMs: 240 } as const;

/**
 * The sawmill tap: the cabin squashes about its middle and springs back to its rest scale.
 */
export const sawmillTap = defineAnimation("board.sawmillTap", {
  slots: { generator: type<Anim.Target>() },
  build: ({ generator }) =>
    sequence(
      tween(generator, Transform, { scale: squash.scale }, { ms: squash.downMs, ease: "out" }),
      tween(generator, Transform, { scale: 1 }, { ms: squash.backMs, ease: "outBack" })
    )
});
