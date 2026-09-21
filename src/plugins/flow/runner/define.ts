/**
 * @file flow/runner — authoring helpers skeleton. Pure: they produce plain data. The signatures
 * carry the compile-time graph check of spike P3.
 */
import type {
  Exit,
  FlowDefinition,
  FlowSpec,
  GameState,
  Mapped,
  NodeDefinition,
  NodeSpec,
  NodeTable,
  OutcomeTags,
  SlotNode,
  TypeTag
} from "./types";

/**
 * Creates a type tag: a value that carries only a payload type. Without a type argument the
 * payload is `void`. The tag never infers its type from the place it is written in.
 *
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const outcomes = { done: type(), orderComplete: type<{ rewardId: string }>() };
 * ```
 */
export function type<Payload = void>(): TypeTag<NoInfer<Payload>> {
  throw new Error("not implemented");
}

/**
 * Defines a node. `out` of the body has one method per declared outcome; `run` is required
 * unless `rest: true`. `Game` is bound by `defineGame<Types>()`; here it is the engine's `Json`.
 *
 * @param _spec - Input tag, outcomes, flags, inbox and the body.
 * @throws {Error} Always, until the build implements it.
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
>(_spec: NodeSpec<Game, Input, Tags>): NodeDefinition<Input, Tags, Game> {
  throw new Error("not implemented");
}

/**
 * Defines a flow. The edge table is inferred as written and checked entry by entry: a missing
 * edge, an unknown target and a payload that does not fit are compile errors with a sentence.
 *
 * @param _id - Flow id, unique in the game.
 * @param _spec - Nodes, start node, edge table, and input and outcomes when used as a node.
 * @throws {Error} Always, until the build implements it.
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
  _id: string,
  _spec: FlowSpec<Nodes, Input, FlowTags, Table>
): FlowDefinition<Input, FlowTags, Nodes> {
  throw new Error("not implemented");
}

/**
 * Edge target: leave the sub-flow with this outcome. The payload passes through to the parent.
 *
 * @param _outcome - Outcome declared by the flow.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * edges: { play: { win: exit("win"), lose: exit("lose") } }
 * ```
 */
export function exit<const Name extends string>(_outcome: Name): Exit<Name> {
  throw new Error("not implemented");
}

/**
 * Edge target: adapt the payload on the edge. The mapper's parameter is annotated by the author;
 * the annotation is checked against the outcome payload, the result against the target's input.
 *
 * @param _target - Name of a node of the same flow.
 * @param _map - Pure function from the outcome payload to the target's input.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * edges: { loadCore: { failed: to("retry", (failure: { reason: string }) => ({ why: failure.reason })) } }
 * ```
 */
export function to<const TargetName extends string, Payload, Output>(
  _target: TargetName,
  _map: (payload: Payload) => Output
): Mapped<TargetName, Payload, Output> {
  throw new Error("not implemented");
}

/**
 * Defines an extension point: a node whose body is "run the contributions of this slot in order".
 * Its single outcome is `done`.
 *
 * @param _name - Slot name features contribute to.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const afterWin = slot("afterWin");
 * ```
 */
export function slot(_name: string): SlotNode {
  throw new Error("not implemented");
}
