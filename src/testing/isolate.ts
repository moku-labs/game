/**
 * @file Isolated feature tests, re-exported by the `./testing` entry. `isolate` composes one
 * feature with the shared layer and nothing else of the game; `stub` replaces a node or a sub-flow
 * of another feature by the outcome it ends with. A root module, not a plugin file: it imports
 * `createApp` from the package root. It imports no `node:` module.
 */
import type { AnyPluginInstance } from "@moku-labs/core";
import type { Clock, Flow, Model } from "../index";
import { createApp, exit, type } from "../index";

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Model.Json = null;

/** Id of the harness main flow. */
const harnessId = "isolated";

/** Name of the harness's rest node that every exit of the isolated flow leads to. */
const exitedName = "exited";

/** Name of the one transit node of a stub. */
const endName = "end";

/** The rng seed of an isolated app that pins none. */
const defaultSeed = 1;

/**
 * A stub for one node or sub-flow of the isolated flow: the outcome it ends with, and its payload.
 *
 * @example
 * ```ts
 * const closed: Stub<"closed"> = stub("closed"); // { kind: "stub", outcome: "closed" }
 * ```
 */
export type Stub<Name extends string = string> = {
  readonly kind: "stub";
  readonly outcome: Name;
  readonly payload?: Model.Json;
};

/**
 * The outcome names of one entry of a node table. Distributes over a union: for a flow widened
 * to `Flow.AnyFlow` an entry is a node, a sub-flow or a slot, and every outcome name is allowed,
 * not only the slot's `done`.
 */
type OutcomeNameOf<Entry> = Entry extends { readonly outcomes: infer Tags }
  ? keyof Tags & string
  : never;

/**
 * One optional stub per node of the flow. The outcome must be one the replaced entry declares:
 * a wrong one and an unknown key are compile errors, and `isolate()` refuses them at run time too.
 * A flow widened to `Flow.AnyFlow` takes every key and every outcome.
 *
 * @example
 * ```ts
 * // boardFlow holds settings: settingsFlow (outcome closed) and energy (outcomes watch, later).
 * const stubs: StubsOf<typeof boardFlow.nodes> = { settings: stub("closed"), energy: stub("later") };
 * ```
 */
export type StubsOf<Nodes extends Flow.NodeTable> = {
  readonly [Name in keyof Nodes & string]?: Stub<OutcomeNameOf<Nodes[Name]>>;
};

/**
 * What `isolate` composes around one feature.
 *
 * @example
 * ```ts
 * const options: IsolateOptions<typeof boardFlow.nodes> = {
 *   flow: boardFlow, shared: sharedLayer, stubs: { settings: stub("closed") }, player: fresh
 * };
 * ```
 */
export type IsolateOptions<Nodes extends Flow.NodeTable> = {
  /** The feature's flow. It becomes the one node of the harness main flow, named by `as`. */
  flow: Flow.AnyFlow & { readonly nodes: Nodes };
  /**
   * The key the game's main flow holds the flow under. `flow.id` by default.
   *
   * @example
   * ```ts
   * // The mini game's main flow holds info: infoFlow, whose id is "infoPopup".
   * isolate(infoFeature, { flow: infoFlow, as: "info", player: { count: 0 } });
   * // paths read "info/show", as in the game
   * ```
   */
  as?: string;
  /** The shared layer, composed as `logicOnly` before the feature. */
  shared?: Flow.FeaturePlugin;
  /** Node name of `flow` to the stub that replaces it. A node not listed runs for real. */
  stubs?: StubsOf<Nodes>;
  /** More plugins the feature needs headless, for example a feature-own plugin. */
  plugins?: readonly AnyPluginInstance[];
  /** The player a new save starts from. */
  player: Model.Json;
  /** The session at start. `{}` by default. */
  session?: Model.Json;
  /** The rng seed. `1` by default. */
  seed?: number;
};

/**
 * What one app of an isolated feature may pin over the options.
 *
 * @example
 * ```ts
 * const game = await createHeadless(boardOnly({ player: { ...fresh, coins: 7 }, clock: fakeClock(1_000_000) }));
 * ```
 */
export type IsolateSeams = {
  /** The player this app starts from, instead of `options.player`. */
  player?: Model.Json;
  /** The session this app starts with, instead of `options.session`. */
  session?: Model.Json;
  /** The rng seed of this app, instead of `options.seed`. */
  seed?: number;
  /** The clock source of this app, `fakeClock()` in a test. The system clock by default. */
  clock?: Clock.ClockSource;
};

/**
 * An app of an isolated feature, as `createApp` returns it: not started, the engine's logic
 * plugins on it.
 */
type IsolatedApp = ReturnType<typeof createApp>;

/**
 * A stub: the replaced node or sub-flow ends at once with this outcome. Written as a sub-flow of
 * one transit node, so a route can still substitute it for one visit:
 * `{ at: "board/energy", result: { outcome: "watch" } }`.
 *
 * @param outcome - An outcome the replaced entry declares.
 * @param payload - The payload it carries, for an outcome with data.
 * @returns The stub as plain data.
 * @example
 * ```ts
 * stub("closed"); // { kind: "stub", outcome: "closed" }
 * stub("orderComplete", { rewardId: "r1" }); // { kind: "stub", outcome: "orderComplete", payload: { rewardId: "r1" } }
 * ```
 */
export function stub<const Name extends string>(outcome: Name, payload?: Model.Json): Stub<Name> {
  return payload === undefined ? { kind: "stub", outcome } : { kind: "stub", outcome, payload };
}

/**
 * Builds the sub-flow `stub:<name>` that replaces one entry: one transit node `end` that ends
 * with the stub's outcome. Input and outcomes are the replaced entry's, and every outcome leaves
 * the sub-flow, so the parent's edge table stays valid and a route can substitute it by path.
 *
 * @param name - The node name of the replaced entry.
 * @param original - The replaced node, sub-flow or slot.
 * @param stubbed - The stub.
 * @returns The sub-flow.
 * @throws {Error} When the replaced entry does not declare the stub's outcome.
 */
function stubEntry(name: string, original: Flow.FlowEntry, stubbed: Stub): Flow.AnyFlow {
  const outcomes = original.outcomes;

  if (!Object.hasOwn(outcomes, stubbed.outcome)) {
    throw new Error(
      `[game] stub at "${name}" ends with "${stubbed.outcome}", which "${name}" does not declare.\n  Use one of: ${Object.keys(outcomes).join(", ")}.`
    );
  }

  const end: Flow.AnyNode = {
    kind: "node",
    input: original.input,
    outcomes,
    rest: false,
    over: false,
    checkpoint: false,
    barrier: false,
    inbox: [],
    run: () => ({ outcome: stubbed.outcome, payload: stubbed.payload ?? noPayload })
  };
  const exits = Object.fromEntries(Object.keys(outcomes).map(outcome => [outcome, exit(outcome)]));

  return {
    kind: "flow",
    id: `stub:${name}`,
    input: original.input,
    outcomes,
    nodes: { [endName]: end },
    start: endName,
    edges: { [endName]: exits }
  };
}

/**
 * Rebuilds a flow with the stubs applied by node name. The flow itself is never changed; without
 * stubs it is returned as it is. A key whose stub is `undefined` stubs nothing.
 *
 * @param flow - The feature's flow.
 * @param stubs - Node name to the stub that replaces it.
 * @returns The flow with the stubbed entries replaced.
 * @throws {Error} For a key that is not a node of the flow, or an outcome the node does not declare.
 */
export function withStubs(
  flow: Flow.AnyFlow,
  stubs: Readonly<Partial<Record<string, Stub>>>
): Flow.AnyFlow {
  const entries = Object.entries(stubs).filter(
    (entry): entry is [string, Stub] => entry[1] !== undefined
  );

  if (entries.length === 0) return flow;

  const nodes: Record<string, Flow.FlowEntry> = { ...flow.nodes };

  for (const [name, stubbed] of entries) {
    // Own keys only: `flow.nodes.constructor` is a function for every object.
    const original = Object.hasOwn(flow.nodes, name) ? flow.nodes[name] : undefined;

    if (original === undefined) {
      throw new Error(
        `[game] isolate: no node "${name}" in flow "${flow.id}".\n  Stub keys are node names of the flow: ${Object.keys(flow.nodes).join(", ")}.`
      );
    }

    nodes[name] = stubEntry(name, original, stubbed);
  }

  return { ...flow, nodes };
}

/**
 * Builds the harness main flow `isolated`: the feature's flow as its node `name`, and, for a flow
 * with outcomes, the rest node `exited` that every exit leads to and whose intent `again` enters
 * the flow once more. An exit of the top-level flow would be fatal, so the flow is never the main
 * flow itself. A flow without outcomes gets no `exited`: it would be unreachable.
 *
 * @param flow - The feature's flow, stubs applied.
 * @param name - The node name the flow is held under: the key the game's main flow uses.
 * @returns The harness main flow.
 * @throws {Error} When a flow with outcomes is to be held under the name `exited`.
 */
export function harnessOf(flow: Flow.AnyFlow, name: string = flow.id): Flow.AnyFlow {
  const outcomes = Object.keys(flow.outcomes);
  const harness: Omit<Flow.AnyFlow, "nodes" | "edges"> = {
    kind: "flow",
    id: harnessId,
    input: type(),
    outcomes: {},
    start: name
  };

  if (outcomes.length === 0) return { ...harness, nodes: { [name]: flow }, edges: { [name]: {} } };

  if (name === exitedName) {
    throw new Error(
      `[game] isolate: "${exitedName}" is the rest node of the harness.\n  Pass another name in as.`
    );
  }

  const exited: Flow.AnyNode = {
    kind: "node",
    input: type<Model.Json>(),
    outcomes: { again: type() },
    rest: true,
    over: false,
    checkpoint: false,
    barrier: false,
    inbox: []
  };
  const toExited = Object.fromEntries(outcomes.map(outcome => [outcome, exitedName]));

  return {
    ...harness,
    nodes: { [name]: flow, [exitedName]: exited },
    edges: { [name]: toExited, [exitedName]: { again: name } }
  };
}

/**
 * Composes one feature without the rest of the game: the shared layer and the feature as
 * `logicOnly`, the feature's flow inside a harness main flow `isolated`, and every stubbed node
 * replaced by a sub-flow that ends with the stub's outcome. Every exit of the flow lands on the
 * rest node `exited`, whose intent `again` enters the flow once more. Paths read as in the game:
 * the harness holds the flow under `options.as`, its id by default. A node that is not stubbed
 * runs for real, even when it belongs to a feature that is not composed.
 *
 * @param feature - The feature under test.
 * @param options - Its flow, the shared layer, the stubs, the starting state.
 * @returns A factory of apps, not started; pass one to `createHeadless`.
 * @throws {Error} For a stub key that is not a node of the flow, or an outcome the node does not declare.
 * @example
 * ```ts
 * // features/board/__tests__/isolated/give.isolated.ts: energy and giveToOrder belong to other features.
 * const boardOnly = isolate(boardFeature, {
 *   shared: sharedLayer, flow: boardFlow, player: fresh,
 *   stubs: { energy: stub("later"), giveToOrder: stub("orderComplete", { rewardId: "r1" }) }
 * });
 * const game = await createHeadless(boardOnly({ player: { ...fresh, energy: 0 } }));
 * await game.walk([{ at: "board/awaitIntent", intent: "tap" }]); // noEnergy, the stubbed energy ends with later
 * game.state().path; // "board/awaitIntent"
 * await game.walk([{ at: "board/awaitIntent", intent: "give" }]);
 * game.state().path; // "exited": the flow left with orderComplete { rewardId: "r1" }
 * ```
 */
export function isolate<Nodes extends Flow.NodeTable>(
  feature: Flow.FeaturePlugin,
  options: IsolateOptions<Nodes>
): (seams?: IsolateSeams) => IsolatedApp {
  const mainFlow = harnessOf(withStubs(options.flow, options.stubs ?? {}), options.as);
  const shared = options.shared === undefined ? [] : [options.shared.logicOnly];
  const plugins = [...shared, feature.logicOnly, ...(options.plugins ?? [])];

  return (seams: IsolateSeams = {}): IsolatedApp =>
    createApp({
      plugins: [...plugins],
      pluginConfigs: {
        model: {
          initialPlayer: seams.player ?? options.player,
          initialSession: seams.session ?? options.session ?? {},
          seed: seams.seed ?? options.seed ?? defaultSeed
        },
        flow: { mainFlow },
        clock: { source: seams.clock }
      }
    });
}
