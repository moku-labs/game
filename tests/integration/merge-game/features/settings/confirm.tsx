/**
 * @file The confirm reset popup (design §6 E3): a small signboard stacked on the settings, with
 * "Сбросить всё?", the body on a parchment chip, the berry Reset and the wood Cancel side by side
 * at the same width. It is not
 * dismissable: its backdrop, the second and darker one, answers nothing. The node that shows it
 * passes `{ over: "Settings" }`, so the settings stay beneath it, covered.
 */
import { type } from "@moku-labs/game";
import { defineComponent, tr } from "../../kit";
import { Parchment, PlankButton, Signboard } from "../ui/kit";
import { PopupScreen } from "../ui/popup";
import { confirmButtons } from "./styles";

export const Confirm = defineComponent("Confirm", {
  outcomes: { reset: type(), cancel: type() },
  view: () => (
    <PopupScreen id="confirm">
      <Signboard
        id="confirmBoard"
        title={tr("settings.confirmTitle")}
        width={900}
        height={700}
        hung
      >
        <Parchment id="confirmBody" chip>
          <text key="confirmText" style="ui.paragraph" content={tr("settings.confirmBody")} />
        </Parchment>
        <row key="confirmButtons" style={confirmButtons}>
          <PlankButton
            id="confirmReset"
            intent="reset"
            look="berry"
            size="half"
            label={tr("settings.confirmReset")}
          />
          <PlankButton
            id="confirmCancel"
            intent="cancel"
            look="wood"
            size="half"
            label={tr("settings.confirmCancel")}
          />
        </row>
      </Signboard>
    </PopupScreen>
  )
});
