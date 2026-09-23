/**
 * @file ui plugin — the components `ui` owns, the `popup` effect descriptor and the binder
 * `defineGame` spreads. Pure: no ctx, no state, no Pixi. Made with the `component()` helper of
 * `world`, so nothing has to be registered.
 */
import type { Descriptor } from "../flow/fx/types";
import type { Json } from "../model/types";
import { component, resource, tag } from "../world/ecs/define";
import { defineComponent } from "./jsx/component";
import type { IntrinsicElementsFor } from "./jsx/intrinsics";
import type { PopupComponent } from "./jsx/types";
import { defineStyle } from "./styles/define";
import { defineTokens } from "./styles/tokens";
import type { Style } from "./styles/types";

/**
 * The rect of a ui element in root coordinates, in reference units. Its `x` and `y` are the rest
 * pose of the `Transform` of that entity, so a motion never fights the layout.
 *
 * @example
 * ```ts
 * const value: BoxValue = { x: 0, y: 0, w: 1080, h: 96 };
 * ```
 */
export type BoxValue = { x: number; y: number; w: number; h: number };

/**
 * What a button with `local` writes into the local state of its nearest component instance.
 *
 * @example
 * ```ts
 * const value: LocalWriteValue = { patch: { tab: "audio" } };
 * ```
 */
export type LocalWriteValue = { patch: Record<string, unknown> };

/**
 * The scroll state of a container. Internal: the engine writes it, a game never does.
 *
 * @example
 * ```ts
 * const value: ScrollValue = { axis: "y", offset: -120, min: -480 };
 * ```
 */
export type ScrollValue = { axis: string; offset: number; min: number };

/**
 * Who owns every entity `ui` spawns. The projection module checks it before it hands out a view
 * handle, so only `ui` may move a ui element.
 */
export const UI_OWNER = { kind: "plugin", name: "ui" } as const;

/** Fresh defaults for the patch, so no two buttons share one object. */
const localWriteDefaults: LocalWriteValue = { patch: {} };

/**
 * The rect of a ui element in root coordinates. Written by the solve, read by `tree()`, `lint()`
 * and the hit test of `guide`.
 */
export const Box = /*#__PURE__*/ component("Box", { x: 0, y: 0, w: 0, h: 0 });

/**
 * On a button that writes local state instead of naming an intent. `input.onTap` reports the tap
 * and `ui` merges the patch into the nearest component instance.
 */
export const LocalWrite = /*#__PURE__*/ component("LocalWrite", localWriteDefaults);

/**
 * On a scroll container. Internal to `ui`: not exported from the package root.
 */
export const Scroll = /*#__PURE__*/ component("Scroll", { axis: "y", offset: 0, min: 0 });

/**
 * On the root entity of a popup kept beneath another popup (`popup(..., { over })`). Internal to
 * `ui`: not exported from the package root. Every element of that root resolves `is.covered`.
 */
export const Covered = /*#__PURE__*/ tag("Covered");

/**
 * On a button with the `escape` prop: the control the Escape key taps while its root is the top
 * one, meant for the close button or the backdrop of a dismissable popup. Internal to `ui`: the
 * game writes the prop, never the tag.
 */
export const Escapable = /*#__PURE__*/ tag("Escapable");

/**
 * What the acceptance cases of the spike count. Internal to `ui`: the numbers are written once
 * per frame step and read by the tests through `world.ecs.resource`, never by a game.
 *
 * @example
 * ```ts
 * const value: UiCountersValue = { solves: 1, nodes: 12, measured: 1, reconciles: 3 };
 * ```
 */
export type UiCountersValue = {
  solves: number;
  nodes: number;
  measured: number;
  reconciles: number;
};

/**
 * The three Yoga counters and the reconcile count of the frame. Written by the two systems of
 * `ui`, read by the acceptance tests. Not part of `app.ui`.
 */
export const UiCounters = /*#__PURE__*/ resource("UiCounters", {
  solves: 0,
  nodes: 0,
  measured: 0,
  reconciles: 0
});

/**
 * Builds the effect a node awaits to show a popup. The gate opens for the outcomes of the
 * component, so the node resolves with the intent one of its buttons answered. `over` names the
 * component of a popup that stays mounted beneath this one, drawn covered, until this one is gone.
 *
 * @param component - A component declared with `outcomes`.
 * @param props - What its view is called with.
 * @param options - How the popup stands to the others.
 * @param options.over - The component name of the popup kept beneath this one.
 * @returns The descriptor `fx()` takes.
 * @example
 * ```ts
 * const Reward = defineComponent("Reward", {
 *   outcomes: { claim: {} },
 *   view: () => ({ type: "panel", props: {}, children: [] })
 * });
 * popup(Reward, { gold: 5 });
 * // { kind: "popup", payload: { component: "Reward", props: { gold: 5 } }, answers: ["claim"] }
 * ```
 * @example
 * ```ts
 * // The settings node asks before a reset; the settings stay beneath, covered.
 * const Confirm = defineComponent("Confirm", {
 *   outcomes: { reset: {}, cancel: {} },
 *   view: () => ({ type: "panel", props: {}, children: [] })
 * });
 * popup(Confirm, {}, { over: "Settings" });
 * // { kind: "popup", payload: { component: "Confirm", props: {}, over: "Settings" },
 * //   answers: ["reset", "cancel"] }
 * ```
 */
export function popup<Properties extends object, Local extends object>(
  component: PopupComponent<Properties, Local>,
  props: Properties,
  options?: { over?: string }
): Descriptor {
  const over = options?.over;
  const payload =
    over === undefined
      ? { component: component.name, props: props as Json }
      : { component: component.name, props: props as Json, over };

  return { kind: "popup", payload, answers: Object.keys(component.outcomes) };
}

/**
 * The ui helpers bound to one game's asset keys, text style keys and message keys. `defineStyle`
 * takes a nine-slice of the game's asset keys only. `intrinsics` carries no value: it is the type
 * of the tags this game writes its screens with.
 *
 * @example
 * ```ts
 * const kit: UiKit<"ui.coin", "digits", "hud.coins"> = uiFor<"ui.coin", "digits", "hud.coins">();
 * kit.defineTokens({ space: { md: 16 } }).space.md; // 16
 * ```
 */
export type UiKit<Asset extends string, TextStyleKey extends string, StringKey extends string> = {
  defineComponent: typeof defineComponent;
  defineStyle: <const Given extends Style<Asset>>(style: Given) => Readonly<Given>;
  defineTokens: typeof defineTokens;
  popup: <Properties extends object, Local extends object>(
    component: PopupComponent<Properties, Local>,
    props: Properties,
    options?: { over?: string }
  ) => Descriptor;
  intrinsics: IntrinsicElementsFor<Asset, TextStyleKey, StringKey>;
};

/**
 * Binds the four ui helpers to one game. Type-only: the same four functions, plus the intrinsic
 * table this game's tags are checked against.
 *
 * @returns The helpers and the intrinsic type carrier.
 * @example
 * ```ts
 * const { defineStyle } = uiFor<"ui.coin", "digits", "hud.coins">();
 * defineStyle({ gap: 8 }).gap; // 8
 * ```
 */
export function uiFor<
  Asset extends string,
  TextStyleKey extends string,
  StringKey extends string
>(): UiKit<Asset, TextStyleKey, StringKey> {
  return {
    defineComponent,
    defineStyle,
    defineTokens,
    popup,
    intrinsics: {} as IntrinsicElementsFor<Asset, TextStyleKey, StringKey>
  };
}

export type { ComponentDefinition } from "./jsx/types";
