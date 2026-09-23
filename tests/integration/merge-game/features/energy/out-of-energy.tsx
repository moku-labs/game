/**
 * @file The Out of energy popup (design §6 E4): the header "Нет энергии", the bolt on a pale-blue
 * disc, "Пополнится через 09:59", the green Watch & refill and the wood Later. It is dismissable:
 * the backdrop answers `close`, which the node reads as Later.
 */
import { type } from "@moku-labs/game";
import { defineComponent, tr } from "../../kit";
import { PlankButton, Signboard } from "../ui/kit";
import { PopupScreen, Prize } from "../ui/popup";

/** What the popup is shown with: the wait until the next point, already formatted. */
export type OutOfEnergyProps = { refillIn: string };

export const OutOfEnergy = defineComponent("OutOfEnergy", {
  outcomes: { watch: type(), later: type(), close: type() },
  view: (props: OutOfEnergyProps) => (
    <PopupScreen id="energy" dismiss="close">
      <Signboard id="energyBoard" title={tr("energy.title")} width={820} height={980} hung>
        <Prize id="energyPrize" picture="ui.icon-energy" disc="sky" />
        <text
          key="energyRefill"
          style="ui.body"
          content={tr("energy.refill", { time: props.refillIn })}
        />
        <PlankButton
          id="energyWatch"
          intent="watch"
          look="green"
          size="wide"
          label={tr("energy.watch")}
        />
        <PlankButton id="energyLater" intent="later" look="wood" label={tr("energy.later")} />
      </Signboard>
    </PopupScreen>
  )
});
