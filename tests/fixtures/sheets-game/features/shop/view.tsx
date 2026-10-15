/**
 * @file The shop: its root is the overlay (the board dims to 56 %, the energy and the gems stay shown above the dim,
 * the dim takes 270 ms: the root plays no motion of its own), a full-screen tap target that closes it, and a sheet
 * that rises with a buy button (energy + 1) and the settings button.
 */
import { defineMotion } from "@moku-labs/game";
import { Overlay, projection } from "../../kit";
import type { Session } from "../../state";
import { buttonAt, fullScreen, pinned } from "../ward/styles";

/** The sheet comes up: from 90 % and transparent to rest over 300 ms. */
export const sheetRise = defineMotion({
  states: { low: { Transform: { scale: 0.9 }, Shape: { alpha: 0 } } },
  transition: { ms: 300, ease: "out" },
  on: { enter: "low", exit: "low" }
});

export const shopSheet = projection({
  name: "shop.sheet",
  layer: "ui",
  from: (_player: unknown, session: Session) => (session.sheet === "shop" ? [{ id: "shop" }] : []),
  key: (item: { id: string }) => item.id,
  view: () => (
    <stack
      key="shopDimLayer"
      style={fullScreen}
      components={[
        Overlay({ dim: 0.56, dimColor: 0x1b_14_30, hud: ["energy", "gems"], fade: 270 })
      ]}
    >
      <button key="shopDim" intent="close" escape style={pinned} />
      <panel
        key="shopSheetPanel"
        motion={sheetRise}
        style={{ ...buttonAt(140, 900, 0xf4_ea_d8), width: 800, height: 700 }}
      >
        <button key="buy" intent="buy" style={buttonAt(80, 80, 0xe0_9a_3a)} />
        <button key="openSettings" intent="settings" style={buttonAt(560, 80, 0x9a_9a_9a)} />
      </panel>
    </stack>
  )
});
