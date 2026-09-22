/**
 * @file scenes plugin — type definitions: the scene declaration, the signature of the authoring
 * helper with its layer check, the state the switch runs on and the one public API member.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as AssetsApi } from "../assets/types";
import type { Api as FlowApi } from "../flow/types";
import type { Api as TimeApi } from "../time/types";
import type { LayerSort, LayerSpec, Owner, Api as WorldApi } from "../world/types";

/**
 * How a layer orders what is drawn in it. The scene's name for the rule `world` stores.
 *
 * @example
 * ```ts
 * const sort: SortRule = "y";
 * ```
 */
export type SortRule = LayerSort;

/**
 * What a scene declares about its layers: the key is the layer name, the order of the keys is
 * draw order, bottom first. An omitted `sort` means `"none"`.
 *
 * @example
 * ```ts
 * const layers: LayerMap = { background: {}, cells: {}, items: { sort: "y" }, lifted: {} };
 * ```
 */
export type LayerMap = Record<string, { sort?: SortRule }>;

/**
 * The name of the layer every scene gets on top of the layers it declared, where popups and the
 * HUD are mounted. A scene that declares it keeps the place it wrote it in.
 *
 * @example
 * ```ts
 * const layer: UiLayer = "ui";
 * ```
 */
export type UiLayer = "ui";

/**
 * The layer names the projections of a scene may use: the keys the scene declared and the
 * appended `ui`, which is there whether the scene wrote it or not.
 *
 * @example
 * ```ts
 * const layer: SceneLayer<{ cells: Record<never, never> }> = "ui"; // or "cells"
 * ```
 */
export type SceneLayer<Layers extends LayerMap> = (keyof Layers & string) | UiLayer;

/**
 * Any projection as a scene reads it. `projection()` widens `lift` to `string` when the author
 * declared none, so this is the loosest shape `defineScene` accepts.
 *
 * @example
 * ```ts
 * const spec: AnySceneProjection = { name: "board.items", layer: "items", lift: "lifted" };
 * ```
 */
export type AnySceneProjection = {
  readonly name: string;
  readonly layer: string;
  readonly lift?: string;
};

/**
 * The three fields of a `ProjectionSpec` a scene reads, with both layers checked against the
 * layers the scene declares. It is what a wrong `layer` or `lift` is reported against.
 *
 * @example
 * ```ts
 * const spec: SceneProjection<"items" | "lifted"> = { name: "board.items", layer: "items" };
 * ```
 */
export type SceneProjection<Layer extends string> = {
  readonly name: string;
  readonly layer: Layer;
  readonly lift?: Layer;
};

/**
 * Checks the `lift` of one projection. A projection built without a `lift` carries the widened
 * `string` of `projection()`, which is the one lift that is always accepted.
 */
type CheckedLift<Layer extends string, Spec> = Spec extends { readonly lift?: infer Lift }
  ? string extends Exclude<Lift, undefined>
    ? Spec
    : Exclude<Lift, undefined> extends Layer
      ? Spec
      : SceneProjection<Layer>
  : Spec;

/**
 * Checks one projection of a scene: first its `layer`, then its `lift`. A projection that fails
 * becomes `SceneProjection<Layer>`, so the compiler prints the layer names it accepts.
 */
type CheckedProjection<Layer extends string, Spec> = Spec extends { readonly layer: infer Declared }
  ? Declared extends Layer
    ? CheckedLift<Layer, Spec>
    : SceneProjection<Layer>
  : SceneProjection<Layer>;

/**
 * Checking type: validates the projections of a scene one by one against its layer names, so the
 * error sits on the projection that is wrong and not on the whole list.
 *
 * @example
 * ```ts
 * type Checked = CheckedProjections<"items", readonly [{ name: "board.items"; layer: "items" }]>;
 * ```
 */
export type CheckedProjections<Layer extends string, List> = {
  readonly [Index in keyof List]: CheckedProjection<Layer, List[Index]>;
};

/**
 * What the author passes to `defineScene`. The layer names come from the keys of `layers` plus
 * the appended `ui`; `NoInfer` keeps `projections` out of that inference, so a wrong name is
 * reported on the projection and never widens the layer union. `music` is an asset key of the
 * game, narrowed to its audio keys once the scanner splits them.
 *
 * @example
 * ```ts
 * const spec: SceneSpec<{ items: Record<never, never> }, readonly [], string, "board"> = {
 *   bundle: "board",
 *   layers: { items: {} },
 *   projections: []
 * };
 * ```
 */
export type SceneSpec<
  Layers extends LayerMap,
  Projections extends readonly AnySceneProjection[],
  Asset extends string,
  Bundle extends string
> = {
  bundle: Bundle;
  layers: Layers;
  projections: Projections & CheckedProjections<NoInfer<SceneLayer<Layers>>, NoInfer<Projections>>;
  music?: Asset;
};

/**
 * The signature of `defineScene` bound to the asset and bundle keys of one game.
 * `defineGame<Types>()` returns it; the loose export accepts any string.
 *
 * @example
 * ```ts
 * const defineGameScene: DefineScene<"board.music", "board"> = defineScene;
 * ```
 */
export type DefineScene<Asset extends string, Bundle extends string> = <
  Layers extends LayerMap,
  const Projections extends readonly AnySceneProjection[]
>(
  id: string,
  scene: SceneSpec<Layers, Projections, Asset, Bundle>
) => SceneDefinition;

/**
 * A scene as `defineScene` returns it: plain frozen data, ready for the `scenes` key of a feature.
 *
 * @example
 * ```ts
 * // What defineScene("board", { bundle: "board", layers: { items: { sort: "y" } }, projections: [] })
 * // returns: { id: "board", bundle: "board", music: undefined,
 * //   layers: [{ name: "items", sort: "y" }, { name: "ui", sort: "none" }], projections: [] }
 * ```
 */
export type SceneDefinition = {
  readonly id: string;
  readonly bundle: string;
  readonly music: string | undefined;
  /** Draw order, bottom first. */
  readonly layers: readonly LayerSpec[];
  /** Names of the projections the scene mounts. */
  readonly projections: readonly string[];
};

/**
 * The one owner every mount of this plugin carries. One is enough: one scene is mounted at a
 * time, and `unmount` is what flushes.
 *
 * @example
 * ```ts
 * const owner: SceneOwner = { kind: "plugin", name: "scenes" };
 * ```
 */
export type SceneOwner = Owner & { kind: "plugin"; name: "scenes" };

/**
 * scenes plugin config: none. A scene is data in a feature, and a transition effect is V3 work
 * of `anim`, so a key here would have no reader.
 *
 * @example
 * ```ts
 * const config: Config = {};
 * ```
 */
export type Config = Record<string, never>;

/**
 * scenes plugin state.
 */
export type State = {
  /** Scene id to its declaration, filled in `onStart` from `flow.features`. */
  scenes: Map<string, SceneDefinition>;
  /** Id of the scene that is mounted now. */
  current: string | undefined;
  /** Fast mode: the scene a transit node named, applied at the next rest node. */
  pending: string | undefined;
  owner: SceneOwner;
  /** The remover of the `onEnter` callback: set in `onStart`, run in `onStop`. */
  teardown: (() => void) | undefined;
};

/**
 * scenes plugin events.
 *
 * @example
 * ```ts
 * // A game plugin starts the music of the scene the graph switched to.
 * createPlugin("music", {
 *   depends: [scenesPlugin],
 *   hooks: ctx => ({ "scenes:changed": ({ music }) => ctx.log.info("scene music", { music }) })
 * }); // entering the board logs { music: "board.theme" }
 * ```
 */
export type Events = {
  /** The mounted scene changed. */
  "scenes:changed": { from: string | undefined; to: string; music: string | undefined };
};

/**
 * How this plugin sends its one event. The single emit site narrows the kernel's `emit` to it.
 *
 * @example
 * ```ts
 * const emit: EmitChanged = (name, payload) => bus.send(name, payload);
 * emit("scenes:changed", { from: "home", to: "board", music: "board.theme" });
 * ```
 */
export type EmitChanged = (name: "scenes:changed", payload: Events["scenes:changed"]) => void;

/**
 * scenes plugin API, `app.scenes`. A scene is switched by the graph, never by a call, so the
 * plugin answers one question and takes no orders.
 *
 * @example
 * ```ts
 * // A headless test walks from the menu onto the board and asks what is mounted.
 * await app.flow.walk([{ at: "home", intent: "play" }]);
 * app.scenes.current(); // "board"
 * ```
 */
export type ScenesApi = {
  /**
   * The id of the mounted scene.
   *
   * @returns The scene id, `undefined` before the first switch and after the app stopped.
   * @example
   * ```ts
   * // A dev overlay writes the scene next to the frame counter.
   * app.scenes.current(); // "board", or undefined while the first bundle still loads
   * ```
   */
  current(): string | undefined;
};

/**
 * Resolved dependency APIs.
 */
export type Deps = { flow: FlowApi; world: WorldApi; assets: AssetsApi; time: TimeApi };

/**
 * What the kernel context offers before the deps are attached.
 *
 * `emit` is declared as the kernel's own, unusable shape on purpose: core 1.7 leaves a plugin's
 * own events out of the context it hands the factories as soon as `depends` is declared, so a
 * scenes-typed `emit` here would make every factory unassignable. `switch.ts` narrows this one
 * member to `EmitChanged`; nothing else about the context is cast.
 */
export type KernelSlice = Omit<PluginCtx<Config, State, Events>, "emit"> & {
  emit(...args: never[]): void;
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context shared by the files of the plugin.
 */
export type ScenesCtx = KernelSlice & { readonly deps: Deps };

/**
 * The mode and the abort signal `flow.onEnter` hands every callback.
 *
 * @example
 * ```ts
 * const run: RunContext = { mode: "live", signal: new AbortController().signal };
 * ```
 */
export type RunContext = { mode: "live" | "fast"; signal: AbortSignal };
