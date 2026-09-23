/**
 * @file The popup shell of Timber Town (design §4, §5.7, §6 E and F): every popup is a `screen`
 * root that holds a full-bleed backdrop and one hung signboard, centred in the safe area. The
 * backdrop dims the screen and fades in; on a dismissable popup it answers `close`, and Escape
 * taps it (design §4); on Reward and Confirm it answers nothing and only swallows the tap. The board itself is the `Signboard` of the
 * kit with `hung`: ropes, the swing, the fit into the safe area and the recede under a cover.
 *
 * The prize of Reward, Daily gift and Out of energy is here too: a reward on the honey rays with
 * no disc, the bolt in its sky disc; the coin with the big amount under a reward; and the one
 * place a popup's swing sound is played, `showPopup`.
 */
import type { Flow } from "@moku-labs/game";
import { defineMotion, sfx } from "@moku-labs/game";
import type { AssetKey } from "../../generated/assets";
import { defineStyle } from "../../kit";
import type { Label } from "./kit";
import { safeEdges, theme } from "./kit";

/** The root of a popup: the whole viewport, the board centred in the safe area. */
const popupScreen = defineStyle({
  width: "100%",
  height: "100%",
  direction: "column",
  align: "center",
  justify: "center",
  padding: safeEdges
});

/** The dim behind a popup: the whole screen, the safe area included. */
const backdropStyle = defineStyle({
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  fill: 0x1a_0f_08,
  alpha: 0.5,
  reason: "the backdrop dims the whole screen, the safe area included (design §5.7)"
});

/** The backdrop fades in and out; the second backdrop of a stacked popup darkens the first. */
const backdropMotion = defineMotion({
  states: { clear: { Shape: { alpha: 0 } } },
  transition: { ms: 200, ease: "out" },
  on: { enter: "clear", exit: "clear" }
});

/** What a popup screen takes. */
export type PopupScreenProps = {
  /** The popup's name: the root is keyed `<id>Screen`, the backdrop `<id>Backdrop`. */
  id: string;
  /**
   * The intent the backdrop answers, on a tap and on Escape. Left out, the popup is not
   * dismissable (Reward, Confirm).
   */
  dismiss?: string;
  /** The hung signboard of the popup. */
  children?: unknown;
};

/**
 * The root of every popup: the backdrop and the board. The backdrop comes first, so the board and
 * its buttons draw over it and a tap on the board never reaches it.
 *
 * @param props - The popup as its component declares it.
 * @returns The screen element.
 */
export function PopupScreen(props: PopupScreenProps) {
  const backdrop = `${props.id}Backdrop`;

  return (
    <screen key={`${props.id}Screen`} style={popupScreen}>
      {props.dismiss === undefined ? (
        <button key={backdrop} style={backdropStyle} motion={backdropMotion} />
      ) : (
        <button
          key={backdrop}
          intent={props.dismiss}
          escape
          style={backdropStyle}
          motion={backdropMotion}
        />
      )}
      {props.children as never}
    </screen>
  );
}

/** The box of a prize on rays: the rays shine past it, the picture sits in its middle. */
const prizeStyle = defineStyle({ width: 400, height: 400, align: "center", justify: "center" });

/** The honey rays behind a reward: wider than the box, so they fade out over the board. */
const raysStyle = defineStyle({
  position: "absolute",
  left: -90,
  top: -90,
  width: 580,
  height: 580,
  reason: "the rays shine behind the prize, past its box (design §6 E1, E5)"
});

/** The picture of a reward: the delivered item or the gift, on the rays with no disc. */
const prizePictureStyle = defineStyle({ width: 300, height: 300 });

/** The pale-sky disc the empty energy sits in (design §6 E4). */
const skyDiscStyle = defineStyle({
  width: 320,
  height: 320,
  radius: 160,
  fill: 0xcf_e8_f5,
  stroke: theme.color.ink,
  strokeWidth: 8,
  align: "center",
  justify: "center"
});

/** The bolt in the sky disc. */
const discPictureStyle = defineStyle({ width: 210, height: 210 });

/** What a prize takes. */
export type PrizeProps = {
  /** The key of the prize; the coins of a claim fly from it. Its parts are `<id>Rays`, `<id>Disc`, `<id>Picture`. */
  id: string;
  /** The picture. */
  picture: AssetKey;
  /**
   * How the picture is shown: `"rays"`, a reward on the honey rays with no disc (Reward, Daily
   * gift), or `"sky"`, in the pale-sky disc (Out of energy).
   */
  look: "rays" | "sky";
};

/**
 * A prize (design §6 E1, E4, E5): the delivered item or the gift on its rays, or the bolt in its
 * sky disc.
 *
 * @param props - The prize as the popup declares it.
 * @returns The stack element.
 */
export function Prize(props: PrizeProps) {
  if (props.look === "sky") {
    return (
      <stack key={props.id} style={skyDiscStyle}>
        <image key={`${props.id}Picture`} texture={props.picture} style={discPictureStyle} />
      </stack>
    );
  }

  return (
    <stack key={props.id} style={prizeStyle}>
      <image key={`${props.id}Rays`} texture="ui.fx-rays" style={raysStyle} />
      <image key={`${props.id}Picture`} texture={props.picture} style={prizePictureStyle} />
    </stack>
  );
}

/** The coin and the amount a reward pays, under its picture. */
const amountRow = defineStyle({ direction: "row", align: "center", gap: theme.space.md });

/** The coin in front of the amount. */
const amountCoin = defineStyle({ width: 104, height: 104 });

/**
 * The amount a reward pays (design §6 E1, E5): a coin, the big "+25", and the word after it when
 * the popup names one ("+50 монет").
 *
 * @param props - The amount.
 * @param props.id - The key of the row; the coin is keyed `<id>Coin`.
 * @param props.amountKey - The key of the big number.
 * @param props.amount - The number, already signed: `"+25"`.
 * @param props.unitKey - The key of the word after it.
 * @param props.unit - The word after the number; none when left out.
 * @returns The row element.
 */
export function Amount(props: {
  id: string;
  amountKey: string;
  amount: string;
  unitKey?: string;
  unit?: Label;
}) {
  return (
    <row key={props.id} style={amountRow}>
      <icon key={`${props.id}Coin`} name="ui.icon-coin" style={amountCoin} />
      <text key={props.amountKey} style="ui.amount" content={props.amount} />
      {props.unit === undefined ? undefined : (
        <text key={props.unitKey ?? `${props.id}Unit`} style="ui.title" content={props.unit} />
      )}
    </row>
  );
}

/** The sound a popup board makes as it swings in (design §6 F1). */
export const popupSound = sfx("ui.popup");

/**
 * Shows a popup that comes in: plays its swing sound once and awaits the popup. A node that shows
 * the same popup again after a transit (Settings after a volume step) awaits the popup alone,
 * because the board is taken back and does not swing in again.
 *
 * @param fx - The effects of the node.
 * @param descriptor - The popup: `popup(Component, props, options?)`.
 * @returns What the popup answered.
 */
export function showPopup(fx: Flow.NodeFx, descriptor: Flow.Descriptor): Promise<unknown> {
  void fx(popupSound);

  return fx(descriptor);
}
