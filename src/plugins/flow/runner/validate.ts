/**
 * @file flow/runner — static graph validation. Every rule reads the graph as data and returns a
 * sentence; `run()` throws all of them at once, so one start names every problem.
 */
import type { FeaturesApi } from "../features/types";
import type { Config } from "../types";
import { findNode, slotNames } from "./registry";
import type { AnyFlow, FlowEntry, Target, ValidationReport } from "./types";

/** Nodes of one flow above which `validate` warns. A flow holds 7 to 15 nodes. */
const MAX_NODES = 15;

/**
 * Names the node an edge target leads to inside its own flow. An exit leads out of the flow and
 * has no node name.
 *
 * @param target - The target as the edge table holds it.
 * @returns The node name, or `undefined` for an exit.
 * @example
 * ```ts
 * const next = targetNode(flow.edges.merge?.done ?? "");
 * ```
 */
function targetNode(target: Target): string | undefined {
  if (typeof target === "string") return target;

  return target.kind === "exit" ? undefined : target.target;
}

/**
 * Whether an entry stops the graph and waits: a rest node, or a sub-flow that holds one.
 *
 * @param entry - A node, sub-flow or slot.
 * @param seen - Ids of the sub-flows already looked into.
 * @returns True when the graph can come to rest inside the entry.
 * @example
 * ```ts
 * const waits = entryRests(flow.nodes.board, new Set());
 * ```
 */
function entryRests(entry: FlowEntry, seen: Set<string>): boolean {
  if (entry.kind === "node") return entry.rest;
  if (entry.kind === "slot") return false;
  if (seen.has(entry.id)) return false;

  seen.add(entry.id);

  return Object.values(entry.nodes).some(child => entryRests(child, seen));
}

/**
 * The nodes of the same flow an entry leads to.
 *
 * @param flow - The flow being validated.
 * @param name - Name of the entry whose edges are read.
 * @returns Names of existing nodes of this flow.
 * @example
 * ```ts
 * const next = nextNodes(boardFlow, "merge");
 * ```
 */
function nextNodes(flow: AnyFlow, name: string): string[] {
  const row = flow.edges[name] ?? {};
  const names: string[] = [];

  for (const target of Object.values(row)) {
    const next = targetNode(target);

    if (next !== undefined && flow.nodes[next]) names.push(next);
  }

  return names;
}

/**
 * Reports an edge target that names nothing: an unknown node, or an exit with an outcome the
 * flow does not declare.
 *
 * @param flow - The flow being validated.
 * @param name - Name of the node the edge starts at.
 * @param outcome - Outcome the edge belongs to.
 * @param target - The target as written.
 * @returns The problem, or `undefined` when the target exists.
 * @example
 * ```ts
 * const problem = targetProblem(boardFlow, "merge", "done", "awaitIntnet");
 * ```
 */
function targetProblem(
  flow: AnyFlow,
  name: string,
  outcome: string,
  target: Target
): string | undefined {
  if (typeof target !== "string" && target.kind === "exit") {
    if (target.outcome in flow.outcomes) return undefined;

    return `[game] Flow "${flow.id}": exit("${target.outcome}") of node "${name}" names no outcome of the flow.\n  Declare outcomes.${target.outcome} on flow "${flow.id}".`;
  }

  const next = typeof target === "string" ? target : target.target;

  if (flow.nodes[next]) return undefined;

  return `[game] Flow "${flow.id}": the edge of outcome "${outcome}" of node "${name}" names no node "${next}".\n  Point edges.${name}.${outcome} at a node of "${flow.id}".`;
}

/**
 * Whether an edge leads to a rest node of the same flow. A barrier needs one: the model's rest
 * point and the runner's rest frame have to move together.
 *
 * @param flow - The flow being validated.
 * @param target - The target as written.
 * @returns True when the target is a rest node of this flow.
 * @example
 * ```ts
 * const safe = leadsToRest(boardFlow, "home");
 * ```
 */
function leadsToRest(flow: AnyFlow, target: Target): boolean {
  const next = targetNode(target);
  const entry = next === undefined ? undefined : flow.nodes[next];

  return entry?.kind === "node" && entry.rest;
}

/**
 * Reports the edges of one flow: an outcome without an edge, a target that does not exist and a
 * barrier edge that does not reach a rest node of the same flow.
 *
 * @param flow - The flow being validated.
 * @returns One sentence per problem.
 * @example
 * ```ts
 * const problems = edgeProblems(boardFlow);
 * ```
 */
function edgeProblems(flow: AnyFlow): string[] {
  const problems: string[] = [];

  for (const [name, entry] of Object.entries(flow.nodes)) {
    const barrier = entry.kind === "node" && entry.barrier;

    for (const outcome of Object.keys(entry.outcomes)) {
      const target = flow.edges[name]?.[outcome];

      if (target === undefined) {
        problems.push(
          `[game] Flow "${flow.id}": outcome "${outcome}" of node "${name}" has no edge.\n  Add edges.${name}.${outcome}.`
        );
        continue;
      }

      const problem = targetProblem(flow, name, outcome, target);

      if (problem) problems.push(problem);

      if (barrier && !leadsToRest(flow, target)) {
        problems.push(
          `[game] Flow "${flow.id}": the edge of outcome "${outcome}" of barrier node "${name}" does not lead to a rest node of "${flow.id}".\n  Point edges.${name}.${outcome} at a rest node of the same flow.`
        );
      }
    }
  }

  return problems;
}

/**
 * Reports the nodes of one flow: a slot without a name, an `inbox` type that is not an outcome
 * and a rest node with neither outcomes nor a body.
 *
 * @param flow - The flow being validated.
 * @returns One sentence per problem.
 * @example
 * ```ts
 * const problems = nodeProblems(boardFlow);
 * ```
 */
function nodeProblems(flow: AnyFlow): string[] {
  const problems: string[] = [];

  for (const [name, entry] of Object.entries(flow.nodes)) {
    if (entry.kind === "slot" && !entry.name) {
      problems.push(
        `[game] Flow "${flow.id}": the slot node "${name}" has no slot name.\n  Give it a name: slot("${name}").`
      );
    }

    if (entry.kind !== "node") continue;

    for (const type of entry.inbox) {
      if (type in entry.outcomes) continue;

      problems.push(
        `[game] Flow "${flow.id}": inbox type "${type}" of node "${name}" is not an outcome.\n  Add outcomes.${type} to node "${name}".`
      );
    }

    if (entry.rest && !entry.run && Object.keys(entry.outcomes).length === 0) {
      problems.push(
        `[game] Flow "${flow.id}": rest node "${name}" has neither outcomes nor a run body.\n  Declare outcomes or add a run body.`
      );
    }
  }

  return problems;
}

/**
 * Reports a start node that is not in `nodes`, and every node the start cannot reach.
 *
 * @param flow - The flow being validated.
 * @returns One sentence per problem.
 * @example
 * ```ts
 * const problems = reachProblems(boardFlow);
 * ```
 */
function reachProblems(flow: AnyFlow): string[] {
  if (!flow.nodes[flow.start]) {
    return [
      `[game] Flow "${flow.id}": the start node "${flow.start}" is not in nodes.\n  Set start to a node of "${flow.id}".`
    ];
  }

  const seen = new Set([flow.start]);
  const queue = [flow.start];

  for (const name of queue) {
    for (const next of nextNodes(flow, name)) {
      if (seen.has(next)) continue;

      seen.add(next);
      queue.push(next);
    }
  }

  return Object.keys(flow.nodes)
    .filter(name => !seen.has(name))
    .map(
      name =>
        `[game] Flow "${flow.id}": node "${name}" cannot be reached from the start node "${flow.start}".\n  Add an edge to it or remove it from nodes.`
    );
}

/**
 * Walks the transit nodes of a flow and returns the first cycle that passes no rest node.
 *
 * @param flow - The flow being validated.
 * @param name - Node the walk stands on.
 * @param path - Nodes on the way here, in order.
 * @param done - Nodes already proven to start no cycle.
 * @returns The cycle, first node repeated at the end, or `undefined`.
 * @example
 * ```ts
 * const cycle = findCycle(boardFlow, "merge", [], new Set());
 * ```
 */
function findCycle(
  flow: AnyFlow,
  name: string,
  path: readonly string[],
  done: Set<string>
): string[] | undefined {
  const entry = flow.nodes[name];

  if (!entry || entryRests(entry, new Set())) return undefined;

  const start = path.indexOf(name);

  if (start !== -1) return path.slice(start);
  if (done.has(name)) return undefined;

  for (const next of nextNodes(flow, name)) {
    const cycle = findCycle(flow, next, [...path, name], done);

    if (cycle) return cycle;
  }

  done.add(name);

  return undefined;
}

/**
 * Reports every cycle of transit nodes: a game that enters one never answers the player again.
 *
 * @param flow - The flow being validated.
 * @returns One sentence per cycle.
 * @example
 * ```ts
 * const problems = cycleProblems(boardFlow);
 * ```
 */
function cycleProblems(flow: AnyFlow): string[] {
  const problems: string[] = [];
  const done = new Set<string>();

  for (const name of Object.keys(flow.nodes)) {
    const cycle = findCycle(flow, name, [], done);

    if (!cycle) continue;

    for (const member of cycle) done.add(member);

    problems.push(
      `[game] Flow "${flow.id}": the nodes "${cycle.join(", ")}" form a cycle with no rest node.\n  Mark one of them rest: true.`
    );
  }

  return problems;
}

/**
 * Reports two different flows that use one id: a path would then name two positions.
 *
 * @param flows - Every collected flow by id.
 * @returns One sentence per colliding id.
 * @example
 * ```ts
 * const problems = flowIdProblems(flows);
 * ```
 */
function flowIdProblems(flows: ReadonlyMap<string, AnyFlow>): string[] {
  const problems: string[] = [];
  const reported = new Set<string>();

  for (const flow of flows.values()) {
    for (const entry of Object.values(flow.nodes)) {
      if (entry.kind !== "flow" || flows.get(entry.id) === entry) continue;
      if (reported.has(entry.id)) continue;

      reported.add(entry.id);
      problems.push(
        `[game] Two different flows use the id "${entry.id}".\n  Give every flow a unique id.`
      );
    }
  }

  return problems;
}

/**
 * Reports a feature whose name is already the id of a flow, and two contributions of one slot
 * that carry the same `order`.
 *
 * @param flows - Every collected flow by id.
 * @param features - Features API: names and slot contributions.
 * @returns One sentence per problem.
 * @example
 * ```ts
 * const problems = featureProblems(flows, features);
 * ```
 */
function featureProblems(flows: ReadonlyMap<string, AnyFlow>, features: FeaturesApi): string[] {
  const problems: string[] = [];

  for (const { name } of features.all()) {
    if (!flows.has(name)) continue;

    problems.push(
      `[game] Feature "${name}" uses the id of a flow.\n  Rename the feature or the flow.`
    );
  }

  for (const slotName of slotNames(flows)) {
    const byOrder = new Map<number, string>();

    for (const { feature, order } of features.contributions(slotName)) {
      const first = byOrder.get(order);

      if (first === undefined) {
        byOrder.set(order, feature);
        continue;
      }

      problems.push(
        `[game] Slot "${slotName}": the features "${first}" and "${feature}" both contribute with order ${order}.\n  Give every contribution of a slot a different order.`
      );
    }
  }

  return problems;
}

/**
 * Reports a `safeNode` that is not a node of the graph or not a checkpoint. The runner enters it
 * after a failed retry, so it has to build its whole screen from state.
 *
 * @param config - Resolved flow config: `mainFlow`, `safeNode`.
 * @returns One sentence, or none.
 * @example
 * ```ts
 * const problems = safeNodeProblems(ctx.config);
 * ```
 */
function safeNodeProblems(config: Readonly<Config>): string[] {
  const { mainFlow, safeNode } = config;

  if (!mainFlow || safeNode === undefined) return [];

  const location = findNode(mainFlow, safeNode);

  if (!location) {
    return [
      `[game] The safe node "${safeNode}" is not a node of the graph.\n  Set flow.safeNode to the path of a checkpoint node.`
    ];
  }

  if (location.entry.kind === "node" && location.entry.checkpoint) return [];

  return [
    `[game] The safe node "${safeNode}" is not a checkpoint.\n  Mark it checkpoint: true or choose another rest node.`
  ];
}

/**
 * Warns about a flow that grew past fifteen nodes. It is a warning, never a problem: a big flow
 * still runs, it is only hard to read.
 *
 * @param flow - The flow being validated.
 * @returns One sentence, or none.
 * @example
 * ```ts
 * const warnings = sizeWarnings(boardFlow);
 * ```
 */
function sizeWarnings(flow: AnyFlow): string[] {
  const count = Object.keys(flow.nodes).length;

  if (count <= MAX_NODES) return [];

  return [
    `[game] Flow "${flow.id}" has ${count} nodes.\n  Split it into sub-flows of 7 to 15 nodes.`
  ];
}

/**
 * Validates the whole graph at `run()` and returns every problem as one `[game] …` sentence:
 * unreachable node, outcome without an edge, missing target, barrier edge that does not reach a
 * rest node of the same flow, cycle with no rest node, slot without a name, equal contribution
 * `order`, `inbox` type that is not an outcome, rest node with neither `run` nor outcomes,
 * `safeNode` that is not a checkpoint, colliding ids. Types are bypassed by JSON data and casts,
 * so this runs even though the edge table is checked at compile time.
 *
 * @param flows - Every collected flow by id, the main flow first.
 * @param features - Features API: slot contributions and feature names.
 * @param config - Resolved flow config: `mainFlow`, `safeNode`.
 * @returns Problems that stop `run()`, and warnings for the caller to log.
 * @example
 * ```ts
 * const { problems, warnings } = validateGraph(flows, features, config);
 * if (problems.length > 0) throw new Error(problems.join("\n"));
 * ```
 */
export function validateGraph(
  flows: ReadonlyMap<string, AnyFlow>,
  features: FeaturesApi,
  config: Readonly<Config>
): ValidationReport {
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const flow of flows.values()) {
    problems.push(
      ...edgeProblems(flow),
      ...nodeProblems(flow),
      ...reachProblems(flow),
      ...cycleProblems(flow)
    );
    warnings.push(...sizeWarnings(flow));
  }

  problems.push(
    ...flowIdProblems(flows),
    ...featureProblems(flows, features),
    ...safeNodeProblems(config)
  );

  return { problems, warnings };
}
