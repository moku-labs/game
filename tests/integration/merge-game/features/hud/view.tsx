/**
 * @file The board screen around the board: one projection whose view is markup. A `screen` root
 * padded with the safe-area tokens holds the full-bleed meadow, the HUD row, the order strip, the
 * board slot and the sawmill info bar (design §5, §6 A3). The slot hosts the board projections, so
 * the cells, their glows, the selection ring, the sawmill with its clock badge and the items are
 * drawn inside it and shrink with it on a short phone. No layout arithmetic anywhere: Yoga places every element.
 */
import { projection } from "../../kit";
import type { Player, Session } from "../../state";
import type { InfoView } from "../board/info-bar";
import { InfoBar, infoOf } from "../board/info-bar";
import type { OrderCardView } from "../orders/strip";
import { OrderStrip, orderCardsOf } from "../orders/strip";
import { fullBleed, safeScreen } from "../ui/kit";
import type { EnergyView } from "./row";
import { HudRow } from "./row";
import { boardArea, boardSlot } from "./styles";

/** The projections the board slot draws inside itself. */
const boardProjections = [
  "board.cells",
  "board.glows",
  "board.selection",
  "board.generators",
  "board.clock",
  "board.items"
] as const;

/** The board screen as the view reads it: one row of the save. */
export type HudView = {
  id: string;
  energy: EnergyView;
  orders: OrderCardView[];
  info: InfoView;
};

/**
 * Reads the board screen out of the save and the session: the energy, the three order cards and
 * what the info bar names, the selected item or the sawmill.
 *
 * @param player - The saved player.
 * @param session - The session, which keeps the selected id.
 * @returns The one row the screen projects.
 */
function hudOf(player: Player, session: Session): HudView {
  const state = player.merge;

  return {
    id: "hud",
    energy: { value: state.energy.value, max: state.energy.max },
    orders: orderCardsOf(state),
    info: infoOf(player, session)
  };
}

/**
 * The board screen. Every button names an intent of the board's rest node: `leave`,
 * `openSettings`, and one `deliver` per order card with that order's give.
 */
export const hud = projection({
  name: "hud",
  layer: "ui",
  from: (player: Player, session: Session): HudView[] => [hudOf(player, session)],
  key: item => item.id,
  view: item => (
    <screen key="boardScreen" style={safeScreen}>
      <image key="boardBackground" texture="board.bg-forest-meadow" fit="cover" style={fullBleed} />
      <HudRow energy={item.energy} />
      <OrderStrip cards={item.orders} />
      <column key="boardArea" style={boardArea}>
        <stack key="boardSlot" hosts={boardProjections} style={boardSlot} />
      </column>
      <InfoBar info={item.info} />
    </screen>
  )
});
