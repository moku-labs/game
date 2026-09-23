/* eslint-disable unicorn/prevent-abbreviations -- "props" is the JSX word for the attributes of a tag; another name would hide the contract. */
/**
 * @file ui/jsx — the intrinsic tags and their props. Every prop is a named alias, so a mismatch
 * prints the alias instead of the bare value type. Types only: nothing here runs.
 */
import type { Message } from "../../i18n/types";
import type { Json } from "../../model/types";
import type { Style } from "../styles/types";
import type { CommonProps as CommonProperties, ElementMotion, JsxChild } from "./types";

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
/** What a text draws: a plain string, or a message of the game's string table. */
export type TextContent = (string | Message) & Brand<"TextContent">;
/** The component field a text follows instead of a content. */
export type TextBind = { component: string; field: string } & Brand<"TextBind">;
/** The text style key, or a layout style when the built-in `body` is meant. */
export type TextStyleProp = (string | Style) & Brand<"TextStyleProp">;
/** The asset key of an image. */
export type ImageTexture = string & Brand<"ImageTexture">;
/** The asset key of an icon. */
export type IconName = string & Brand<"IconName">;
/** How an image or an icon fills its rect: inside it, over it (cropped), or stretched. */
export type ImageFit = ("contain" | "cover" | "fill") & Brand<"ImageFit">;
/** The axis a scroll container moves on. `"x"` throws until V4. */
export type ScrollAxis = ("x" | "y") & Brand<"ScrollAxis">;
/** The world projections whose live views a container draws inside itself. */
export type HostedProjections = readonly string[] & Brand<"HostedProjections">;

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
 * or writes local state.
 *
 * @example
 * ```ts
 * const props: ButtonTagProps = { intent: "claim", payload: { orderId: "o1" } };
 * ```
 */
export type ButtonTagProps = CommonProperties &
  (
    | { intent?: ButtonIntent; payload?: ButtonPayload; local?: never }
    | { intent?: never; payload?: never; local?: ButtonLocal }
  );

/**
 * What a text takes: a content or a bind, and the style key that carries its size.
 *
 * @example
 * ```ts
 * const props: TextTagProps = { content: "120", style: "digits" };
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

/**
 * What a scroll container takes.
 *
 * @example
 * ```ts
 * const props: ScrollProps = { axis: "y" };
 * ```
 */
export type ScrollProps = CommonProperties & { axis?: ScrollAxis };

/**
 * The thirteen tags a screen is written with.
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
  input: BoxProps;
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
 * `name` and the `nineSlice` of every style.
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
  [Tag in Exclude<keyof UiIntrinsicElements, "image" | "icon" | "text">]: Restyled<
    UiIntrinsicElements[Tag],
    Asset
  >;
} & {
  image: Restyled<CommonProperties, Asset> & { texture: Asset; fit?: "contain" | "cover" | "fill" };
  icon: Restyled<CommonProperties, Asset> & { name: Asset; fit?: "contain" | "cover" | "fill" };
  text: Omit<CommonProperties, "style"> & {
    content?: string | Message<StringKey>;
    bind?: TextBind;
    style?: TextStyleKey | Style<Asset>;
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
