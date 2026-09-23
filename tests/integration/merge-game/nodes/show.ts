/**
 * @file Transit node `show`: what the player sees when an order is done. The board already played
 * the delivery and its "Готово!" stamp; here the sound plays, the reward popup waits for `claim`,
 * and the coins fly from the popup picture to the coin icon of the HUD. Every one of these is an
 * effect: without a screen they resolve at once and the same edge is taken, which is why this
 * node is the reward feature in both compositions.
 */
import type { Anim } from "@moku-labs/game";
import { play, sfx, type } from "@moku-labs/game";
import { coinsFlyReward } from "../features/hud/animations";
import { RewardPopup, rewardPictureOf } from "../features/orders/reward";
import { defineNode, popup } from "../kit";

/** The prize box of the reward popup: where the coins start from. */
const prize: Anim.Target = { projection: "RewardPopup", key: "rewardPrize" };

/** The coin icon of the HUD pill: where the coins land. */
const coinIcon: Anim.Target = { projection: "hud", key: "coinPillIcon" };

export const show = defineNode({
  outcomes: { claim: type() },
  over: true,
  run: async ({ player, fx, out }) => {
    void fx(sfx("orders.complete"));

    await fx(
      popup(RewardPopup, {
        coins: player.pendingCoins,
        picture: rewardPictureOf(player.pendingReward)
      })
    );

    void fx(sfx("ui.click"));
    void fx(play(coinsFlyReward, { from: prize, to: coinIcon }));

    return out.claim();
  }
});
