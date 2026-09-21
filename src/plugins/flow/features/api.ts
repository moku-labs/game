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
 * @example
 * ```ts
 * assertRegistrable(ctx.state.features, "board");
 * ```
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
 * const contribution = contributionOf("board", description, "afterWin");
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
 * @example
 * ```ts
 * const features = createFeaturesApi(ctx);
 * features.register("board", description);
 * ```
 */
export function createFeaturesApi(ctx: FlowCtx): FeaturesApi & FeaturesInternal {
  const state = ctx.state.features;

  return {
    /**
     * Records what a feature brings. Called from the feature plugin's `onInit`, so every feature
     * is known before the graph is validated.
     *
     * @param name - Feature name. Shares the namespace with plugin names.
     * @param description - Nodes, flows and slot contributions of the feature.
     * @throws {Error} After `run()` sealed the registry, and for a duplicate name.
     * @example
     * ```ts
     * ctx.require(flowPlugin).features.register("board", description);
     * ```
     */
    register: (name: string, description: FeatureDescription): void => {
      assertRegistrable(state, name);
      state.byName.set(name, description);
    },

    /**
     * Lists every registered feature in registration order. Plugins above read it in their
     * `onStart` to pick up what they own.
     *
     * @returns A fresh list of name and description.
     * @example
     * ```ts
     * for (const { name, description } of app.flow.features.all()) collect(name, description);
     * ```
     */
    all: (): readonly { name: string; description: FeatureDescription }[] =>
      [...state.byName].map(([name, description]) => ({ name, description })),

    /**
     * Lists the sub-flows contributed to one slot, lowest `order` first. Two equal orders in one
     * slot stay in registration order here and are reported by `validate`.
     *
     * @param slotName - Name of the slot node.
     * @returns The contributions of that slot, sorted by `order`.
     * @example
     * ```ts
     * const afterWin = app.flow.features.contributions("afterWin");
     * ```
     */
    contributions: (slotName: string): readonly Contribution[] =>
      [...state.byName]
        .map(([name, description]) => contributionOf(name, description, slotName))
        .filter(entry => entry !== undefined)
        .toSorted((first, second) => first.order - second.order),

    /**
     * Closes the registry. Called once by `run()` after the graph was collected.
     *
     * @example
     * ```ts
     * modules.features.seal();
     * ```
     */
    seal: (): void => {
      state.sealed = true;
    }
  };
}
