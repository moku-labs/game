/**
 * @file flow plugin — the fixtures of the perf tests and benches. Not a test file. A game-sized graph (40 window
 * flows of 12 nodes under one hub, the size of A Memory Missing) and the `describe()` a rest of `assets` calls on it.
 */
import { createFeaturesApi } from "../../features/api";
import { graphOf } from "../../runner/graph";
import { createRunnerState } from "../../runner/state";
import type { AnyFlow, AnyNode, AnyTypeTag, FlowEntry, Target } from "../../runner/types";
import type { FlowCtx } from "../../types";

/** Window flows under the hub. */
const WINDOWS = 40;

/** Nodes of each window flow. */
const NODES = 12;

const tag: AnyTypeTag = { kind: "type" };

/**
 * Builds one node with two outcomes, `next` and `close`.
 *
 * @param rest - Whether the node rests.
 * @returns The node.
 */
function step(rest: boolean): AnyNode {
  return {
    kind: "node",
    input: tag,
    outcomes: { next: tag, close: tag },
    rest,
    over: false,
    checkpoint: false,
    barrier: false,
    inbox: []
  };
}

/**
 * Builds one window flow: a chain of nodes, the first resting, the last leaving through `close`.
 *
 * @param id - Id of the flow.
 * @returns The flow.
 */
function windowFlow(id: string): AnyFlow {
  const nodes: Record<string, FlowEntry> = {};
  const edges: Record<string, Record<string, Target>> = {};

  for (let at = 0; at < NODES; at += 1) {
    nodes[`n${at}`] = step(at === 0);
    edges[`n${at}`] = { next: at + 1 < NODES ? `n${at + 1}` : "n0", close: "exit:closed" };
  }

  return { kind: "flow", id, input: tag, outcomes: { closed: tag }, nodes, start: "n0", edges };
}

/**
 * Builds the context `graphOf` reads: the main flow of the hub and its windows, the features sealed or not.
 *
 * @param sealed - Whether `run()` sealed the features.
 * @returns The context and the features API.
 */
function graphContext(sealed: boolean) {
  const nodes: Record<string, FlowEntry> = { hub: step(true) };
  const edges: Record<string, Record<string, Target>> = { hub: {} };
  const hub = edges.hub ?? {};

  for (let at = 0; at < WINDOWS; at += 1) {
    nodes[`w${at}`] = windowFlow(`window${at}`);
    hub[`open${at}`] = `w${at}`;
    edges[`w${at}`] = { closed: "hub" };
  }

  const main: AnyFlow = {
    kind: "flow",
    id: "main",
    input: tag,
    outcomes: {},
    nodes,
    start: "hub",
    edges
  };
  const ctx = {
    config: { mainFlow: main },
    state: {
      runner: createRunnerState(),
      features: { byName: new Map(), parentOf: new Map(), sealed }
    }
  } as unknown as FlowCtx;

  return { ctx, features: createFeaturesApi(ctx) };
}

/**
 * The `describe()` of the game-sized graph, as `assets` calls it at every rest.
 *
 * @param sealed - Whether `run()` sealed the features: after it the graph is rendered once.
 * @returns The call.
 */
export function describeCall(sealed: boolean): () => void {
  const { ctx, features } = graphContext(sealed);

  return () => void graphOf(ctx, features);
}
