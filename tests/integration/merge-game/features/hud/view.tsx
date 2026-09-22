/**
 * @file The HUD: one projection whose view is markup. The save gives the coins and the first
 * order, the markup gives the shape, and the two buttons name the intents the board answers —
 * `deliver` for the order card, `openSettings` for the gear. No layout arithmetic anywhere.
 */
import { defineMotion } from "@moku-labs/game";
import { projection, tr } from "../../kit";
import type { GiveInput, MergeState, Order } from "../../rules";
import { rules } from "../../rules";
import type { Player } from "../../state";
import { coinSlot, iconButton, orderCard, topBar } from "./styles";

/** How long a button takes to arrive and to leave. */
const BUTTON_MS = 150;

/** The order the card shows, with the board item that would fill it. */
export type OrderView = {
  /** Id of the order slot. */
  id: number;
  /** The chain its open need asks for. */
  chain: string;
  /** The level its open need asks for. */
  level: number;
  /** The item on the board that fills it, `""` when the player has none. */
  item: string;
};

/** The whole HUD as the view reads it: one row of the save. */
export type HudView = {
  id: string;
  coins: number;
  order: OrderView;
};

/**
 * The HUD buttons arrive and leave with a small pop, built from one named pose. The keys of a
 * pose are component names, which is why no component is imported here.
 */
const buttonMotion = defineMotion({
  states: { hidden: { Transform: { scale: 0.9 }, Shape: { alpha: 0 } } },
  transition: { ms: BUTTON_MS, ease: "out" },
  on: { enter: "hidden", exit: "hidden", change: ["Transform"] }
});

/**
 * The first open need of an order: what the card asks the player for.
 *
 * @param order - The order slot.
 * @returns The chain and the level of the need, or the level zero when the order is full.
 * @example
 * ```ts
 * openNeed({ id: 0, needs: [{ chain: "wood", level: 3 }], given: [], rewardId: "planks" });
 * // { chain: "wood", level: 3 }
 * ```
 */
function openNeed(order: Order): { chain: string; level: number } {
  const index = order.needs.findIndex((_need, position) => !order.given.includes(position));

  return order.needs[index] ?? { chain: "", level: 0 };
}

/**
 * The item on the board that would fill an order right now. It is the rules that answer, so the
 * card is enabled exactly when the `deliver` node would accept the give.
 *
 * @param state - The rule state of the save.
 * @param order - The order slot the card shows.
 * @returns The item id, or `""` when nothing on the board fits.
 */
function itemFor(state: MergeState, order: Order): string {
  const found = state.board.items.find(item => rules.isLegalOrderMatch(state, item.id, order.id));

  return found?.id ?? "";
}

/**
 * Reads the HUD out of the save: the coins and the first order slot with what would fill it.
 *
 * @param player - The saved player.
 * @returns The one row the HUD projects.
 */
function hudOf(player: Player): HudView {
  const state = player.merge;
  const coins = state.wallet.coins ?? 0;
  const order = state.orders[0];

  if (order === undefined) {
    return {
      id: "hud",
      coins,
      order: { id: -1, chain: "", level: 0, item: "" }
    };
  }

  return {
    id: "hud",
    coins,
    order: { id: order.id, ...openNeed(order), item: itemFor(state, order) }
  };
}

/**
 * What the order card answers the gate with: the same input the `deliver` node takes.
 *
 * @param order - The order the card shows.
 * @returns The give the board applies.
 */
function deliverOf(order: OrderView): GiveInput {
  return { item: order.item, order: order.id };
}

/**
 * The top bar: the slot the coin counter is drawn into, the order card and the gear. The card is
 * a button with the `deliver` intent and is disabled while no item on the board fills the order.
 */
export const hud = projection({
  name: "hud",
  layer: "ui",
  from: (player: Player): HudView[] => [hudOf(player)],
  key: item => item.id,
  view: item => (
    <row key="bar" style={topBar}>
      <row key="coinSlot" style={coinSlot} />
      <button
        key="order"
        intent="deliver"
        payload={deliverOf(item.order)}
        state={{ disabled: item.order.item === "" }}
        style={orderCard}
        motion={buttonMotion}
      >
        <text key="orderTitle" style="hud.label" content={tr("hud.order")} />
        <text
          key="orderNeed"
          style="hud.label"
          content={tr("hud.need", { chain: item.order.chain, level: item.order.level })}
        />
        <text key="orderAction" style="hud.label" content={tr("hud.deliver")} />
      </button>
      <button key="settings" intent="openSettings" style={iconButton} motion={buttonMotion}>
        <text key="settingsLabel" style="hud.label" content={tr("hud.settings")} />
      </button>
    </row>
  )
});
