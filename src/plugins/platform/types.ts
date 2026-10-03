/**
 * @file platform plugin — shared types: the provider seam a game fills, what one Back press ends
 * in, the config, the state and the public API.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { HapticKind } from "../anim/timeline/types";
import type { Events as LifecycleEvents } from "../lifecycle/types";

export type { HapticKind } from "../anim/timeline/types";

/**
 * The seam a game fills, usually from `@moku-labs/system` in its own bridge. The engine never
 * imports a native package: the provider is built in the application layer. Every `on*` returns
 * its remover, which the plugin calls on stop.
 *
 * @example
 * ```ts
 * // A headless test drives the plugin with a fake of six functions.
 * const ticks: string[] = [];
 * const provider: PlatformProvider = {
 *   onPause: () => () => undefined,
 *   onResume: () => () => undefined,
 *   onBack: () => () => undefined,
 *   haptic: kind => ticks.push(kind),
 *   keepAwake: () => undefined,
 *   exit: () => undefined
 * };
 * createApp({ plugins: [...screen, platformPlugin], pluginConfigs: { platform: { provider } } });
 * ```
 */
export type PlatformProvider = {
  /** Calls `fn` when the app goes to the background. Returns the remover. */
  onPause(fn: () => void): () => void;
  /** Calls `fn` when the app comes back to the foreground. Returns the remover. */
  onResume(fn: () => void): () => void;
  /**
   * Calls `fn` on every press of the system Back button. `fn` returns whether the engine took the
   * press; `false` lets the provider do its default, which on Android leaves the app.
   */
  onBack(fn: () => boolean): () => void;
  /** Plays one haptic tick. */
  haptic(kind: HapticKind): void;
  /** Keeps the screen on while `on` is true. */
  keepAwake(on: boolean): void;
  /** Leaves the app. */
  exit(): void;
};

/**
 * What took one Back press: the Escape button of the top popup, the intent `back` of the resting
 * node, the provider leaving the app, or nothing at all because the app has no provider.
 *
 * @example
 * ```ts
 * // Home rests and does not list "back": the provider leaves the app.
 * const result: BackResult = app.platform.back(); // "exit"
 * ```
 */
export type BackResult = "popup" | "intent" | "exit" | "none";

/**
 * platform plugin config.
 *
 * @example
 * ```ts
 * // app.ts of a game in the native shell: the bridge maps the system plugins onto the provider.
 * createApp({
 *   plugins: [...screen, effectsPlugin, audioPlugin, platformPlugin],
 *   pluginConfigs: { platform: { provider: fromSystem(system), keepAwake: true } }
 * });
 * ```
 */
export type Config = {
  /** The provider. `undefined`, the default: the plugin is inert, as on the web without a bridge and in headless tests. */
  provider: PlatformProvider | undefined;
  /** Keep the screen on while the game runs. Default `false`. */
  keepAwake: boolean;
};

/**
 * platform plugin state.
 */
export type State = {
  /** Whether `provider.keepAwake(true)` is in force. */
  awake: boolean;
  /** Removers of the provider subscriptions and of the haptic handler, called on stop. */
  offs: Array<() => void>;
  /** Haptic kinds already warned about in a dev build, so each warns once. */
  warned: Set<string>;
};

/**
 * platform plugin API, `app.platform`. The rest of the plugin runs on its own: the provider's
 * pause, resume and Back press, the `haptic` effect and keep-awake need no call.
 *
 * @example
 * ```ts
 * // An e2e test plays the Android Back button on Home, which rests without "back".
 * app.platform.back(); // "exit": the provider leaves the app
 * ```
 */
export type PlatformApi = {
  /**
   * Runs the Back chain once, exactly as a press of the system Back button does. The first step
   * that takes the press wins: Escape taps the `escape` button of the top ui root (`"popup"`),
   * then the intent `back` is answered to the resting node (`"intent"`), and otherwise the
   * provider leaves the app (`"exit"`). While the graph moves between nodes the gate is closed and
   * holds the answer for one frame, so the press answers `"intent"` and never leaves the app.
   * Escape also ends the editing of a ui text field, so a
   * press while a field is edited ends the edit and answers `"popup"`. Without a provider nothing
   * is pressed and the answer is `"none"`.
   *
   * @returns What took the press.
   * @example
   * ```ts
   * // An e2e test plays the Android Back button over the settings popup, then on Home.
   * app.platform.back(); // "popup": the settings popup was open and closed like Escape
   * // ...the runner settles on Home, which does not list "back"...
   * app.platform.back(); // "exit": the provider leaves the app
   * ```
   */
  back(): BackResult;
};

/**
 * What the kernel context offers the files of the plugin.
 *
 * `platform` owns no event, so `emit` is the kernel's and never called here.
 */
export type KernelSlice = PluginCtx<Config, State> & {
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Payload of the `lifecycle:changed` hook: the pause that releases keep-awake.
 */
export type LifecycleChanged = LifecycleEvents["lifecycle:changed"];

/**
 * A method of the provider, named in the log when it throws.
 */
export type ProviderMethod = keyof PlatformProvider;
