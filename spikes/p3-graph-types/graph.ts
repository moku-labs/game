// P3 spike: compile-time checking of a flow graph (edge table).
// Types first, runtime is trivial stubs.

// ---------------------------------------------------------------- type tags

/** A value that carries only a type. Invariant in T. */
export interface TypeTag<T> {
  readonly kind: "type";
  readonly $t?: (x: T) => T;
}

export function type<T = void>(): TypeTag<NoInfer<T>> {
  return { kind: "type" };
}

/** outcome name -> type tag of its payload */
export type OutcomeTags = Record<string, TypeTag<any>>;

export type PayloadOf<Tag> = Tag extends TypeTag<infer P> ? P : never;

// ---------------------------------------------------------------- game binding

export type GameTypes = { player: unknown; session: unknown };

export interface Rng {
  stream(id: string): { int(min: number, max: number): number };
}

export interface Fx {
  <T>(descriptor: { readonly $awaits?: T }): Promise<T>;
  emit(hint: { kind: string; data: unknown }): void;
}

// ---------------------------------------------------------------- node

/** What `out.x(...)` returns. `run` must return one of these. */
export interface Result<O extends OutcomeTags> {
  readonly $result: keyof O & string;
  readonly payload: unknown;
}

export type Out<O extends OutcomeTags> = {
  readonly [K in keyof O]: [PayloadOf<O[K]>] extends [void]
    ? () => Result<O>
    : (data: PayloadOf<O[K]>) => Result<O>;
};

export interface NodeContext<G extends GameTypes, In, O extends OutcomeTags> {
  input: In;
  player: G["player"];
  session: G["session"];
  rng: Rng;
  fx: Fx;
  out: Out<O>;
  signal: AbortSignal;
  now: number;
}

export type NodeRun<G extends GameTypes, In, O extends OutcomeTags> = (
  ctx: NodeContext<G, In, O>,
) => Result<O> | Promise<Result<O>>;

/** The part of a node (or a flow used as a node) that the edge table looks at. */
export interface Wired<In, O extends OutcomeTags> {
  readonly input: TypeTag<In>;
  readonly outcomes: O;
}

export type AnyNode = Wired<any, OutcomeTags>;

export interface NodeDefinition<In, O extends OutcomeTags, G extends GameTypes = GameTypes>
  extends Wired<In, O> {
  readonly kind: "node";
  readonly slot?: string;
  readonly rest: boolean;
  readonly over: boolean;
  readonly checkpoint: boolean;
  readonly barrier: boolean;
  readonly inbox: readonly (keyof O & string)[];
  readonly run?: NodeRun<G, In, O>;
}

/** What the author writes. A rest node may omit `run` (pure wait). */
export type NodeSpec<G extends GameTypes, In, O extends OutcomeTags> = {
  input?: TypeTag<In>;
  outcomes: O;
  over?: boolean;
  checkpoint?: boolean;
  barrier?: boolean;
  inbox?: readonly (keyof O & string)[];
} & ({ rest: true; run?: NodeRun<G, In, O> } | { rest?: false; run: NodeRun<G, In, O> });

// ---------------------------------------------------------------- edge targets

export interface Exit<Name extends string> {
  readonly kind: "exit";
  readonly outcome: Name;
}

export interface Mapped<Target extends string, Payload, Result> {
  readonly kind: "to";
  readonly target: Target;
  readonly map: (payload: Payload) => Result;
}

export function exit<const Name extends string>(outcome: Name): Exit<Name> {
  return { kind: "exit", outcome };
}

export function to<const Target extends string, Payload, R>(
  target: Target,
  map: (payload: Payload) => R,
): Mapped<Target, Payload, R> {
  return { kind: "to", target, map };
}

/** A receiver without input ignores the payload, so it accepts anything. */
type Accepts<Payload, In> = [In] extends [void] ? true : [Payload] extends [In] ? true : false;

type InputOf<N extends AnyNode> = PayloadOf<N["input"]>;

type NodeNamesFor<N extends Record<string, AnyNode>, Payload> = {
  [T in keyof N & string]: Accepts<Payload, InputOf<N[T]>> extends true ? T : never;
}[keyof N & string];

type ExitNamesFor<FO extends OutcomeTags, Payload> = {
  [X in keyof FO & string]: Accepts<Payload, PayloadOf<FO[X]>> extends true ? X : never;
}[keyof FO & string];

type MappedFor<N extends Record<string, AnyNode>, Payload> = {
  [T in keyof N & string]: Mapped<T, Payload, InputOf<N[T]>>;
}[keyof N & string];

export type TargetFor<N extends Record<string, AnyNode>, FO extends OutcomeTags, Payload> =
  | NodeNamesFor<N, Payload>
  | Exit<ExitNamesFor<FO, Payload>>
  | MappedFor<N, Payload>;

export type Edges<N extends Record<string, AnyNode>, FO extends OutcomeTags> = {
  readonly [K in keyof N]: {
    readonly [O in keyof N[K]["outcomes"]]: TargetFor<N, FO, PayloadOf<N[K]["outcomes"][O]>>;
  };
};

// ---------------------------------------------------------------- checked edges (readable errors)

/** Shown by the compiler in the "is not assignable to" position. */
export interface GraphError<Message extends string> {
  readonly $graphError: Message;
}

type AnyTargetOf<N extends Record<string, AnyNode>, FO extends OutcomeTags> =
  | (keyof N & string)
  | Exit<keyof FO & string>
  | Mapped<keyof N & string, never, unknown>;

type CheckTarget<
  N extends Record<string, AnyNode>, FO extends OutcomeTags,
  K extends string, O extends string, Payload, V,
> = V extends string
  ? V extends keyof N
    ? Accepts<Payload, InputOf<N[V]>> extends true
      ? V
      : GraphError<`Payload of outcome "${O}" of node "${K}" does not fit the input of node "${V}". Use to("${V}", payload => ...).`>
    : GraphError<`No node "${V}" in this flow (edge of outcome "${O}" of node "${K}").`>
  : V extends Exit<infer X>
    ? X extends keyof FO
      ? Accepts<Payload, PayloadOf<FO[X]>> extends true
        ? V
        : GraphError<`Payload of outcome "${O}" of node "${K}" does not fit flow outcome "${X}".`>
      : GraphError<`exit("${X}"): the flow declares no outcome "${X}".`>
    : V extends Mapped<infer T, any, any>
      ? T extends keyof N
        ? Mapped<T, Payload, InputOf<N[T]>>
        : GraphError<`to("${T}", ...): no node "${T}" in this flow.`>
      : AnyTargetOf<N, FO>;

export type CheckedEdges<N extends Record<string, AnyNode>, FO extends OutcomeTags, E> = {
  readonly [K in keyof N & string]: {
    readonly [O in keyof N[K]["outcomes"] & string]: K extends keyof E
      ? O extends keyof E[K]
        ? CheckTarget<N, FO, K, O, PayloadOf<N[K]["outcomes"][O]>, E[K][O]>
        : AnyTargetOf<N, FO>
      : AnyTargetOf<N, FO>;
  } & (K extends keyof E
    ? { readonly [X in Exclude<keyof E[K], keyof N[K]["outcomes"]> & string]: GraphError<`Node "${K}" has no outcome "${X}".`> }
    : {});
} & {
  readonly [X in Exclude<keyof E, keyof N> & string]: GraphError<`"${X}" is not a node of this flow.`>;
};

// ---------------------------------------------------------------- flow

export interface FlowDefinition<
  In,
  FO extends OutcomeTags,
  N extends Record<string, AnyNode> = Record<string, AnyNode>,
> extends Wired<In, FO> {
  readonly kind: "flow";
  readonly id: string;
  readonly nodes: N;
  readonly start: keyof N & string;
  readonly edges: Edges<N, FO>;
}

export type FlowSpec<N extends Record<string, AnyNode>, In, FO extends OutcomeTags, E> = {
  nodes: N;
  start: NodeNamesFor<NoInfer<N>, NoInfer<In>>;
  edges: E & CheckedEdges<NoInfer<N>, NoInfer<FO>, NoInfer<E>>;
  input?: TypeTag<In>;
  outcomes?: FO;
};

// ---------------------------------------------------------------- helpers

export function slot(name: string): NodeDefinition<void, { done: TypeTag<void> }> {
  return {
    kind: "node", slot: name, input: type(), outcomes: { done: type() },
    rest: false, over: false, checkpoint: false, barrier: false, inbox: [],
  };
}

export function defineGame<G extends GameTypes>() {
  function defineNode<In = void, const O extends OutcomeTags = OutcomeTags>(
    spec: NodeSpec<G, In, O>,
  ): NodeDefinition<In, O, G> {
    const base = {
      kind: "node" as const,
      input: spec.input ?? type<In>(),
      outcomes: spec.outcomes,
      rest: spec.rest ?? false,
      over: spec.over ?? false,
      checkpoint: spec.checkpoint ?? false,
      barrier: spec.barrier ?? false,
      inbox: spec.inbox ?? [],
    };
    return spec.run ? { ...base, run: spec.run } : base;
  }

  function defineFlow<N extends Record<string, AnyNode>, In = void, const FO extends OutcomeTags = {}, const E = {}>(
    id: string,
    spec: FlowSpec<N, In, FO, E>,
  ): FlowDefinition<In, FO, N> {
    return {
      kind: "flow",
      id,
      input: spec.input ?? type<In>(),
      outcomes: spec.outcomes ?? ({} as FO),
      nodes: spec.nodes,
      start: spec.start,
      edges: spec.edges as unknown as Edges<N, FO>,
    };
  }

  return { defineNode, defineFlow };
}
