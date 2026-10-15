/**
 * @file The HUD in its own layer, above every overlay: the level ring, the energy and the gems counters and the shop
 * button, each a part an overlay keeps or lets fade.
 */
import { HudPart, projection } from "../../kit";
import type { Player } from "../../state";
import { buttonAt } from "../ward/styles";

export const hudBar = projection({
  name: "hud.bar",
  layer: "hud",
  from: (player: Player) => ({ level: player.level, energy: player.energy, gems: player.gems }),
  view: item => (
    <stack key="hudBar" style={{ width: "100%", height: 220 }}>
      <panel
        key="hudLevel"
        style={buttonAt(40, 40, 0x7a_4f_9a)}
        components={[HudPart({ key: "level" })]}
      />
      <stack
        key="hudEnergy"
        style={buttonAt(240, 40, 0x2f_6a_4f)}
        components={[HudPart({ key: "energy" })]}
      >
        <text key="hudEnergyCount" style="ui.count" content={`${item.energy}`} />
      </stack>
      <stack
        key="hudGems"
        style={buttonAt(440, 40, 0x2f_4f_6a)}
        components={[HudPart({ key: "gems" })]}
      >
        <text key="hudGemsCount" style="ui.count" content={`${item.gems}`} />
      </stack>
      <button
        key="shopButton"
        intent="shop"
        style={buttonAt(880, 40, 0xc2_7a_3a)}
        components={[HudPart({ key: "shop" })]}
      />
    </stack>
  )
});
