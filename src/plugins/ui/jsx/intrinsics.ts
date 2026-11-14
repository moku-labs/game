/* eslint-disable unicorn/prevent-abbreviations -- "props" is the JSX word for the attributes of a tag; another name would hide the contract. */
/**
 * @file ui/jsx — the intrinsic tags and their props. Every prop is a named alias, so a mismatch
 * prints the alias instead of the bare value type. Types only: nothing here runs.
 */
import type { Message } from "../../i18n/types";
import type { Json } from "../../model/types";
import type { TextBind } from "../../text/types";
import type { AnchorTarget } from "../../world/projection/types";
import type { AnyComponentValue } from "../../world/types";
import type { Style, TextTagStyle } from "../styles/types";
import type {
  CommonProps as CommonProperties,
  DescriptionNode,
  ElementMotion,
  JsxChild
} from "./types";

export type { TextBind } from "../../text/types";

/**
 * The optional brand that makes a wrong value print the name of the prop it was written on.
 *
 * @example
 * ```ts
 * type Named = string & Brand<"ButtonIntent">;
 * ```
 */
export type Brand<Name extends string> = { readonly _ui?: Name };

/** The intent a button answers the gate with. */
export type ButtonIntent = string & Brand<"ButtonIntent">;
/** The payload that travels with a button's intent. */
export type ButtonPayload = Json & Brand<"ButtonPayload">;
/** The patch a button writes into the local state of its nearest component. */
export type ButtonLocal = Record<string, unknown> & Brand<"ButtonLocal">;
/** Makes a button the control the Escape key taps while its root is the top one. */
export type ButtonEscape = boolean & Brand<"ButtonEscape">;
/** Asks a button that answers an intent to add the press point to its payload. */
export type ButtonPoint = boolean & Brand<"ButtonPoint">;
/** What a text draws: a plain string, or a message of the game's string table. */
export type TextContent = (string | Message) & Brand<"TextContent">;
/**
 * The text style key, or a layout style that may name the key in its base and its `when`
 * variants; one that names none draws in the built-in `body`.
 */
export type TextStyleProp = (string | TextTagStyle) & Brand<"TextStyleProp">;
/** The asset key of an image. */
export type ImageTexture = string & Brand<"ImageTexture">;
/** The asset key of an icon. */
export type IconName = string & Brand<"IconName">;
/** How an image or an icon fills its rect: inside it, over it (cropped), or stretched. */
export type ImageFit = ("contain" | "cover" | "fill") & Brand<"ImageFit">;
/**
 * The axis a scroll container moves on: `"y"`, the default, or `"x"`. Fixed when the scroll
 * spawns: another axis on a later render keeps the first one, with one warning
 * `ui:scroll-axis-fixed`. A windowed scroll moves on `"y"` only: `"x"` with `rows` throws.
 *
 * @example
 * ```tsx
 * // The order strip of the board moves sideways; the cards in it lay out in a row.
 * <scroll key="strip" axis="x" style={{ width: 306, height: 120 }}>
 *   <row key="track" style={{ width: 696, height: 120 }} />
 * </scroll>;
 * // ScrollState of the strip: { offset: 0, max: 390, moving: false }
 * ```
 */
export type ScrollAxis = ("x" | "y") & Brand<"ScrollAxis">;

/**
 * The stops a scroll comes to rest on, as offsets from the start, kept inside 0 to `max`. A
 * release glides to the stop nearest to where its velocity carries in 260 ms, on the curve
 * `1 − (1 − p)³`, in `min(620, 260 + distance × 1.1)` ms; without `snap` it flings.
 *
 * @example
 * ```tsx
 * // Three stops: the events, the orders, the end. A slow release at offset 300 glides to 318.
 * <scroll key="strip" axis="x" snap={[0, 318, 390]} style={{ width: 306, height: 120 }}>
 *   <row key="track" style={{ width: 696, height: 120 }} />
 * </scroll>;
 * ```
 */
export type ScrollSnap = readonly number[] & Brand<"ScrollSnap">;

/**
 * How far a scroll stands from its start, in reference units, kept inside 0 to `max`; 0 when
 * left out. The first frame draws it there. A later render with another value glides there on
 * the curve `1 − (1 − p)³`, in `min(620, 260 + distance × 1.1)` ms or in `glideMs`. The same value
 * with the same `aim` changes nothing, so a scroll the finger moved stays where it was left; a new
 * `aim` glides it back to the value.
 *
 * @example
 * ```tsx
 * // The strip opens on the orders; closing the pinned column moves the game to 306.
 * <scroll key="strip" axis="x" offset={318} snap={[0, 318, 390]} style={{ width: 306, height: 120 }}>
 *   <row key="track" style={{ width: 696, height: 120 }} />
 * </scroll>;
 * // first drawn frame: the content stands 318 u left of its rest, the orders in view
 * ```
 */
export type ScrollOffset = number & Brand<"ScrollOffset">;

/**
 * Whether a new `offset` prop or a new `aim` of this render stands at the prop at once instead of
 * gliding: in the same solve as the content's new rects, so content that moved inside the track
 * and an offset that moves by as much keep what the player sees in place. A running fling or glide
 * stops and `ScrollState` says `moving: false`. A glide to the prop that runs ends at its target in
 * the render that turns `jump` on, with the same `offset`. A scroll the finger holds only remembers
 * the prop; left out or false, a new prop glides. A `snap` release always glides.
 *
 * @example
 * ```tsx
 * // The order strip opens on 0. A first tile of 82 u comes in at the start of the track: the
 * // track and the offset shift 82 in one render, and the cards stay where they were drawn.
 * <scroll key="strip" axis="x" offset={82} jump style={{ width: 306, height: 120 }}>
 *   <row key="track" style={{ width: 778, height: 120 }} />
 * </scroll>;
 * // the frame of that render: ScrollState { offset: 82, max: 472, moving: false }
 *
 * // The strip glides 0 to 390 in 620 ms; 150 ms in, the player skips: the same offset with jump.
 * <scroll key="strip" axis="x" offset={390} jump style={{ width: 306, height: 120 }}>
 *   <row key="track" style={{ width: 696, height: 120 }} />
 * </scroll>;
 * // the frame of that render: ScrollState { offset: 390, max: 390, moving: false }
 * ```
 */
export type ScrollJump = boolean & Brand<"ScrollJump">;

/**
 * How long every glide to the `offset` prop lasts, in ms, on the curve `1 − (1 − p)³`: a new
 * `offset`, a new `aim`, and a glide to the prop that a new range re-aims, which starts again from
 * where the scroll stands. 0 stands at the prop at once, as `jump`. Left out, not a number, `NaN`,
 * `Infinity` or below 0: `min(620, 260 + distance × 1.1)`. A `snap` glide after a release keeps
 * that default. A new value alone leaves a running glide as it is; it applies from the next glide
 * to the prop.
 *
 * @example
 * ```tsx
 * // The strip stands on 318; the game moves it to the next order in exactly 150 ms.
 * <scroll key="strip" axis="x" offset={390} glideMs={150} style={{ width: 306, height: 120 }}>
 *   <row key="track" style={{ width: 696, height: 120 }} />
 * </scroll>;
 * // 75 ms in: ScrollState { offset: 381, max: 390, moving: true }
 * // 150 ms in: ScrollState { offset: 390, max: 390, moving: false }
 * ```
 */
export type ScrollGlideMs = number & Brand<"ScrollGlideMs">;

/**
 * What the `offset` prop aims at, a string or a finite number: a new value follows the prop again
 * from where the scroll stands, even when the offset is the same. A scroll the finger moved glides
 * back to its offset; a running glide, fling or snap glide starts again toward it, in `glideMs`;
 * with `jump` it stands there at once. Compared with `Object.is`; any other value (`NaN`,
 * `Infinity`, an object, a boolean) counts as left out, and leaving it out after a value is a
 * change too. The same value on a re-render does nothing. A scroll the finger holds only remembers
 * it: the release glides to a stop or flings, as without it.
 *
 * @example
 * ```tsx
 * // The player dragged the strip to 390. The game skips to the next order, which is also at 0.
 * <scroll key="strip" axis="x" offset={0} aim="order-7" style={{ width: 306, height: 120 }}>
 *   <row key="track" style={{ width: 696, height: 120 }} />
 * </scroll>;
 * // the render before said aim="order-6": the strip glides 390 → 0 and stands on 0
 * ```
 */
export type ScrollAim = (string | number) & Brand<"ScrollAim">;

/**
 * Keeps the finger from moving the scroll while it is `true` (F177); any other value leaves it
 * unlocked. A drag on it or on a view inside it moves nothing, its release neither flings nor
 * snaps, and a finger that lands while it glides or flings does not stop it. The views inside keep
 * their taps: a press that drifts past the tap slop answers none. A finger that holds the scroll
 * when the lock comes is let go with no velocity: with `snap` it glides to the stop nearest to
 * where it stands, and the finger takes it again only after a new press. `offset`, `aim`, `jump`
 * and `glideMs` move it as before. A scroll of the same axis around it does not take the pan.
 *
 * @example
 * ```tsx
 * // A delivery plays on the order strip, which stands on 318: the game moves it to the delivered
 * // order in 150 ms, and the player can tap the cards but not scroll them.
 * <scroll
 *   key="strip"
 *   axis="x"
 *   snap={[0, 318, 390]}
 *   offset={390}
 *   glideMs={150}
 *   locked
 *   style={{ width: 306, height: 120 }}
 * >
 *   <row key="track" style={{ width: 696, height: 120 }} />
 * </scroll>;
 * // 150 ms in: ScrollState { offset: 390, max: 390, moving: false }
 * // a drag on the strip after that: the same ScrollState in every frame, and no tap
 * ```
 */
export type ScrollLocked = boolean & Brand<"ScrollLocked">;
/** How many rows a windowed scroll has. */
export type ScrollRows = number & Brand<"ScrollRows">;
/** The height of every row, in reference units; above 0. */
export type ScrollRowHeight = number & Brand<"ScrollRowHeight">;
/** Rows kept alive beyond each edge of the viewport; 5 when left out. */
export type ScrollOverscan = number & Brand<"ScrollOverscan">;

/**
 * Builds the row at an index; called at reconcile for the rows in the window, never at build time.
 *
 * @example
 * ```tsx
 * <scroll key="shop" style={list} rows={items.length} rowHeight={80} overscan={5}
 *         row={index => <ShopRow key={items[index].id} item={items[index]} />} />;
 * // at offset 0: rows 0 to 24 exist, 25 of the 1000, for 80 u rows in a 1600 u list with overscan 5
 * ```
 */
export type ScrollRow = ((index: number) => DescriptionNode) & Brand<"ScrollRow">;
/** The world projections whose live views a container draws inside itself. */
export type HostedProjections = readonly string[] & Brand<"HostedProjections">;
/** The local field of the nearest component instance a text field writes on every keystroke. */
export type InputLocal = string & Brand<"InputLocal">;
/** The intent a text field answers on Enter, with `{ [local]: value }` as the payload. */
export type InputSubmit = string & Brand<"InputSubmit">;
/** The longest value of a text field, in UTF-16 units. */
export type InputMaxLength = number & Brand<"InputMaxLength">;
/** What an empty text field shows at half alpha; also the label a screen reader says. */
export type InputPlaceholder = (string | Message) & Brand<"InputPlaceholder">;
/** The keyboard a text field opens: plain text, a decimal pad or an email keyboard. */
export type TextInputKind = ("text" | "number" | "email") & Brand<"TextInputKind">;
/** The text style key of a field's value, its placeholder and its caret height. */
export type InputTextStyle = string & Brand<"InputTextStyle">;

/**
 * Extra component values an element's entity carries, beside the ones the tag writes itself. Any
 * component or tag works: a filter of `effects`, or a game's own component. A value whose type the
 * element owns (`Transform`, `Box`, `Shape`, `Tappable`, ...) is dropped and logged as
 * `ui:component-owned`; the element keeps its own.
 *
 * @example
 * ```tsx
 * <button key="claim" intent="claim" components={[Glow({ strength: 2 })]} />;
 * // the button entity carries Glow({ strength: 2 }) next to Tappable, Shape and Box
 * ```
 */
export type ElementComponents = readonly AnyComponentValue[] & Brand<"ElementComponents">;

/**
 * The props every tag takes, with the key kept out: JSX passes it as the third argument.
 *
 * @example
 * ```ts
 * const props: BoxProps = { style: { gap: 8 } };
 * ```
 */
export type BoxProps = CommonProperties;

/**
 * What a container takes: the common props and the projections it hosts. Every live view of a
 * hosted projection that has no parent, and is not held by a drag, is drawn inside the element,
 * in its local space; it falls back to its layer when the element leaves.
 *
 * @example
 * ```tsx
 * // The board of a merge game sits in a slot that shrinks to fit a short phone.
 * <stack
 *   key="boardSlot"
 *   hosts={["board.cells", "board.generators", "board.items"]}
 *   style={{ width: 970, height: 970, fit: "contain" }}
 * />;
 * // one frame after the slot is laid out, every live cell, generator and item view without a
 * // parent carries Parent({ entity: slot }) and draws in the slot's 0..970 space
 * ```
 */
export type HostProps = CommonProperties & { hosts?: HostedProjections };

/**
 * What a button takes. `intent` and `local` exclude each other: a button either answers the gate
 * or writes local state. `escape` marks the control the Escape key taps: the close button or the
 * backdrop of a dismissable popup. `point`, only beside `intent`, adds the press point of a finger
 * tap to the payload under `point`, in the button's own layout units: (0, 0) its top-left corner,
 * (width, height) its bottom-right, whatever its offset, scale or parent. A keyboard tap (Enter on
 * the focused button, Escape) has no press point and answers the payload as it is.
 *
 * @example
 * ```ts
 * const props: ButtonTagProps = { intent: "claim", payload: { orderId: "o1" } };
 * // The close button of the settings popup: Escape taps it while the popup is on top.
 * const close: ButtonTagProps = { intent: "close", escape: true };
 * // The gift sphere of 400 x 200, `<button intent="kitTap" point />`: a finger 10 in from its
 * // left edge and 150 down answers { intent: "kitTap", payload: { point: { x: 10, y: 150 } } }.
 * const sphere: ButtonTagProps = { intent: "kitTap", point: true };
 * ```
 */
export type ButtonTagProps = CommonProperties & { escape?: ButtonEscape } & (
    | { intent?: ButtonIntent; payload?: ButtonPayload; point?: ButtonPoint; local?: never }
    | { intent?: never; payload?: never; point?: never; local?: ButtonLocal }
  );

/**
 * What a text takes: a content or a bind, and the style key that carries its size. Only `bind()`
 * makes a bind; the text shows the bound field of a component of its own entity, so the bound
 * component goes in `components`.
 *
 * @example
 * ```ts
 * const props: TextTagProps = { content: "120", style: "digits" };
 * // The shop title: "title.19" on a short phone, "title.20.5" on a tall one.
 * const title: TextTagProps = { content: "Vitrine", style: { text: "title.19", when: { tall: { text: "title.20.5" } } } };
 * // The coin counter: Counter is an extra component, the text shows Math.round of its value.
 * const coins: TextTagProps = { bind: bind(Counter, "value"), components: [Counter({ value: 25 })] };
 * ```
 */
export type TextTagProps = Omit<CommonProperties, "style"> & {
  content?: TextContent;
  bind?: TextBind;
  style?: TextStyleProp;
};

/**
 * What an image takes: the texture key is required; `fit` is `"contain"` unless it says so.
 *
 * @example
 * ```ts
 * // A full-bleed background.
 * const props: ImageProps = {
 *   texture: "board.bg-forest-meadow",
 *   fit: "cover",
 *   style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }
 * };
 * ```
 */
export type ImageProps = CommonProperties & { texture: ImageTexture; fit?: ImageFit };

/**
 * What an icon takes: the asset key is required; without a size it follows the line height.
 *
 * @example
 * ```ts
 * const props: IconProps = { name: "hud.gear", fit: "contain" };
 * ```
 */
export type IconProps = CommonProperties & { name: IconName; fit?: ImageFit };

/**
 * What a panel takes: the common props. Its nine-slice is a style field, and it swallows every
 * tap that lands on it.
 *
 * @example
 * ```ts
 * const props: PanelProps = { style: { nineSlice: "ui.panel", padding: 32 } };
 * ```
 */
export type PanelProps = CommonProperties;

/** The child form of a scroll: its children are the content, laid out whole. */
type ScrollChildForm = { rows?: never; rowHeight?: never; overscan?: never; row?: never };

/** The windowed form of a scroll: only the rows in view plus `overscan` exist. */
type ScrollWindowForm = {
  rows: ScrollRows;
  rowHeight: ScrollRowHeight;
  overscan?: ScrollOverscan;
  row: ScrollRow;
  children?: never;
};

/**
 * What a scroll container takes: children for a short list, or `rows`, `rowHeight` and `row` for
 * a long one, whose rows exist only in the window; the `axis` it moves on, the `snap` stops a
 * release glides to, the `offset` it stands at, how long a glide to it lasts (`glideMs`), what it
 * aims at (`aim`), whether a new `offset` stands there at once (`jump`), and whether the finger
 * is kept from moving it (`locked`).
 *
 * @example
 * ```ts
 * const props: ScrollProps = { axis: "y" };
 * // The order strip: sideways, three stops, opened on the orders.
 * const strip: ScrollProps = { axis: "x", snap: [0, 318, 390], offset: 318 };
 * // A first tile of 82 u came in at the start of the track: the strip stands on 82 at once.
 * const shifted: ScrollProps = { axis: "x", offset: 82, jump: true };
 * // From 318, the next order: the strip glides to 390 in exactly 150 ms.
 * const quick: ScrollProps = { axis: "x", offset: 390, glideMs: 150 };
 * // The next order is at 0 too: a strip the player dragged to 390 glides back to 0.
 * const next: ScrollProps = { axis: "x", offset: 0, aim: "order-7" };
 * // A delivery plays: the strip stands on 390 and no finger moves it.
 * const delivering: ScrollProps = { axis: "x", offset: 390, locked: true };
 * // 1000 orders of 120 u in a 1600 u list: rows 0 to 18 exist at offset 0.
 * const orders: ScrollProps = {
 *   style: { height: 1600 },
 *   rows: 1000,
 *   rowHeight: 120,
 *   row: index => ({ type: "row", key: `order${index}`, props: {}, children: [] })
 * };
 * ```
 */
export type ScrollProps = CommonProperties & {
  axis?: ScrollAxis;
  snap?: ScrollSnap;
  offset?: ScrollOffset;
  glideMs?: ScrollGlideMs;
  aim?: ScrollAim;
  jump?: ScrollJump;
  locked?: ScrollLocked;
} & (ScrollChildForm | ScrollWindowForm);

/**
 * What a text field takes. `local` is required: every keystroke writes that field of the local
 * state of the nearest component, and Enter answers `submit` with `{ [local]: value }`. `style` is
 * the layout style of the field box.
 *
 * @example
 * ```tsx
 * // The name field of a rename popup. The player types "Alex": local.name is "Alex".
 * <input key="nameField" local="name" maxLength={16} submit="save" placeholder="Your name" />;
 * // Enter then answers the gate with { intent: "save", payload: { name: "Alex" } }
 * ```
 */
export type InputProps = CommonProperties & {
  local: InputLocal;
  submit?: InputSubmit;
  maxLength?: InputMaxLength;
  placeholder?: InputPlaceholder;
  kind?: TextInputKind;
  textStyle?: InputTextStyle;
};

/**
 * What an anchor sits on: one view or element by its projection and key, or a list of them, whose
 * shown ones it spans.
 */
export type AnchorTo = (AnchorTarget | readonly AnchorTarget[]) & Brand<"AnchorTo">;

/**
 * How far an anchor reaches past its targets on each side, in its root's units; 0 by default. A
 * value below 0 pulls it inward; past half the targets the size stops at 0, at their centre.
 */
export type AnchorPad = number & Brand<"AnchorPad">;

/**
 * What an anchor takes: the common props, `to` and `pad`. Its rect is the drawn rect of its
 * targets, padded, in the frame they are laid out, and its children lay out inside it; its style
 * gives its look, and a `width`, `height` or `position` there is ignored (`ui:anchor-style`, dev
 * builds). While no target is shown it is not drawn and takes no tap. On a target of no area it
 * stands at the point at size 0: it takes no tap itself, and its children overflow it and take
 * theirs. Its `change.Box` motion plays only when its targets change: a new `to`, or keys that name
 * other entities, a point included.
 *
 * @example
 * ```tsx
 * // The tutorial's window sits on the first seat of the board's order strip, 4 u outside it.
 * <anchor key="window" to={{ projection: "board.strip", key: "seat0" }} pad={4}>
 *   <stack key="rim" style={{ nineSlice: "tutorial.rim", hollow: true, width: "100%", height: "100%" }} />
 * </anchor>;
 * // the seat is drawn at { x: 40, y: 1500, w: 116, h: 120 }
 * app.ui.rectOf({ projection: "tutorial", key: "window" }); // { x: 36, y: 1496, w: 124, h: 128 }
 * ```
 */
export type AnchorProps = CommonProperties & { to: AnchorTo; pad?: AnchorPad };

/**
 * The fourteen tags a screen is written with.
 *
 * @example
 * ```ts
 * const tags: (keyof UiIntrinsicElements)[] = ["row", "column", "button"];
 * ```
 */
export type UiIntrinsicElements = {
  screen: HostProps;
  layer: BoxProps;
  row: HostProps;
  column: HostProps;
  stack: HostProps;
  spacer: BoxProps;
  panel: PanelProps;
  image: ImageProps;
  icon: IconProps;
  text: TextTagProps;
  button: ButtonTagProps;
  scroll: ScrollProps;
  input: InputProps;
  anchor: AnchorProps;
};

/**
 * The props of one tag with its `style` narrowed to the asset keys of one game, so a nine-slice
 * key outside them is an error where the tag is written. Distributes over a union, so the two
 * shapes of a button stay apart.
 *
 * @example
 * ```ts
 * type Panel = Restyled<PanelProps, "ui.panel">; // style?: Style<"ui.panel">
 * ```
 */
export type Restyled<Properties, Asset extends string> = Properties extends unknown
  ? Omit<Properties, "style"> & { style?: Style<Asset> }
  : never;

/**
 * The same tags with the asset keys, text style keys and message keys of one game. `uiFor`
 * carries it, so a game can name the type of its own intrinsics. The asset keys narrow `texture`,
 * `name` and the `nineSlice` of every style; the text style keys narrow the `style` of a text,
 * the `text` of its style object and of each `when` variant, and the `textStyle` of a field; the message keys narrow `content` and `placeholder`.
 *
 * @example
 * ```ts
 * type Tags = IntrinsicElementsFor<"ui.coin", "digits", "hud.coins">;
 * ```
 */
export type IntrinsicElementsFor<
  Asset extends string,
  TextStyleKey extends string,
  StringKey extends string
> = {
  [Tag in Exclude<keyof UiIntrinsicElements, "image" | "icon" | "text" | "input">]: Restyled<
    UiIntrinsicElements[Tag],
    Asset
  >;
} & {
  input: Restyled<Omit<InputProps, "textStyle" | "placeholder">, Asset> & {
    textStyle?: TextStyleKey;
    placeholder?: string | Message<StringKey>;
  };
  image: Restyled<CommonProperties, Asset> & { texture: Asset; fit?: "contain" | "cover" | "fill" };
  icon: Restyled<CommonProperties, Asset> & { name: Asset; fit?: "contain" | "cover" | "fill" };
  text: Omit<CommonProperties, "style"> & {
    content?: string | Message<StringKey>;
    bind?: TextBind;
    style?: TextStyleKey | TextTagStyle<Asset, TextStyleKey>;
  };
};

/**
 * What a tag may hold between its two ends, and where the motion hooks sit. Exported so the
 * runtime's `JSX` namespace can name them without repeating the shapes.
 *
 * @example
 * ```ts
 * const children: TagChildren = ["120 coins"];
 * ```
 */
export type TagChildren = JsxChild;

/**
 * The motion of one element, re-exported under the name the tag prop uses.
 *
 * @example
 * ```ts
 * const motion: TagMotion = {};
 * ```
 */
export type TagMotion = ElementMotion;
