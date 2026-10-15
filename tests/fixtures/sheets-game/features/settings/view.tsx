/**
 * @file The settings sheet over the shop: its root is the overlay (dim 0.4, no HUD part stays shown), a sheet with
 * a close button.
 */
import { Overlay, projection } from "../../kit";
import type { Session } from "../../state";
import { buttonAt, fullScreen } from "../ward/styles";

export const settingsSheet = projection({
  name: "settings.sheet",
  layer: "ui",
  from: (_player: unknown, session: Session) =>
    session.over === "settings" ? [{ id: "settings" }] : [],
  key: (item: { id: string }) => item.id,
  view: () => (
    <stack key="settingsLayer" style={fullScreen} components={[Overlay({ dim: 0.4, hud: "none" })]}>
      <panel
        key="settingsPanel"
        style={{ ...buttonAt(240, 600, 0xd8_e4_f4), width: 600, height: 500 }}
      >
        <button key="settingsClose" intent="close" escape style={buttonAt(220, 300, 0x7a_7a_7a)} />
      </panel>
    </stack>
  )
});
