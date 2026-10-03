/**
 * @file The Rename popup: a signboard stacked on the settings with "Твоё имя", the name field in
 * its cream frame on a parchment chip with its "4/16" counter under it, and the green Save. The text lives in the
 * popup's `local`: every keystroke writes it, the counter and Save follow in the same frame, and
 * the gate hears only the answer, from Enter in the field or from Save. It is dismissable: the
 * X, the backdrop and Escape answer `close`, and the name stays what it was.
 */
import { type } from "@moku-labs/game";
import { defineComponent, tr } from "../../kit";
import { Parchment, PlankButton, Signboard } from "../ui/kit";
import { PopupScreen } from "../ui/popup";
import { nameColumn, nameCountRow, nameField, nameFrame } from "./styles";

/** The longest name the field takes, in characters. */
export const NAME_LENGTH = 16;

/** What Save and Enter answer with: the name as it was typed. */
export type RenameInput = { name: string };

export const Rename = defineComponent("Rename", {
  local: { name: "" },
  outcomes: { save: type<RenameInput>(), close: type() },
  view: (_props: object, local) => (
    <PopupScreen id="rename" dismiss="close">
      <Signboard
        id="renameBoard"
        title={tr("settings.renameTitle")}
        width={900}
        height={640}
        hung
        close="close"
      >
        <Parchment id="renamePaper" chip>
          <column key="renameColumn" style={nameColumn}>
            <row key="nameFrame" style={nameFrame}>
              <input
                key="nameField"
                local="name"
                maxLength={NAME_LENGTH}
                submit="save"
                placeholder={tr("settings.renameHint")}
                textStyle="ui.field"
                style={nameField}
              />
            </row>
            <row key="nameCountRow" style={nameCountRow}>
              <text
                key="nameCount"
                style="ui.small"
                content={`${local.name.length}/${NAME_LENGTH}`}
              />
            </row>
          </column>
        </Parchment>
        <PlankButton
          id="renameSave"
          intent="save"
          payload={{ name: local.name }}
          look="green"
          size="popup"
          disabled={local.name.trim() === ""}
          label={tr("settings.renameSave")}
        />
      </Signboard>
    </PopupScreen>
  )
});
