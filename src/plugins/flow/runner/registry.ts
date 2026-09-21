/**
 * @file flow/runner — flow registry, path lookup and graph description. Everything here reads
 * the graph as data: no node is run, no state is touched.
 */
import type { FeaturesApi } from "../features/types";
import { hashText } from "./journal";
import type {
  AnyFlow,
  FlowEntry,
  FlowGraph,
  Frame,
  GraphNode,
  NodeLocation,
  Target
} from "./types";

/**
 * Creates the empty flow map. It lives in its own function because the plugin's lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty map of flow id to flow.
 * @example
 * ```ts
 * const flows = emptyFlows();
 * ```
 */
function emptyFlows(): Map<string, AnyFlow> {
  return new Map();
}

/**
 * Adds a flow and every flow it reaches by reference to the map. The first flow under an id wins,
 * so a collision is visible to `validateGraph` instead of silently replacing a flow.
 *
 * @param flow - The flow to add.
 * @param flows - The map being filled.
 * @example
 * ```ts
 * addFlow(mainFlow, flows);
 * ```
 */
function addFlow(flow: AnyFlow, flows: Map<string, AnyFlow>): void {
  if (flows.has(flow.id)) return;

  flows.set(flow.id, flow);

  for (const entry of Object.values(flow.nodes)) {
    if (entry.kind === "flow") addFlow(entry, flows);
  }
}

/**
 * Collects every flow reachable from the main flow by reference, plus the registered extras.
 * The main flow is the first entry: `describeGraph` reads it as the entry point of the graph.
 *
 * @param main - The top-level flow.
 * @param extra - Flows added with `register`, not reachable by reference.
 * @returns Flow id to flow, main first.
 * @example
 * ```ts
 * const flows = collectFlows(mainFlow, [debugFlow]);
 * ```
 */
export function collectFlows(main: AnyFlow, extra: readonly AnyFlow[]): Map<string, AnyFlow> {
  const flows = emptyFlows();

  addFlow(main, flows);

  for (const flow of extra) addFlow(flow, flows);

  return flows;
}

/**
 * Renders a position as a path: the node of every frame, outermost first.
 *
 * @param stack - One frame per nesting level.
 * @returns The path, for example `"board/awaitIntent"`; empty without a position.
 * @example
 * ```ts
 * const path = framePath(ctx.state.runner.stack);
 * ```
 */
export function framePath(stack: readonly Frame[]): string {
  return stack.map(frame => frame.node).join("/");
}

/**
 * Finds the node, sub-flow or slot a path names, starting at the main flow. A path descends one
 * sub-flow per segment; a segment after a plain node finds nothing.
 *
 * @param main - The top-level flow.
 * @param path - A path as `framePath` renders it.
 * @returns Where the path leads, or `undefined` when no such node exists.
 * @example
 * ```ts
 * const location = findNode(mainFlow, "board/awaitIntent");
 * ```
 */
export function findNode(main: AnyFlow, path: string): NodeLocation | undefined {
  const names = path.split("/").filter(Boolean);
  const trail: { flow: string; node: string }[] = [];
  let flow = main;

  for (const [step, name] of names.entries()) {
    const entry = flow.nodes[name];

    if (!entry) return undefined;

    trail.push({ flow: flow.id, node: name });

    if (step === names.length - 1) return { flow, name, entry, trail };
    if (entry.kind !== "flow") return undefined;

    flow = entry;
  }

  return undefined;
}

/**
 * Renders an edge target as a string: a node name, `"exit:win"` or `"map:node"`.
 *
 * @param target - The target as the edge table holds it.
 * @returns The rendered target.
 * @example
 * ```ts
 * const next = renderTarget(flow.edges.merge?.done);
 * ```
 */
function renderTarget(target: Target): string {
  if (typeof target === "string") return target;

  return target.kind === "exit" ? `exit:${target.outcome}` : `map:${target.target}`;
}

/**
 * Renders the edge table of one flow.
 *
 * @param flow - The flow to render.
 * @returns Node name to outcome name to rendered target.
 * @example
 * ```ts
 * const edges = renderEdges(boardFlow);
 * ```
 */
function renderEdges(flow: AnyFlow): Record<string, Record<string, string>> {
  const edges: Record<string, Record<string, string>> = {};

  for (const [name, row] of Object.entries(flow.edges)) {
    const rendered: Record<string, string> = {};

    for (const [outcome, target] of Object.entries(row)) rendered[outcome] = renderTarget(target);

    edges[name] = rendered;
  }

  return edges;
}

/**
 * Maps every node and flow a feature brought to the name of that feature.
 *
 * @param features - Features API.
 * @returns Node or flow object to feature name.
 * @example
 * ```ts
 * const owners = collectOwners(features);
 * ```
 */
function collectOwners(features: FeaturesApi): Map<object, string> {
  const owners = new Map<object, string>();

  for (const { name, description } of features.all()) {
    for (const node of description.nodes ?? []) owners.set(node, name);
    for (const flow of description.flows ?? []) owners.set(flow, name);
  }

  return owners;
}

/**
 * Describes one entry of a flow: its flags, its outcome names, and the slot, sub-flow or owning
 * feature when it has one.
 *
 * @param flow - The flow that holds the entry.
 * @param name - Name of the entry inside that flow.
 * @param entry - The node, sub-flow or slot.
 * @param owner - Name of the feature that brought it, when a feature did.
 * @returns The entry as JSON.
 * @example
 * ```ts
 * const node = describeNode(boardFlow, "merge", merge, "board");
 * ```
 */
function describeNode(
  flow: AnyFlow,
  name: string,
  entry: FlowEntry,
  owner: string | undefined
): GraphNode {
  const node = entry.kind === "node" ? entry : undefined;

  return {
    path: `${flow.id}/${name}`,
    flow: flow.id,
    node: name,
    rest: node?.rest ?? false,
    over: node?.over ?? false,
    checkpoint: node?.checkpoint ?? false,
    barrier: node?.barrier ?? false,
    outcomes: Object.keys(entry.outcomes),
    ...(entry.kind === "slot" ? { slot: entry.name } : {}),
    ...(entry.kind === "flow" ? { subFlow: entry.id } : {}),
    ...(owner === undefined ? {} : { owner })
  };
}

/**
 * Describes every entry of one flow.
 *
 * @param flow - The flow to describe.
 * @param owners - Node or flow object to feature name.
 * @returns Node name to description.
 * @example
 * ```ts
 * const nodes = describeNodes(boardFlow, owners);
 * ```
 */
function describeNodes(flow: AnyFlow, owners: Map<object, string>): Record<string, GraphNode> {
  const nodes: Record<string, GraphNode> = {};

  for (const [name, entry] of Object.entries(flow.nodes)) {
    nodes[name] = describeNode(flow, name, entry, owners.get(entry) ?? owners.get(flow));
  }

  return nodes;
}

/**
 * Collects the slot names of every flow of the graph. `describe()` and `validate` both read the
 * contributions of exactly these slots.
 *
 * @param flows - Every collected flow by id.
 * @returns The slot names, in the order the graph declares them, each once.
 * @example
 * ```ts
 * const names = slotNames(flows);
 * ```
 */
export function slotNames(flows: ReadonlyMap<string, AnyFlow>): string[] {
  const names: string[] = [];

  for (const flow of flows.values()) {
    for (const entry of Object.values(flow.nodes)) {
      if (entry.kind === "slot" && !names.includes(entry.name)) names.push(entry.name);
    }
  }

  return names;
}

/**
 * Renders the whole graph as JSON without running the game: nodes, flags, outcomes, edges,
 * slots and who contributed. Edge targets become `"node"`, `"exit:win"`, `"map:node"`.
 *
 * @param flows - Every collected flow by id, the main flow first, as `collectFlows` returns them.
 * @param features - Features API: owners and slot contributions.
 * @returns The graph as plain JSON.
 * @example
 * ```ts
 * const graph = describeGraph(flows, features);
 * ```
 */
export function describeGraph(
  flows: ReadonlyMap<string, AnyFlow>,
  features: FeaturesApi
): FlowGraph {
  const owners = collectOwners(features);
  const described: FlowGraph["flows"] = {};
  const slots: FlowGraph["slots"] = {};

  for (const flow of flows.values()) {
    described[flow.id] = {
      nodes: describeNodes(flow, owners),
      start: flow.start,
      edges: renderEdges(flow)
    };
  }

  for (const name of slotNames(flows)) {
    slots[name] = features
      .contributions(name)
      .map(({ feature, flow, order }) => ({ feature, flow: flow.id, order }));
  }

  return { main: [...flows.keys()][0] ?? "", flows: described, slots };
}

/**
 * Compares two object keys without a locale, so the rendering is the same everywhere.
 *
 * @param first - First key.
 * @param second - Second key.
 * @returns A negative number, zero or a positive number.
 * @example
 * ```ts
 * entries.sort(([first], [second]) => compareKeys(first, second));
 * ```
 */
function compareKeys(first: string, second: string): number {
  if (first === second) return 0;

  return first < second ? -1 : 1;
}

/**
 * Renders a JSON value with its object keys sorted, so two equal graphs written in a different
 * order hash the same.
 *
 * @param value - Any JSON value.
 * @returns The value as text.
 * @example
 * ```ts
 * const text = stableJson({ b: 1, a: 2 });
 * ```
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item)).join(",")}]`;

  if (typeof value !== "object" || !value) return JSON.stringify(value) ?? "";

  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .toSorted(([first], [second]) => compareKeys(first, second));
  const fields = entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);

  return `{${fields.join(",")}}`;
}

/**
 * Hashes a graph description. A bookmark of a plain rest node is accepted only while this hash
 * is unchanged.
 *
 * @param graph - Result of `describeGraph`.
 * @returns Eight lowercase hexadecimal characters.
 * @example
 * ```ts
 * const hash = graphHash(describeGraph(flows, features));
 * ```
 */
export function graphHash(graph: FlowGraph): string {
  return hashText(stableJson(graph));
}
