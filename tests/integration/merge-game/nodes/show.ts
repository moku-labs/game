/**
 * @file Transit node `show`: what the player sees when an order is done. The board hands the
 * goods over, the sound plays, the popup waits for `claim`, and the coins fly to the counter.
 * Every one of these is an effect: without a screen they resolve at once and the same edge is
 * taken, which is why this node is the reward feature in both compositions.
 */
import type { Anim } from "@moku-labs/game";
import { play, sfx, type } from "@moku-labs/game";
import { coinsFly } from "../features/hud/animations";
import { deliverOrder } from "../features/orders/animations";
import { RewardPopup } from "../features/orders/reward";
import { cardKey } from "../features/orders/strip";
import { defineNode, popup } from "../kit";
import type { Player } from "../state";

/** The coin counter of the HUD: where the coins land. */
const counter: Anim.Target = { projection: "hud.coins", key: "coins" };

/**
 * The card of the order that was just filled: where the goods go and where the coins start from.
 * The rules put the next order into the freed slot, and a new order takes the highest id, so the
 * slot that holds it is the slot that was delivered.
 *
 * @param player - The saved player.
 * @returns The card element of that slot, as an animation target.
 */
function deliveredCard(player: Player): Anim.Target {
  const orders = player.merge.orders;
  const newest = Math.max(...orders.map(order => order.id));

  return { projection: "hud", key: cardKey(orders.findIndex(order => order.id === newest)) };
}

/**
 * The items still on the board, as animation targets. A target is a projection key, so this
 * holds no entity and works the same in a game without a screen.
 *
 * @param player - The saved player.
 * @returns One target per item.
 */
function itemTargets(player: Player): Anim.Target[] {
  return player.merge.board.items.map(item => ({ projection: "board.items", key: item.id }));
}

export const show = defineNode({
  outcomes: { claim: type() },
  over: true,
  run: async ({ player, fx, out }) => {
    const card = deliveredCard(player);

    await fx(play(deliverOrder, { items: itemTargets(player), card }));
    void fx(sfx("orders.complete"));

    await fx(popup(RewardPopup, { coins: player.pendingCoins }));

    void fx(sfx("ui.click"));
    void fx(play(coinsFly, { from: card, to: counter }));

    return out.claim();
  }
});
