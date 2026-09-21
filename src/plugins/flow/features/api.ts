/**
 * @file flow/features — API factory. The registry every feature plugin writes itself into.
 */
import type { FlowCtx } from "../types";
import type {
  Contribution,
  FeatureDescription,
  FeaturesApi,
  FeaturesInternal,
  FeaturesState
} from "./types";

/**
 * Refuses a registration the graph can no longer take. After `run()` the registry is sealed: the
 * graph was validated and described, so a late feature would not be in it.
 *
 * @param state - features module state.
 * @param name - Feature name being registered.
 * @throws {Error} When the registry is sealed or the name is taken.
 */
function assertRegistrable(state: FeaturesState, name: string): void {
  if (state.sealed) {
    throw new Error(
      `[game] Feature "${name}" was registered after flow.run() started.\n  Register features in the feature plugin's onInit, before the app starts.`
    );
  }

  if (state.byName.has(name)) {
    throw new Error(
      `[game] Feature "${name}" is already registered.\n  Give the second feature another name.`
    );
  }
}

/**
 * Reads one feature's contribution to a slot, if it has one.
 *
 * @param feature - Name of the contributing feature.
 * @param description - What the feature brings.
 * @param slotName - Name of the slot node.
 * @returns The contribution, or `undefined` when the feature stays out of this slot.
 * @example
 * ```ts
 * contributionOf("reward", { contribute: { afterOrder: { flow, order: 10 } } }, "afterOrder");
 * // { feature: "reward", flow, order: 10 }
 * ```
 */
function contributionOf(
  feature: string,
  description: FeatureDescription,
  slotName: string
): Contribution | undefined {
  const entry = description.contribute?.[slotName];

  if (entry === undefined) return;
  if (entry.when === undefined) return { feature, flow: entry.flow, order: entry.order };

  return { feature, flow: entry.flow, order: entry.order, when: entry.when };
}

/**
 * Creates the features API: `register` from a feature plugin's `onInit` (throws after `run()`
 * and on a duplicate name), `all`, `contributions` of a slot sorted by `order`, and the internal
 * `seal`.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns The public features API plus the methods injected into the runner.
 */
export function createFeaturesApi(ctx: FlowCtx): FeaturesApi & FeaturesInternal {
  const state = ctx.state.features;

  return {
    register: (name: string, description: FeatureDescription): void => {
      assertRegistrable(state, name);
      state.byName.set(name, description);
    },

    all: (): readonly { name: string; description: FeatureDescription }[] =>
      [...state.byName].map(([name, description]) => ({ name, description })),

    contributions: (slotName: string): readonly Contribution[] =>
      [...state.byName]
        .map(([name, description]) => contributionOf(name, description, slotName))
        .filter(entry => entry !== undefined)
        .toSorted((first, second) => first.order - second.order),

    seal: (): void => {
      state.sealed = true;
    }
  };
}
