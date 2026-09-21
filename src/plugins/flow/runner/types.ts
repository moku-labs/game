/**
 * @file flow/runner — type definitions: the strict graph types of the authoring helpers
 * (spike P3) and the widened run-time types of the runner.
 */
import type { Json, RngState, RngView } from "../../model/types";
import type { FeaturesApi, FeaturesInternal } from "../features/types";
import type { FxApi, FxInternal, NodeFx } from "../fx/types";
import type { GateApi, GateInternal } from "../gate/types";
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
export type GameState = { player: Json; session: Json };

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
 * run: ({ player, session, rng, out }) => {
 *   player.coins += rng.stream("dice").range(1, 6);
 *   session.rolls += 1;
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
  readonly run?: NodeRun<Game, Input, Tags>;
};

/**
 * What the author passes to `defineNode`. `run` is required unless `rest: true`: a rest node
 * without a body is a pure wait.
 *
 * @example
 * ```ts
 * const spec: NodeSpec<Game, void, { play: TypeTag<void> }> = {
 *   rest: true,
 *   checkpoint: true,
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
} & (
  | { rest: true; run?: NodeRun<Game, Input, Tags> }
  | { rest?: false; run: NodeRun<Game, Input, Tags> }
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
 * An extension point inside a flow: a node whose body is "run the contributions in order".
 * Its single outcome is `done`.
 *
 * @example
 * ```ts
 * const afterOrder: SlotNode = slot("afterOrder");
 * // { kind: "slot", name: "afterOrder", input: { kind: "type" },
 * //   outcomes: { done: { kind: "type" } } }
 * ```
 */
export type SlotNode = Wired<void, { readonly done: TypeTag<void> }> & {
  readonly kind: "slot";
  readonly name: string;
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
 * Any node as the runner holds it. `run` is a method on purpose: method parameters are compared
 * bivariantly, so every typed `NodeDefinition` fits and the runner calls the body without a cast.
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
  run?(ctx: AnyNodeContext): Result | Promise<Result>;
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
 * A rest node plus a state that really existed there. Serialisable. `graph` is the hash of
 * `describe()`.
 *
 * @example
 * ```ts
 * const bookmark: Bookmark = {
 *   path: "board/awaitIntent", input: null,
 *   player: { coins: 7 }, session: { taps: 0 },
 *   rng: { seed: 42, streams: {} }, graph: "fe4d257a"
 * };
 * ```
 */
export type Bookmark = {
  path: string;
  input: Json;
  player: Json;
  session: Json;
  rng: RngState;
  graph: string;
};

/**
 * What `onEnter` callbacks learn about the node being entered.
 *
 * @example
 * ```ts
 * // The rest node "awaitIntent" of the sub-flow "board" is being entered.
 * const node: NodeInfo = {
 *   path: "board/awaitIntent", flow: "board", node: "awaitIntent",
 *   rest: true, over: false, checkpoint: false, barrier: false
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
 * One node of `describe()`: its flags, its outcome names and, when it is one, the slot it opens,
 * the sub-flow it enters and the feature that brought it. It has no `path`: a static description
 * has no runtime position, and `flow` plus `node` address it.
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
 * Stages of entering a node: `assets` preloads at `load`, `scenes` switches at `scene`.
 *
 * @example
 * ```ts
 * const stage: Stage = "load";
 * ```
 */
export type Stage = "load" | "scene";

/**
 * Callback of `onEnter`. Called before `node.run`, awaited.
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
  /** Called with the path every time the loop enters a rest node. */
  rest: ((path: string) => void)[];
  /** Called every time the loop opens the gate of a rest node. The walk waits on it. */
  gateOpen: (() => void)[];
  /** The bookmark the loop enters at the next turn. */
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
  /** The stack of the last rest node: the rollback target. */
  restFrame: Frame[] | undefined;
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
   * Registers a callback run before every node body: `assets` preloads at `load`, `scenes`
   * switches at `scene`. Every `load` callback runs before the first `scene` callback, in
   * registration order, each awaited.
   *
   * @param stage - `"load"` or `"scene"`.
   * @param callback - Called with the node and `{ mode, signal }`, awaited.
   * @returns The unregister function.
   * @example
   * ```ts
   * // A scenes plugin switches the screen when the graph enters a node.
   * const off = app.flow.onEnter("scene", node => showScene(node.path)); // node.path: "home"
   *
   * off(); // the plugin stops: the callback is not called any more
   * ```
   */
  onEnter(stage: Stage, callback: EnterCallback): () => void;

  /**
   * Walks a route in fast mode through the running loop: it answers the gate at each step's `at`
   * and substitutes the result of every sub-flow node the route skips. A `from` bookmark is
   * entered through the same check as `restore`. The mode of the caller is put back afterwards.
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
   * Makes a bookmark of the current rest point: the rest node plus the committed state.
   *
   * @returns The bookmark, ready for JSON.
   * @throws {Error} When the graph has no position yet.
   * @example
   * ```ts
   * // A devtools button keeps the position while the board rests.
   * const bookmark = app.flow.bookmark();
   * bookmark.path; // "board/awaitIntent"
   * JSON.stringify(bookmark); // plain data: path, input, player, session, rng and the graph hash
   * ```
   */
  bookmark(): Bookmark;

  /**
   * Replaces the state with the bookmark's and enters its node. A checkpoint is always
   * accepted; any other rest node only while the graph is unchanged.
   *
   * @param bookmark - The bookmark to enter.
   * @returns A promise that resolves once the graph rests at the bookmark's node.
   * @throws {Error} When the bookmark names no rest node of this graph, when the graph changed
   *   since a bookmark of a plain rest node, and before `run()`.
   * @example
   * ```ts
   * // The next session opens where the last one stopped: state and position come back together.
   * await app.flow.restore(bookmark);
   * app.flow.state().path; // "board/awaitIntent"
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
   * Reads where the graph stands.
   *
   * @returns Whether it runs, the path, the stack, what it waits for and the mode.
   * @example
   * ```ts
   * // The screen enables only the buttons the resting node takes.
   * const { path, pending } = app.flow.state();
   * // path: "home", pending: { gate: ["play"] }
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
   * Switches between live and fast mode. Legal before `run()` and while the graph rests.
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
