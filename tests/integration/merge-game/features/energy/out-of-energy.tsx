/**
 * @file The Out of energy popup (design §6 E4): the plaque "Нет энергии", the bolt in the pale-sky
 * disc, "Пополнится через 09:59" on a parchment chip, the green Watch & refill with its play
 * glyph on two lines and the wood Later. It is dismissable:
 * the backdrop answers `close`, which the node reads as Later.
 */
import { type } from "@moku-labs/game";
import { defineComponent, tr } from "../../kit";
import { Parchment, PlankButton, Signboard } from "../ui/kit";
import { PopupScreen, Prize } from "../ui/popup";

/** What the popup is shown with: the wait until the next point, already formatted. */
export type OutOfEnergyProps = { refillIn: string };

export const OutOfEnergy = defineComponent("OutOfEnergy", {
  outcomes: { watch: type(), later: type(), close: type() },
  view: (props: OutOfEnergyProps) => (
    <PopupScreen id="energy" dismiss="close">
      <Signboard
        id="energyBoard"
        title={tr("energy.title")}
        width={840}
        height={1240}
        top={150}
        hung
      >
        <Prize id="energyPrize" picture="ui.icon-energy" look="sky" />
        <Parchment id="energyTimer" chip>
          <text
            key="energyRefill"
            style="ui.paragraph"
            content={tr("energy.refill", { time: props.refillIn })}
          />
        </Parchment>
        <PlankButton
          id="energyWatch"
          intent="watch"
          look="green"
          size="tall"
          glyph="play"
          label={tr("energy.watch")}
        />
        <PlankButton
          id="energyLater"
          intent="later"
          look="wood"
          size="popup"
          label={tr("energy.later")}
        />
      </Signboard>
    </PopupScreen>
  )
});
