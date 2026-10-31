/**
 * @file scenes plugin — type definitions: the scene declaration, the signature of the authoring
 * helper with its layer check, the state the switch runs on and the public API.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as AssetsApi, Events as AssetsEvents } from "../assets/types";
import type { Api as ClockApi } from "../clock/types";
import type { Api as FlowApi } from "../flow/types";
import type { Json, Api as ModelApi } from "../model/types";
import type { Api as RendererApi } from "../renderer/types";
import type { Api as TimeApi } from "../time/types";
import type { LayerSort, LayerSpec, Owner, SceneSwitch, Api as WorldApi } from "../world/types";

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
 * draw order, bottom first. An omitted `sort` means `"none"`, and `"order"` on a layer named `ui`,
 * so the roots of a scene draw there in the order of its projections. `above: "overlays"` makes the layer
 * the scene's HUD layer: it draws above every overlay and is never part of the picture an overlay
 * keeps. At most one per scene.
 *
 * @example
 * ```ts
 * const layers: LayerMap = { background: {}, cells: {}, items: { sort: "y" }, lifted: {} };
 * const ward: LayerMap = { scene: {}, ui: { sort: "order" }, hud: { above: "overlays" } };
 * ```
 */
export type LayerMap = Record<string, { sort?: SortRule; above?: "overlays" }>;

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
 * The veil a live switch lays over the scene being left, from the switch start: a full-screen rect the engine draws
 * above every layer, fading from 0 to `alpha` over `inMs`; after the swap the next scene is under it and it fades out
 * over `outMs`. It takes no tap. A field left out keeps the one of the level below: the scene's over the config's over
 * the engine's. The scene being entered has the last word on its `color` and `alpha` (`enter.cover`).
 *
 * @example
 * ```ts
 * // A navy veil at 60 %, the engine's 50 ms in and 150 ms out.
 * const cover: SceneCover = { color: 0x0b1020, alpha: 0.6 };
 * ```
 */
export type SceneCover = {
  /** Colour of the veil, `0xRRGGBB`. Default `0x000000`. */
  color?: number;
  /** The alpha it fades in to, 0 to 1. Default 0.45. */
  alpha?: number;
  /** Milliseconds from 0 to `alpha`, from the switch start. Default 50. */
  inMs?: number;
  /** Milliseconds back to 0 after the swap. Default 150. */
  outMs?: number;
};

/**
 * What a live switch shows above the veil when it is not done `afterMs` after its start, until the swap: a game
 * texture turning at the centre (`texture`), a projection of the game drawn above the veil (`projection`), or, with
 * neither, a white ring the engine draws. `texture` and `projection` are one choice: a level that names either replaces
 * both of the level below, and with both named `projection` is drawn. A projection loader draws in a layer of its own
 * that the scene being left declares: kept built and hidden while that scene stands, shown once the loader is due (the
 * whole layer is drawn above the veil while it shows), and faded out with the veil after the swap. `scenes` hands its
 * `from` the switch (`SceneSwitch`): where it goes and how far its bundles loaded. `holdMs` is a floor on the swap: the
 * next scene builds at once and the old one stays until the floor passed.
 *
 * @example
 * ```ts
 * // The game's ring texture, shown once the switch took 400 ms.
 * const loader: SceneLoader<"ui.loader.ring"> = { texture: "ui.loader.ring" };
 * // The game's own loading screen, the projection "loading" in the layer "loading", after 250 ms.
 * const screen: SceneLoader = { afterMs: 250, projection: "loading" };
 * // A circle that opens over 260 ms, however fast the scene comes: shown from the first drawn frame, the swap held.
 * const opening: SceneLoader = { afterMs: 0, holdMs: 260, projection: "opening" };
 * ```
 */
export type SceneLoader<Asset extends string = string> = {
  /** Milliseconds after the switch start the loader waits for; 0 shows it from the first drawn frame. Default 400. */
  afterMs?: number;
  /**
   * Milliseconds after the switch start before the swap may happen, on the clock of the look: a floor, so a switch
   * slower than it gets nothing added. Merged like `afterMs`: 0 lifts the floor of the level below. Default 0.
   */
  holdMs?: number;
  /** An asset key of the game: the texture turns at the centre of the frame. */
  texture?: Asset;
  /**
   * The name of a registered projection: kept built and hidden while the scene stands, shown once the loader is due,
   * its layer drawn above the veil; it fades out with the veil after the swap. Its `from(player, session, sw)` reads the
   * switch as its third argument: `{ from: "ward", to: "ward", progress: 0 }` while the ward stands, then `{ from:
   * "ward", to: "board", progress }`, the share of the board's bundles loaded, in steps of 0.01 up to 1.
   */
  projection?: string;
};

/**
 * What a live switch shows over the scene being left: the veil and the loader. The scene being left decides: its
 * `leave` is merged field by field over `config.leave`, which is merged over the engine's default (`{ cover: { color:
 * 0x000000, alpha: 0.45, inMs: 50, outMs: 150 }, loader: { afterMs: 400 } }`). `false` turns a part or the whole off;
 * a part written over `false` starts from the engine's default. The scene being entered may set the veil's `color` and
 * `alpha` on top (`enter.cover`). Fast mode, a headless app and the first scene of a run show nothing.
 *
 * @example
 * ```ts
 * // The board leaves under a navy veil with the game's ring texture; the ward leaves with nothing at all.
 * const board: SceneLeave<"ui.loader.ring"> = { cover: { color: 0x0b1020, alpha: 0.6 }, loader: { texture: "ui.loader.ring" } };
 * const ward: SceneLeave = false;
 * // The veil without a loader.
 * const quiet: SceneLeave = { loader: false };
 * ```
 */
export type SceneLeave<Asset extends string = string> =
  | { cover?: SceneCover | false; loader?: SceneLoader<Asset> | false }
  | false;

/**
 * What a live switch to this scene shows over the scene being left: the veil takes this scene's `color` and `alpha`,
 * each over what the scene being left resolved (its `leave` over `config.leave` over the engine's). Only the look of
 * the veil: `inMs` and `outMs` stay the left scene's, and a veil the scene being left turned off (`cover: false`)
 * stays off, as `enter` never turns one on. Absent: the scene being left decides alone.
 *
 * @example
 * ```ts
 * // Every way into the night scene dims the scene being left in navy at 70 %: ward → night shows the veil
 * // { color: 0x0b1020, alpha: 0.7, inMs: 50, outMs: 150 } over a ward that leaves with the engine's.
 * const enter: SceneEnter = { cover: { color: 0x0b1020, alpha: 0.7 } };
 * ```
 */
export type SceneEnter = {
  /** The `color` and the `alpha` of the veil of a switch to this scene. */
  cover?: Pick<SceneCover, "color" | "alpha">;
};

/**
 * What the author passes to `defineScene`. The layer names come from the keys of `layers` plus
 * the appended `ui`; `NoInfer` keeps `projections` out of that inference, so a wrong name is
 * reported on the projection and never widens the layer union. `music` is an asset key of the
 * game, narrowed to its audio keys once the scanner splits them. `bundles` names the bundles that
 * depend on the committed state, typed with the game's `Player` and `Session`.
 *
 * @example
 * ```ts
 * // A scene of the location feature shows the art of the episode the session plays: the restore
 * // of a bookmark at that scene mounts it once "location" and "ep01" are in.
 * const spec: SceneSpec<{ room: Record<never, never> }, readonly [], string, "location" | "ep01", Json, { episode: "ep01" }> = {
 *   bundle: "location",
 *   bundles: ({ session }) => [session.episode],
 *   layers: { room: {} },
 *   projections: []
 * };
 * ```
 */
export type SceneSpec<
  Layers extends LayerMap,
  Projections extends readonly AnySceneProjection[],
  Asset extends string,
  Bundle extends string,
  Player extends Json = Json,
  Session extends Json = Json
> = {
  bundle: Bundle;
  /**
   * Bundles the scene needs on top of `bundle`, read from the committed state each time a node
   * enters the scene. Pure and cheap: it gets frozen trees, and throwing rolls the node back.
   *
   * @param state - The committed `player` and `session`, frozen.
   * @returns Bundle keys of the game, in the order they are loaded.
   */
  bundles?(state: SceneState<Player, Session>): readonly Bundle[];
  layers: Layers;
  projections: Projections & NoInfer<CheckedProjections<SceneLayer<Layers>, Projections>>;
  music?: Asset;
  /** What a live switch shows over this scene when it is left: merged field by field over `config.leave`. */
  leave?: SceneLeave<Asset>;
  /** What a live switch to this scene shows: the `color` and `alpha` of the veil over the scene being left. */
  enter?: SceneEnter;
};

/**
 * The signature of `defineScene` bound to the asset and bundle keys and to the `Player` and
 * `Session` of one game. `defineGame<Types>()` returns it; the loose export accepts any string and
 * reads the state as `Json`.
 *
 * @example
 * ```ts
 * const defineGameScene: DefineScene<"board.music", "board" | "ep01", Player, Session> = defineScene;
 * ```
 */
export type DefineScene<
  Asset extends string,
  Bundle extends string,
  Player extends Json = Json,
  Session extends Json = Json
> = <Layers extends LayerMap, const Projections extends readonly AnySceneProjection[]>(
  id: string,
  scene: SceneSpec<Layers, Projections, Asset, Bundle, Player, Session>
) => SceneDefinition;

/**
 * A scene as `defineScene` returns it: plain frozen data, ready for the `scenes` key of a feature.
 *
 * @example
 * ```ts
 * // What defineScene("board", { bundle: "board", layers: { items: { sort: "y" } }, projections: [] })
 * // returns: { id: "board", bundle: "board", music: undefined,
 * //   layers: [{ name: "items", sort: "y" }, { name: "ui", sort: "order" }], projections: [] }
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
  /**
   * What `defineScene` was given as `bundles`; absent when the scene names no bundle of state.
   *
   * @param state - The committed `player` and `session`, frozen.
   * @returns The bundle names the scene needs on top of `bundle`.
   */
  bundles?(state: SceneState): readonly string[];
  /** What `defineScene` was given as `leave`; absent when the scene takes the config's. */
  readonly leave?: SceneLeave;
  /** What `defineScene` was given as `enter`; absent when the scene being left decides the veil alone. */
  readonly enter?: SceneEnter;
};

/**
 * The committed state a scene's `bundles` reads: the frozen `player` and `session` of `model.store.snapshot()`, never a
 * draft of the node being entered.
 *
 * @example
 * ```ts
 * const state: SceneState<{ coins: number }, { episode: string }> = { player: { coins: 4 }, session: { episode: "ep01" } };
 * ```
 */
export type SceneState<Player extends Json = Json, Session extends Json = Json> = {
  readonly player: Player;
  readonly session: Session;
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
 * scenes plugin config. A scene is data in a feature; the keys are the budget of a live switch and what it shows over
 * the scene being left.
 *
 * @example
 * ```ts
 * // The default: two thirds of each frame, read at the start of every build: 11.1 ms at 60 Hz, 5.56 ms at 120 Hz.
 * const config: Config = { buildMs: "auto" };
 *
 * // A game on a slow phone gives the next scene a fixed 3 ms of each frame: the switch takes more frames.
 * const fixed: Config = { buildMs: 3 };
 *
 * // Every switch shows the veil and no loader.
 * const quiet: Config = { buildMs: "auto", leave: { loader: false } };
 * ```
 */
export type Config = {
  /**
   * Milliseconds per frame the next scene's building work may take on a live switch with a
   * drawing renderer: a finite number above 0, or `"auto"` (the default) for two thirds of the
   * frame interval the loop runs at, `(1000 / time.rate().fps) * 2 / 3`, read once at the build start.
   */
  buildMs: number | "auto";
  /**
   * What a live switch shows over the scene being left, for every scene; a scene's own `leave` is merged over it field
   * by field. A field left out keeps the engine's default, `{ cover: { color: 0x000000, alpha: 0.45, inMs: 50,
   * outMs: 150 }, loader: { afterMs: 400 } }`, which holds no swap (no `holdMs`); `false` turns a part or the whole off.
   *
   * @example
   * ```ts
   * // The veil a little darker for every scene, and the game's ring texture after 300 ms instead of the white ring.
   * createApp({
   *   plugins: [...screen, boardFeature],
   *   pluginConfigs: { scenes: { leave: { cover: { alpha: 0.6 }, loader: { afterMs: 300, texture: "ui.loader.ring" } } } }
   * });
   * // A circle that opens over 260 ms from the first drawn frame, however fast the next scene comes.
   * createApp({
   *   plugins: [...screen, boardFeature],
   *   pluginConfigs: { scenes: { leave: { loader: { afterMs: 0, holdMs: 260, projection: "opening" } } } }
   * });
   * // No veil and no loader on any switch.
   * createApp({ plugins: [...screen, boardFeature], pluginConfigs: { scenes: { leave: false } } });
   * ```
   */
  leave?: SceneLeave;
};

/**
 * The running build of the next scene (spec 31): what the commit needs, and how to stop
 * listening. Absent while no build runs.
 */
export type SceneBuild = {
  /** The scene being built. */
  scene: SceneDefinition;
  /** The bundles it names, as they were awaited. */
  named: readonly string[];
  /** The scene current at the build start, the one that leaves at the commit. */
  from: string | undefined;
  /** Frames the build waited in so far. */
  frames: number;
  /** The building budget of a frame the build runs with, ms: `buildMs`, or what `"auto"` gave at its start. */
  budgetMs: number;
  /** The page clock of an agent build at the build start, ms; 0 in a build without the flag. */
  startedAt: number;
  /** Removes the frame callback and the abort listener of the build. */
  off: () => void;
  /** Settles the switch once the build is committed, discarded or dropped by a stop. */
  resolve: () => void;
  /**
   * Rejects the switch when the commit threw.
   *
   * @param error - What the commit threw.
   */
  reject: (error: unknown) => void;
};

/**
 * scenes plugin state.
 */
export type State = {
  /** Scene id to its declaration, filled in `onStart` from `flow.features`. */
  scenes: Map<string, SceneDefinition>;
  /** Id of the scene that is mounted now. */
  current: string | undefined;
  /**
   * The scene the next node without its own `scene` mounts, at a rest node or at a transit node
   * in live mode: the one a transit node named in fast mode, or the one the restore door expected
   * with `expect`. A rest node clears it; a transit node clears it only when it took it; an over
   * node takes it and clears it, whatever is mounted, except an over transit node of a fast walk,
   * which leaves it alone.
   */
  pending: string | undefined;
  /**
   * The bundles the mounted scene names, its `bundle` first, as last awaited. Empty while nothing
   * is mounted.
   */
  named: readonly string[];
  owner: SceneOwner;
  /** The remover of the two `onEnter` callbacks, `begin` and `scene`: set in `onStart`, run in `onStop`. */
  teardown: (() => void) | undefined;
  /**
   * The build of the next scene on a live switch, from its start to its commit or discard.
   * Absent otherwise: deleted, never written as `undefined`.
   */
  build?: SceneBuild;
  /**
   * The veil and the loader of the running switch, from the `begin` stage of its node to its swap or its end without
   * one. Absent otherwise: deleted, never written as `undefined`.
   */
  leaving?: Leaving;
  /**
   * The leave loader projection scenes holds for the next switch of the scene that stands (F103): `world` keeps it
   * built and hidden, and the loader's `due` only shows it. Absent while it holds none: deleted, never written as
   * `undefined`.
   */
  held?: HeldLoader;
  /**
   * The loader projection the last switch showed, fading out with the veil after its swap (F107 part 3), until the
   * veil's `outMs` passed. Absent otherwise: deleted, never written as `undefined`.
   */
  fading?: FadingLoader;
};

/**
 * A leave loader projection scenes holds while a scene stands (F103): its name and the layer its spec names, which the
 * renderer draws above the veil once the loader is due.
 */
export type HeldLoader = {
  /** The projection. */
  name: string;
  /** The `layer` of its spec: the view a `show` brings has no `Layer` before the next frame's reconcile. */
  layer: string;
};

/**
 * A loader projection fading out with the veil after the swap of its switch (F107 part 3): unmounted once the veil's
 * `outMs` passed, or held again for the next switch when the scene that stands leaves with the same loader.
 */
export type FadingLoader = {
  /** The projection. */
  name: string;
  /** Milliseconds of the fade still to run, counted down by the frames since the swap. */
  leftMs: number;
  /** The loader the scene that stands holds once the fade is over: this projection again. Absent: it is unmounted. */
  rehold?: HeldLoader;
  /** Removes the frame callback of the fade. */
  off: () => void;
};

/**
 * The veil and the loader a switch showed over the scene being left (spec 33, slices A2 and A3): the node that started
 * them, whether they were taken down already, the loader projection it mounted once its loader was due, and how to stop
 * listening to the abort of its node.
 */
export type Leaving = {
  /**
   * The abort signal of the node whose `begin` stage started the look: its `scene` stage takes the look over, and the
   * `begin` stage of any later node finds it left over by a node that never reached its `scene` stage.
   */
  signal: AbortSignal;
  /**
   * The scene the look was started for: the `scene` stage takes it over only for that scene, since its loader was
   * resolved against it.
   */
  to: string;
  /** Landed or dropped: a second end does nothing. */
  done: boolean;
  /**
   * The loader projection the switch mounted or showed once its loader was due: unmounted at once at a drop, faded out
   * with the veil after a land. Absent while it mounted and showed none.
   */
  projection?: string;
  /** Milliseconds the veil fades out over after the swap, 0 without a veil: a loader shown goes with it. */
  outMs: number;
  /**
   * The floor on the swap (F130), for a loader that is on with `holdMs` above 0: the clock moment the swap may happen at,
   * and the frame counter at the look's start. Absent: no floor. `state.leaving` is always the running switch's look
   * (`dropLeftOver` and `leaveFor` keep it so), which is why the build reads it there.
   */
  hold?: { until: number; frame: number };
  /**
   * The loader projection the switch feeds its `SceneSwitch` (F107 part 1), from its start to its swap or drop. Absent
   * when it feeds none: a ring, a texture, a loader turned off, or a projection another owner shows.
   */
  feeding?: LoaderFeed;
  /** Removes the abort listener of the switch's node. */
  off: () => void;
};

/**
 * One bundle of a switch and how much of it is loaded, in thousandths: 1000 once it is loaded.
 */
export type BundleShare = {
  /** The bundle. */
  readonly bundle: string;
  /** The share of its files settled, in thousandths: 0 to 1000. */
  share: number;
};

/**
 * What a switch feeds its loader projection (F107 part 1): the name, both scenes, the table of its bundles made at the
 * start, the progress last fed and the one `feed` call of the switch. The hook of `assets:bundle-progress` and the
 * scene stage, once its loads are in, write the table and feed a new `SceneSwitch` only once the progress grew by 0.01
 * or reached 1.
 */
export type LoaderFeed = {
  /** The loader projection. */
  readonly name: string;
  /** The scene being left: `from` of every switch fed. */
  readonly from: string;
  /** The scene being switched to: `to` of every switch fed. */
  readonly to: string;
  /** The bundles the scene being switched to names, one row each, in the order it names them. */
  readonly bundles: readonly BundleShare[];
  /** The progress last fed, in thousandths: the mean of the shares, floored; 1000 with no bundle. */
  fed: number;
  /**
   * Feeds the loader a switch: `world.projection.feed` bound to the name, made once per switch.
   *
   * @param sw - The switch, a new object for each new value.
   */
  readonly feed: (sw: SceneSwitch) => void;
};

/**
 * The payload of the `assets:bundle-progress` hook: one more file of a running load settled.
 */
export type BundleProgress = AssetsEvents["assets:bundle-progress"];

/**
 * A veil with every field: what a level of `leave` resolves to.
 */
export type FullCover = Required<SceneCover>;

/**
 * A loader with its delay, at most one look and its floor on the swap, absent for no floor: what a level of `leave`
 * resolves to.
 */
export type FullLoader = {
  afterMs: number;
  holdMs?: number;
  texture?: string;
  projection?: string;
};

/**
 * What a switch shows over the scene being left, every level merged: each part resolved or off.
 */
export type FullLeave = { cover: FullCover | false; loader: FullLoader | false };

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
 * scenes plugin API, `app.scenes`. A scene is switched by the graph, never by a call, so the
 * plugin answers one question and takes one order, for the restore door.
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
  /**
   * Names the scene the next node without its own `scene` mounts. A rest node reads it, and so
   * does a transit node in live mode; a transit node of a fast walk leaves it for the rest point.
   * The restore door calls it with the scene of a bookmark, so a bookmark at a popup comes back
   * with the scene under it, also when the popup is a transit node that waits for its answer:
   * the scene of such a popup is mounted before `flow.restore` resolves.
   * An over node takes the expected scene too, whatever is mounted, so a popup bookmark restored
   * on a page that shows another scene switches to the scene of the bookmark. With nothing
   * expected an over node never switches. An over transit node of a fast walk mounts nothing and
   * keeps the record.
   *
   * @param id - Id of a scene a feature declared.
   * @throws {Error} For an id no feature declared, also before `onStart` filled the registry.
   * @example
   * ```ts
   * // A fresh page restores a bookmark taken at the Settings popup over Home, a transit node
   * // that waits for its answer.
   * app.scenes.expect("home");
   * await app.flow.restore(bookmark); // resolves when the popup's gate is open
   * app.scenes.current(); // "home"
   * ```
   */
  expect(id: string): void;
};

/**
 * Resolved dependency APIs.
 */
export type Deps = {
  flow: FlowApi;
  world: WorldApi;
  assets: AssetsApi;
  time: TimeApi;
  /** The clock of the look, which a floor on the swap is counted on. */
  clock: ClockApi;
  model: ModelApi;
  /**
   * Whether the renderer draws, which chooses the path of a switch, and the performance log of
   * an agent build that names every switch.
   */
  renderer: RendererApi;
};

/**
 * What the kernel context offers before the deps are attached.
 *
 * `index.ts` writes `events` with an annotated `register` (core spec `14-EVENT-REGISTRATION.md`
 * row 8), so the own event reaches the context the kernel hands the factories and `emit` is the
 * kernel's own, scenes-typed one. No member of the context is cast.
 */
export type KernelSlice = PluginCtx<Config, State, Events> & {
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
