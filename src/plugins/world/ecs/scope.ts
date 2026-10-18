/**
 * @file world/ecs — which features are active (spec 28). A feature that writes
 * `systemsRun: "active"` runs its systems only while a node of it is on the flow stack (rule N), a
 * view of a projection it registered exists, leaving included (rule V), or `scenes` and `ui` hold
 * it for a mounted scene or a ui root (rules S and U). The scope is sized once at start; a phase
 * reads one flag per scoped system and allocates nothing.
 */
import type { FeatureDescription, FlowGraph, FlowState } from "../../flow/types";
import type { WorldCtx } from "../types";
import { asError } from "./storage";
import type { ScopeState } from "./types";

/** The keys of a description whose entries can make a feature active. */
const SOURCES = ["nodes", "flows", "scenes", "projections", "ui"] as const;

/** The release of a hold that holds nothing. */
const RELEASE_NOTHING = (): void => {};

/**
 * Creates an empty table of owners. Its own function: a collection is built outside the exported
 * declarations.
 *
 * @returns An empty map.
 */
function emptyOwners<Value>(): Map<string, Value> {
  return new Map();
}

/**
 * Sizes the scope to the features of the game, in registration order: the only allocation of the
 * scope, once per start. Whatever an earlier start left is dropped first.
 *
 * @param ctx - Domain context of the world plugin.
 */
export function openScope(ctx: WorldCtx): void {
  const scope = ctx.state.ecs.scope;
  const features = ctx.deps.flow.features.all();
  const count = features.length;

  resetScope(scope);

  for (const [at, feature] of features.entries()) {
    scope.names.push(feature.name);
    scope.index.set(feature.name, at);
  }

  scope.onStack = new Uint8Array(count);
  scope.active = new Uint8Array(count);
  scope.holds = new Int32Array(count);
  scope.views = new Int32Array(count);
  scope.dirty = true;
}

/**
 * Empties the scope in place, as a world that never started has it, and moves its generation on:
 * a release kept past this changes nothing, also once the world started again.
 *
 * @param scope - The scope.
 */
export function resetScope(scope: ScopeState): void {
  scope.generation += 1;
  scope.names.length = 0;
  scope.index.clear();
  scope.projections.clear();
  scope.owners = undefined;
  scope.ownersFailed = false;
  scope.flow = undefined;
  scope.onStack = new Uint8Array(0);
  scope.active = new Uint8Array(0);
  scope.holds = new Int32Array(0);
  scope.views = new Int32Array(0);
  scope.dirty = false;
  scope.scoped = false;
}

/**
 * The scope the systems of one feature register with: its index for `systemsRun: "active"`, -1
 * otherwise. A value outside the type (a hand-written `features.register`) is reported and its
 * systems always run.
 *
 * @param ctx - Domain context of the world plugin.
 * @param at - The feature's index.
 * @param feature - The feature and what it registered.
 * @param feature.name - Feature name, for the log entry.
 * @param feature.description - What the feature brought.
 * @returns The scope of its systems.
 */
export function scopeOf(
  ctx: WorldCtx,
  at: number,
  feature: { name: string; description: FeatureDescription }
): number {
  const run: unknown = feature.description.systemsRun;

  if (run === "active") return at;
  if (run !== undefined && run !== "always") {
    ctx.log.warn("world:bad-feature-entry", { feature: feature.name, key: "systemsRun" });
  }

  return -1;
}

/**
 * Warns about a feature whose systems wait for it to be active while nothing can make it active:
 * it has systems and `systemsRun: "active"`, and no node, flow, scene, projection or ui component.
 * The caller guards it for dev builds.
 *
 * @param ctx - Domain context of the world plugin.
 * @param feature - The feature and what it registered.
 * @param feature.name - Feature name, for the warning.
 * @param feature.description - What the feature brought.
 */
export function reportNeverActive(
  ctx: WorldCtx,
  feature: { name: string; description: FeatureDescription }
): void {
  const { name, description } = feature;
  const systems = description.systems;

  if (description.systemsRun !== "active") return;
  if (!Array.isArray(systems) || systems.length === 0) return;

  for (const key of SOURCES) {
    const list = description[key];

    if (Array.isArray(list) && list.length > 0) return;
  }

  ctx.log.warn("world:feature-never-active", {
    feature: name,
    message:
      `Feature "${name}" runs its systems only while it is active, but it has no node, flow, scene, projection or ui ` +
      `component, so nothing makes it active and its systems never run. Remove systemsRun: "active" from it.`
  });
}

/**
 * Builds the owner table of rule N from one `describe()`: flow id to node name to the index of the
 * feature that owns the node. A node without an owner, or owned by a name that is not a feature,
 * is left out.
 *
 * @param graph - The described graph.
 * @param index - Feature name to index.
 * @returns The owner table.
 */
function ownersOf(
  graph: FlowGraph,
  index: ReadonlyMap<string, number>
): Map<string, Map<string, number>> {
  const owners = emptyOwners<Map<string, number>>();

  for (const [id, flow] of Object.entries(graph.flows)) {
    const nodes = emptyOwners<number>();

    for (const [node, info] of Object.entries(flow.nodes)) {
      const at = info.owner === undefined ? undefined : index.get(info.owner);

      if (at !== undefined) nodes.set(node, at);
    }

    if (nodes.size > 0) owners.set(id, nodes);
  }

  return owners;
}

/**
 * Builds the owner table once, at the first stack that is not empty: the graph is sealed by
 * `flow.run()`. A `describe()` that throws is logged once and makes every feature count as on the
 * stack (fail-safe).
 *
 * @param ctx - Domain context of the world plugin.
 * @param scope - The scope.
 */
function buildOwners(ctx: WorldCtx, scope: ScopeState): void {
  try {
    scope.owners = ownersOf(ctx.deps.flow.describe(), scope.index);
  } catch (error) {
    scope.ownersFailed = true;
    ctx.log.error("world:scope-owners-failed", {}, asError(error));
  }
}

/**
 * Sets the stack flags of rule N from the frames of one flow state, every frame counted, the
 * outer frames of sub-flows included.
 *
 * @param ctx - Domain context of the world plugin.
 * @param scope - The scope.
 * @param stack - The frames of the flow state.
 */
function readStack(ctx: WorldCtx, scope: ScopeState, stack: FlowState["stack"]): void {
  const onStack = scope.onStack;
  const depth = stack.length;

  onStack.fill(0);

  if (depth === 0) return;
  if (scope.owners === undefined && !scope.ownersFailed) buildOwners(ctx, scope);

  const owners = scope.owners;

  if (owners === undefined) {
    onStack.fill(1);

    return;
  }

  // Per stack move: an index loop over the frozen frames, two map reads each, no iterator.
  for (let index = 0; index < depth; index += 1) {
    const frame = stack[index];
    const at = frame === undefined ? undefined : owners.get(frame.flow)?.get(frame.node);

    if (at !== undefined) onStack[at] = 1;
  }
}

/**
 * Reads the flow stack again when `flow.state()` answers a new object. The state is memoised, so a
 * frame in which the graph did not move costs one call and one comparison.
 *
 * @param ctx - Domain context of the world plugin.
 * @param scope - The scope.
 */
function readSources(ctx: WorldCtx, scope: ScopeState): void {
  const flowState = ctx.deps.flow.state();

  if (flowState === scope.flow) return;

  scope.flow = flowState;
  readStack(ctx, scope, flowState.stack);
  scope.dirty = true;
}

/**
 * Evaluates the active set at the start of a phase that runs systems: a feature is active while it
 * is on the stack, held, or has a view. Nothing moved: one call, one comparison and one flag test.
 *
 * @param ctx - Domain context of the world plugin.
 */
export function refreshScope(ctx: WorldCtx): void {
  const scope = ctx.state.ecs.scope;

  readSources(ctx, scope);

  if (!scope.dirty) return;

  const { onStack, holds, views, active } = scope;
  const count = scope.names.length;

  for (let at = 0; at < count; at += 1) {
    active[at] = onStack[at] === 1 || (holds[at] ?? 0) > 0 || (views[at] ?? 0) > 0 ? 1 : 0;
  }

  scope.dirty = false;
}

/**
 * The release of one hold: it takes the hold back once, never below 0, and only in the run it was
 * taken in. A release kept across a stop and a start finds a newer generation and changes nothing
 * (spec 28 W7.1).
 *
 * @param scope - The scope.
 * @param at - The held feature's index.
 * @returns The idempotent release.
 */
function releaseOf(scope: ScopeState, at: number): () => void {
  const hold = { released: false, generation: scope.generation };

  return (): void => {
    if (hold.released || hold.generation !== scope.generation) return;

    hold.released = true;
    scope.holds[at] = Math.max(0, (scope.holds[at] ?? 0) - 1);
    scope.dirty = true;
  };
}

/**
 * Takes one hold on a feature. A name that is not a feature holds nothing; a dev build warns.
 *
 * @param ctx - Domain context of the world plugin.
 * @param feature - The feature to keep active.
 * @returns The release.
 */
export function holdFeature(ctx: WorldCtx, feature: string): () => void {
  const scope = ctx.state.ecs.scope;
  const at = scope.index.get(feature);

  if (at === undefined) {
    // Inline and positive: a production `define` folds the guard and the warning goes.
    if (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) {
      ctx.log.warn("world:hold-unknown-feature", { feature });
    }

    return RELEASE_NOTHING;
  }

  scope.holds[at] = (scope.holds[at] ?? 0) + 1;
  scope.dirty = true;

  return releaseOf(scope, at);
}

/**
 * Whether a feature is active now, from the sources as they are at this moment. It leaves the
 * active set of the running phase alone: a source that moves inside a phase counts for the
 * systems from the next phase.
 *
 * @param ctx - Domain context of the world plugin.
 * @param feature - The feature name.
 * @returns True while it is on the stack, held or has a view; false for a name that is not a feature.
 */
export function isFeatureActive(ctx: WorldCtx, feature: string): boolean {
  const scope = ctx.state.ecs.scope;
  const at = scope.index.get(feature);

  if (at === undefined) return false;

  readSources(ctx, scope);

  return scope.onStack[at] === 1 || (scope.holds[at] ?? 0) > 0 || (scope.views[at] ?? 0) > 0;
}

/**
 * Counts a new view of a projection for the feature that registered it. A projection no feature
 * registered counts for nobody.
 *
 * @param scope - The scope.
 * @param projection - The projection name.
 */
export function viewCame(scope: ScopeState, projection: string): void {
  const at = scope.projections.get(projection);

  if (at === undefined) return;

  scope.views[at] = (scope.views[at] ?? 0) + 1;
  scope.dirty = true;
}

/**
 * Takes back the count of a despawned view, never below 0.
 *
 * @param scope - The scope.
 * @param projection - The projection name.
 */
export function viewLeft(scope: ScopeState, projection: string): void {
  const at = scope.projections.get(projection);

  if (at === undefined) return;

  scope.views[at] = Math.max(0, (scope.views[at] ?? 0) - 1);
  scope.dirty = true;
}

/**
 * Drops every view count: the projections were cleared.
 *
 * @param scope - The scope.
 */
export function viewsCleared(scope: ScopeState): void {
  scope.views.fill(0);
  scope.dirty = true;
}
