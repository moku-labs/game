/**
 * @file Transit node `dailyGift`: the gift button of Home was tapped. The Daily gift popup waits
 * for Claim; the claim pays the coins into the wallet and marks the gift taken — one commit, so
 * the "1" of the button and the counter change together — and the coins fly from the gift to the
 * coin pill of Home, where the counter rolls when they land. The backdrop closes the popup with
 * nothing paid. A gift already taken opens nothing.
 */
import type { Flow } from "@moku-labs/game";
import { hint, play, sfx, type } from "@moku-labs/game";
import { DailyGift } from "../features/gift/daily-gift";
import { coinsFlyGift, FLIGHT_MS } from "../features/hud/animations";
import { defineNode, popup } from "../kit";
import { giftCoins } from "../tables";

export const dailyGift = defineNode({
  outcomes: { claim: type(), close: type() },
  run: async ({ player, fx, out }) => {
    if (player.giftClaimed) return out.close();

    const answered = (await fx(popup(DailyGift, { coins: giftCoins }))) as Flow.Answer | undefined;

    if (answered?.intent !== "claim") return out.close();

    player.merge.wallet.coins = (player.merge.wallet.coins ?? 0) + giftCoins;
    player.giftClaimed = true;

    void fx(sfx("ui.click"));
    void fx(
      play(coinsFlyGift, {
        from: { projection: "DailyGift", key: "giftPrize" },
        to: { projection: "home.screen", key: "homeCoinsIcon" }
      })
    );
    // Released after this commit: the counter holds still while the coins fly, then rolls.
    fx.emit(hint("coins.fly", { projection: "hud.coins", key: "coins", ms: FLIGHT_MS }));

    return out.claim();
  }
});
