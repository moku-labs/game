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
/** The asset key of the nine-slice a panel stretches. */
export type PanelNineSlice = string & Brand<"PanelNineSlice">;
/** The axis a scroll container moves on. `"x"` throws until V4. */
export type ScrollAxis = ("x" | "y") & Brand<"ScrollAxis">;

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
 * What an image takes: the texture key is required.
 *
 * @example
 * ```ts
 * const props: ImageProps = { texture: "ui.coin", style: { width: 48, height: 48 } };
 * ```
 */
export type ImageProps = CommonProperties & { texture: ImageTexture };

/**
 * What an icon takes: the asset key is required; without a size it follows the line height.
 *
 * @example
 * ```ts
 * const props: IconProps = { name: "hud.gear" };
 * ```
 */
export type IconProps = CommonProperties & { name: IconName };

/**
 * What a panel takes: a nine-slice key, or nothing for a plain filled rectangle.
 *
 * @example
 * ```ts
 * const props: PanelProps = { nineSlice: "ui.panel" };
 * ```
 */
export type PanelProps = CommonProperties & { nineSlice?: PanelNineSlice };

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
  screen: BoxProps;
  layer: BoxProps;
  row: BoxProps;
  column: BoxProps;
  stack: BoxProps;
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
 * The same tags with the asset keys, text style keys and message keys of one game. `uiFor`
 * carries it, so a game can name the type of its own intrinsics.
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
> = Omit<UiIntrinsicElements, "image" | "icon" | "panel" | "text"> & {
  image: CommonProperties & { texture: Asset };
  icon: CommonProperties & { name: Asset };
  panel: CommonProperties & { nineSlice?: Asset };
  text: Omit<CommonProperties, "style"> & {
    content?: string | Message<StringKey>;
    bind?: TextBind;
    style?: TextStyleKey | Style;
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
