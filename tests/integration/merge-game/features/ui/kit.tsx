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
import { defineStyle, defineTokens, tr } from "../../kit";

/** What a control shows as its words: a message of the string table, or a plain number. */
export type Label = I18n.Message | string;

/** The palette of design §2 and the spacing every screen shares. */
export const theme = defineTokens({
  color: {
    ink: 0x3a_22_12,
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
const pointerStates = {
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
 * The sizes a plank comes in: the Play sign, a popup button, the Deliver of a card, and the wide
 * plank a long label needs ("Смотреть и пополнить").
 */
export type PlankSize = "large" | "medium" | "small" | "wide";

/** The nine-slice of every face. */
const plankFaces: Record<PlankLook, AssetKey> = {
  green: "ui.button-green",
  wood: "ui.button-wood",
  berry: "ui.button-berry"
};

/** Width and height of every size, in reference units. */
const plankBoxes: Record<PlankSize, { width: number; height: number }> = {
  large: { width: 520, height: 150 },
  medium: { width: 360, height: 120 },
  small: { width: 250, height: 96 },
  wide: { width: 680, height: 120 }
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
    gap: theme.space.xs,
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
    (["large", "medium", "small", "wide"] as const).map(size => [
      `${look}.${size}`,
      plankStyle(look, size)
    ])
  )
) as Record<`${PlankLook}.${PlankSize}`, ReturnType<typeof plankStyle>>;

/** The check a selected plank carries next to its words. */
const checkStyle = defineStyle({ width: 48, height: 48 });

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
  /** Large, medium or small. `"medium"` when left out. */
  size?: PlankSize;
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

  return (
    <button
      key={props.id}
      intent={props.intent}
      payload={props.payload ?? {}}
      state={{ disabled: props.disabled === true, selected }}
      style={plankStyles[`${props.look}.${props.size ?? "medium"}`]}
    >
      {selected ? (
        <icon key={`${props.id}Check`} name="ui.icon-check" style={checkStyle} />
      ) : undefined}
      <text key={`${props.id}Label`} style="ui.button" content={props.label} />
    </button>
  );
}

/** The round wood button: a disc with an ink rim, the same states as a plank. */
const roundStyle = defineStyle({
  width: 144,
  height: 144,
  radius: 72,
  fill: theme.color.wood,
  stroke: theme.color.ink,
  strokeWidth: 6,
  align: "center",
  justify: "center",
  is: { ...pointerStates, disabled: { alpha: 0.6 } }
});

/** The icon inside a round button. */
const roundIconStyle = defineStyle({ width: 88, height: 88 });

/** The red count in the corner of a round button. */
const badgeStyle = defineStyle({
  position: "absolute",
  top: -6,
  right: -6,
  width: 56,
  height: 56,
  radius: 28,
  fill: theme.color.berry,
  stroke: theme.color.ink,
  strokeWidth: 4,
  align: "center",
  justify: "center",
  reason: "the count sits on the rim of the button, over its corner"
});

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
};

/**
 * A round wood button (design §6 G): home, gear and the daily gift. An optional red badge shows a
 * count in its corner.
 *
 * @param props - The button as the screen declares it.
 * @returns The button element.
 */
export function RoundButton(props: RoundButtonProps) {
  return (
    <button key={props.id} intent={props.intent} style={roundStyle}>
      <icon key={`${props.id}Icon`} name={props.icon} style={roundIconStyle} />
      {props.badge === undefined ? undefined : (
        <stack key={`${props.id}Badge`} style={badgeStyle}>
          <text key={`${props.id}BadgeCount`} style="ui.badge" content={String(props.badge)} />
        </stack>
      )}
    </button>
  );
}

/**
 * The geometry of a HUD pill, in the pill's own units. The coin counter is a projection hosted by
 * the pill, so it is placed with the same numbers the pill is laid out with.
 */
export const pill = { height: 104, padLeft: 12, padRight: 28, icon: 84, gap: 12 } as const;

/** Where the number of a pill starts, in the pill's own units: after the icon, at mid height. */
export const pillNumberAt = { x: pill.padLeft + pill.icon + pill.gap, y: pill.height / 2 };

/** The icon at the left end of a pill. */
const pillIconStyle = defineStyle({ width: pill.icon, height: pill.icon });

/**
 * The style of a pill of one width.
 *
 * @param width - The width of the pill in reference units.
 * @returns The frozen style.
 */
function pillStyle(width: number) {
  return defineStyle({
    width,
    height: pill.height,
    direction: "row",
    align: "center",
    gap: pill.gap,
    padding: { left: pill.padLeft, right: pill.padRight },
    nineSlice: "ui.hud-pill"
  });
}

/** The two pills of the HUD: the coins take more room than the energy. */
const pillStyles = { wide: pillStyle(300), narrow: pillStyle(250) } as const;

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
 * A HUD pill (design §6 G): the wooden pill with an icon and a number. The coin pill hosts the
 * counter projection, so the number rolls where it is drawn.
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

/** The header plank that hangs over the top edge of a signboard. */
const headerStyle = defineStyle({
  position: "absolute",
  top: -44,
  left: 0,
  right: 0,
  height: 110,
  align: "center",
  justify: "center",
  nineSlice: "ui.header-plank",
  reason: "the header plank hangs over the top edge of the signboard"
});

/** What a signboard takes. */
export type SignboardProps = {
  /** The key of the board; its header is keyed `<id>Header`, its title `<id>Title`. */
  id: string;
  /** The words on the header plank; no plank when left out. */
  title?: Label;
  /** Width and height of the board in reference units. */
  width: number;
  /** Height of the board in reference units. */
  height: number;
  /**
   * A popup board (design §6 F1, F2): it hangs on two ropes (`<id>RopeLeft`, `<id>RopeRight`),
   * scales down into the safe area, swings in and out around its top edge, and recedes while
   * another popup covers it.
   */
  hung?: boolean;
  /** The intent of the X in the corner (`<id>Close`); no X when left out. */
  close?: string;
  /** The contents under the header. */
  children?: unknown;
};

/** The ink-darkened tint of a board another popup covers: 42 % of its colour (design §6 F2). */
const receded = 0x6b_6b_6b;

/** The pose a popup board hangs in before it swings in and after it swings out. */
const hanging = { Transform: { rotation: -0.12, scale: 0.8 } } as const;

/** The swing in (design §6 F1): from the tilted, small pose, with a small overshoot, and the recede. */
const swingIn = defineMotion({
  states: { hanging },
  transition: { ms: 420, ease: "outBack" },
  on: { enter: "hanging", change: ["Transform"] }
});

/** The swing out: the same pose, reached quickly, so the next screen is not kept waiting. */
const swingOut = defineMotion({
  states: { hanging },
  transition: { ms: 220, ease: "in" },
  on: { exit: "hanging" }
});

/** The motion of every popup board: it swings in, recedes under a cover, and swings out. */
export const swingMotion = { ...swingIn, ...swingOut };

/**
 * The style of one signboard. A hung board is fitted into its parent, turns around the middle of
 * its top edge, and shrinks, rises and darkens while it is covered.
 *
 * @param width - The width of the board in reference units.
 * @param height - The height of the board in reference units.
 * @param hung - Whether the board is a popup board.
 * @returns The frozen style.
 */
function boardStyle(width: number, height: number, hung: boolean) {
  const board = {
    width,
    height,
    direction: "column",
    align: "center",
    justify: "center",
    gap: theme.space.md,
    padding: { top: 100, right: 56, bottom: 56, left: 56 },
    nineSlice: "ui.panel-signboard"
  } as const;

  if (!hung) return defineStyle(board);

  return defineStyle({
    ...board,
    fit: "contain",
    origin: "top",
    is: { covered: { scale: 0.84, offsetY: -8, tint: receded } }
  });
}

/** What hides while a popup is covered: its ropes and its X (design §6 F2). */
const hiddenWhenCovered = { covered: { alpha: 0 } } as const;

/**
 * The style of one rope of a hung board, from far above it down behind its header plank.
 *
 * @param side - Which side the rope hangs on.
 * @param width - The width of the board.
 * @returns The frozen style.
 */
function hungRopeStyle(side: "left" | "right", width: number) {
  const inset = Math.round(width * 0.2);

  return defineStyle({
    ...(side === "left" ? { left: inset } : { right: inset }),
    position: "absolute",
    top: -300,
    width: 40,
    height: 330,
    is: hiddenWhenCovered,
    reason: "the ropes hang the popup from a pivot above the screen (design §6 F1)"
  });
}

/** The X in the corner of a board: a berry disc over the top-right corner. */
const closeStyle = defineStyle({
  position: "absolute",
  top: -40,
  right: -40,
  width: 112,
  height: 112,
  radius: 56,
  fill: theme.color.berry,
  stroke: theme.color.ink,
  strokeWidth: 6,
  align: "center",
  justify: "center",
  is: { ...pointerStates, ...hiddenWhenCovered },
  reason: "the X sits on the corner of the signboard"
});

/** The cross on the X. */
const closeIconStyle = defineStyle({ width: 64, height: 64, is: hiddenWhenCovered });

/**
 * A signboard (design §6 G): the painted wooden panel every popup and the logo are drawn on, with
 * an optional honey header plank. A panel swallows every tap, so nothing under it answers. A hung
 * board is a popup board: two ropes, the swing, the fit into the safe area and the recede.
 *
 * @param props - The board as the screen declares it.
 * @returns The panel element.
 */
export function Signboard(props: SignboardProps) {
  const hung = props.hung === true;

  return (
    <panel
      key={props.id}
      style={boardStyle(props.width, props.height, hung)}
      {...(hung ? { motion: swingMotion } : {})}
    >
      {hung ? (
        <image
          key={`${props.id}RopeLeft`}
          texture="ui.rope-vertical"
          style={hungRopeStyle("left", props.width)}
        />
      ) : undefined}
      {hung ? (
        <image
          key={`${props.id}RopeRight`}
          texture="ui.rope-vertical"
          style={hungRopeStyle("right", props.width)}
        />
      ) : undefined}
      {props.title === undefined ? undefined : (
        <stack key={`${props.id}Header`} style={headerStyle}>
          <text key={`${props.id}Title`} style="ui.title" content={props.title} />
        </stack>
      )}
      {props.close === undefined ? undefined : (
        <button key={`${props.id}Close`} intent={props.close} style={closeStyle}>
          <icon key={`${props.id}CloseIcon`} name="ui.icon-close" style={closeIconStyle} />
        </button>
      )}
      {props.children as never}
    </panel>
  );
}

/** What a parchment insert takes. */
export type ParchmentProps = {
  /** The key of the insert. */
  id: string;
  /** The contents on the paper. */
  children?: unknown;
};

/** The paper inside a signboard: body text and panes sit on it. */
const parchmentStyle = defineStyle({
  direction: "column",
  align: "center",
  justify: "center",
  gap: theme.space.sm,
  padding: 40,
  alignSelf: "stretch",
  grow: 1,
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
    <column key={props.id} style={parchmentStyle}>
      {props.children as never}
    </column>
  );
}

/** One rope of the logo sign, from above the sign down to its top edge. */
const ropeStyle = defineStyle({
  position: "absolute",
  top: -150,
  width: 40,
  height: 170,
  reason: "the ropes hang the sign from a point above it"
});

/** The berry sprig on the top-left corner of the logo sign. */
const sprigLeftStyle = defineStyle({
  position: "absolute",
  left: -40,
  top: -40,
  width: 130,
  height: 140,
  reason: "the sprig is pinned over the corner of the sign"
});

/** The berry sprig on the bottom-right corner of the logo sign. */
const sprigRightStyle = defineStyle({
  position: "absolute",
  right: -40,
  bottom: -40,
  width: 130,
  height: 140,
  reason: "the sprig is pinned over the corner of the sign"
});

/** The name of the game, in the language of the player. */
const gameName = tr("ui.gameName");

/** The sign the name of the game is painted on. */
const logoStyle = defineStyle({
  width: 860,
  height: 280,
  align: "center",
  justify: "center",
  nineSlice: "ui.panel-signboard"
});

/**
 * The logo sign of Splash and Home (design §6 A1, A2): the name of the game painted on a
 * signboard that hangs on two ropes, with a berry sprig on two corners.
 *
 * @param props - The key of the sign.
 * @param props.id - The key; the name is keyed `<id>Name`.
 * @returns The panel element.
 */
export function LogoSign(props: { id: string }) {
  return (
    <panel key={props.id} style={logoStyle}>
      <image
        key={`${props.id}RopeLeft`}
        texture="ui.rope-vertical"
        style={{ ...ropeStyle, left: 150 }}
      />
      <image
        key={`${props.id}RopeRight`}
        texture="ui.rope-vertical"
        style={{ ...ropeStyle, right: 150 }}
      />
      <text key={`${props.id}Name`} style="ui.title" content={gameName} />
      <image key={`${props.id}SprigLeft`} texture="ui.decor-sprig" style={sprigLeftStyle} />
      <image key={`${props.id}SprigRight`} texture="ui.decor-sprig" style={sprigRightStyle} />
    </panel>
  );
}
