/**
 * @file flow/features — API factory. The registry every feature plugin writes itself into.
 */
import type { FlowCtx } from "../types";
import type {
  Contribution,
  FeatureDescription,
  FeaturesApi,
  FeaturesInternal,
  FeaturesState,
  RegisteredFeature
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
 * Refuses a parent whose sub-feature another feature already declares: a sub-feature has one
 * parent. Runs before any write, so a refused registration records nothing.
 *
 * @param state - features module state.
 * @param name - Feature name being registered.
 * @param children - The sub-features its description declares.
 * @throws {Error} When one of them is declared by another feature.
 */
function assertOneParent(
  state: FeaturesState,
  name: string,
  children: readonly { readonly name: string }[]
): void {
  for (const child of children) {
    const declared = state.parentOf.get(child.name);

    if (declared !== undefined && declared !== name) {
      throw new Error(
        `[game] Feature "${child.name}" is declared by the features "${declared}" and "${name}".\n  A sub-feature has one parent: declare it in one of them, and give the other its own ${child.name}, such as "${name}-${child.name}".`
      );
    }
  }
}

/**
 * Builds one registry entry; a top-level feature has no `parent` key at all.
 *
 * @param name - Feature name.
 * @param description - What the feature brings.
 * @param parent - The feature that declares it, when one does.
 * @returns The entry `all()` lists.
 * @example
 * ```ts
 * registeredOf("home", {}, undefined); // { name: "home", description: {} }
 * ```
 */
function registeredOf(
  name: string,
  description: FeatureDescription,
  parent: string | undefined
): RegisteredFeature {
  return parent === undefined ? { name, description } : { name, description, parent };
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
 * Creates the features API: `register` from a feature plugin's `onInit` (throws after `run()`,
 * on a duplicate name and on a sub-feature with a second parent; records the parent of each
 * declared sub-feature), `all` with the parent read at call time, `contributions` of a slot
 * sorted by `order`, and the internal `seal`.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns The public features API plus the methods injected into the runner.
 */
export function createFeaturesApi(ctx: FlowCtx): FeaturesApi & FeaturesInternal {
  const state = ctx.state.features;

  return {
    register: (name: string, description: FeatureDescription): void => {
      const children = description.features ?? [];

      // Every check before any write: a refused registration records no description and no parent.
      assertRegistrable(state, name);
      assertOneParent(state, name, children);
      state.byName.set(name, description);
      for (const child of children) state.parentOf.set(child.name, name);
    },

    all: (): readonly RegisteredFeature[] =>
      [...state.byName].map(([name, description]) =>
        registeredOf(name, description, state.parentOf.get(name))
      ),

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
