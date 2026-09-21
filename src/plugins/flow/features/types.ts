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
 * const [first]: readonly Contribution[] = app.flow.features.contributions("afterWin");
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
 *
 * @example
 * ```ts
 * const features: FeaturesState = createFeaturesState();
 * ```
 */
export type FeaturesState = {
  byName: Map<string, FeatureDescription>;
  /** True after `run()`: `register` throws. */
  sealed: boolean;
};

/**
 * features module API.
 *
 * @example
 * ```ts
 * ctx.require(flowPlugin).features.register("board", description);
 * ```
 */
export type FeaturesApi = {
  register(name: string, description: FeatureDescription): void;
  all(): readonly { name: string; description: FeatureDescription }[];
  contributions(slotName: string): readonly Contribution[];
};

/**
 * features methods injected into `runner`. Not public.
 *
 * @example
 * ```ts
 * modules.features.seal();
 * ```
 */
export type FeaturesInternal = { seal(): void };
