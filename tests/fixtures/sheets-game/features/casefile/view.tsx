/**
 * @file The case file: an opaque panel over the whole ward, its own fade the overlay's motion. Once it has faded in,
 * the ward under it is not drawn at all, until it starts to leave.
 */
import { defineMotion } from "@moku-labs/game";
import { Overlay, projection } from "../../kit";
import type { Session } from "../../state";
import { buttonAt, fullScreen } from "../ward/styles";

/** The case file fades in and out over 250 ms. */
export const sheetFade = defineMotion({
  states: { faded: { Shape: { alpha: 0 } } },
  transition: { ms: 250 },
  on: { enter: "faded", exit: "faded" }
});

export const casefileSheet = projection({
  name: "casefile.sheet",
  layer: "ui",
  from: (_player: unknown, session: Session) =>
    session.sheet === "casefile" ? [{ id: "casefile" }] : [],
  key: (item: { id: string }) => item.id,
  view: () => (
    <panel
      key="caseSheet"
      motion={sheetFade}
      style={{ ...fullScreen, fill: 0xee_e4_cc }}
      components={[Overlay({ cover: "opaque" })]}
    >
      <button key="caseClose" intent="close" escape style={buttonAt(460, 1500, 0x5a_4a_3a)} />
    </panel>
  )
});
