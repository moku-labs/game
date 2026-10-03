/**
 * @file The Leave popup: Back on Home asks first. A small hung signboard with the plaque "Выйти из
 * игры?" and two planks side by side at the same width: the wood Leave and the green Stay, which
 * glows as the primary button. It is dismissable: the backdrop and Escape answer `stay`, so a
 * second Back press keeps the player in the game.
 */
import { type } from "@moku-labs/game";
import { defineComponent, defineStyle, tr } from "../../kit";
import { PlankButton, Signboard, theme } from "../ui/kit";
import { PopupScreen } from "../ui/popup";

/** The two planks of the popup, side by side at the same width. */
const leaveButtons = defineStyle({
  direction: "row",
  align: "center",
  alignSelf: "stretch",
  gap: theme.space.md
});

export const Leave = defineComponent("Leave", {
  outcomes: { leave: type(), stay: type() },
  view: () => (
    <PopupScreen id="leave" dismiss="stay">
      <Signboard id="leaveBoard" title={tr("leave.title")} width={900} height={420} hung>
        <row key="leaveButtons" style={leaveButtons}>
          <PlankButton
            id="leaveExit"
            intent="leave"
            look="wood"
            size="half"
            label={tr("leave.leave")}
          />
          <PlankButton
            id="leaveStay"
            intent="stay"
            look="green"
            size="half"
            label={tr("leave.stay")}
          />
        </row>
      </Signboard>
    </PopupScreen>
  )
});
