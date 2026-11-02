/**
 * @file flow/runner — type definitions: the strict graph types of the authoring helpers
 * (spike P3) and the widened run-time types of the runner.
 */
import type { Json, RngState, RngView } from "../../model/types";
import type { FeaturesApi, FeaturesInternal } from "../features/types";
import type { FxApi, FxInternal, GuideOptions, NodeFx } from "../fx/types";
import type { GateApi, GateInternal, GateSpec } from "../gate/types";
import type { InboxApi, InboxInternal } from "../inbox/types";

// ─── Type tags ────────────────────────────────────────────────

/**
 * A value that carries only a type. Invariant in `Payload`, so `{ stars }` never passes for
 * `{ stars, moves }` in either direction.
 *
 * @example
 * ```ts
 * const stars: TypeTag<{ stars: number }> = type<{ stars: number }>();
 * ```
 */
export type TypeTag<Payload> = {
  readonly kind: "type";
  readonly $type?: (value: Payload) => Payload;
};

/**
 * Any type tag. The bound of tag records: it names no payload, so `type()` infers nothing from it.
 */
export type AnyTypeTag = { readonly kind: "type" };

/**
 * Outcome name to the type tag of its payload.
 *
 * @example
 * ```ts
 * const outcomes = { done: type(), failed: type<{ reason: string }>() } satisfies OutcomeTags;
 * ```
 */
export type OutcomeTags = Readonly<Record<string, AnyTypeTag>>;

/**
 * The payload type carried by a type tag.
 *
 * @example
 * ```ts
 * type Reason = PayloadOf<TypeTag<{ reason: string }>>; // { reason: string }
 * ```
 */
export type PayloadOf<Tag> = Tag extends TypeTag<infer Payload> ? Payload : never;

// ─── Node ─────────────────────────────────────────────────────

/**
 * The part of the game types a node sees. Inside the engine both trees are `Json`;
 * `defineGame<Types>()` narrows them for the game at the type level only.
 *
 * @example
 * ```ts
 * const game: GameState = { player: { lives: 3 }, session: { visits: 0 } };
 * ```
 */
export type GameState = { player: Json; session: Json; scenes?: string };

/**
 * The scene ids a game declared, `string` when it declared none.
 *
 * @example
 * ```ts
 * type Ids = SceneIdOf<{ player: {}; session: {}; scenes: "home" | "board" }>; // "home" | "board"
 * ```
 */
export type SceneIdOf<Game extends GameState> = Game extends { scenes: infer Ids extends string }
  ? Ids
  : string;

/**
 * Whether a payload or input type is `void`: an outcome without data, a node without input.
 *
 * @example
 * ```ts
 * type Empty = IsVoid<PayloadOf<TypeTag<void>>>; // true
 * ```
 */
type IsVoid<Payload> =
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` is the payload type of `type()`, compared on purpose
  [Payload] extends [void] ? true : false;

/**
 * What `out.name(data)` returns. `run` must return one of these; a bare string is not accepted.
 * `Name` is the union of the node's outcome names; without a type argument it is the widened
 * result the runner reads.
 *
 * @example
 * ```ts
 * // What `out.rejected({ reason: "empty" })` returns, and what the journal keeps of the edge.
 * const result: Result = { outcome: "rejected", payload: { reason: "empty" } };
 * ```
 */
export type Result<Name extends string = string> = {
  readonly outcome: Name;
  readonly payload: Json;
};

/**
 * The `out` of a node context: one method per declared outcome, without an argument when the
 * payload is `void`.
 *
 * @example
 * ```ts
 * // In a node with outcomes { done: type(), rejected: type<{ reason: string }>() }:
 * out.done(); // { outcome: "done", payload: null }
 * out.rejected({ reason: "empty" }); // { outcome: "rejected", payload: { reason: "empty" } }
 * ```
 */
export type Out<Tags extends OutcomeTags> = {
  readonly [Name in keyof Tags]: IsVoid<PayloadOf<Tags[Name]>> extends true
    ? () => Result<keyof Tags & string>
    : (data: PayloadOf<Tags[Name]>) => Result<keyof Tags & string>;
};

/**
 * The one object a node body receives. `player` and `session` are drafts of the open
 * transaction, `rng` is its view, `now` is `clock.now()` read once at node entry.
 *
 * @example
 * ```ts
 * // The "roll" node of a dice game: the drafts are written in place, the edge commits them.
 * run: async ({ player, session, rng, fx, out }) => {
 *   const loaded = await fx(load("board")); // LoadResult | undefined
 *   player.coins += rng.stream("dice").range(1, 6);
 *   session.rolls += 1;
 *   session.loadedMb = loaded?.mb ?? 0;
 *   return out.done();
 * }
 * ```
 */
export type NodeContext<
  Game extends GameState = GameState,
  Input = void,
  Tags extends OutcomeTags = OutcomeTags
> = {
  input: Input;
  player: Game["player"];
  session: Game["session"];
  rng: RngView;
  fx: NodeFx;
  out: Out<Tags>;
  signal: AbortSignal;
  now: number;
};

/**
 * The body of a node: plain `await` code that ends with `out.name(data)`.
 */
export type NodeRun<Game extends GameState, Input, Tags extends OutcomeTags> = (
  ctx: NodeContext<Game, Input, Tags>
) => Result<keyof Tags & string> | Promise<Result<keyof Tags & string>>;

/**
 * The one object the `recover` of a rest node receives: the node context without `input` and
 * `out`. The transition that led here failed, so there is no input, and a recovery ends with no
 * outcome: the node is entered right after it. `player` and `session` are drafts of the
 * recovery's own transaction, `now` is `clock.now()` read once when the recovery starts.
 *
 * @example
 * ```ts
 * // The safe node "home" of a board game. The board failed: the session still says "board".
 * recover: ({ session }: RecoverContext<Game>) => {
 *   session.screen = "home";
 *   session.moves = [];
 * }
 * ```
 */
export type RecoverContext<Game extends GameState = GameState> = {
  player: Game["player"];
  session: Game["session"];
  rng: RngView;
  fx: NodeFx;
  signal: AbortSignal;
  now: number;
};

/**
 * The recovery of a rest node: plain `await` code that puts the state right and returns nothing.
 */
export type NodeRecover<Game extends GameState> = (
  context: RecoverContext<Game>
) => void | Promise<void>;

/**
 * The guide of a node, derived from the committed state: the options while the node stands, or
 * `undefined` for none. `player` and `session` are the committed trees, frozen.
 */
export type NodeGuide<Game extends GameState> = (state: {
  player: Game["player"];
  session: Game["session"];
}) => GuideOptions | undefined;

/**
 * The part of a node, or of a flow used as a node, that an edge table looks at.
 */
export type Wired<Input, Tags extends OutcomeTags> = {
  readonly input: TypeTag<Input>;
  readonly outcomes: Tags;
};

/**
 * Anything that can sit in the `nodes` of a flow: a node, a sub-flow or a slot.
 */
export type AnyWired = { readonly input: AnyTypeTag; readonly outcomes: OutcomeTags };

/**
 * Node name to node: the `nodes` of one flow.
 */
export type NodeTable = Readonly<Record<string, AnyWired>>;

/**
 * A node as `defineNode` returns it: plain data plus the optional body.
 *
 * @example
 * ```ts
 * // What defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true }) returns:
 * // { kind: "node", input: { kind: "type" }, outcomes: { play: { kind: "type" } }, rest: true,
 * //   over: false, checkpoint: true, barrier: false, inbox: [] }
 * ```
 */
export type NodeDefinition<
  Input,
  Tags extends OutcomeTags,
  Game extends GameState = GameState
> = Wired<Input, Tags> & {
  readonly kind: "node";
  readonly rest: boolean;
  readonly over: boolean;
  readonly checkpoint: boolean;
  readonly barrier: boolean;
  readonly inbox: readonly (keyof Tags & string)[];
  /** Id of the scene the node is shown on. Absent: the node keeps the current scene. */
  readonly scene?: string;
  readonly run?: NodeRun<Game, Input, Tags>;
  /** The recovery of a rest node. Absent: the node is entered as it is after a failure. */
  readonly recover?: NodeRecover<Game>;
  /** The guide that stands while the node does, derived from state. Absent: the node shows none. */
  readonly guide?: NodeGuide<Game>;
};

/**
 * What the author passes to `defineNode`. `run` is required unless `rest: true`: a rest node
 * without a body is a pure wait. `recover` exists on a rest node only.
 *
 * @example
 * ```ts
 * const spec: NodeSpec<Game, void, { play: TypeTag<void> }> = {
 *   rest: true,
 *   checkpoint: true,
 *   scene: "home",
 *   outcomes: { play: type() }
 * };
 * ```
 */
export type NodeSpec<Game extends GameState, Input, Tags extends OutcomeTags> = {
  input?: TypeTag<Input>;
  outcomes: Tags;
  over?: boolean;
  checkpoint?: boolean;
  barrier?: boolean;
  inbox?: readonly (keyof Tags & string)[];
  /** Id of the scene this node is shown on. Without it the node keeps the current scene. */
  scene?: SceneIdOf<Game>;
  /**
   * Derives the guide that stands while this node does, from the committed state: a tutorial step
   * that is data, with no `run` and no save field of its own. The engine calls it when the node is
   * entered, after its `onEnter` stages, and again after a commit while the node waits at its
   * gate; a result equal to the last one (deep JSON equality) changes nothing, a new one replaces
   * the guide, `undefined` lifts it. The guide goes when the node is left, and a restore enters the
   * node again, so it is derived again. It narrows the gate to `allow` and `blocked` and hands the
   * options to the `guide` handler of `ui`; in fast mode only the narrow applies. A `guide` that
   * throws fails the node: rollback and retry, as a body that throws. Meant for a rest node; any
   * node may carry one.
   *
   * @param state - The committed `player` and `session`, frozen.
   * @param state.player - The committed player tree.
   * @param state.session - The committed session tree.
   * @returns The guide while the node stands, or `undefined` for none.
   * @example
   * ```ts
   * // The board rests; the tutorial's step is in the session: step 2 teaches the merge of c2 into c3.
   * const awaitIntent = defineNode({
   *   rest: true,
   *   outcomes: { merge: type<{ from: string; to: string }>(), tutorialBlocked: type() },
   *   guide: ({ session }) =>
   *     session.tutorial === 2
   *       ? {
   *           allow: { intent: "merge", payload: { from: "c2", to: "c3" } },
   *           target: [{ projection: "board.items", key: "c2" }, { projection: "board.items", key: "c3" }],
   *           blocked: { intent: "tutorialBlocked" }
   *         }
   *       : undefined
   * });
   * // session.tutorial 2: app.flow.gate.state().narrowed is true, a press beside the two items answers "tutorialBlocked"
   * ```
   */
  guide?(state: { player: Game["player"]; session: Game["session"] }): GuideOptions | undefined;
} & (
  | {
      rest: true;
      run?: NodeRun<Game, Input, Tags>;
      /**
       * Puts the state right before this node is entered as the safe node. When a transition
       * failed and its retries are used up, the graph rolls back to the rest point that failed
       * and moves to `flow.safeNode`. Without `recover` that node opens its gate on the state of
       * the rest point it did not come from. With it the engine runs `recover` first, as one
       * transaction: what it writes is committed as an edge of the node onto itself, with the
       * outcome `"recover"`, and becomes the rest point a later rollback returns to. Then the node
       * is entered as usual. It runs only in the safe node, only after the loop gave up, never on
       * a retry and never after a `restore`. A `recover` that throws rejects `run()`.
       *
       * @example
       * ```ts
       * // "home" is flow.safeNode. The board failed twice: the session still describes the board.
       * const home = defineNode({
       *   rest: true,
       *   checkpoint: true,
       *   outcomes: { play: type() },
       *   recover: ({ session }) => {
       *     session.screen = "home"; // the gate of "home" opens on this, not on "board"
       *   }
       * });
       * ```
       */
      recover?: NodeRecover<Game>;
    }
  | {
      rest?: false;
      run: NodeRun<Game, Input, Tags>;
      /** A transit node has no `recover`: writing one is a compile error. */
      recover?: never;
    }
);

/**
 * The signature of `defineNode` bound to one game. `defineGame<Types>()` returns it.
 *
 * @example
 * ```ts
 * const defineGameNode: DefineNode<{ player: Player; session: Session }> = defineNode;
 * ```
 */
export type DefineNode<Game extends GameState> = <
  Input = void,
  const Tags extends OutcomeTags = OutcomeTags
>(
  spec: NodeSpec<Game, Input, Tags>
) => NodeDefinition<Input, Tags, Game>;

/**
 * An extension point inside a flow: a node whose body is "run the contributions in order". Its
 * outcomes are `done` and the named outcomes `slot()` declares, so the flow that holds it routes
 * each of them with an ordinary edge. Without type arguments it is a slot that declares none.
 *
 * @example
 * ```ts
 * // A feature may send the player from the slot to the shop, on the tab it names.
 * const afterOrder: SlotNode<{ shop: TypeTag<{ tab: string }> }, "afterOrder"> = slot("afterOrder", {
 *   shop: type<{ tab: string }>()
 * });
 * // { kind: "slot", name: "afterOrder", input: { kind: "type" },
 * //   outcomes: { done: { kind: "type" }, shop: { kind: "type" } } }
 * ```
 */
export type SlotNode<
  Tags extends OutcomeTags = Record<never, never>,
  Name extends string = string
> = Wired<void, { readonly done: TypeTag<void> } & Tags> & {
  readonly kind: "slot";
  readonly name: Name;
};

// ─── Edge targets ─────────────────────────────────────────────

/**
 * Edge target that leaves the sub-flow with this outcome. The payload passes through.
 *
 * @example
 * ```ts
 * const leave: Exit<"left"> = exit("left"); // { kind: "exit", outcome: "left" }
 * ```
 */
export type Exit<Name extends string = string> = {
  readonly kind: "exit";
  readonly outcome: Name;
};

/**
 * Edge target that adapts the payload on the edge. `map` is a property on purpose: the mapper's
 * parameter annotation is checked strictly against the outcome payload.
 *
 * @example
 * ```ts
 * const adapt: Mapped<"retry", { reason: string }, { why: string }> = to(
 *   "retry",
 *   (failure: { reason: string }) => ({ why: failure.reason })
 * );
 * ```
 */
export type Mapped<TargetName extends string = string, Payload = never, Output = unknown> = {
  readonly kind: "map";
  readonly target: TargetName;
  readonly map: (payload: Payload) => Output;
};

/**
 * A mapped target as the runner calls it. `map` is a method on purpose: method parameters are
 * compared bivariantly, so every checked `Mapped` fits and the runner calls it without a cast.
 * The result is `unknown`: a mapper into a node without input returns nothing, and the runner
 * checks that a mapped payload is plain JSON before it becomes the next input.
 */
export type AnyMapped = {
  readonly kind: "map";
  readonly target: string;
  map(payload: unknown): unknown;
};

/**
 * Any edge target as the runner reads it: a node name, an exit or a mapped target.
 *
 * @example
 * ```ts
 * const next: Target = "home"; // a node of the same flow
 * const leave: Target = exit("left"); // { kind: "exit", outcome: "left" }
 * ```
 */
export type Target = string | Exit | AnyMapped;

/**
 * Whether a receiver with input `Input` takes `Payload`. A receiver without input ignores the
 * payload, so it accepts anything; a void outcome into a node with input is an error.
 *
 * @example
 * ```ts
 * type Fits = Accepts<{ stars: number }, void>; // true
 * ```
 */
type Accepts<Payload, Input> =
  IsVoid<Input> extends true ? true : [Payload] extends [Input] ? true : false;

/**
 * The input type of a node or sub-flow.
 *
 * @example
 * ```ts
 * type MergeInput = InputOf<typeof merge>; // { from: string; to: string }
 * ```
 */
type InputOf<Node extends AnyWired> = PayloadOf<Node["input"]>;

/**
 * Names of the nodes whose input accepts `Payload`.
 *
 * @example
 * ```ts
 * type Starts = NodeNamesFor<{ boot: typeof boot; merge: typeof merge }, void>; // "boot"
 * ```
 */
type NodeNamesFor<Nodes extends NodeTable, Payload> = {
  [Name in keyof Nodes & string]: Accepts<Payload, InputOf<Nodes[Name]>> extends true
    ? Name
    : never;
}[keyof Nodes & string];

/**
 * Names of the flow outcomes whose payload accepts `Payload`.
 *
 * @example
 * ```ts
 * type Exits = ExitNamesFor<{ win: TypeTag<{ stars: number }> }, { stars: number }>; // "win"
 * ```
 */
type ExitNamesFor<FlowTags extends OutcomeTags, Payload> = {
  [Name in keyof FlowTags & string]: Accepts<Payload, PayloadOf<FlowTags[Name]>> extends true
    ? Name
    : never;
}[keyof FlowTags & string];

/**
 * Every correctly typed `to(node, map)` for `Payload`.
 */
type MappedFor<Nodes extends NodeTable, Payload> = {
  [Name in keyof Nodes & string]: Mapped<Name, Payload, InputOf<Nodes[Name]>>;
}[keyof Nodes & string];

/**
 * Descriptive type: every legal target of an outcome that carries `Payload`.
 */
export type TargetFor<Nodes extends NodeTable, FlowTags extends OutcomeTags, Payload> =
  | NodeNamesFor<Nodes, Payload>
  | Exit<ExitNamesFor<FlowTags, Payload>>
  | MappedFor<Nodes, Payload>;

/**
 * Descriptive type of an edge table: one entry per outcome of every node. Stored on
 * `FlowDefinition` and read by tools; the check with readable errors is `CheckedEdges`.
 *
 * @example
 * ```ts
 * const edges: Edges<{ boot: typeof boot; home: typeof home }, Record<never, never>> = {
 *   boot: { ready: "home" },
 *   home: { play: "boot" }
 * };
 * ```
 */
export type Edges<Nodes extends NodeTable, FlowTags extends OutcomeTags> = {
  readonly [Name in keyof Nodes]: {
    readonly [Outcome in keyof Nodes[Name]["outcomes"]]: TargetFor<
      Nodes,
      FlowTags,
      PayloadOf<Nodes[Name]["outcomes"][Outcome]>
    >;
  };
};

// ─── Checked edges (readable compiler errors) ─────────────────

/**
 * A branded sentence. The compiler prints it in the "is not assignable to" position, so a wrong
 * edge reads as a message with node and outcome names.
 *
 * @example
 * ```ts
 * type Problem = GraphError<'No node "awaitIntnet" in this flow (edge of outcome "done" of node "merge").'>;
 * ```
 */
export type GraphError<Message extends string> = { readonly $graphError: Message };

/**
 * The loosest legal target of a flow: what a missing entry is expected to be.
 */
type AnyTargetOf<Nodes extends NodeTable, FlowTags extends OutcomeTags> =
  | (keyof Nodes & string)
  | Exit<keyof FlowTags & string>
  | Mapped<keyof Nodes & string, never, unknown>;

/**
 * Checks one entry `Value` of the inferred edge table. A legal entry stays itself; a wrong one
 * becomes a `GraphError` sentence.
 */
type CheckTarget<
  Nodes extends NodeTable,
  FlowTags extends OutcomeTags,
  NodeName extends string,
  OutcomeName extends string,
  Payload,
  Value
> = Value extends string
  ? Value extends keyof Nodes
    ? Accepts<Payload, InputOf<Nodes[Value]>> extends true
      ? Value
      : GraphError<`Payload of outcome "${OutcomeName}" of node "${NodeName}" does not fit the input of node "${Value}". Use to("${Value}", payload => ...).`>
    : GraphError<`No node "${Value}" in this flow (edge of outcome "${OutcomeName}" of node "${NodeName}").`>
  : Value extends Exit<infer ExitName>
    ? ExitName extends keyof FlowTags
      ? Accepts<Payload, PayloadOf<FlowTags[ExitName]>> extends true
        ? Value
        : GraphError<`Payload of outcome "${OutcomeName}" of node "${NodeName}" does not fit flow outcome "${ExitName}".`>
      : GraphError<`exit("${ExitName}"): the flow declares no outcome "${ExitName}".`>
    : Value extends Mapped<infer TargetName, never, unknown>
      ? TargetName extends keyof Nodes
        ? Mapped<TargetName, Payload, InputOf<Nodes[TargetName]>>
        : GraphError<`to("${TargetName}", ...): no node "${TargetName}" in this flow.`>
      : AnyTargetOf<Nodes, FlowTags>;

/**
 * Checking type: validates the inferred edge table `Table` entry by entry. It reports a missing
 * edge, an unknown target, a payload that does not fit, an edge of an unknown outcome and an
 * edge table row of an unknown node.
 *
 * @example
 * ```ts
 * type Spec = { edges: Table & CheckedEdges<Nodes, FlowTags, Table> };
 * ```
 */
export type CheckedEdges<Nodes extends NodeTable, FlowTags extends OutcomeTags, Table> = {
  readonly [Name in keyof Nodes & string]: {
    readonly [Outcome in keyof Nodes[Name]["outcomes"] & string]: Name extends keyof Table
      ? Outcome extends keyof Table[Name]
        ? CheckTarget<
            Nodes,
            FlowTags,
            Name,
            Outcome,
            PayloadOf<Nodes[Name]["outcomes"][Outcome]>,
            Table[Name][Outcome]
          >
        : AnyTargetOf<Nodes, FlowTags>
      : AnyTargetOf<Nodes, FlowTags>;
  } & (Name extends keyof Table
    ? {
        readonly [Extra in Exclude<keyof Table[Name], keyof Nodes[Name]["outcomes"]> &
          string]: GraphError<`Node "${Name}" has no outcome "${Extra}".`>;
      }
    : unknown);
} & {
  readonly [Extra in Exclude<keyof Table, keyof Nodes> &
    string]: GraphError<`"${Extra}" is not a node of this flow.`>;
};

/**
 * Checks one outcome `Outcome` of the contributed flow `Contributed` against the slot `Host`:
 * `never` when it is `done`, or an outcome the slot declares whose payload fits; a `GraphError`
 * sentence otherwise.
 */
type OutcomeFit<
  Contributed extends AnyFlow,
  Host extends SlotNode<OutcomeTags, string>,
  Outcome extends keyof Contributed["outcomes"]
> = Outcome extends "done"
  ? never
  : Outcome extends Exclude<keyof Host["outcomes"], "done">
    ? Accepts<
        PayloadOf<Contributed["outcomes"][Outcome]>,
        PayloadOf<Host["outcomes"][Outcome]>
      > extends true
      ? never
      : GraphError<`Payload of outcome "${Outcome & string}" does not fit slot "${Host["name"]}".`>
    : GraphError<`Slot "${Host["name"]}" declares no outcome "${Outcome & string}".`>;

/**
 * The outcomes of `Contributed` that do not fit the slot `Host`, as `GraphError` sentences, or
 * `never` when every outcome fits.
 */
type MisfitOutcomes<Contributed extends AnyFlow, Host extends SlotNode<OutcomeTags, string>> = {
  [Outcome in keyof Contributed["outcomes"]]: OutcomeFit<Contributed, Host, Outcome>;
}[keyof Contributed["outcomes"]];

/**
 * Checking type of `contribution()`: whether the flow `Contributed` fits the slot `Host`. Every
 * outcome of the flow is `done`, or an outcome the slot declares whose payload fits; then it is
 * `unknown`, otherwise the `GraphError` sentence of the misfit. A slot that declares no outcome
 * accepts any flow, and a flow without outcomes fits any slot.
 *
 * @example
 * ```ts
 * // episodeStep = slot("episodeStep", { shop: type<{ tab: string }>() })
 * type Fitting = Fits<typeof storyFlow, typeof episodeStep>; // unknown: outcomes done and shop
 * type Misfit = Fits<typeof giftFlow, typeof episodeStep>; // giftFlow exits "gift":
 * // GraphError<'Slot "episodeStep" declares no outcome "gift".'>
 * ```
 */
export type Fits<Contributed extends AnyFlow, Host extends SlotNode<OutcomeTags, string>> = [
  Exclude<keyof Host["outcomes"], "done">
] extends [never]
  ? unknown
  : [MisfitOutcomes<Contributed, Host>] extends [never]
    ? unknown
    : MisfitOutcomes<Contributed, Host>;

// ─── Flow ─────────────────────────────────────────────────────

/**
 * A flow as `defineFlow` returns it: plain data. A flow that declares `input` and `outcomes`
 * is used as a node of another flow.
 *
 * @example
 * ```ts
 * // What defineFlow("main", { nodes: { boot, home }, start: "boot", edges }) returns:
 * // { kind: "flow", id: "main", input: { kind: "type" }, outcomes: {}, nodes: { boot, home },
 * //   start: "boot", edges: { boot: { ready: "home" }, home: { play: "boot" } } }
 * ```
 */
export type FlowDefinition<
  Input,
  FlowTags extends OutcomeTags,
  Nodes extends NodeTable = NodeTable
> = Wired<Input, FlowTags> & {
  readonly kind: "flow";
  readonly id: string;
  readonly nodes: Nodes;
  readonly start: keyof Nodes & string;
  readonly edges: Edges<Nodes, FlowTags>;
};

/**
 * What the author passes to `defineFlow`. `start` must name a node whose input accepts the flow
 * input; `edges` is inferred as written and validated by `CheckedEdges`.
 *
 * @example
 * ```ts
 * // The spec of a sub-flow: `outcomes` makes it usable as a node, exit() leaves it.
 * defineFlow("rewardPopup", {
 *   nodes: { show, grant },
 *   start: "show",
 *   outcomes: { done: type() },
 *   edges: { show: { claim: "grant" }, grant: { done: exit("done") } }
 * });
 * ```
 */
export type FlowSpec<Nodes extends NodeTable, Input, FlowTags extends OutcomeTags, Table> = {
  nodes: Nodes;
  start: NodeNamesFor<NoInfer<Nodes>, NoInfer<Input>>;
  edges: Table & CheckedEdges<NoInfer<Nodes>, NoInfer<FlowTags>, NoInfer<Table>>;
  input?: TypeTag<Input>;
  outcomes?: FlowTags;
};

// ─── Widened run-time types (the runner is not generic) ───────

/**
 * The node context as the runner builds it. Every typed `NodeContext` is assignable to it.
 */
export type AnyNodeContext = {
  input: unknown;
  player: unknown;
  session: unknown;
  rng: RngView;
  fx: NodeFx;
  out: Readonly<Record<string, (payload: never) => Result>>;
  signal: AbortSignal;
  now: number;
};

/**
 * The recovery context as the runner builds it. Every typed `RecoverContext` is assignable to it.
 */
export type AnyRecoverContext = Omit<AnyNodeContext, "input" | "out">;

/**
 * Any node as the runner holds it. `run` and `recover` are methods on purpose: method parameters
 * are compared bivariantly, so every typed `NodeDefinition` fits and the runner calls both
 * without a cast.
 *
 * @example
 * ```ts
 * const nodes: readonly AnyNode[] = [catchUp, merge];
 * ```
 */
export type AnyNode = AnyWired & {
  readonly kind: "node";
  readonly rest: boolean;
  readonly over: boolean;
  readonly checkpoint: boolean;
  readonly barrier: boolean;
  readonly inbox: readonly string[];
  /** Id of the scene the node is shown on. Absent: the node keeps the current scene. */
  readonly scene?: string;
  run?(ctx: AnyNodeContext): Result | Promise<Result>;
  recover?(context: AnyRecoverContext): void | Promise<void>;
  /**
   * The guide of the node, derived from the committed state; see `NodeSpec.guide`.
   *
   * @param state - The committed `player` and `session`.
   * @param state.player - The committed player tree.
   * @param state.session - The committed session tree.
   * @returns The guide while the node stands, or `undefined` for none.
   */
  guide?(state: { player: unknown; session: unknown }): GuideOptions | undefined;
};

/**
 * One entry of a flow's `nodes`: a node, a sub-flow or a slot. The `kind` field tells them apart.
 */
export type FlowEntry = AnyNode | AnyFlow | SlotNode;

/**
 * Any flow as the runner holds it. Every typed `FlowDefinition` fits.
 *
 * @example
 * ```ts
 * const flows: readonly AnyFlow[] = [mainFlow, boardFlow, rewardFlow];
 * ```
 */
export type AnyFlow = AnyWired & {
  readonly kind: "flow";
  readonly id: string;
  readonly nodes: Readonly<Record<string, FlowEntry>>;
  readonly start: string;
  readonly edges: Readonly<Record<string, Readonly<Record<string, Target>>>>;
};

/**
 * Where a path leads: the entry, the flow that holds it and one `{ flow, node }` pair per level,
 * outermost first. The loop turns the trail into frames.
 */
export type NodeLocation = {
  /** The flow that holds the entry. */
  flow: AnyFlow;
  /** Name of the entry inside that flow. */
  name: string;
  /** The node, sub-flow or slot the path names. */
  entry: FlowEntry;
  /** One step per nesting level, outermost first. */
  trail: readonly { flow: string; node: string }[];
};

/**
 * One level of the position. The path is the frames joined: `"board/awaitIntent"`.
 *
 * @example
 * ```ts
 * const frame: Frame = { flow: "board", node: "awaitIntent", input: null };
 * ```
 */
export type Frame = { flow: string; node: string; input: Json };

/**
 * One taken edge. `hash` covers `path + outcome + next`, so a replay against edited code fails
 * loudly in dev.
 *
 * @example
 * ```ts
 * // The play button on "home" led into the board sub-flow.
 * const entry: JournalEntry = {
 *   index: 1, path: "home", outcome: "play", payload: null,
 *   next: "board/awaitIntent", now: 1_790_000_000_000, hash: "fbeb1a2f"
 * };
 * ```
 */
export type JournalEntry = {
  index: number;
  path: string;
  outcome: string;
  payload: Json;
  next: string;
  now: number;
  hash: string;
};

/**
 * One step of a fast walk: a player answer at a rest node, or a substituted sub-flow result.
 *
 * @example
 * ```ts
 * const route: RouteStep[] = [
 *   { at: "home", intent: "play" }, // the answer "play" at the rest node "home"
 *   { at: "board", result: { outcome: "left" } } // the sub-flow "board" is skipped with "left"
 * ];
 * ```
 */
export type RouteStep =
  | { at: string; intent: string; payload?: Json }
  | { at: string; result: { outcome: string; payload?: Json } };

/**
 * A node plus a state that really existed there. Serialisable. `path` names a rest node, or a
 * transit node that waited at the gate for the answer of an effect (a popup); for the second the
 * state is the one committed when the node was entered. `graph` is the hash of `describe()`.
 *
 * @example
 * ```ts
 * // Taken while the info popup of the mini game waits for its answer, opened from "home".
 * const bookmark: Bookmark = {
 *   path: "info/show", input: null, player: { count: 0 }, session: { opened: 0 },
 *   rng: { seed: 42, streams: {} }, graph: "0e0d2aa8", rest: { path: "home", input: null }
 * };
 * ```
 */
export type Bookmark = {
  /** Path of a rest node, or of a transit node that waited at the gate. */
  path: string;
  input: Json;
  player: Json;
  session: Json;
  rng: RngState;
  graph: string;
  /**
   * The scene mounted when the bookmark was taken. Written by the `game.bookmark` door, read by
   * `game.restore`; `flow.restore` ignores it.
   */
  scene?: string;
  /**
   * The rest point before a transit `path`: the last rest node and its input. `restore` enters
   * it instead when the graph changed since the bookmark. Absent for a bookmark of a rest node,
   * and when no rest node came before the transit node.
   */
  rest?: { path: string; input: Json };
  /**
   * The save schema version `player` and `rng` were taken at (`model.store.schemaVersion()`).
   * `restore` runs the migrations from it when the game's schema moved on since, as a dev reload
   * after a schema change does. Absent in a bookmark of an older engine: taken as the current one.
   */
  version?: number;
};

/**
 * What `onEnter` callbacks learn about the node being entered.
 *
 * @example
 * ```ts
 * // The rest node "awaitIntent" of the sub-flow "board" is being entered.
 * const node: NodeInfo = {
 *   path: "board/awaitIntent", flow: "board", node: "awaitIntent",
 *   rest: true, over: false, checkpoint: false, barrier: false, scene: "board"
 * };
 * ```
 */
export type NodeInfo = {
  path: string;
  flow: string;
  node: string;
  rest: boolean;
  over: boolean;
  checkpoint: boolean;
  barrier: boolean;
  /** Id of the scene the node is shown on: `scenes` switches on it, `assets` pins its bundle. */
  scene?: string;
};

/**
 * The whole graph as JSON. Edge targets are rendered as strings: `"node"`, `"exit:win"`,
 * `"map:node"`.
 *
 * @example
 * ```ts
 * const graph: FlowGraph = app.flow.describe();
 *
 * graph.main; // "main"
 * graph.flows.board?.edges.awaitIntent?.leave; // "exit:left"; a mapped target reads "map:node"
 * graph.slots.afterOrder; // [{ feature: "reward", flow: "rewardPopup", order: 10 }]
 * ```
 */
export type FlowGraph = {
  main: string;
  flows: Record<
    string,
    {
      nodes: Record<string, GraphNode>;
      start: string;
      edges: Record<string, Record<string, string>>;
    }
  >;
  slots: Record<string, { feature: string; flow: string; order: number }[]>;
};

/**
 * One node of `describe()`: its flags, its scene, its outcome names and, when it is one, the slot
 * it opens, the sub-flow it enters and the feature that brought it. It has no `path`: a static
 * description has no runtime position, and `flow` plus `node` address it.
 *
 * @example
 * ```ts
 * // app.flow.describe().flows.main?.nodes.board: the sub-flow "board" used as a node of "main".
 * const node: GraphNode = {
 *   flow: "main", node: "board",
 *   rest: false, over: false, checkpoint: false, barrier: false,
 *   outcomes: ["orderComplete", "left"], subFlow: "board"
 * };
 * ```
 */
export type GraphNode = Omit<NodeInfo, "path"> & {
  outcomes: string[];
  slot?: string;
  subFlow?: string;
  owner?: string;
};

/**
 * What `validateGraph` returns: problems that stop `run()`, and warnings the caller logs. A flow
 * above fifteen nodes is a warning, never an error.
 */
export type ValidationReport = { problems: string[]; warnings: string[] };

/**
 * Inspection of the running graph.
 *
 * @example
 * ```ts
 * // The graph rests at "home" and waits for the intent "play".
 * const state: FlowState = {
 *   running: true, path: "home", stack: [{ flow: "main", node: "home", input: null }],
 *   pending: { gate: ["play"] }, mode: "live"
 * };
 * ```
 */
export type FlowState = {
  running: boolean;
  path: string;
  stack: readonly Frame[];
  pending: { fx?: string; gate?: readonly string[] };
  mode: "live" | "fast";
};

/**
 * Stages of entering a node, in the order they run: `begin`, `load`, `scene`. At `begin` a plugin
 * starts what reacts at once and returns without waiting: the loop awaits it before the `load`
 * stage, so a callback that waits there delays the loads. `assets` preloads at `load`, `scenes`
 * switches at `scene`.
 *
 * @example
 * ```ts
 * // Registered in any order, the stages of a node run begin, load, scene: the veil `scenes` shows
 * // at "begin" is up before `assets` downloads the board at "load".
 * const order: string[] = [];
 * app.flow.onEnter("scene", () => order.push("scene"));
 * app.flow.onEnter("load", () => order.push("load"));
 * app.flow.onEnter("begin", () => order.push("begin"));
 * // entering a node: order is ["begin", "load", "scene"]
 * ```
 */
export type Stage = "begin" | "load" | "scene";

/**
 * Callback of `onEnter`. Called before `node.run`, awaited. Read the state with
 * `model.store.snapshot()`: no node of the graph writes while the stages run.
 *
 * @example
 * ```ts
 * // The "load" stage of a game plugin: the loop waits for it before the body of the node runs.
 * const preloadNode: EnterCallback = async (node, { signal }) => {
 *   if (node.flow === "board") await preloadBoard(signal); // node.path: "board/awaitIntent"
 * };
 *
 * app.flow.onEnter("load", preloadNode);
 * ```
 */
export type EnterCallback = (
  node: NodeInfo,
  ctx: { mode: "live" | "fast"; signal: AbortSignal }
) => void | Promise<void>;

/**
 * The seam the fast walk and `restore` steer the running loop with. It stays absent while the
 * game just runs: `walk.ts` and `restore` create it through `loopSeam` when they need it.
 */
export type LoopSeam = {
  /** Sub-flow results a walk substitutes, by path. The loop takes each one once. */
  substitutions: Map<string, Result>;
  /**
   * Called with the path every time the loop enters a rest node, and once when it enters the
   * node of a bookmark, which may be a transit node. `restore` resolves on the second.
   */
  rest: ((path: string) => void)[];
  /**
   * Called every time the loop opens a gate: the wait of a rest node, or an effect with answers
   * inside any node. The walk waits on it, and so does `restore` after it entered a transit node.
   */
  gateOpen: (() => void)[];
  /**
   * The bookmark the loop enters at the next turn. The loop clears it when it takes it. A loop
   * that ends first never takes it, so the restore that waits drops its own.
   */
  restoring: Bookmark | undefined;
};

/**
 * runner module state.
 */
export type RunnerState = {
  /** Flush started by a background pause. `onStop` awaits it. */
  flushing: Promise<void> | undefined;
  /** Every flow of the graph by id, collected at `run()`. */
  flows: Map<string, AnyFlow>;
  enterCallbacks: Record<Stage, EnterCallback[]>;
  /** The position: one frame per nesting level. */
  stack: Frame[];
  /**
   * The frames a failed node is retried from, paired with the state a rollback returns to: the
   * last rest node, or the node the graph started at or a restore entered. The last two may be
   * transit nodes, so `bookmark()` writes its `rest` only when these frames name a rest node.
   */
  restFrame: Frame[] | undefined;
  /** Inside a slot: the contribution the loop just finished. The slot continues after it. */
  slotAfter: string | undefined;
  /** Inside a slot: the declared outcome a contribution left on. The slot takes its edge next. */
  slotLeave: { outcome: string; payload: Json } | undefined;
  /** Edges committed since the loop last arrived at a rest node. */
  restless: number;
  /** Edges without a rest node after which the next one fails: `max(64, 4 × expanded nodes)`. */
  restlessCap: number;
  /** Edges since the last checkpoint. */
  journal: JournalEntry[];
  journalIndex: number;
  /** The promise of `run()`. `undefined`: not started. */
  running: Promise<void> | undefined;
  /** Aborts the active node. */
  abort: AbortController | undefined;
  /** Failed transitions in a row. */
  failures: number;
  /** How `walk` and `restore` steer the loop. Absent until one of them needs it. */
  seam?: LoopSeam;
  /** The last `state()` and what it was read from. Absent until the first `state()`. */
  view?: StateView;
  /**
   * The guide of the node that stands, derived from state: its last result and how to derive it
   * again. Set when a node with a `guide` is entered; cleared when the node is left, at a restore
   * and when the loop starts.
   */
  guide?: NodeGuideHost | undefined;
};

/**
 * The guide of the node that stands. A commit while the node waits at its gate calls `refresh`;
 * the node's abort makes it a no-op.
 */
export type NodeGuideHost = {
  /** The last result as the payload of its descriptor; `undefined` while the node guides nothing. */
  last: { [key: string]: Json } | undefined;
  /** Derives the guide again from the committed state; a `guide` that throws fails the node. */
  refresh: () => void;
  /**
   * Shows the last result again through the `guide` handler, with the narrow it already set. Called
   * when the fx mode goes from fast back to live: in fast mode the handler of `ui` did not run.
   * Shows nothing once the node was left, or while it guides nothing.
   */
  reshow: () => void;
};

/**
 * The last `flow.state()` and the fields it was built from. `state()` hands the same frozen
 * object out again while none of them moved, so a watcher compares identities.
 */
export type StateView = {
  running: boolean;
  depth: number;
  top: Frame | undefined;
  open: GateSpec | undefined;
  mode: "live" | "fast";
  journalIndex: number;
  state: FlowState;
};

/**
 * The sibling module APIs injected into the runner, public and internal parts together.
 */
export type Modules = {
  features: FeaturesApi & FeaturesInternal;
  fx: FxApi & FxInternal;
  gate: GateApi & GateInternal;
  inbox: InboxApi & InboxInternal;
};

/**
 * runner module API. Its methods are spread onto the plugin root: `app.flow.run()`. `run` owns
 * the one loop, `walk` and `restore` enter a position through it, `describe`, `state` and
 * `history` inspect it.
 *
 * @example
 * ```ts
 * // A live game starts the graph once and then only reads it: answers go through the gate.
 * app.flow.run().catch(showFatal);
 * app.flow.state().path; // "home", once the transit node "boot" was played out
 * ```
 */
export type RunnerApi = {
  /**
   * Validates the graph, seals the features, loads the save and runs the one loop until `onStop`
   * aborts it. A fatal error rejects: the consumer catches it.
   *
   * @returns The promise of the running graph. It resolves when the app stops.
   * @throws {Error} When `run()` was already called.
   * @example
   * ```ts
   * // The game starts the graph from onStart and does not await it: the loop never ends.
   * createApp({
   *   pluginConfigs: { flow: { mainFlow, safeNode: "home" } },
   *   onStart: ctx => {
   *     ctx.flow.run().catch(showFatal); // a broken graph or an unreadable save ends up here
   *   }
   * });
   * ```
   */
  run(): Promise<void>;

  /**
   * Registers a callback run before every node body, at one of three stages: `scenes` reacts at
   * `begin` (the veil over the scene being left), `assets` preloads at `load`, `scenes` switches
   * at `scene`. Every `begin` callback runs before the first `load` callback, and every `load`
   * callback before the first `scene` callback, in registration order inside a stage, each
   * awaited. A `begin` callback must not wait: it starts what reacts at once and returns, since
   * the loads start only after it. Once the node is aborted (a restore, a stop) no further stage
   * starts. A stage that throws ends the node: its signal is aborted with reason `"failed"` before
   * the rollback, so what an earlier stage started for it (a veil over the scene being left) is
   * taken down at once, also before a safe node's `recover` and when the failure is fatal. A stage
   * that rejects with the abort itself after a stop or a restore (the `AbortError` of a cancelled
   * download, or the signal's reason) is that abort, not a failure: no rollback, no `flow:error`.
   * A real error that arrives after the abort is still a failure.
   *
   * The stages run before the node opens its transaction, and `model.store.snapshot()` is the
   * committed state, so a stage reads the state the node is entered with: on an ordinary entry
   * the state the edge into the node committed; after a restore the bookmark's state, since the
   * store is replaced before the node's stages run; at the safe node after a give-up the state
   * its `recover` committed, or, without `recover`, the state of the rest point the rollback
   * returned to.
   *
   * @param stage - `"begin"`, `"load"` or `"scene"`.
   * @param callback - Called with the node and `{ mode, signal }`, awaited.
   * @returns The unregister function.
   * @example
   * ```ts
   * // The scenes plugin, at the tap on "board" over the ward: the veil goes up at `begin`, without
   * // waiting, while the `load` stage still downloads the board; the switch runs at `scene`.
   * const flow = ctx.require(flowPlugin);
   * const veil = { cover: { color: 0x000000, alpha: 0.45, inMs: 50, outMs: 150 } };
   * const offBegin = flow.onEnter("begin", (node, { mode }) => {
   *   if (mode === "live" && node.scene === "board") ctx.require(rendererPlugin).sync.leave.show(veil);
   * });
   * const offScene = flow.onEnter("scene", async node => {
   *   // node.scene: "board": await its bundles, build it aside, swap it in, then land the veil
   * });
   *
   * offBegin(); // the plugin stops: neither callback is called any more
   * offScene();
   * ```
   */
  onEnter(stage: Stage, callback: EnterCallback): () => void;

  /**
   * Walks a route in fast mode through the running loop: it answers the gate at each step's `at`
   * and substitutes the result of every sub-flow node the route skips. A `from` bookmark is
   * entered through the same check as `restore`, with the same fallback. A rest node is entered
   * before the switch to fast mode: its stages see the mode of the caller. A transit node is
   * entered after the switch and without the wait `restore` adds for it: its popup is not shown,
   * the route answers it. The mode of the caller is put back afterwards; when it is live, the guide
   * of the node the walk ends at is shown, its lock and veil as on a live entry.
   *
   * @param route - The player's answers and substituted sub-flow results, in order.
   * @param options - Walk options.
   * @param options.from - Bookmark restored before the first step.
   * @returns The state the walk ended in.
   * @throws {Error} Before `run()` was called, when the bookmark is refused, and when a step's
   *   `at` is never reached.
   * @example
   * ```ts
   * // A test skips the menu and stands on the board, without a screen and without waiting.
   * const state = await app.flow.walk([{ at: "home", intent: "play" }]);
   * state.path; // "board/awaitIntent"
   *
   * // Devtools jump back to a saved position and leave the board from there.
   * await app.flow.walk([{ at: "board/awaitIntent", intent: "leave" }], { from: bookmark });
   * ```
   */
  walk(route: readonly RouteStep[], options?: { from?: Bookmark }): Promise<FlowState>;

  /**
   * Makes a bookmark of where the graph stands: the last rest node plus the committed state.
   * While a transit node waits at the gate for the answer of an effect (a `popup`, or any
   * descriptor with `answers`), the bookmark names that node instead. Its state is the one
   * committed when the node was entered: what the node wrote before the wait is not in it, the
   * node writes it again when it is restored. `rest` then names the rest point before the node.
   * While a transit node awaits anything else (an animation, a request) the bookmark still names
   * the last rest node.
   *
   * @returns The bookmark, ready for JSON.
   * @throws {Error} When the graph has no position yet.
   * @example
   * ```ts
   * // A devtools button keeps the position. The board rests: the bookmark names its rest node.
   * const atBoard = app.flow.bookmark(); // plain data, ready for JSON.stringify
   * atBoard.path; // "board/awaitIntent"
   * // The mini game with its info popup open: the bookmark names the node that waits.
   * const atPopup = app.flow.bookmark();
   * atPopup.path; // "info/show"
   * atPopup.rest; // { path: "home", input: null }: the rest point before it
   * ```
   */
  bookmark(): Bookmark;

  /**
   * Replaces the state with the bookmark's and enters its node. A rest checkpoint is always
   * accepted; any other node only while the graph is unchanged. A transit node is never taken
   * for a checkpoint: when the graph changed, such a bookmark is entered at its `rest` point
   * instead, if that is a checkpoint, and the log gets `flow:restore-fell-back`. A renamed or
   * removed node is a changed graph too: a bookmark with `rest` whose path names no node takes
   * the same fallback.
   *
   * A rest node: the promise resolves when the node is entered, before its scene stage ran. A
   * transit node runs again from its first line, live, with the bookmark's input, so its effects
   * before the gate play again; the promise resolves when its gate is open, or at the rest node
   * or the end of the loop it reaches without one. A node that does none of these keeps the
   * promise pending. An open gate is not a drawn popup: the popup shows on the next frame. And
   * `setMode` still throws there, since the graph waits inside a transit node.
   *
   * The promise also resolves when the graph stops before the bookmark was entered: `onStop`
   * ended the loop, or `run()` rejected. Nothing is entered then and the state is not replaced.
   * `state()` shows whether it was: its `path` is the node the graph stands at.
   *
   * The restored node's `begin`, `load` and `scene` stages run after this resolves for a rest node: the
   * scene is mounted when its bundles are in, before the node's gate opens;
   * `await app.flow.walk([])` waits for that gate.
   *
   * @param bookmark - The bookmark to enter.
   * @returns A promise that resolves once a rest node is entered, or a transit node waits at
   *   its gate. It also resolves when the graph stops first, with nothing entered: read
   *   `state()` to tell.
   * @throws {Error} When the bookmark names no node of this graph and has no `rest`, when the
   *   graph changed since the bookmark and neither it nor its `rest` point is a rest checkpoint,
   *   and before `run()`.
   * @example
   * ```ts
   * // The next session opens where the last one stopped: state and position come back together.
   * await app.flow.restore(atBoard);
   * app.flow.state().path; // "board/awaitIntent"
   * // A bookmark the mini game took at its info popup: the popup waits again when this resolves.
   * await app.flow.restore(atPopup);
   * app.flow.state().pending.gate; // ["ok", "close"], and state().path is "info/show"
   * ```
   */
  restore(bookmark: Bookmark): Promise<void>;

  /**
   * Renders the whole graph as JSON, without running the game. It reads the flows as data, so
   * it works before `run()`.
   *
   * @returns Nodes, flags, outcomes, edges, slots and who contributed.
   * @example
   * ```ts
   * // A devtools panel draws the graph of the merge game.
   * const graph = app.flow.describe();
   *
   * graph.flows.main?.edges.home; // { play: "board" }
   * graph.flows.board?.nodes.merge?.outcomes; // ["done", "rejected"]
   * ```
   */
  describe(): FlowGraph;

  /**
   * Reads where the graph stands. Frozen, and the same object while the graph did not move: no
   * edge, no gate opened or closed, no mode switch.
   *
   * @returns Whether it runs, the path, the stack, what it waits for and the mode.
   * @example
   * ```ts
   * // The screen enables only the buttons the resting node takes.
   * const { path, pending } = app.flow.state();
   * // path: "home", pending: { gate: ["play"] }
   *
   * // An editor panel redraws the position only when the graph moved.
   * app.flow.state() === app.flow.state(); // true while "home" rests
   * ```
   */
  state(): FlowState;

  /**
   * Reads the edges taken since the last checkpoint.
   *
   * @returns A copy of the journal.
   * @example
   * ```ts
   * // A bug report says why the last move was refused.
   * const last = app.flow.history().at(-1);
   * // last?.path: "board/merge", last?.outcome: "rejected", last?.payload: { reason: "empty" }
   * ```
   */
  history(): readonly JournalEntry[];

  /**
   * Switches between live and fast mode. Legal before `run()` and while the graph rests. A
   * transit node that waits at the gate for a popup does not rest: it throws there too, also
   * right after a `restore` into such a node.
   *
   * @param mode - `"live"` or `"fast"`.
   * @throws {Error} When a transit node is running.
   * @example
   * ```ts
   * // A headless run plays without effects: fast mode before the app starts.
   * app.flow.setMode("fast");
   * await app.start();
   * app.flow.state().mode; // "fast"
   * ```
   */
  setMode(mode: "live" | "fast"): void;
};
