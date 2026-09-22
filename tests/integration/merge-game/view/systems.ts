/**
 * @file The one game system of the board: while an item is in the hand, every item it may be
 * merged with is tagged. It is an ordinary system on the `Held` tag the input plugin writes — the
 * engine owns the drag, the game owns what the drag means.
 */
import type { Model } from "@moku-labs/game";
import { Held, system } from "@moku-labs/game";
import { rules } from "../rules";
import type { Player } from "../state";
import { tables } from "../tables";
import { Highlighted, Item } from "./components";

/**
 * Reads the player tree out of the frame snapshot. The world hands a system plain JSON, because
 * the world knows no game; the game knows its own shape.
 *
 * @param snapshot - The frozen model snapshot of the frame.
 * @returns The player tree.
 */
function playerOf(snapshot: Model.Snapshot): Player {
  return snapshot.player as unknown as Player;
}

export const highlightLegal = system({
  name: "highlightLegal",
  phase: "input",
  // `Item` first, so the row reads `[entity, item]` and the `Held` tag stays the trailing hole.
  query: [Item, Held],
  run: (held, { world, snapshot }) => {
    for (const [entity] of world.query(Highlighted)) world.untag(entity, Highlighted);

    const state = playerOf(snapshot).merge;

    for (const [, carried] of held) {
      for (const [entity, candidate] of world.query(Item)) {
        if (rules.isLegalMerge(state, carried.cell, candidate.cell, tables)) {
          world.tag(entity, Highlighted);
        }
      }
    }
  }
});
