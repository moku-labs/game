/**
 * @file flow/features — type definitions.
 */
import type { AnyPluginInstance } from "@moku-labs/core";
import type { Snapshot } from "../../model/types";
import type { AnyFlow, AnyNode } from "../runner/types";

/**
 * One animation of a feature, as `defineAnimation` returns it. Structural on purpose: `flow`
 * stores what the game brought and never imports `anim`, which reads the rest of the object.
 *
 * @example
 * ```ts
 * const coinsFly: FeatureAnimation = { id: "coinsFly" };
 * ```
 */
export type FeatureAnimation = { readonly id: string };

/**
 * One particle emitter of a feature, as `defineEmitter` returns it. Structural on purpose: `flow`
 * stores what the game brought and never imports `effects`, which reads the rest of the object.
 *
 * @example
 * ```ts
 * const coins: FeatureEmitter = { id: "coins" };
 * ```
 */
export type FeatureEmitter = { readonly id: string };

/**
 * One filter a feature puts on an interface component: the component by name and the filter as
 * `defineFilter` returns it. Structural on purpose: `effects` reads the filter, `flow` only carries it.
 *
 * @example
 * ```ts
 * const glow: FeatureFilter = { componentName: "RewardPopup", filter: { id: "glow" } };
 * ```
 */
export type FeatureFilter = {
  readonly componentName: string;
  readonly filter: { readonly id: string };
};

/**
 * One interface component of a feature, as `defineComponent` returns it. Structural on purpose:
 * `ui` reads the rest of the object, `flow` only carries it.
 *
 * @example
 * ```ts
 * const rewardPopup: FeatureComponent = { name: "RewardPopup" };
 * ```
 */
export type FeatureComponent = { readonly name: string };

/**
 * The compiled messages of one locale: message key to what `compileStrings` wrote for it. The
 * value stays opaque here because only `i18n` calls it; `flow` passes the module on untouched.
 *
 * @example
 * ```ts
 * const en: CompiledMessagesLike = { "board.title": () => [{ kind: "text", text: "Board" }] };
 * ```
 */
export type CompiledMessagesLike = { readonly [key: string]: unknown };

/**
 * The text styles of a feature, as `defineTextStyles` returns them. Structural on purpose: `text`
 * reads the fields of each style, `flow` only carries the map.
 *
 * @example
 * ```ts
 * const styles: FeatureTextStyles = { kind: "textStyles", map: { title: { size: 24 } } };
 * ```
 */
export type FeatureTextStyles = {
  readonly kind: "textStyles";
  readonly map: Record<string, object>;
};

/**
 * When the systems of a feature run. `"always"` (the default): every frame, as before. `"active"`: only while the
 * feature is active — a node of it is on the flow stack, a scene it declares is mounted, a view of a projection it
 * registered exists, or `ui` holds a popup or a JSX root of it — leaving included, until the last view is gone.
 * Skipping changes nothing the flow sees: systems never write the model. The systems the engine's plugins
 * register always run.
 *
 * @example
 * ```ts
 * // features/board/index.ts: the board's four systems stop on the ward and on the splash.
 * export const boardFeature = defineFeature("board", {
 *   flows: [mergeBoard],
 *   systems: [looks, fade, leaving, veil],
 *   systemsRun: "active"
 * });
 * ```
 */
export type SystemsRun = "always" | "active";

/**
 * What a feature brings to the game. The logic keys are typed here; the keys of later milestones
 * pass through the index signature until their plugin types them. `flow` stores them untouched,
 * and `logicOnly` drops them. The V2 screen plugins read five of them through the index signature:
 * `projections`, `systems` and `components` (`world`), `scenes` (`scenes`, `assets`, and the
 * scene-id check of `flow`) and `assets` (`assets`). `world` also reads the typed `systemsRun`.
 * The V3 interface keys are typed below.
 *
 * @example
 * ```ts
 * const description: FeatureDescription = {
 *   flows: [rewardFlow],
 *   contribute: { afterWin: { flow: rewardFlow, order: 10 } },
 *   features: [kitFeature, ep01Feature]
 * };
 * ```
 */
export type FeatureDescription = {
  /** Nodes the feature owns. Recorded for `describe()` and hot swap. */
  nodes?: readonly AnyNode[];
  /** Flows the feature owns. */
  flows?: readonly AnyFlow[];
  /** Slot name to the sub-flow run in that slot. */
  contribute?: Record<
    string,
    { flow: AnyFlow; order: number; when?: (snapshot: Snapshot) => boolean }
  >;
  /**
   * Sub-features this feature declares, each in a folder of its own inside this feature's folder,
   * in the order they are composed. `defineGameApp` composes them right after this feature; this
   * feature's `onInit` throws when one of them is not composed.
   */
  features?: readonly FeaturePlugin[];
  /** Animations the feature owns, read by `anim`. */
  animations?: readonly FeatureAnimation[];
  /** Interface components the feature owns, read by `ui`. `components` stays the ECS key. */
  ui?: readonly FeatureComponent[];
  /** Compiled messages per locale, ready or lazy, read by `i18n`. */
  strings?: Record<string, CompiledMessagesLike | (() => Promise<unknown>)>;
  /** Text styles the feature owns, read by `text`. */
  textStyles?: FeatureTextStyles;
  /** Particle emitters the feature owns, read by `effects`. */
  emitters?: readonly FeatureEmitter[];
  /** Filters the feature puts on its interface components, read by `effects`. */
  filters?: readonly FeatureFilter[];
  /** When the feature's systems run, read by `world`. Absent is `"always"`. */
  systemsRun?: SystemsRun;
  [later: string]: unknown;
};

/**
 * A feature is an ordinary plugin with no API of its own; `AnyPluginInstance` is the kernel's
 * widened type for plugin lists. It carries the sub-features it declares and its `logicOnly` twin,
 * so `flattenFeatures` composes the whole tree, full or logic only.
 *
 * @example
 * ```ts
 * createApp({ plugins: flattenFeatures([episodesFeature.logicOnly]) }); // episodes, kit, ep01, ep02
 * ```
 */
export type FeaturePlugin = AnyPluginInstance & {
  /** The same plugin reduced to the logic keys; its `features` are the children's `logicOnly`. */
  readonly logicOnly: FeatureTree;
  /** The declared sub-features, in declaration order; empty for a leaf. */
  readonly features: readonly FeaturePlugin[];
};

/**
 * One sub-flow contributed to a slot.
 *
 * @example
 * ```ts
 * const contribution: Contribution = { feature: "reward", flow: rewardFlow, order: 10 };
 * ```
 */
export type Contribution = {
  feature: string;
  flow: AnyFlow;
  order: number;
  when?: (snapshot: Snapshot) => boolean;
};

/**
 * features module state.
 */
export type FeaturesState = {
  byName: Map<string, FeatureDescription>;
  /** Sub-feature name to the name of the feature that declares it, whatever the registration order. */
  parentOf: Map<string, string>;
  /** True after `run()`: `register` throws. */
  sealed: boolean;
};

/**
 * features module API, `app.flow.features`: the registry every feature plugin writes itself into.
 *
 * @example
 * ```ts
 * // The game composed `rewardFeature`. A plugin above asks in its onStart what the game brought.
 * app.flow.features.all().map(feature => feature.name); // ["reward"]
 * ```
 */
export type FeaturesApi = {
  /**
   * Records what a feature brings. Called from the feature plugin's `onInit`, so every feature
   * is known before the graph is validated.
   *
   * A description with `features` records this feature as the parent of each of them.
   *
   * @param name - Feature name. Shares the namespace with plugin names.
   * @param description - Nodes, flows and slot contributions of the feature.
   * @throws {Error} After `run()` sealed the registry, for a duplicate name, and when one of
   *   `description.features` is already declared by another feature. A refused registration
   *   writes nothing.
   * @example
   * ```ts
   * // A hand-written feature plugin registers itself in onInit. `defineFeature` does the same.
   * const rewardPlugin = createPlugin("reward", {
   *   depends: [flowPlugin],
   *   onInit: ctx => ctx.require(flowPlugin).features.register("reward", { flows: [rewardFlow] })
   * });
   * ```
   */
  register(name: string, description: FeatureDescription): void;

  /**
   * Lists every registered feature in registration order, a sub-feature with the name of the
   * feature that declares it. Plugins above read it in their `onStart` to pick up what they own.
   *
   * @returns A fresh list of name, description and, for a sub-feature, `parent`.
   * @example
   * ```ts
   * // The game composed homeFeature and episodesFeature, whose sub-features are kit and ep01.
   * app.flow.features.all().map(({ name, parent }) => (parent === undefined ? name : `${parent}/${name}`));
   * // ["home", "episodes", "episodes/kit", "episodes/ep01"]
   * ```
   */
  all(): readonly RegisteredFeature[];

  /**
   * Lists the sub-flows contributed to one slot, lowest `order` first. Two equal orders in one
   * slot stay in registration order here and are reported by `validate`.
   *
   * @param slotName - Name of the slot node.
   * @returns The contributions of that slot, sorted by `order`.
   * @example
   * ```ts
   * // What runs when the graph enters slot("afterOrder").
   * app.flow.features.contributions("afterOrder");
   * // [{ feature: "reward", flow: rewardFlow, order: 10 }]
   * app.flow.features.contributions("afterLoss"); // []: no feature contributes to this slot
   * ```
   */
  contributions(slotName: string): readonly Contribution[];
};

/**
 * features methods injected into `runner`. Not public.
 */
export type FeaturesInternal = {
  /**
   * Closes the registry. Called once by `run()` after the graph was collected.
   */
  seal(): void;
};

/**
 * A feature plugin with the sub-features it declares, as `flattenFeatures` reads it: a full plugin or its `logicOnly`.
 *
 * @example
 * ```ts
 * const tree: FeatureTree = episodesFeature.logicOnly;
 * tree.features.map(child => child.name); // ["kit", "ep01", "ep02"]
 * ```
 */
export type FeatureTree = AnyPluginInstance & { readonly features: readonly FeatureTree[] };

/**
 * One entry of the feature registry: the name, the description and, for a sub-feature, the feature that declares it.
 *
 * @example
 * ```ts
 * const entry: RegisteredFeature = { name: "ep01", description: { flows: [ep01Flow] }, parent: "episodes" };
 * ```
 */
export type RegisteredFeature = {
  name: string;
  description: FeatureDescription;
  /** Name of the feature that declares this one in its `features`; absent for a top-level feature. */
  parent?: string;
};
