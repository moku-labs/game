/**
 * @file flow/features — type definitions.
 */
import type { Snapshot } from "../../model/types";
import type { AnyFlow, AnyNode } from "../runner/types";

/**
 * What a feature brings to the game. V1 keys only; keys of later milestones pass through the
 * index signature until their plugin types them.
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
