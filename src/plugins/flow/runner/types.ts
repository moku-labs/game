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
 *
 * @example
 * ```ts
 * const tag: AnyTypeTag = type<{ level: number }>();
 * ```
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
 * const result: Result<"done" | "rejected"> = out.done();
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
 * run: ({ out }) => (broken ? out.failed({ reason: "clock" }) : out.done())
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
 * run: ({ input, player, out }: NodeContext<Game, { level: number }, Tags>) => out.done()
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
 *
 * @example
 * ```ts
 * const run: NodeRun<Game, void, { done: TypeTag<void> }> = ({ out }) => out.done();
 * ```
 */
export type NodeRun<Game extends GameState, Input, Tags extends OutcomeTags> = (
  ctx: NodeContext<Game, Input, Tags>
) => Result<keyof Tags & string> | Promise<Result<keyof Tags & string>>;

/**
 * The part of a node, or of a flow used as a node, that an edge table looks at.
 *
 * @example
 * ```ts
 * const wired: Wired<{ level: number }, { win: TypeTag<void> }> = levelFlow;
 * ```
 */
export type Wired<Input, Tags extends OutcomeTags> = {
  readonly input: TypeTag<Input>;
  readonly outcomes: Tags;
};

/**
 * Anything that can sit in the `nodes` of a flow: a node, a sub-flow or a slot.
 *
 * @example
 * ```ts
 * const entry: AnyWired = catchUp;
 * ```
 */
export type AnyWired = { readonly input: AnyTypeTag; readonly outcomes: OutcomeTags };

/**
 * Node name to node: the `nodes` of one flow.
 *
 * @example
 * ```ts
 * const nodes = { catchUp, awaitIntent, merge } satisfies NodeTable;
 * ```
 */
export type NodeTable = Readonly<Record<string, AnyWired>>;

/**
 * A node as `defineNode` returns it: plain data plus the optional body.
 *
 * @example
 * ```ts
 * const merge: NodeDefinition<{ from: string; to: string }, { done: TypeTag<void> }> = defineNode({
 *   input: type<{ from: string; to: string }>(),
 *   outcomes: { done: type() },
 *   run: ({ out }) => out.done()
 * });
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
 * const afterWin: SlotNode = slot("afterWin");
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
 * const leave: Exit<"win"> = exit("win");
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
 *
 * @example
 * ```ts
 * const input = mapped.map(result.payload);
 * ```
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
 * const target: Target | undefined = flow.edges[node]?.[result.outcome];
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
 *
 * @example
 * ```ts
 * type Adapters = MappedFor<{ retry: typeof retry }, { reason: string }>;
 * ```
 */
type MappedFor<Nodes extends NodeTable, Payload> = {
  [Name in keyof Nodes & string]: Mapped<Name, Payload, InputOf<Nodes[Name]>>;
}[keyof Nodes & string];

/**
 * Descriptive type: every legal target of an outcome that carries `Payload`.
 *
 * @example
 * ```ts
 * type AfterMerge = TargetFor<BoardNodes, BoardOutcomes, void>;
 * ```
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
 *   boot: { done: "home" },
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
 *
 * @example
 * ```ts
 * type Missing = AnyTargetOf<BoardNodes, BoardOutcomes>;
 * ```
 */
type AnyTargetOf<Nodes extends NodeTable, FlowTags extends OutcomeTags> =
  | (keyof Nodes & string)
  | Exit<keyof FlowTags & string>
  | Mapped<keyof Nodes & string, never, unknown>;

/**
 * Checks one entry `Value` of the inferred edge table. A legal entry stays itself; a wrong one
 * becomes a `GraphError` sentence.
 *
 * @example
 * ```ts
 * type Checked = CheckTarget<BoardNodes, BoardOutcomes, "merge", "done", void, "awaitIntent">;
 * ```
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
 * const levelFlow: FlowDefinition<{ level: number }, { win: TypeTag<void> }, LevelNodes> =
 *   defineFlow("level", { input, outcomes, nodes, start: "prepare", edges });
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
 * defineFlow("main", { nodes: { boot, home }, start: "boot", edges: { boot: { done: "home" } } });
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
 *
 * @example
 * ```ts
 * const ctx: AnyNodeContext = { input, player, session, rng, fx, out, signal, now };
 * ```
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
 *
 * @example
 * ```ts
 * const entry: FlowEntry | undefined = flow.nodes[name];
 * ```
 */
export type FlowEntry = AnyNode | AnyFlow | SlotNode;

/**
 * Any flow as the runner holds it. Every typed `FlowDefinition` fits.
 *
 * @example
 * ```ts
 * const flows: Map<string, AnyFlow> = collectFlows(mainFlow, []);
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
 *
 * @example
 * ```ts
 * const { entry, trail } = findNode(mainFlow, "board/awaitIntent") ?? {};
 * ```
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
 * const [last]: readonly JournalEntry[] = app.flow.history().slice(-1);
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
 *   { at: "home", intent: "play" },
 *   { at: "level", result: { outcome: "win", payload: { stars: 3 } } }
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
 * const bookmark: Bookmark = app.flow.bookmark();
 * await app.flow.restore(bookmark);
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
 * app.flow.onEnter("load", (node: NodeInfo) => preload(node.path));
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
 * graph.flows[graph.main]?.start;
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
 * the sub-flow it enters and the feature that brought it.
 *
 * @example
 * ```ts
 * const node: GraphNode | undefined = app.flow.describe().flows.main?.nodes.board;
 * ```
 */
export type GraphNode = NodeInfo & {
  outcomes: string[];
  slot?: string;
  subFlow?: string;
  owner?: string;
};

/**
 * What `validateGraph` returns: problems that stop `run()`, and warnings the caller logs. A flow
 * above fifteen nodes is a warning, never an error.
 *
 * @example
 * ```ts
 * const { problems, warnings } = validateGraph(flows, features, config);
 * ```
 */
export type ValidationReport = { problems: string[]; warnings: string[] };

/**
 * Inspection of the running graph.
 *
 * @example
 * ```ts
 * const { path, pending }: FlowState = app.flow.state();
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
 * const preloadNode: EnterCallback = (node, { signal }) => assets.preload(node.path, signal);
 * ```
 */
export type EnterCallback = (
  node: NodeInfo,
  ctx: { mode: "live" | "fast"; signal: AbortSignal }
) => void | Promise<void>;

/**
 * The seam the fast walk and `restore` steer the running loop with. It stays absent while the
 * game just runs: `walk.ts` and `restore` create it through `loopSeam` when they need it.
 *
 * @example
 * ```ts
 * loopSeam(ctx.state.runner).substitutions.set("level", { outcome: "win", payload: null });
 * ```
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
 *
 * @example
 * ```ts
 * const runner: RunnerState = createRunnerState();
 * ```
 */
export type RunnerState = {
  /** Flush started by a background pause. `onStop` awaits it. */
  flushing: Promise<void> | undefined;
  /** Every reachable or registered flow by id. */
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
 *
 * @example
 * ```ts
 * const runner = createRunnerApi(ctx, { features, fx, gate, inbox });
 * ```
 */
export type Modules = {
  features: FeaturesApi & FeaturesInternal;
  fx: FxApi & FxInternal;
  gate: GateApi & GateInternal;
  inbox: InboxApi & InboxInternal;
};

/**
 * runner module API. Its methods are spread onto the plugin root: `app.flow.run()`.
 *
 * @example
 * ```ts
 * createApp({ onStart: ctx => { ctx.flow.run().catch(showFatal); } });
 * ```
 */
export type RunnerApi = {
  run(): Promise<void>;
  register(flow: AnyFlow): void;
  onEnter(stage: Stage, callback: EnterCallback): () => void;
  walk(route: readonly RouteStep[], options?: { from?: Bookmark }): Promise<FlowState>;
  bookmark(): Bookmark;
  restore(bookmark: Bookmark): Promise<void>;
  describe(): FlowGraph;
  state(): FlowState;
  history(): readonly JournalEntry[];
  setMode(mode: "live" | "fast"): void;
};
