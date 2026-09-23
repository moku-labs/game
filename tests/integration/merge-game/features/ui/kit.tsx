/**
 * @file The controls every screen of Timber Town is built from (design §6 G): the plank button,
 * the round wood button, the HUD pill, the signboard with its header plank, the parchment insert
 * and the logo sign. One state rule set drives every control (design §4): it lifts under the
 * mouse, sinks when pressed, turns into the grey plank when disabled and green with a check when
 * selected.
 *
 * A control is a plain function of its props. The JSX runtime calls it, so a control carries no
 * local state and no outcomes of its own: the button inside names the intent. The `id` prop keys
 * the control and every keyed element inside it, so a test and a hint find them by name.
 */
import type { I18n, Model } from "@moku-labs/game";
import { defineMotion } from "@moku-labs/game";
import type { AssetKey } from "../../generated/assets";
import { defineStyle, defineTokens } from "../../kit";

/** What a control shows as its words: a message of the string table, or a plain number. */
export type Label = I18n.Message | string;

/** The palette of design §2 and the spacing every screen shares. */
export const theme = defineTokens({
  color: {
    ink: 0x3a_22_12,
    cream: 0xff_f3_d6,
    parchment: 0xfb_ee_d2,
    wood: 0xd8_a0_62,
    woodDark: 0x9c_60_31,
    walnut: 0x6e_41_21,
    honey: 0xf2_b4_3d,
    honeyGlow: 0xff_e3_9a,
    berry: 0xc9_3b_4d,
    rope: 0x8a_5a_2e
  },
  space: { xs: 8, sm: 16, md: 24, lg: 40 }
});

/**
 * The one state rule set of every control (design §4): it lifts a little under the mouse and
 * sinks onto its lip when pressed. Touch never hovers, so a phone only ever sees the sink.
 */
export const pointerStates = {
  hover: { offsetY: -4, scale: 1.03 },
  pressed: { offsetY: 6, scale: 0.97 }
} as const;

/** The padding of a screen root: only the background goes into the notch and the home bar. */
export const safeEdges = {
  top: "safeArea.top",
  right: "safeArea.right",
  bottom: "safeArea.bottom",
  left: "safeArea.left"
} as const;

/** A screen root: the whole viewport, its content kept inside the safe area. */
export const safeScreen = defineStyle({
  width: "100%",
  height: "100%",
  direction: "column",
  align: "center",
  padding: safeEdges
});

/** A full-bleed background: the whole screen, behind the status bar and the home indicator. */
export const fullBleed = defineStyle({
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  reason: "the background covers the whole screen, the safe area included (design §5.1)"
});

/** The three faces of a plank button: green is go, wood is neutral, berry is danger. */
export type PlankLook = "green" | "wood" | "berry";

/**
 * The sizes a plank comes in. `large`, `medium`, `small` and `wide` have a fixed box: the Play
 * sign, a small popup button, the Deliver of a card, a long label. `popup` is the plank of a
 * popup (Claim, Later), `full` spans the width of the column that holds it (a language plank),
 * `half` shares a row with another plank at the same width (Reset and Cancel), `tall` spans the
 * column with room for two lines (Watch & refill).
 */
export type PlankSize = "large" | "medium" | "small" | "wide" | "popup" | "full" | "half" | "tall";

/** Every size, in the order the plank styles are built. */
const plankSizes: readonly PlankSize[] = [
  "large",
  "medium",
  "small",
  "wide",
  "popup",
  "full",
  "half",
  "tall"
];

/** The nine-slice of every face. */
const plankFaces: Record<PlankLook, AssetKey> = {
  green: "ui.button-green",
  wood: "ui.button-wood",
  berry: "ui.button-berry"
};

/**
 * The box of every size, in reference units. A size without a width stretches across its column;
 * a `half` plank starts at no width and grows, so two of them in a row share it equally.
 */
const plankBoxes: Record<
  PlankSize,
  { width?: number; height: number; alignSelf?: "stretch"; grow?: number }
> = {
  large: { width: 520, height: 150 },
  medium: { width: 360, height: 120 },
  small: { width: 250, height: 96 },
  wide: { width: 680, height: 120 },
  popup: { width: 554, height: 150 },
  full: { alignSelf: "stretch", height: 150 },
  half: { width: 0, grow: 1, height: 140 },
  tall: { alignSelf: "stretch", height: 200 }
};

/**
 * The words of a plank: the small label on the Deliver of a card, the button voice on a medium
 * plank, the bigger label on the others.
 */
const plankLabels: Record<PlankSize, "ui.button-small" | "ui.button" | "ui.plank"> = {
  large: "ui.plank",
  medium: "ui.button",
  small: "ui.button-small",
  wide: "ui.plank",
  popup: "ui.plank",
  full: "ui.plank",
  half: "ui.plank",
  tall: "ui.plank"
};

/**
 * The style of one plank: its face, its size and the shared states. Disabled swaps in the grey
 * plank; selected swaps in the green one, which is how the current language reads as chosen.
 *
 * @param look - The face of the plank.
 * @param size - The size of the plank.
 * @returns The frozen style.
 */
function plankStyle(look: PlankLook, size: PlankSize) {
  return defineStyle({
    ...plankBoxes[size],
    direction: "row",
    align: "center",
    justify: "center",
    gap: theme.space.md,
    // The rounded ends of the art stay clear of the words; the small plank has room for less.
    padding: size === "small" ? { left: 16, right: 16 } : { left: 40, right: 40 },
    nineSlice: plankFaces[look],
    is: {
      ...pointerStates,
      selected: { nineSlice: "ui.button-green" },
      disabled: { nineSlice: "ui.button-disabled" }
    }
  });
}

/** Every plank style, built once: a view never makes a new style object per frame. */
const plankStyles = Object.fromEntries(
  (["green", "wood", "berry"] as const).flatMap(look =>
    plankSizes.map(size => [`${look}.${size}`, plankStyle(look, size)])
  )
) as Record<`${PlankLook}.${PlankSize}`, ReturnType<typeof plankStyle>>;

/** The check a selected plank carries next to its words. */
const checkStyle = defineStyle({ width: 64, height: 64 });

/** The play glyph of Watch & refill: a cream ring at the left end of the plank. */
const playRingStyle = defineStyle({
  width: 72,
  height: 72,
  radius: 36,
  fill: 0xff_f3_d6,
  stroke: theme.color.ink,
  strokeWidth: 6,
  align: "center",
  justify: "center"
});

/**
 * The play mark in the ring (design §6 E4): a moss triangle with an ink edge, pointing right. It
 * moves right by a sixth of its width, so its centre of mass, not its box, sits in the middle of
 * the ring.
 */
const playMarkStyle = defineStyle({
  width: 30,
  height: 34,
  shape: "triangle",
  fill: 0x55_7f_2d,
  stroke: theme.color.ink,
  strokeWidth: 4,
  offsetX: 5
});

/** What a plank button takes. */
export type PlankButtonProps = {
  /** The key of the button; its words are keyed `<id>Label`. */
  id: string;
  /** The intent the button answers the gate with. */
  intent: string;
  /** What travels with the intent. */
  payload?: Model.Json;
  /** The words on the plank. */
  label: Label;
  /** Green, wood or berry. */
  look: PlankLook;
  /** The size of the plank. `"medium"` when left out. */
  size?: PlankSize;
  /** A glyph in front of the words: `"play"` for a plank that plays a video. */
  glyph?: "play";
  /** A disabled plank is grey, swallows the tap and answers nothing. */
  disabled?: boolean;
  /** A selected plank is green with a check. */
  selected?: boolean;
};

/**
 * A plank button (design §6 G): the painted plank that sits on its lip, with its words in the
 * button voice. Disabled is the grey plank; the tap is swallowed and the gate hears nothing.
 *
 * @param props - The plank as the screen declares it.
 * @returns The button element.
 */
export function PlankButton(props: PlankButtonProps) {
  const selected = props.selected === true;
  const size = props.size ?? "medium";

  return (
    <button
      key={props.id}
      intent={props.intent}
      payload={props.payload ?? {}}
      state={{ disabled: props.disabled === true, selected }}
      style={plankStyles[`${props.look}.${size}`]}
    >
      {selected ? (
        <icon key={`${props.id}Check`} name="ui.icon-check" style={checkStyle} />
      ) : undefined}
      {props.glyph === "play" ? (
        <stack key={`${props.id}Play`} style={playRingStyle}>
          <stack key={`${props.id}PlayMark`} style={playMarkStyle} />
        </stack>
      ) : undefined}
      <text key={`${props.id}Label`} style={plankLabels[size]} content={props.label} />
    </button>
  );
}

/** The size of a round button of the HUD (design §6 B1, F4). */
const ROUND_SIZE = 120;

/**
 * The styles of a round wood button of one size: the disc with its ink rim and the same states
 * as a plank, the icon on it, and the red count on its rim.
 *
 * @param size - The diameter in reference units.
 * @returns The three frozen styles.
 */
function roundStylesOf(size: number) {
  const badge = Math.max(52, Math.round(size * 0.34));

  return {
    disc: defineStyle({
      width: size,
      height: size,
      radius: size / 2,
      fill: theme.color.wood,
      stroke: theme.color.ink,
      strokeWidth: 6,
      align: "center",
      justify: "center",
      is: { ...pointerStates, disabled: { alpha: 0.6 } }
    }),
    icon: defineStyle({ width: Math.round(size * 0.66), height: Math.round(size * 0.66) }),
    badge: defineStyle({
      position: "absolute",
      top: -6,
      right: -6,
      width: badge,
      height: badge,
      radius: badge / 2,
      fill: theme.color.berry,
      stroke: theme.color.ink,
      strokeWidth: 4,
      align: "center",
      justify: "center",
      reason: "the count sits on the rim of the button, over its corner"
    })
  };
}

/** The styles of every round size a screen asked for, built once per size. */
const roundStyles = new Map<number, ReturnType<typeof roundStylesOf>>();

/**
 * The styles of a round button of one size, built the first time the size is asked for.
 *
 * @param size - The diameter in reference units.
 * @returns The styles of that size.
 */
function roundOf(size: number): ReturnType<typeof roundStylesOf> {
  const known = roundStyles.get(size);

  if (known !== undefined) return known;

  const built = roundStylesOf(size);

  roundStyles.set(size, built);

  return built;
}

/** What a round button takes. */
export type RoundButtonProps = {
  /** The key of the button; its icon is keyed `<id>Icon`, its badge `<id>Badge`. */
  id: string;
  /** The intent the button answers the gate with. */
  intent: string;
  /** The icon on the disc. */
  icon: AssetKey;
  /** A count in the red badge; no badge when left out or `undefined`. */
  badge?: number | undefined;
  /** The diameter in reference units: 120, the HUD size, when left out. */
  size?: number;
};

/**
 * A round wood button (design §6 G): home, gear and the daily gift. An optional red badge shows a
 * count in its corner.
 *
 * @param props - The button as the screen declares it.
 * @returns The button element.
 */
export function RoundButton(props: RoundButtonProps) {
  const styles = roundOf(props.size ?? ROUND_SIZE);

  return (
    <button key={props.id} intent={props.intent} style={styles.disc}>
      <icon key={`${props.id}Icon`} name={props.icon} style={styles.icon} />
      {props.badge === undefined ? undefined : (
        <stack key={`${props.id}Badge`} style={styles.badge}>
          <text key={`${props.id}BadgeCount`} style="ui.badge" content={String(props.badge)} />
        </stack>
      )}
    </button>
  );
}

/**
 * The geometry of a HUD pill, in the pill's own units (design §6 B1, F4). The pill is the bar at
 * the height ratio of its art (300×63), so the corners of the nine-slice are never stretched; the
 * icon is bigger than the bar and hangs over its left end. The coin counter is a projection
 * hosted by the pill, so it is placed with the same numbers the pill is laid out with.
 */
export const pill = {
  height: 76,
  icon: 110,
  overhang: 36,
  padLeft: 84,
  padRight: 24,
  widths: { wide: 290, narrow: 280 }
} as const;

/**
 * Where the number of the coin pill sits, in the pill's own units: the middle of the bar right of
 * the icon.
 */
export const pillNumberAt = {
  x: (pill.padLeft + pill.widths.wide - pill.padRight) / 2,
  y: pill.height / 2
};

/** The icon at the left end of a pill, over the end of the bar. */
const pillIconStyle = defineStyle({
  position: "absolute",
  left: -pill.overhang,
  top: (pill.height - pill.icon) / 2,
  width: pill.icon,
  height: pill.icon,
  reason: "the icon of a HUD pill is bigger than the bar and hangs over its left end (design §6 B1)"
});

/**
 * The style of a pill of one width.
 *
 * @param width - The width of the bar in reference units.
 * @returns The frozen style.
 */
function pillStyle(width: number) {
  return defineStyle({
    width,
    height: pill.height,
    direction: "row",
    align: "center",
    justify: "center",
    margin: { left: pill.overhang },
    padding: { left: pill.padLeft, right: pill.padRight },
    nineSlice: "ui.hud-pill"
  });
}

/** The two pills of the HUD: the coins take a little more room than the energy. */
const pillStyles = {
  wide: pillStyle(pill.widths.wide),
  narrow: pillStyle(pill.widths.narrow)
} as const;

/** What a HUD pill takes. */
export type HudPillProps = {
  /** The key of the pill; its icon is keyed `<id>Icon`, its words `<id>Text`. */
  id: string;
  /** The icon at the left end. */
  icon: AssetKey;
  /** The words after the icon. Left out when a hosted projection draws the number instead. */
  text?: Label;
  /** The projections the pill hosts, drawn in its own units. */
  hosts?: readonly string[];
  /** `"wide"` for the coins, `"narrow"` for the energy. */
  width: keyof typeof pillStyles;
};

/**
 * A HUD pill (design §6 G): the wooden bar with a big icon over its left end and a number in its
 * middle. The coin pill hosts the counter projection, so the number rolls where it is drawn.
 *
 * @param props - The pill as the screen declares it.
 * @returns The row element.
 */
export function HudPill(props: HudPillProps) {
  return (
    <row key={props.id} hosts={props.hosts ?? []} style={pillStyles[props.width]}>
      <icon key={`${props.id}Icon`} name={props.icon} style={pillIconStyle} />
      {props.text === undefined ? undefined : (
        <text key={`${props.id}Text`} style="ui.number" content={props.text} />
      )}
    </row>
  );
}

/** How tall the honey title plaque is; half of it rises above the board (design §6 G). */
const PLAQUE_HEIGHT = 150;

/**
 * The honey title plaque: a separate plank as wide as its title plus the padding, centred on the
 * top edge of the board with half of it above and tilted by 1.5 degrees. The same in every popup,
 * so titles are uniform.
 */
const plaqueStyle = defineStyle({
  position: "absolute",
  top: -PLAQUE_HEIGHT / 2,
  height: PLAQUE_HEIGHT,
  minWidth: 420,
  padding: { left: 80, right: 80 },
  direction: "row",
  align: "center",
  justify: "center",
  nineSlice: "ui.header-plank",
  // Hung a little crooked, 1.5 degrees to the left, as the design draws it.
  rotation: -0.026,
  reason: "the title plaque sits on the top edge of the signboard, half above it (design §6 G)"
});

/** What a signboard takes. */
export type SignboardProps = {
  /** The key of the board; its plaque is keyed `<id>Header`, its title `<id>Title`. */
  id: string;
  /** The words on the title plaque; no plaque when left out. */
  title?: Label;
  /** Width of the board in reference units. */
  width: number;
  /** Height of the board in reference units. */
  height: number;
  /** The padding above the contents; 110, room for the lower half of the plaque, when left out. */
  top?: number;
  /**
   * A popup board (design §6 F1, F2): it hangs on two ropes (`<id>RopeLeft`, `<id>RopeRight`),
   * scales down into the safe area, swings in and out on the ropes, and recedes while another
   * popup covers it.
   */
  hung?: boolean;
  /** The intent of the X in the corner (`<id>Close`); no X when left out. */
  close?: string;
  /** The contents under the plaque. */
  children?: unknown;
};

/** The ink-darkened tint of a board another popup covers: 42 % of its colour (design §6 F2). */
const receded = 0x6b_6b_6b;

/** How small a covered board gets (design §6 F2). */
const RECEDE_SCALE = 0.84;

/** How far up a covered board moves, besides the shrink (design §6 F2). */
const RECEDE_RISE = 8;

/** Degrees to radians, for the keys of the swing, which the design gives in degrees. */
const degree = Math.PI / 180;

/**
 * The swing in (design §6 F1): the board drops from above the screen on its ropes, overshoots
 * with a turn, and wobbles to rest around the rope point above it.
 */
const swingIn = defineMotion({
  keyframes: {
    swingIn: [
      { at: 0, Transform: { dy: -780, rotation: -2 * degree, scale: 0.8 } },
      { at: 0.42, ease: "out", Transform: { dy: 14, rotation: 5 * degree, scale: 1.04 } },
      { at: 0.58, Transform: { dy: -5, rotation: -3.2 * degree, scale: 0.99 } },
      { at: 0.72, Transform: { dy: 2, rotation: 1.8 * degree, scale: 1.01 } },
      { at: 0.86, Transform: { dy: 0, rotation: -0.7 * degree, scale: 1 } }
    ]
  },
  transition: { ms: 1000 },
  on: { enter: "swingIn" }
});

/** The swing out: a small dip, then up and out of the screen, quickly. */
const swingOut = defineMotion({
  keyframes: {
    swingOut: [
      { at: 0.25, Transform: { dy: 10, rotation: -2 * degree } },
      { at: 1, ease: "in", Transform: { dy: -840, rotation: 3 * degree, scale: 0.9 } }
    ]
  },
  transition: { ms: 420 },
  on: { exit: "swingOut" }
});

/** The recede under a cover and the rise back: the rest pose moves, the board follows it. */
const recede = defineMotion({
  transition: { ms: 320, ease: "out" },
  on: { change: ["Transform"] }
});

/** The motion of every popup board: it swings in, recedes under a cover, and swings out. */
export const swingMotion = { ...recede, ...swingIn, ...swingOut };

/**
 * The style of one signboard. A hung board is fitted into its parent and turns around the rope
 * point half its height above its top edge. Covered, it shrinks, rises a little and darkens; the
 * shrink around the rope point would lift it by the part of its height it loses, so the offset
 * gives that back and the board shrinks around its middle, as the design shows.
 *
 * @param width - The width of the board in reference units.
 * @param height - The height of the board in reference units.
 * @param top - The padding above the contents.
 * @param hung - Whether the board is a popup board.
 * @returns The frozen style.
 */
function boardStyle(width: number, height: number, top: number, hung: boolean) {
  const board = {
    width,
    height,
    direction: "column",
    align: "center",
    justify: "center",
    gap: theme.space.md,
    padding: { top, right: 72, bottom: 64, left: 72 },
    nineSlice: "ui.panel-signboard"
  } as const;

  if (!hung) return defineStyle(board);

  return defineStyle({
    ...board,
    fit: "contain",
    origin: { x: 0.5, y: -0.5 },
    is: {
      covered: {
        scale: RECEDE_SCALE,
        offsetY: Math.round((1 - RECEDE_SCALE) * height) - RECEDE_RISE,
        tint: receded
      }
    }
  });
}

/** Every board style a popup asked for, built once per size. */
const boardStyles = new Map<string, ReturnType<typeof boardStyle>>();

/**
 * The style of a board of one size, built the first time it is asked for.
 *
 * @param width - The width of the board.
 * @param height - The height of the board.
 * @param top - The padding above the contents.
 * @param hung - Whether the board is a popup board.
 * @returns The style of that board.
 */
function boardOf(width: number, height: number, top: number, hung: boolean) {
  const key = `${width}x${height}+${top}${hung ? "h" : ""}`;
  const known = boardStyles.get(key);

  if (known !== undefined) return known;

  const built = boardStyle(width, height, top, hung);

  boardStyles.set(key, built);

  return built;
}

/** What hides while a popup is covered: its ropes and its X (design §6 F2). */
const hiddenWhenCovered = { covered: { alpha: 0 } } as const;

/** How wide a rope is drawn, and how long one segment of it is: its art at one uniform scale. */
const rope = { width: 12, segment: 614, segments: 3 } as const;

/** One segment of a rope: the rope art at a uniform scale, hidden while the popup is covered. */
const ropeSegmentStyle = defineStyle({
  width: rope.width,
  height: rope.segment,
  is: hiddenWhenCovered
});

/**
 * The style of one rope of a hung board: a column of segments from far above the screen down to
 * the top edge of the board, 18 % in from its side (design §6 F1).
 *
 * @param side - Which side the rope hangs on.
 * @param width - The width of the board.
 * @returns The frozen style.
 */
function hungRopeStyle(side: "left" | "right", width: number) {
  const inset = Math.round(width * 0.18 - rope.width / 2);

  return defineStyle({
    ...(side === "left" ? { left: inset } : { right: inset }),
    position: "absolute",
    top: -rope.segment * rope.segments,
    width: rope.width,
    height: rope.segment * rope.segments,
    direction: "column",
    is: hiddenWhenCovered,
    reason: "the ropes hang the popup from above the screen (design §6 F1)"
  });
}

/** Both ropes of every board width a popup asked for, built once per width. */
const ropeStyles = new Map<
  number,
  { left: ReturnType<typeof hungRopeStyle>; right: ReturnType<typeof hungRopeStyle> }
>();

/**
 * The two rope styles of a board of one width, built the first time the width is asked for.
 *
 * @param width - The width of the board.
 * @returns The left and the right rope.
 */
function ropesOf(width: number) {
  const known = ropeStyles.get(width);

  if (known !== undefined) return known;

  const built = { left: hungRopeStyle("left", width), right: hungRopeStyle("right", width) };

  ropeStyles.set(width, built);

  return built;
}

/** Every segment index of a rope. */
const ropeSegments = Array.from({ length: rope.segments }, (_unused, index) => index);

/**
 * One rope of a hung board: its segments, one under the other.
 *
 * @param props - The rope.
 * @param props.id - The key of the rope; its segments are keyed `<id>0`, `<id>1`, ….
 * @param props.style - The style of the rope column.
 * @returns The column element.
 */
function Rope(props: { id: string; style: ReturnType<typeof hungRopeStyle> }) {
  return (
    <column key={props.id} style={props.style}>
      {ropeSegments.map(index => (
        <image
          key={`${props.id}${index}`}
          texture="ui.rope-vertical"
          fit="fill"
          style={ropeSegmentStyle}
        />
      ))}
    </column>
  );
}

/** The X in the corner of a board: a berry disc over the top-right corner. */
const closeStyle = defineStyle({
  position: "absolute",
  top: -36,
  right: -28,
  width: 128,
  height: 128,
  radius: 64,
  fill: theme.color.berry,
  stroke: theme.color.ink,
  strokeWidth: 6,
  align: "center",
  justify: "center",
  is: { ...pointerStates, ...hiddenWhenCovered },
  reason: "the X sits on the corner of the signboard"
});

/** The cross on the X. */
const closeIconStyle = defineStyle({ width: 72, height: 72, is: hiddenWhenCovered });

/** The padding above the contents of a board: room for the lower half of the plaque. */
const BOARD_TOP = 110;

/**
 * A signboard (design §6 G): the painted wooden panel every popup is drawn on, with an optional
 * honey title plaque over its top edge. A panel swallows every tap, so nothing under it answers.
 * A hung board is a popup board: two ropes, the swing, the fit into the safe area and the recede.
 * The contents draw before the plaque and the X, so the rays of a prize pass under the plaque.
 *
 * @param props - The board as the screen declares it.
 * @returns The panel element.
 */
export function Signboard(props: SignboardProps) {
  const hung = props.hung === true;
  const ropes = hung ? ropesOf(props.width) : undefined;

  return (
    <panel
      key={props.id}
      style={boardOf(props.width, props.height, props.top ?? BOARD_TOP, hung)}
      {...(hung ? { motion: swingMotion } : {})}
    >
      {ropes === undefined ? undefined : <Rope id={`${props.id}RopeLeft`} style={ropes.left} />}
      {ropes === undefined ? undefined : <Rope id={`${props.id}RopeRight`} style={ropes.right} />}
      {props.children as never}
      {props.title === undefined ? undefined : (
        <row key={`${props.id}Header`} style={plaqueStyle}>
          <text key={`${props.id}Title`} style="ui.title" content={props.title} />
        </row>
      )}
      {props.close === undefined ? undefined : (
        <button key={`${props.id}Close`} intent={props.close} style={closeStyle}>
          <icon key={`${props.id}CloseIcon`} name="ui.icon-close" style={closeIconStyle} />
        </button>
      )}
    </panel>
  );
}

/** What a parchment insert takes. */
export type ParchmentProps = {
  /** The key of the insert. */
  id: string;
  /**
   * A chip is the small paper a popup body is written on (design §6 E3, E4): as tall as its
   * words. Without it the insert fills what the board leaves, as the settings pane does.
   */
  chip?: boolean;
  /** The contents on the paper. */
  children?: unknown;
};

/** The paper inside a signboard: body text and panes sit on it. */
const parchmentStyle = defineStyle({
  direction: "column",
  align: "center",
  justify: "center",
  gap: theme.space.lg,
  padding: 48,
  alignSelf: "stretch",
  grow: 1,
  nineSlice: "ui.panel-parchment"
});

/** The parchment chip of a popup body: the width of the board, as tall as its words. */
const chipStyle = defineStyle({
  direction: "column",
  align: "center",
  justify: "center",
  padding: { top: 40, right: 40, bottom: 40, left: 40 },
  minHeight: 200,
  alignSelf: "stretch",
  nineSlice: "ui.panel-parchment"
});

/**
 * A parchment insert (design §6 G): the paper a popup body or a settings pane is written on.
 *
 * @param props - The insert as the screen declares it.
 * @returns The column element.
 */
export function Parchment(props: ParchmentProps) {
  return (
    <column key={props.id} style={props.chip === true ? chipStyle : parchmentStyle}>
      {props.children as never}
    </column>
  );
}
