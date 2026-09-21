# P3 result

Question: Does the compiler survive compile-time graph checking, and are the errors readable?

Answer: changes

The compiler survives easily. All five checks stay in the type system. Three shapes differ from the design sketch. See "What changes in the plan".

Evidence:

TypeScript 6.0.3, `tsc --noEmit --extendedDiagnostics`, 3 runs each, numbers stable.

| Project | Nodes | Lines of TS | Check time | Total time | Instantiations | Types | Memory |
|---|---|---|---|---|---|---|---|
| Baseline, `graph.ts` only | 0 | 256 | 0.02s | 0.11s | 719 | 963 | 59 MB |
| Example: main 11 + board 8 + level 3, plus `mistakes.ts` with 5 more flows | 19 + 3 | 580 | 0.10s | 0.19s | 38 546 | 6 607 | 87 MB |
| Scale: 25 flows x 12 nodes, sub-flows nested in chains of 5 | 300 | 1 906 | 0.26s | 0.36s | 152 306 | 19 733 | 114 MB |

Cost per 100 nodes is about 0.08s of check time and 50k instantiations. Growth is linear. No depth limit hit.

Error excerpts. Real output of `tsc -p tsconfig.raw.json`, long lines cut. Full text is in `errors-raw.txt`.

**1. Outcome with no edge** (`awaitIntent.sell` missing). Rating: points at the right line and names the problem, but only on line 2. Line 1 is noise.

```
mistakes-raw.ts(22,5): error TS2322: Type '{ merge: "merge"; tapGenerator: "tapGenerator"; giveToOrder: "giveToOrder"; elapsed: "catchUp"; talk: Exit<"talk">; shop: Exit<"shop">; }' is not assignable to type '{ readonly merge: "merge"; ...
  Property 'sell' is missing in type '{ merge: "merge"; tapGenerator: ... }' but required in type '{ readonly elapsed: "catchUp"; ...
```

**2. Target name with a typo** (`"awaitIntnet"`). Rating: points at the right line and names the problem.

```
mistakes-raw.ts(44,14): error TS2322: Type '"awaitIntnet"' is not assignable to type '"awaitIntnet" & GraphError<"No node \"awaitIntnet\" in this flow (edge of outcome \"done\" of node \"merge\").">'.
  Type 'string' is not assignable to type 'GraphError<"No node \"awaitIntnet\" in this flow (edge of outcome \"done\" of node \"merge\").">'.
```

**3. Payload mismatch** (`level.win {stars}` into `result {stars, moves}`). Rating: points at the right line and names the problem. Before the improvement it was "right line, cryptic text".

```
// before (expected-type version, graph-v1.ts.txt)
mistakes-raw.ts(57,14): error TS2322: Type '"result"' is not assignable to type 'TargetFor<NoInfer<{ home: NodeDefinition<void, { readonly play: TypeTag<{ level: number; }>; }, { player: Player; session: Session; }>; level: FlowDefinition<{ level: number; }, { ...; }, { ...; }>; result: NodeDefinition<...>; }>, {}, { ...; }>'.

// after (branded GraphError)
mistakes-raw.ts(57,14): error TS2322: Type '"result"' is not assignable to type '"result" & GraphError<"Payload of outcome \"win\" of node \"level\" does not fit the input of node \"result\". Use to(\"result\", payload => ...).">'.
```

**4. `out.won()` not declared**. Rating: points at the right line and names the problem.

```
mistakes-raw.ts(65,53): error TS2339: Property 'won' does not exist on type 'Out<{ readonly win: TypeTag<void>; readonly lose: TypeTag<void>; }>'.
```

**5. Sub-flow outcome `quit` has no edge in the parent**. Rating: same as 1. Right line, problem named on line 2, line 1 is noise.

```
mistakes-raw.ts(74,5): error TS2322: Type '{ win: Mapped<"result", { stars: number; }, { moves: number; stars: number; }>; lose: "home"; }' is not assignable to type '{ readonly win: Mapped<...>; readonly lose: "home"; } & { readonly lose: "home"; readonly quit: AnyTarg...
  Property 'quit' is missing in type '{ win: Mapped<...>; lose: "home"; }' but required in type '{ readonly lose: "home"; readonly quit: AnyTargetOf<...
```

The one improvement tried: branded `GraphError<"...">` in the expected position. It helped. Mistake 3 went from cryptic to a full sentence with node and outcome names. Mistake 2 lost the "Did you mean" hint but gained the node and outcome names. Mistakes 1 and 5 got one extra noise line. The same brand also reports an edge for an unknown node, an edge for an unknown outcome, `exit("x")` of an undeclared flow outcome, and `to("x", ...)` to an unknown node.

Three findings that were not in the sketch:

1. `to("retry", r => ...)` cannot infer `r`. The call sits inside the same object literal that infers `nodes`. TypeScript resolves the inner call before `N` is known, so `r` is `unknown`. Proven with probes: separate arguments work, a single literal does not.
2. `type()` inside `outcomes` infers `T = any` from the constraint `TypeTag<any>`. Then every void outcome fits every input and the check is silently off. `TypeTag<NoInfer<T>>` as the return type fixes it.
3. The sketch's `Edges<N>` as the expected type works, but its payload error prints the whole node map. The checked form below is needed for readable text.

What changes in the plan:

All graph checks stay in the type system. Nothing moves to run time. `validate.ts` is still built as planned, because data loaded from JSON and `any` casts bypass types.

1. Mapper payload is annotated by the author. The annotation is checked against the outcome payload.

```ts
// now (design context)
loadCore: { done: "home", failed: to("retry", f => ({ why: f.reason })) },

// fix
loadCore: { done: "home", failed: to("retry", (f: { reason: string }) => ({ why: f.reason })) },
```

2. `defineFlow` infers the edge table as `const E` and validates it with `CheckedEdges<N, FO, E>`. Wrong entries become `GraphError<"sentence">`. `Edges<N, FO>` stays as the stored, descriptive type on `FlowDefinition`.

3. `type<T = void>()` returns `TypeTag<NoInfer<T>>`.

4. Generic shape: nodes are generic over the tag record `O` (`{ done: TypeTag<void> }`), not over a payload map. `OutOf` and `InputOf` become plain indexed access. No `infer` over mapped types. This keeps instantiations low.

5. Rule fixed by the spike: a receiver without `input` accepts any payload. Example: `elapsed { now }` goes to `catchUp`. A void outcome into a node with `input` is an error.

6. `run` is required unless `rest: true`. Typed with a two-member union. Error text is acceptable ("Property 'run' is missing").

Recommended signatures for `src/plugins/flow/runner/types.ts`:

```ts
export interface TypeTag<T> { readonly kind: "type"; readonly $t?: (x: T) => T }   // invariant
export function type<T = void>(): TypeTag<NoInfer<T>>;

export type OutcomeTags = Record<string, TypeTag<any>>;
export type PayloadOf<Tag> = Tag extends TypeTag<infer P> ? P : never;

export interface Result<O extends OutcomeTags> { readonly $result: keyof O & string; readonly payload: unknown }

export type Out<O extends OutcomeTags> = {
  readonly [K in keyof O]: [PayloadOf<O[K]>] extends [void] ? () => Result<O> : (data: PayloadOf<O[K]>) => Result<O>;
};

export interface NodeContext<G extends GameTypes, In, O extends OutcomeTags> {
  input: In; player: G["player"]; session: G["session"];
  rng: Rng; fx: Fx; out: Out<O>; signal: AbortSignal; now: number;
}

export type NodeRun<G extends GameTypes, In, O extends OutcomeTags> =
  (ctx: NodeContext<G, In, O>) => Result<O> | Promise<Result<O>>;

/** What the edge table looks at. Nodes and flows both satisfy it. */
export interface Wired<In, O extends OutcomeTags> { readonly input: TypeTag<In>; readonly outcomes: O }
export type AnyNode = Wired<any, OutcomeTags>;

export interface NodeDefinition<In, O extends OutcomeTags, G extends GameTypes = GameTypes> extends Wired<In, O> {
  readonly kind: "node";
  readonly slot?: string;
  readonly rest: boolean; readonly over: boolean; readonly checkpoint: boolean; readonly barrier: boolean;
  readonly inbox: readonly (keyof O & string)[];
  readonly run?: NodeRun<G, In, O>;
}

export type NodeSpec<G extends GameTypes, In, O extends OutcomeTags> = {
  input?: TypeTag<In>; outcomes: O;
  over?: boolean; checkpoint?: boolean; barrier?: boolean;
  inbox?: readonly (keyof O & string)[];
} & ({ rest: true; run?: NodeRun<G, In, O> } | { rest?: false; run: NodeRun<G, In, O> });

export interface Exit<Name extends string> { readonly kind: "exit"; readonly outcome: Name }
export interface Mapped<Target extends string, Payload, R> {
  readonly kind: "to"; readonly target: Target; readonly map: (payload: Payload) => R;
}
export function exit<const Name extends string>(outcome: Name): Exit<Name>;
export function to<const Target extends string, Payload, R>(target: Target, map: (payload: Payload) => R): Mapped<Target, Payload, R>;

type Accepts<Payload, In> = [In] extends [void] ? true : [Payload] extends [In] ? true : false;
type InputOf<N extends AnyNode> = PayloadOf<N["input"]>;

/** Descriptive type: what a legal target is. Stored on FlowDefinition, used by tools. */
export type TargetFor<N extends Record<string, AnyNode>, FO extends OutcomeTags, Payload> =
  | { [T in keyof N & string]: Accepts<Payload, InputOf<N[T]>> extends true ? T : never }[keyof N & string]
  | Exit<{ [X in keyof FO & string]: Accepts<Payload, PayloadOf<FO[X]>> extends true ? X : never }[keyof FO & string]>
  | { [T in keyof N & string]: Mapped<T, Payload, InputOf<N[T]>> }[keyof N & string];

export type Edges<N extends Record<string, AnyNode>, FO extends OutcomeTags> = {
  readonly [K in keyof N]: { readonly [O in keyof N[K]["outcomes"]]: TargetFor<N, FO, PayloadOf<N[K]["outcomes"][O]>> };
};

/** Checking type: validates the inferred table E entry by entry, with sentences as errors. */
export interface GraphError<Message extends string> { readonly $graphError: Message }

type AnyTargetOf<N extends Record<string, AnyNode>, FO extends OutcomeTags> =
  | (keyof N & string) | Exit<keyof FO & string> | Mapped<keyof N & string, never, unknown>;

type CheckTarget<N extends Record<string, AnyNode>, FO extends OutcomeTags, K extends string, O extends string, Payload, V> =
  V extends string
    ? V extends keyof N
      ? Accepts<Payload, InputOf<N[V]>> extends true ? V
        : GraphError<`Payload of outcome "${O}" of node "${K}" does not fit the input of node "${V}". Use to("${V}", payload => ...).`>
      : GraphError<`No node "${V}" in this flow (edge of outcome "${O}" of node "${K}").`>
  : V extends Exit<infer X>
    ? X extends keyof FO
      ? Accepts<Payload, PayloadOf<FO[X]>> extends true ? V
        : GraphError<`Payload of outcome "${O}" of node "${K}" does not fit flow outcome "${X}".`>
      : GraphError<`exit("${X}"): the flow declares no outcome "${X}".`>
  : V extends Mapped<infer T, any, any>
    ? T extends keyof N ? Mapped<T, Payload, InputOf<N[T]>> : GraphError<`to("${T}", ...): no node "${T}" in this flow.`>
  : AnyTargetOf<N, FO>;

export type CheckedEdges<N extends Record<string, AnyNode>, FO extends OutcomeTags, E> = {
  readonly [K in keyof N & string]: {
    readonly [O in keyof N[K]["outcomes"] & string]: K extends keyof E
      ? O extends keyof E[K] ? CheckTarget<N, FO, K, O, PayloadOf<N[K]["outcomes"][O]>, E[K][O]> : AnyTargetOf<N, FO>
      : AnyTargetOf<N, FO>;
  } & (K extends keyof E
    ? { readonly [X in Exclude<keyof E[K], keyof N[K]["outcomes"]> & string]: GraphError<`Node "${K}" has no outcome "${X}".`> }
    : {});
} & { readonly [X in Exclude<keyof E, keyof N> & string]: GraphError<`"${X}" is not a node of this flow.`> };

export interface FlowDefinition<In, FO extends OutcomeTags, N extends Record<string, AnyNode> = Record<string, AnyNode>>
  extends Wired<In, FO> {
  readonly kind: "flow"; readonly id: string;
  readonly nodes: N; readonly start: keyof N & string; readonly edges: Edges<N, FO>;
}

export type FlowSpec<N extends Record<string, AnyNode>, In, FO extends OutcomeTags, E> = {
  nodes: N;
  start: NodeNamesFor<NoInfer<N>, NoInfer<In>>;   // first member of TargetFor: node names whose input accepts In
  edges: E & CheckedEdges<NoInfer<N>, NoInfer<FO>, NoInfer<E>>;
  input?: TypeTag<In>;
  outcomes?: FO;
};

// inside defineGame<G>():
function defineNode<In = void, const O extends OutcomeTags = OutcomeTags>(spec: NodeSpec<G, In, O>): NodeDefinition<In, O, G>;
function defineFlow<N extends Record<string, AnyNode>, In = void, const FO extends OutcomeTags = {}, const E = {}>(
  id: string, spec: FlowSpec<N, In, FO, E>,
): FlowDefinition<In, FO, N>;
export function slot(name: string): NodeDefinition<void, { done: TypeTag<void> }>;
```

Known cosmetic leftovers: `NoInfer<...>` shows up inside printed tag types. Missing-edge errors carry one noise line before the useful one.

Files: `graph.ts` (final types), `graph-v1.ts.txt` (expected-type version before the improvement), `example-kit.ts`, `example-board.ts`, `example-main.ts`, `mistakes.ts`, `mistakes-raw.ts` + `tsconfig.raw.json` + `errors-raw.txt`, `gen-scale.ts` + `scale-generated.ts` + `tsconfig.scale.json`.
