/**
 * @file The reward popup (design §6 E1): the honey header "Заказ выполнен", the delivered item on
 * a parchment disc with rays behind it, "+25" with a coin, and the green Claim. It is not
 * dismissable: the backdrop swallows the tap and answers nothing, so `claim` is the one outcome.
 * The coins of the claim fly from the prize box, keyed `rewardPrize`.
 */
import { type } from "@moku-labs/game";
import type { AssetKey } from "../../generated/assets";
import { defineComponent, defineStyle, tr } from "../../kit";
import { tables } from "../../tables";
import { pictureOf } from "../../view/items";
import { PlankButton, Signboard, theme } from "../ui/kit";
import { PopupScreen, Prize } from "../ui/popup";

/** What the popup is shown with: the coins the finished order paid and the item it took. */
export type RewardProps = { coins: number; picture: AssetKey };

/** The coin and the number under the prize. */
const amountRow = defineStyle({ direction: "row", align: "center", gap: theme.space.sm });

/** The coin in front of the amount. */
const amountCoin = defineStyle({ width: 88, height: 88 });

/**
 * The picture of the item an order took, read from the order table by its reward id. A reward the
 * table does not know shows the first item of the chain.
 *
 * @param rewardId - The reward id the finished order carried.
 * @returns The asset key of the item's picture.
 * @example
 * ```ts
 * rewardPictureOf("planks"); // "board.item-wood-3"
 * ```
 */
export function rewardPictureOf(rewardId: string): AssetKey {
  const need = tables.orders.find(entry => entry.rewardId === rewardId)?.needs[0];

  return pictureOf(need?.chain ?? "wood", need?.level ?? 1);
}

export const RewardPopup = defineComponent("RewardPopup", {
  outcomes: { claim: type() },
  view: (props: RewardProps) => (
    <PopupScreen id="reward">
      <Signboard id="rewardBoard" title={tr("orders.done")} width={760} height={900} hung>
        <Prize id="rewardPrize" picture={props.picture} rays disc="paper" />
        <row key="rewardAmount" style={amountRow}>
          <icon key="rewardCoin" name="ui.icon-coin" style={amountCoin} />
          <text key="rewardCoins" style="ui.title" content={`+${props.coins}`} />
        </row>
        <PlankButton id="rewardClaim" intent="claim" look="green" label={tr("orders.claim")} />
      </Signboard>
    </PopupScreen>
  )
});
