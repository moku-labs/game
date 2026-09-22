/**
 * @file ui plugin — shared types of the plugin and its three modules: the config, the composed
 * state, the domain context and the public API the game calls.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as FlowApi } from "../flow/types";
import type { I18nApi } from "../i18n/types";
import type { InputApi } from "../input/types";
import type { Api as RendererApi } from "../renderer/types";
import type { TextApi } from "../text/types";
import type { Api as TimeApi } from "../time/types";
import type { Entity, Api as WorldApi } from "../world/types";
import type { Finding, JsxState, UiNode } from "./jsx/types";
import type { LayoutState } from "./layout/types";
import type { StylesState } from "./styles/types";

/**
 * ui plugin config.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { ui: { tapTargetPt: 48, breakpoints: { tall: 2, wide: 1.5 } } } });
 * ```
 */
export type Config = {
  /** Smallest tap target `lint()` accepts, in CSS px (points). */
  tapTargetPt: number;
  /** `when` flags: `tall` when height / width is at least `tall`, `wide` the other way round. */
  breakpoints: { tall: number; wide: number };
};

/**
 * ui plugin state: one branch per module.
 */
export type State = { jsx: JsxState; styles: StylesState; layout: LayoutState };

/**
 * Resolved dependency APIs. `anim` is not here: its edge is validation only, and its work
 * reaches `ui` through the tween driver behind every `ViewHandle`.
 */
export type Deps = {
  time: TimeApi;
  flow: FlowApi;
  world: WorldApi;
  renderer: RendererApi;
  input: InputApi;
  i18n: I18nApi;
  text: TextApi;
};

/**
 * What the kernel context offers before the deps are attached.
 *
 * `ui` owns no event, so `emit` is the kernel's and never called here.
 */
export type KernelSlice = PluginCtx<Config, State> & {
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context shared by the three modules: the kernel slice plus the resolved deps.
 */
export type UiCtx = KernelSlice & { readonly deps: Deps };

/**
 * ui plugin API, `app.ui`. The screen is one more projection, so the three members read it the
 * way a test reads the board: a snapshot, a key lookup and a list of findings.
 *
 * @example
 * ```ts
 * // A headless scenario taps the claim button of the reward popup.
 * app.ui.tree().type; // "row", the root element of the HUD
 * app.input.tap(app.ui.find("claim") ?? 0);
 * app.ui.lint(); // []
 * ```
 */
export type UiApi = {
  /**
   * The live screen as plain data: every root in layer order, every element in child order, with
   * its rect in root coordinates, its resolved style and its state flags. Works headless.
   *
   * @returns The root node; several roots come back under one `screen` node.
   * @example
   * ```ts
   * // A snapshot test reads the HUD without a browser.
   * app.ui.tree().children.map(child => child.key); // ["coins", "settings", "order"]
   * ```
   */
  tree(): UiNode;

  /**
   * The entity of a keyed element, so a test can tap it and `anim` can aim at it. Popup roots
   * come first, then the projection roots in layer order.
   *
   * @param key - The `key` prop of the element.
   * @returns The entity, or `undefined` for an unknown or exiting element.
   * @example
   * ```ts
   * // A headless scenario answers the gate through the button of the popup.
   * app.input.tap(app.ui.find("claim") ?? 0); // true
   * app.ui.find("nothing"); // undefined
   * ```
   */
  find(key: string): Entity | undefined;

  /**
   * Reads the live screen against the three rules: a tap target under `tapTargetPt`, a text that
   * does not fit its box in some registered locale, an absolute element with no `reason`.
   * Never throws; empty when nothing is mounted.
   *
   * @returns One finding per rule and element.
   * @example
   * ```ts
   * // A game test keeps the HUD honest on every screen it supports.
   * app.ui.lint(); // [{ rule: "tap-target", key: "settings", detail: "36 x 36 pt" }]
   * ```
   */
  lint(): readonly Finding[];
};

export type { Finding, UiNode } from "./jsx/types";
