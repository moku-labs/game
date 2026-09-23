/**
 * @file The reward popup (design §6 E1): the honey plaque "Заказ выполнен", the delivered item on
 * the honey rays with no disc, a coin with the big "+25", and the green Claim. It is not
 * dismissable: the backdrop swallows the tap and answers nothing, so `claim` is the one outcome.
 * The coins of the claim fly from the prize box, keyed `rewardPrize`.
 */
import { type } from "@moku-labs/game";
import type { AssetKey } from "../../generated/assets";
import { defineComponent, tr } from "../../kit";
import { tables } from "../../tables";
import { pictureOf } from "../../view/items";
import { PlankButton, Signboard } from "../ui/kit";
import { Amount, PopupScreen, Prize } from "../ui/popup";

/** What the popup is shown with: the coins the finished order paid and the item it took. */
export type RewardProps = { coins: number; picture: AssetKey };

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
      <Signboard id="rewardBoard" title={tr("orders.done")} width={840} height={900} hung>
        <Prize id="rewardPrize" picture={props.picture} look="rays" />
        <Amount id="rewardAmount" amountKey="rewardCoins" amount={`+${props.coins}`} />
        <PlankButton
          id="rewardClaim"
          intent="claim"
          look="green"
          size="popup"
          label={tr("orders.claim")}
        />
      </Signboard>
    </PopupScreen>
  )
});
