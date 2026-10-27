/**
 * @file flow/runner — authoring helpers. Pure: they produce plain data. The signatures carry the
 * compile-time graph check of spike P3.
 */
import type { Json, Snapshot } from "../../model/types";
import type { ContributionSpec } from "../features/types";
import type {
  AnyFlow,
  AnyTypeTag,
  Exit,
  Fits,
  FlowDefinition,
  FlowEntry,
  FlowSpec,
  GameState,
  Mapped,
  NodeDefinition,
  NodeSpec,
  NodeTable,
  OutcomeTags,
  Result,
  SlotNode,
  Target,
  TypeTag
} from "./types";

/**
 * A flow spec as the builder reads it, with the graph check already done. It is the widened form
 * of `FlowSpec`: the implementation signature of `defineFlow`, never the signature authors see.
 */
type AnyFlowSpec = {
  nodes: Readonly<Record<string, FlowEntry>>;
  start: string;
  edges: Readonly<Record<string, Readonly<Record<string, Target>>>>;
  input?: AnyTypeTag;
  outcomes?: OutcomeTags;
};

/** The payload of an outcome whose body passed no data. */
// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

/**
 * Creates a type tag: a value that carries only a payload type. Without a type argument the
 * payload is `void`. The tag never infers its type from the place it is written in.
 *
 * @returns A tag that carries the payload type and no value.
 * @example
 * ```ts
 * // The outcomes of a node: `done` carries nothing, `orderComplete` carries the reward id.
 * const outcomes = { done: type(), orderComplete: type<{ rewardId: string }>() };
 * // outcomes.done: { kind: "type" }. The payload type exists for the compiler only.
 * ```
 */
export function type<Payload = void>(): TypeTag<NoInfer<Payload>> {
  return { kind: "type" };
}

/**
 * Defines a node. `out` of the body has one method per declared outcome; `run` is required
 * unless `rest: true`. A rest node may carry `recover`: the engine runs it before the node is
 * entered as the safe node. `guide` derives the tutorial guide that stands while the node does.
 * `Game` is bound by `defineGame<Types>()`; here it is the engine's `Json`.
 *
 * @param spec - Input tag, outcomes, flags, inbox and the body.
 * @returns The node as plain data.
 * @example
 * ```ts
 * // A transit node of a merge game. `out` has one method per declared outcome.
 * const merge = defineNode({
 *   input: type<{ from: string; to: string }>(),
 *   outcomes: { done: type(), rejected: type() },
 *   run: ({ input, out }) => (input.from === input.to ? out.rejected() : out.done())
 * });
 *
 * // A rest node names the scene it is shown on; a node without `scene` keeps the current one.
 * const awaitIntent = defineNode({ scene: "board", rest: true, outcomes: { merge: type() } });
 * ```
 */
export function defineNode<
  Input = void,
  const Tags extends OutcomeTags = OutcomeTags,
  Game extends GameState = GameState
>(spec: NodeSpec<Game, Input, Tags>): NodeDefinition<Input, Tags, Game> {
  const node: NodeDefinition<Input, Tags, Game> = {
    kind: "node",
    input: spec.input ?? type<Input>(),
    outcomes: spec.outcomes,
    rest: spec.rest === true,
    over: spec.over === true,
    checkpoint: spec.checkpoint === true,
    barrier: spec.barrier === true,
    inbox: spec.inbox ?? [],
    // `exactOptionalPropertyTypes`: the key is absent, never present with `undefined`.
    ...(spec.scene === undefined ? {} : { scene: spec.scene }),
    ...(spec.recover === undefined ? {} : { recover: spec.recover }),
    ...(spec.guide === undefined ? {} : { guide: spec.guide })
  };

  return spec.run ? { ...node, run: spec.run } : node;
}

/**
 * Defines a flow. The edge table is inferred as written and checked entry by entry: a missing
 * edge, an unknown target and a payload that does not fit are compile errors with a sentence.
 *
 * @param id - Flow id, unique in the game.
 * @param spec - Nodes, start node, edge table, and input and outcomes when used as a node.
 * @returns The flow as plain data.
 * @example
 * ```ts
 * // The main flow of a dice game. A missing edge or an unknown target is a compile error.
 * const mainFlow = defineFlow("main", {
 *   nodes: { home, roll },
 *   start: "home",
 *   edges: { home: { roll: "roll" }, roll: { done: "home" } }
 * });
 * ```
 */
export function defineFlow<
  Nodes extends NodeTable,
  Input = void,
  const FlowTags extends OutcomeTags = Record<never, never>,
  const Table = Record<never, never>
>(
  id: string,
  spec: FlowSpec<Nodes, Input, FlowTags, Table>
): FlowDefinition<Input, FlowTags, Nodes>;
/**
 * Builds the flow. The body works on the widened shapes the runner reads: `CheckedEdges` has
 * already proved the table entry by entry, and no type assertion is needed to store it.
 *
 * @param id - Flow id, unique in the game.
 * @param spec - Nodes, start node, edge table, input and outcomes.
 * @returns The flow as plain data.
 */
export function defineFlow(id: string, spec: AnyFlowSpec): AnyFlow {
  return {
    kind: "flow",
    id,
    input: spec.input ?? type(),
    outcomes: spec.outcomes ?? {},
    nodes: spec.nodes,
    start: spec.start,
    edges: spec.edges
  };
}

/**
 * Edge target: leave the sub-flow with this outcome. The payload passes through to the parent.
 *
 * @param outcome - Outcome declared by the flow.
 * @returns The exit target as plain data.
 * @example
 * ```ts
 * // Inside the sub-flow "board": the intent "leave" ends the flow with its outcome "left".
 * edges: { awaitIntent: { leave: exit("left") } } // the target: { kind: "exit", outcome: "left" }
 * // The parent flow then follows its own edge: board: { left: "home" }.
 * ```
 */
export function exit<const Name extends string>(outcome: Name): Exit<Name> {
  return { kind: "exit", outcome };
}

/**
 * Edge target: adapt the payload on the edge. The mapper's parameter is annotated by the author;
 * the annotation is checked against the outcome payload, the result against the target's input.
 *
 * @param target - Name of a node of the same flow.
 * @param map - Pure function from the outcome payload to the target's input.
 * @returns The mapped target as plain data.
 * @example
 * ```ts
 * // "loadCore" fails with { reason }, "retry" takes { why }: the edge adapts the payload.
 * edges: { loadCore: { failed: to("retry", (failure: { reason: string }) => ({ why: failure.reason })) } }
 * // to("retry", map): { kind: "map", target: "retry", map }
 * ```
 */
export function to<const TargetName extends string, Payload, Output>(
  target: TargetName,
  map: (payload: Payload) => Output
): Mapped<TargetName, Payload, Output> {
  return { kind: "map", target, map };
}

/**
 * Defines an extension point: a node whose body is "run the contributions of this slot in order".
 * Its outcomes are `done` and the ones declared here; the flow that holds the slot gives each an
 * edge. A contribution that exits `done` hands over to the next contribution whose `when` holds,
 * and with none left the slot takes its `done` edge. A contribution that exits a declared outcome
 * leaves the slot at once with its payload: the later contributions do not run, and the slot takes
 * its own edge of that outcome, journalled like `done`. The next entry of the slot starts again at
 * its first contribution. Without `outcomes` the slot declares only `done`.
 *
 * @param name - Slot name features contribute to.
 * @param outcomes - The named outcomes besides `done`, with the type tag of each payload.
 * @returns The slot node as plain data.
 * @throws {TypeError} When `outcomes` declares `done`, which is every slot's own outcome.
 * @example
 * ```ts
 * // After an order a feature may send the player to the shop, on the tab it names.
 * slot("afterOrder", { shop: type<{ tab: string }>() });
 * // { kind: "slot", name: "afterOrder", input: { kind: "type" },
 * //   outcomes: { done: { kind: "type" }, shop: { kind: "type" } } }
 * ```
 */
export function slot<
  const Name extends string,
  const Tags extends OutcomeTags = Record<never, never>
>(name: Name, outcomes?: Tags & { readonly done?: never }): SlotNode<Tags, Name>;
/**
 * Builds the slot. The body works on the widened shapes the runner reads: the signature above has
 * already kept `done` out of the declared outcomes for a typed caller, and the check here refuses
 * it past a cast.
 *
 * @param name - Slot name features contribute to.
 * @param outcomes - The named outcomes besides `done`.
 * @returns The slot node as plain data.
 * @throws {TypeError} When `outcomes` declares `done`.
 */
export function slot(name: string, outcomes?: OutcomeTags): SlotNode<OutcomeTags> {
  if (outcomes !== undefined && Object.hasOwn(outcomes, "done")) {
    throw new TypeError(
      `[game] Slot "${name}" declares the outcome "done".\n  done is every slot's own outcome; remove it from slot("${name}", ...).`
    );
  }

  return { kind: "slot", name, input: type(), outcomes: { done: type(), ...outcomes } };
}

/**
 * Builds one typed entry of a feature's `contribute`: the flow a slot runs, under the slot's
 * name. The compiler checks every outcome of the flow: `done`, or an outcome the slot declares
 * whose payload fits; a slot that declares none accepts any flow. A raw `contribute` entry stays
 * valid and is checked by name at `run()` only.
 *
 * @param host - The slot node the flow runs in, as `slot()` returned it.
 * @param spec - The flow, its `order` among the slot's contributions and an optional `when`.
 * @param spec.flow - The contributed flow; an outcome the slot does not take is a compile error.
 * @param spec.order - Place among the contributions of the slot, lowest first.
 * @param spec.when - Skips the contribution while it returns false, read on the committed state.
 * @returns `{ [host.name]: spec }`, spread into `contribute`; no `when` key when none was given.
 * @example
 * ```ts
 * // The story feature fills the episode step of the main flow: spread the entry into contribute.
 * contribution(episodeStep, { flow: storyFlow, order: 10 });
 * // { episodeStep: { flow: storyFlow, order: 10 } }
 * contribute: { ...contribution(episodeStep, { flow: storyFlow, order: 10 }) }
 * ```
 */
export function contribution<S extends SlotNode<OutcomeTags, string>, F extends AnyFlow>(
  host: S,
  spec: { flow: F & Fits<F, S>; order: number; when?: (snapshot: Snapshot) => boolean }
): Readonly<Record<S["name"], ContributionSpec>>;
/**
 * Builds the entry. The body works on the widened shapes the runner reads: the signature above
 * has already checked the flow against the slot.
 *
 * @param host - The slot node the flow runs in.
 * @param spec - The flow, its `order` and an optional `when`.
 * @returns The entry under the slot's name.
 */
export function contribution(
  host: SlotNode,
  spec: ContributionSpec
): Readonly<Record<string, ContributionSpec>> {
  const { flow, order, when } = spec;

  // `exactOptionalPropertyTypes`: the key is absent, never present with `undefined`.
  return { [host.name]: when === undefined ? { flow, order } : { flow, order, when } };
}

/**
 * Builds the `out` of a node context: one method per declared outcome. A method called without
 * data produces a `null` payload. Called by the loop when it enters a node, never by a game.
 *
 * @param outcomes - The outcome table of the node being entered.
 * @returns One result builder per outcome name.
 * @example
 * ```ts
 * createOut({ done: type() }).done?.(); // { outcome: "done", payload: null }
 * ```
 */
export function createOut(
  outcomes: OutcomeTags
): Readonly<Record<string, (payload?: Json) => Result>> {
  const out: Record<string, (payload?: Json) => Result> = {};

  for (const outcome of Object.keys(outcomes)) {
    /**
     * Ends the node with this outcome.
     *
     * @param payload - Data for the next node; absent when the outcome carries none.
     * @returns The result the runner reads to find the edge.
     */
    out[outcome] = (payload?: Json): Result => ({ outcome, payload: payload ?? noPayload });
  }

  return out;
}
