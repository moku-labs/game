/**
 * @file The reward popup: a component with one outcome. `popup(RewardPopup, …)` opens the gate
 * for exactly that outcome, so the button inside the panel is what resolves the node — the node
 * awaits an answer, not a timer.
 */
import { type } from "@moku-labs/game";
import { defineComponent, tr } from "../../kit";
import { claimButton, rewardPanel } from "./styles";

/** What the popup is shown with: the coins the finished order paid. */
export type RewardProps = { coins: number };

export const RewardPopup = defineComponent("RewardPopup", {
  outcomes: { claim: type() },
  view: (props: RewardProps) => (
    <panel key="reward" style={rewardPanel}>
      <text key="title" style="hud.title" content={tr("orders.done")} />
      <text key="amount" style="hud.label" content={tr("orders.reward", { coins: props.coins })} />
      <button key="claim" intent="claim" style={claimButton}>
        <text key="claimLabel" style="hud.label" content={tr("orders.claim")} />
      </button>
    </panel>
  )
});
