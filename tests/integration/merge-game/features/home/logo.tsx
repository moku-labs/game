/**
 * @file The logo sign of Splash and Home (design §6 A1, A2): the name of the game painted on a
 * signboard 900 units wide. It hangs on two ropes that come down from above the top of the
 * screen, and a berry sprig sits on its top-right and bottom-left corners. The sign is a picture,
 * not a control: it takes no tap.
 */
import { defineStyle, tr } from "../../kit";

/**
 * The sign, in reference units: its size, where its two ropes meet its top edge (228 units either
 * side of its middle), how thick and long a rope is, and how far a rope reaches over the top rim.
 */
export const logo = {
  width: 900,
  height: 440,
  ropeFromMiddle: 228,
  ropeWidth: 18,
  ropeLength: 900,
  ropeOverlap: 16
} as const;

/** The size of a berry sprig on a corner of the sign. */
const sprig = { width: 180, height: 195 } as const;

/** The name of the game, in the language of the player. */
const gameName = tr("ui.gameName");

/**
 * The walnut the light signboard is tinted to: the logo sign is dark wood, so the cream name reads
 * on it, while the popup boards keep the light board (design §6 A1, A2).
 */
const walnutTint = 0x7c_60_4e;

/** The signboard, dark walnut, with the name in its middle. */
const signStyle = defineStyle({
  width: logo.width,
  height: logo.height,
  align: "center",
  justify: "center",
  padding: { top: 60, right: 72, bottom: 72, left: 72 },
  nineSlice: "ui.panel-signboard",
  tint: walnutTint
});

/** Where a rope sits: from its edge of the sign to the rope's own left or right side. */
const ropeInset = logo.width / 2 - logo.ropeFromMiddle - logo.ropeWidth / 2;

/**
 * The style of one rope, from far above the sign down over its top rim.
 *
 * @param side - Which rope.
 * @returns The frozen style.
 */
function ropeStyle(side: "left" | "right") {
  return defineStyle({
    ...(side === "left" ? { left: ropeInset } : { right: ropeInset }),
    position: "absolute",
    top: -logo.ropeLength,
    width: logo.ropeWidth,
    height: logo.ropeLength + logo.ropeOverlap,
    reason: "the ropes hang the sign from above the top of the screen (design §6 A1)"
  });
}

/** The two ropes, built once. */
const ropes = { left: ropeStyle("left"), right: ropeStyle("right") } as const;

/** The sprig over the top-right corner of the sign. */
const sprigTopRight = defineStyle({
  position: "absolute",
  right: -56,
  top: -48,
  ...sprig,
  reason: "the sprig is pinned over the corner of the sign"
});

/** The sprig under the bottom-left corner of the sign. */
const sprigBottomLeft = defineStyle({
  position: "absolute",
  left: -96,
  bottom: -104,
  ...sprig,
  reason: "the sprig is pinned over the corner of the sign"
});

/**
 * The logo sign. Its parts are keyed after `id`: `<id>RopeLeft`, `<id>RopeRight`, `<id>Name`,
 * `<id>SprigTop` and `<id>SprigBottom`.
 *
 * @param props - The key of the sign.
 * @param props.id - The key.
 * @returns The column element.
 */
export function LogoSign(props: { id: string }) {
  return (
    <column key={props.id} style={signStyle}>
      <image key={`${props.id}RopeLeft`} texture="ui.rope-vertical" fit="fill" style={ropes.left} />
      <image
        key={`${props.id}RopeRight`}
        texture="ui.rope-vertical"
        fit="fill"
        style={ropes.right}
      />
      <text key={`${props.id}Name`} style="ui.logo" content={gameName} />
      <image key={`${props.id}SprigTop`} texture="ui.decor-sprig" style={sprigTopRight} />
      <image key={`${props.id}SprigBottom`} texture="ui.decor-sprig" style={sprigBottomLeft} />
    </column>
  );
}
