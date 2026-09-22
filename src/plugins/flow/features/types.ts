/**
 * @file flow/features — type definitions.
 */
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
 * What a feature brings to the game. The logic keys are typed here; the keys of later milestones
 * pass through the index signature until their plugin types them. `flow` stores them untouched,
 * and `logicOnly` drops them. The V2 screen plugins read five of them through the index signature:
 * `projections`, `systems` and `components` (`world`), `scenes` (`scenes`, `assets`, and the
 * scene-id check of `flow`) and `assets` (`assets`). The V3 interface keys are typed below.
 *
 * @example
 * ```ts
 * const description: FeatureDescription = {
 *   flows: [rewardFlow],
 *   contribute: { afterWin: { flow: rewardFlow, order: 10 } }
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
  /** Animations the feature owns, read by `anim`. */
  animations?: readonly FeatureAnimation[];
  /** Interface components the feature owns, read by `ui`. `components` stays the ECS key. */
  ui?: readonly FeatureComponent[];
  /** Compiled messages per locale, ready or lazy, read by `i18n`. */
  strings?: Record<string, CompiledMessagesLike | (() => Promise<unknown>)>;
  /** Text styles the feature owns, read by `text`. */
  textStyles?: FeatureTextStyles;
  [later: string]: unknown;
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
   * @param name - Feature name. Shares the namespace with plugin names.
   * @param description - Nodes, flows and slot contributions of the feature.
   * @throws {Error} After `run()` sealed the registry, and for a duplicate name.
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
   * Lists every registered feature in registration order. Plugins above read it in their
   * `onStart` to pick up what they own.
   *
   * @returns A fresh list of name and description.
   * @example
   * ```ts
   * // A plugin above collects the flows of every feature.
   * app.flow.features.all(); // [{ name: "reward", description: { flows: [rewardFlow] } }]
   * ```
   */
  all(): readonly { name: string; description: FeatureDescription }[];

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
