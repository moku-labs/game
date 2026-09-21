/**
 * @file flow/runner — authoring helpers. Pure: they produce plain data. The signatures carry the
 * compile-time graph check of spike P3.
 */
import type { Json } from "../../model/types";
import type {
  AnyFlow,
  AnyTypeTag,
  Exit,
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
 *
 * @example
 * ```ts
 * const spec: AnyFlowSpec = { nodes, start: "boot", edges: { boot: { done: "home" } } };
 * ```
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
 * const outcomes = { done: type(), orderComplete: type<{ rewardId: string }>() };
 * ```
 */
export function type<Payload = void>(): TypeTag<NoInfer<Payload>> {
  return { kind: "type" };
}

/**
 * Defines a node. `out` of the body has one method per declared outcome; `run` is required
 * unless `rest: true`. `Game` is bound by `defineGame<Types>()`; here it is the engine's `Json`.
 *
 * @param spec - Input tag, outcomes, flags, inbox and the body.
 * @returns The node as plain data.
 * @example
 * ```ts
 * const merge = defineNode({
 *   input: type<{ from: string; to: string }>(),
 *   outcomes: { done: type(), rejected: type() },
 *   run: ({ out }) => out.done()
 * });
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
    inbox: spec.inbox ?? []
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
 * const mainFlow = defineFlow("main", {
 *   nodes: { boot, home },
 *   start: "boot",
 *   edges: { boot: { done: "home" }, home: { play: "boot" } }
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
 * @example
 * ```ts
 * const flow = defineFlow("level", { nodes, start: "prepare", edges });
 * ```
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
 * edges: { play: { win: exit("win"), lose: exit("lose") } }
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
 * edges: { loadCore: { failed: to("retry", (failure: { reason: string }) => ({ why: failure.reason })) } }
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
 * Its single outcome is `done`.
 *
 * @param name - Slot name features contribute to.
 * @returns The slot node as plain data.
 * @example
 * ```ts
 * const afterWin = slot("afterWin");
 * ```
 */
export function slot(name: string): SlotNode {
  return { kind: "slot", name, input: type(), outcomes: { done: type() } };
}

/**
 * Builds the `out` of a node context: one method per declared outcome. A method called without
 * data produces a `null` payload. Called by the loop when it enters a node, never by a game.
 *
 * @param outcomes - The outcome table of the node being entered.
 * @returns One result builder per outcome name.
 * @example
 * ```ts
 * const out = createOut(node.outcomes);
 * const result = await node.run({ ...ctx, out });
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
     * @example
     * ```ts
     * return out.done();
     * ```
     */
    out[outcome] = (payload?: Json): Result => ({ outcome, payload: payload ?? noPayload });
  }

  return out;
}
