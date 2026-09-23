/**
 * @file The order strip of the board (design §6 B2): three paper tags on clothespins along one
 * rope. Each card shows what its order wants — the picture with its level, "×2" when two are
 * needed, the name and the coins it pays — and its own Deliver button. The rules decide whether a
 * card is ready: its Deliver answers `deliver` with exactly the give the node applies, and it is
 * the grey plank while nothing on the board fits.
 */
import { tr } from "../../kit";
import type { GiveInput, MergeState, Order } from "../../rules";
import { rules } from "../../rules";
import { tables } from "../../tables";
import { nameOf, pictureOf } from "../../view/items";
import { PlankButton } from "../ui/kit";
import {
  cardPicture,
  levelBadge,
  levelDisc,
  nameRow,
  orderCard,
  orderStrip,
  pictureFrame,
  pinStyle,
  rewardIcon,
  rewardRow,
  ropeStyle,
  waitingPicture
} from "./styles";

/**
 * One order card as the view reads it: the slot on the rope, the open need, how many of it, the
 * item on the board that fills it, and the coins the order pays.
 *
 * @example
 * ```ts
 * const card: OrderCardView = {
 *   slot: 0, id: 0, chain: "wood", level: 3, count: 1, item: "i1", reward: 25, ready: true
 * };
 * ```
 */
export type OrderCardView = {
  /** The position on the rope, 0 on the left. */
  slot: number;
  /** Id of the order in that slot. */
  id: number;
  /** The chain its open need asks for. */
  chain: string;
  /** The level its open need asks for; zero when the order is full. */
  level: number;
  /** How many open needs ask for that same item. */
  count: number;
  /** The item on the board the rules accept for it, `""` when none. */
  item: string;
  /** The coins the order pays. */
  reward: number;
  /** Whether the rules accept a give right now. */
  ready: boolean;
};

/**
 * The open needs of an order, in the order the table lists them.
 *
 * @param order - The order slot.
 * @returns The needs not given yet.
 * @example
 * ```ts
 * openNeeds({ id: 1, needs: [{ chain: "wood", level: 2 }], given: [], rewardId: "logs" });
 * // [{ chain: "wood", level: 2 }]
 * ```
 */
function openNeeds(order: Order): Order["needs"] {
  return order.needs.filter((_need, position) => !order.given.includes(position));
}

/**
 * The coins one order pays, read from the order table.
 *
 * @param order - The order slot.
 * @returns The coins, zero when the table does not know the reward.
 * @example
 * ```ts
 * rewardOf({ id: 0, needs: [], given: [], rewardId: "planks" }); // 25
 * ```
 */
function rewardOf(order: Order): number {
  return tables.orders.find(entry => entry.rewardId === order.rewardId)?.reward.coins ?? 0;
}

/**
 * Reads one card out of the rule state. It is the rules that answer whether a board item fits,
 * so the card is ready exactly when the `deliver` node would accept the give.
 *
 * @param state - The rule state of the save.
 * @param order - The order in the slot.
 * @param slot - The position of the slot on the rope.
 * @returns The card.
 */
function cardOf(state: MergeState, order: Order, slot: number): OrderCardView {
  const open = openNeeds(order);
  const need = open[0] ?? { chain: "", level: 0 };
  const count = open.filter(each => each.chain === need.chain && each.level === need.level).length;
  const fit = state.board.items.find(item => rules.isLegalOrderMatch(state, item.id, order.id));

  return {
    slot,
    id: order.id,
    chain: need.chain,
    level: need.level,
    count,
    item: fit?.id ?? "",
    reward: rewardOf(order),
    ready: fit !== undefined
  };
}

/**
 * Reads the three cards of the strip out of the rule state, one per order slot.
 *
 * @param state - The rule state of the save.
 * @returns One card per order, left to right.
 */
export function orderCardsOf(state: MergeState): OrderCardView[] {
  return state.orders.map((order, slot) => cardOf(state, order, slot));
}

/**
 * The key of the card in one slot. The reward animation aims at it, so it is written once.
 *
 * @param slot - The position on the rope.
 * @returns The key of the card element.
 * @example
 * ```ts
 * cardKey(2); // "card2"
 * ```
 */
export function cardKey(slot: number): string {
  return `card${slot}`;
}

/**
 * What the Deliver button of a card answers the gate with: the input of the `deliver` node.
 *
 * @param card - The card.
 * @returns The give the board applies.
 */
function deliverOf(card: OrderCardView): GiveInput {
  return { item: card.item, order: card.id };
}

/**
 * One order card: the paper tag on its clothespin. A ready card is selected, which gives it the
 * honey glow of its style; a waiting one fades only its picture, so its words stay readable.
 *
 * @param props - The card to draw.
 * @param props.card - The card as `orderCardsOf` read it.
 * @returns The column element of the card.
 */
export function OrderCard(props: { card: OrderCardView }) {
  const card = props.card;
  const id = cardKey(card.slot);

  return (
    <column key={id} state={{ selected: card.ready }} style={orderCard}>
      <image key={`${id}Pin`} texture="ui.decor-clothespin" style={pinStyle} />
      <text
        key={`${id}Title`}
        style="ui.small"
        content={tr("orders.title", { number: card.slot + 1 })}
      />
      <stack key={`${id}Picture`} style={pictureFrame}>
        <image
          key={`${id}Item`}
          texture={pictureOf(card.chain, card.level)}
          style={card.ready ? cardPicture : waitingPicture}
        />
        <stack key={`${id}Level`} style={levelBadge}>
          <image key={`${id}LevelDisc`} texture="ui.badge-level" style={levelDisc} />
          <text key={`${id}LevelNumber`} style="ui.badge" content={String(card.level)} />
        </stack>
      </stack>
      <row key={`${id}Need`} style={nameRow}>
        <text
          key={`${id}Name`}
          style="ui.name"
          content={tr("board.item", { item: nameOf(card.level) })}
        />
        {card.count > 1 ? (
          <text key={`${id}Count`} style="ui.name" content={`×${card.count}`} />
        ) : undefined}
      </row>
      <row key={`${id}Reward`} style={rewardRow}>
        <icon key={`${id}Coin`} name="ui.icon-coin" style={rewardIcon} />
        <text key={`${id}Coins`} style="ui.name" content={String(card.reward)} />
      </row>
      <PlankButton
        id={`deliver${card.slot}`}
        intent="deliver"
        payload={deliverOf(card)}
        look="green"
        size="small"
        disabled={!card.ready}
        label={tr("orders.deliver")}
      />
    </column>
  );
}

/**
 * The order strip: one rope across the screen, the three cards pinned to it.
 *
 * @param props - The cards to draw.
 * @param props.cards - One card per order slot, left to right.
 * @returns The strip element.
 */
export function OrderStrip(props: { cards: readonly OrderCardView[] }) {
  return (
    <row key="orders" style={orderStrip}>
      <row key="ordersRope" style={ropeStyle} />
      {props.cards.map(card => (
        <OrderCard key={cardKey(card.slot)} card={card} />
      ))}
    </row>
  );
}
