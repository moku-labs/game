/**
 * @file The daily gift popup (design §6 E5): the plaque "Подарок дня", the gift box on the rays,
 * a coin with the big "+50" and "монет" after it, and the green Claim. It is dismissable: the backdrop answers `close`. The coins of
 * the claim fly from the prize box, keyed `giftPrize`, to the coin pill of Home.
 */
import { type } from "@moku-labs/game";
import { defineComponent, tr } from "../../kit";
import { PlankButton, Signboard } from "../ui/kit";
import { Amount, PopupScreen, Prize } from "../ui/popup";

/** What the popup is shown with: the coins the gift pays. */
export type DailyGiftProps = { coins: number };

export const DailyGift = defineComponent("DailyGift", {
  outcomes: { claim: type(), close: type() },
  view: (props: DailyGiftProps) => (
    <PopupScreen id="gift" dismiss="close">
      <Signboard id="giftBoard" title={tr("gift.title")} width={840} height={900} hung>
        <Prize id="giftPrize" picture="ui.icon-gift" look="rays" />
        <Amount
          id="giftAmount"
          amountKey="giftReward"
          amount={`+${props.coins}`}
          unitKey="giftRewardUnit"
          unit={tr("gift.coins", { coins: props.coins })}
        />
        <PlankButton
          id="giftClaim"
          intent="claim"
          look="green"
          size="popup"
          label={tr("gift.claim")}
        />
      </Signboard>
    </PopupScreen>
  )
});
