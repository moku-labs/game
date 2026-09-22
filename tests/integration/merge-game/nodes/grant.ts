/**
 * @file Transit node `grant`: the player took the reward out of the popup. This is the commit the
 * coins arrive in — the order paid them, `applyGive` parked them, and here they reach the wallet
 * together with the hint the coin counter waits for. One commit, one hint, one roll.
 */
import { hint, type } from "@moku-labs/game";
import { FLIGHT_MS } from "../features/hud/animations";
import { defineNode } from "../kit";

export const grant = defineNode({
  outcomes: { done: type() },
  run: ({ player, fx, out }) => {
    player.merge.wallet.coins = (player.merge.wallet.coins ?? 0) + player.pendingCoins;
    player.claimed.push(player.pendingReward);
    player.pendingReward = "";
    player.pendingCoins = 0;

    // Released after this commit. A hint finds its view by the key in its payload, so it names
    // the counter: the number holds still while the coins fly, and then rolls to the new sum.
    fx.emit(hint("coins.fly", { projection: "hud.coins", key: "coins", ms: FLIGHT_MS }));

    return out.done();
  }
});
