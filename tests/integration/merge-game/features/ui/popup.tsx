/**
 * @file The popup shell of Timber Town (design §4, §5.7, §6 E and F): every popup is a `screen`
 * root that holds a full-bleed backdrop and one hung signboard, centred in the safe area. The
 * backdrop dims the screen and fades in; on a dismissable popup it answers `close`, on Reward and
 * Confirm it answers nothing and only swallows the tap. The board itself is the `Signboard` of the
 * kit with `hung`: ropes, the swing, the fit into the safe area and the recede under a cover.
 *
 * The prize picture of Reward, Daily gift and Out of energy is here too: a picture on a disc,
 * with the honey rays behind it when it is a reward.
 */
import { defineMotion } from "@moku-labs/game";
import type { AssetKey } from "../../generated/assets";
import { defineStyle } from "../../kit";
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
  /** The intent the backdrop answers. Left out, the popup is not dismissable (Reward, Confirm). */
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
          style={backdropStyle}
          motion={backdropMotion}
        />
      )}
      {props.children as never}
    </screen>
  );
}

/** The disc colours of a prize: parchment for a reward, pale sky for the energy. */
export type PrizeDisc = "paper" | "sky";

/** The box of a prize: the rays fill it, the disc sits in its middle. */
const prizeStyle = defineStyle({ width: 360, height: 360, align: "center", justify: "center" });

/** The honey rays behind a reward. */
const raysStyle = defineStyle({
  position: "absolute",
  left: 0,
  top: 0,
  width: 360,
  height: 360,
  reason: "the rays shine behind the disc, over the whole prize box"
});

/**
 * The style of the disc a prize sits on.
 *
 * @param fill - The colour of the disc.
 * @returns The frozen style.
 */
function discStyle(fill: number) {
  return defineStyle({
    width: 240,
    height: 240,
    radius: 120,
    fill,
    stroke: theme.color.woodDark,
    strokeWidth: 6,
    align: "center",
    justify: "center"
  });
}

/** Both discs, built once. */
const discStyles: Record<PrizeDisc, ReturnType<typeof discStyle>> = {
  paper: discStyle(theme.color.parchment),
  sky: discStyle(0xcf_e8_f5)
};

/** The picture on the disc. */
const prizePictureStyle = defineStyle({ width: 180, height: 180 });

/** What a prize takes. */
export type PrizeProps = {
  /** The key of the prize box; the coins of a claim fly from it. Its parts are `<id>Rays`, `<id>Disc`, `<id>Picture`. */
  id: string;
  /** The picture on the disc. */
  picture: AssetKey;
  /** Whether the honey rays shine behind it: a reward does, the empty energy bar does not. */
  rays?: boolean;
  /** The colour of the disc. */
  disc: PrizeDisc;
};

/**
 * A prize (design §6 E1, E4, E5): the delivered item, the gift or the bolt on its disc.
 *
 * @param props - The prize as the popup declares it.
 * @returns The stack element.
 */
export function Prize(props: PrizeProps) {
  return (
    <stack key={props.id} style={prizeStyle}>
      {props.rays === true ? (
        <image key={`${props.id}Rays`} texture="ui.fx-rays" style={raysStyle} />
      ) : undefined}
      <stack key={`${props.id}Disc`} style={discStyles[props.disc]}>
        <image key={`${props.id}Picture`} texture={props.picture} style={prizePictureStyle} />
      </stack>
    </stack>
  );
}
