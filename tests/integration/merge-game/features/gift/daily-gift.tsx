/**
 * @file The daily gift popup (design §6 E5): the header "Подарок дня", the gift box on rays,
 * "+50 монет" and the green Claim. It is dismissable: the backdrop answers `close`. The coins of
 * the claim fly from the prize box, keyed `giftPrize`, to the coin pill of Home.
 */
import { type } from "@moku-labs/game";
import { defineComponent, tr } from "../../kit";
import { PlankButton, Signboard } from "../ui/kit";
import { PopupScreen, Prize } from "../ui/popup";

/** What the popup is shown with: the coins the gift pays. */
export type DailyGiftProps = { coins: number };

export const DailyGift = defineComponent("DailyGift", {
  outcomes: { claim: type(), close: type() },
  view: (props: DailyGiftProps) => (
    <PopupScreen id="gift" dismiss="close">
      <Signboard id="giftBoard" title={tr("gift.title")} width={760} height={900} hung>
        <Prize id="giftPrize" picture="ui.icon-gift" rays disc="paper" />
        <text
          key="giftReward"
          style="ui.title"
          content={tr("gift.reward", { coins: props.coins })}
        />
        <PlankButton id="giftClaim" intent="claim" look="green" label={tr("gift.claim")} />
      </Signboard>
    </PopupScreen>
  )
});
