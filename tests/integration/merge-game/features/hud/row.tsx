/**
 * @file The HUD row of the board (design §6 B1, F4): the round home button, the coin pill, the
 * energy pill and the round gear, spread across one row under the top safe edge. The coin pill hosts the counter
 * projection, so its number rolls in place; the energy is plain words, "7/10".
 */
import { HudPill, RoundButton } from "../ui/kit";
import { hudRow } from "./styles";

/**
 * The energy the pill shows, as the rules keep it.
 *
 * @example
 * ```ts
 * const energy: EnergyView = { value: 7, max: 10 };
 * ```
 */
export type EnergyView = { value: number; max: number };

/**
 * The HUD row. The home button answers `leave` and the gear `openSettings`: both are intents of
 * the board's rest node.
 *
 * @param props - What the row shows.
 * @param props.energy - The energy of the save.
 * @returns The row element.
 */
export function HudRow(props: { energy: EnergyView }) {
  return (
    <row key="hudRow" style={hudRow}>
      <RoundButton id="home" intent="leave" icon="ui.icon-home" />
      <HudPill id="coinPill" icon="ui.icon-coin" hosts={["hud.coins"]} width="wide" />
      <HudPill
        id="energyPill"
        icon="ui.icon-energy"
        text={`${props.energy.value}/${props.energy.max}`}
        width="narrow"
      />
      <RoundButton id="settings" intent="openSettings" icon="ui.icon-gear" />
    </row>
  );
}
