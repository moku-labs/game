/**
 * @file Transit node `merge`: the item on `from` is dragged onto the item on `to`. A legal merge
 * bursts into sparkles and leaves on the item that rose and plays `board.merge` (design §6 F4); a
 * merge the rules refuse —
 * another level, a crate on a crate, the sawmill — shakes what stands on `to` and changes nothing
 * (design §6 F7), and the dragged item flies home on the settle of the input plugin. The node
 * waits for neither, so the next drag is free at once.
 */
import { play, sfx, type } from "@moku-labs/game";
import { defineNode } from "../kit";
import { rules } from "../rules";
import { applyRules } from "../state";
import { tables } from "../tables";
import { mergeBurst, refuseShake } from "../view/animations";
import { viewAt } from "../view/targets";

export const merge = defineNode({
  input: type<{ from: string; to: string }>(),
  outcomes: { done: type(), rejected: type<{ reason: string }>() },
  run: ({ input, player, fx, out }) => {
    const result = rules.merge(player.merge, input.from, input.to, tables);

    if (!result.legal) {
      const target = viewAt(player, input.to);

      if (target !== undefined) void fx(play(refuseShake, { target }));

      return out.rejected({ reason: result.reason });
    }

    applyRules(player, result.state);
    void fx(sfx("board.merge"));
    // The risen item keeps the id of the target, so the burst aims at the item that stays.
    void fx(play(mergeBurst, { item: { projection: "board.items", key: result.item.id } }));

    return out.done();
  }
});
