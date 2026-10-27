/**
 * @file flow/runner — static graph validation. Every rule reads the graph as data and returns a
 * sentence; `run()` throws all of them at once, so one start names every problem.
 */
import type { Contribution, FeaturesApi } from "../features/types";
import type { Config } from "../types";
import { findNode, slotNames } from "./registry";
import type { AnyFlow, FlowEntry, OutcomeTags, Target, ValidationReport } from "./types";

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
 * targetNode("home"); // "home"
 * targetNode({ kind: "exit", outcome: "left" }); // undefined
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
 * entryRests(boardFlow, new Set()); // true: "awaitIntent" rests inside it
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
 * nextNodes(boardFlow, "awaitIntent");
 * // ["tapGenerator", "merge", "giveToOrder", "catchUp"]: exit("left") names no node
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
 * targetProblem(boardFlow, "merge", "done", "awaitIntent"); // undefined: the node exists
 * targetProblem(boardFlow, "merge", "done", "awaitIntnet"); // a sentence: … names no node …
 * ```
 */
function targetProblem(
  flow: AnyFlow,
  name: string,
  outcome: string,
  target: Target
): string | undefined {
  if (typeof target !== "string" && target.kind === "exit") {
    // Own keys only: `"constructor" in outcomes` is true for every object.
    if (Object.hasOwn(flow.outcomes, target.outcome)) return undefined;

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
 * leadsToRest(boardFlow, "awaitIntent"); // true
 * leadsToRest(boardFlow, { kind: "exit", outcome: "left" }); // false
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
 * edgeProblems(boardFlow); // []: every outcome has an edge and every target exists
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
 * nodeProblems(boardFlow); // []: "elapsed" of awaitIntent.inbox is one of its outcomes
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
      if (Object.hasOwn(entry.outcomes, type)) continue;

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
 * Reports a `recover` on a node that does not rest. The recovery makes its node the rest point
 * of the loop, so only a rest node can carry one.
 *
 * @param flow - The flow being validated.
 * @returns One sentence per problem.
 * @example
 * ```ts
 * recoverProblems(boardFlow); // []: no transit node of the board has a recover
 * ```
 */
function recoverProblems(flow: AnyFlow): string[] {
  const problems: string[] = [];

  for (const [name, entry] of Object.entries(flow.nodes)) {
    if (entry.kind !== "node" || entry.recover === undefined || entry.rest) continue;

    problems.push(
      `[game] Flow "${flow.id}": node "${name}" has recover but is not a rest node.\n  Add rest: true, or remove recover.`
    );
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
 * reachProblems(boardFlow); // []: every node is reached from "awaitIntent"
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
 * findCycle(boardFlow, "merge", [], new Set()); // undefined: "merge" leads to a rest node
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
 * cycleProblems(boardFlow); // []: every way round passes the rest node "awaitIntent"
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
 * flowIdProblems(collectFlows(mainFlow, [])); // []: "main" and "board" differ
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
 * Reports a feature whose name is already the id of a flow, two contributions of one slot that
 * carry the same `order`, and one flow contributed twice to the same slot: the runner finds a
 * finished contribution by its flow id, so the slot would re-enter the first of the two forever.
 *
 * @param flows - Every collected flow by id.
 * @param features - Features API: names and slot contributions.
 * @returns One sentence per problem.
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
    const byFlow = new Set<string>();

    for (const { feature, flow, order } of features.contributions(slotName)) {
      const first = byOrder.get(order);

      if (first === undefined) byOrder.set(order, feature);
      else {
        problems.push(
          `[game] Slot "${slotName}": the features "${first}" and "${feature}" both contribute with order ${order}.\n  Give every contribution of a slot a different order.`
        );
      }

      if (byFlow.has(flow.id)) {
        problems.push(
          `[game] Slot "${slotName}": flow "${flow.id}" is contributed twice.\n  Contribute a flow to one slot once.`
        );
        continue;
      }

      byFlow.add(flow.id);
    }
  }

  return problems;
}

/** One slot node of the graph: the flow that holds it and the outcomes it declares. */
type SlotDeclaration = { flow: string; declared: readonly string[] };

/** The slot nodes of one slot name, in graph order: there is always a first. */
type SlotDeclarations = [SlotDeclaration, ...SlotDeclaration[]];

/**
 * Names the outcomes of a table besides `done`: what a slot declares, or what a contributed flow
 * may leave its slot on.
 *
 * @param outcomes - The outcome table of a slot or a flow.
 * @returns The outcome names other than `done`, in declaration order.
 * @example
 * ```ts
 * declaredOutcomes({ done: type(), shop: type() }); // ["shop"]
 * ```
 */
function declaredOutcomes(outcomes: OutcomeTags): string[] {
  return Object.keys(outcomes).filter(name => name !== "done");
}

/**
 * Tells whether two lists hold the same names, in any order.
 *
 * @param first - One list of names.
 * @param second - The other list.
 * @returns True when every name of one is in the other and the lengths match.
 * @example
 * ```ts
 * sameNames(["shop", "board"], ["board", "shop"]); // true
 * ```
 */
function sameNames(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every(name => second.includes(name));
}

/**
 * Collects every slot node of the graph by slot name: the flow that holds it and what it
 * declares, in the order the graph declares them.
 *
 * @param flows - Every collected flow by id.
 * @returns Slot name to its slot nodes, at least one each.
 */
function slotDeclarations(flows: ReadonlyMap<string, AnyFlow>): Map<string, SlotDeclarations> {
  const declarations = new Map<string, SlotDeclarations>();

  for (const flow of flows.values()) {
    for (const entry of Object.values(flow.nodes)) {
      if (entry.kind !== "slot") continue;

      const declaration = { flow: flow.id, declared: declaredOutcomes(entry.outcomes) };
      const list = declarations.get(entry.name);

      if (list === undefined) declarations.set(entry.name, [declaration]);
      else list.push(declaration);
    }
  }

  return declarations;
}

/**
 * Reports the contributions of a slot that declares outcomes and that may leave it on an outcome
 * the slot does not declare: the loop would have no edge for it.
 *
 * @param slotName - Name of the slot.
 * @param declared - The outcomes the slot declares besides `done`.
 * @param contributions - The contributions of the slot.
 * @returns One sentence per contribution and outcome.
 */
function undeclaredExits(
  slotName: string,
  declared: readonly string[],
  contributions: readonly Contribution[]
): string[] {
  const problems: string[] = [];

  for (const { feature, flow } of contributions) {
    for (const outcome of declaredOutcomes(flow.outcomes)) {
      if (declared.includes(outcome)) continue;

      problems.push(
        `[game] Slot "${slotName}": flow "${flow.id}" of feature "${feature}" exits "${outcome}", which the slot does not declare.\n  Declare slot("${slotName}", { ${outcome}: type() }) or exit "done".`
      );
    }
  }

  return problems;
}

/**
 * Reports the named outcomes of slots: one slot name declared with different outcomes in two
 * places, and a contribution of a slot that declares outcomes which may leave it on another one.
 * A slot that declares none takes any contribution: what it ignores is a warning.
 *
 * @param flows - Every collected flow by id.
 * @param features - Features API, read for the contributions of every slot.
 * @returns One sentence per problem.
 */
function slotOutcomeProblems(flows: ReadonlyMap<string, AnyFlow>, features: FeaturesApi): string[] {
  const problems: string[] = [];

  for (const [slotName, [first, ...others]] of slotDeclarations(flows)) {
    for (const other of others) {
      if (sameNames(first.declared, other.declared)) continue;

      problems.push(
        `[game] Slot "${slotName}" declares different outcomes in flow "${first.flow}" and flow "${other.flow}".\n  Declare the slot once and use it in both flows.`
      );
    }

    if (first.declared.length === 0) continue;

    problems.push(...undeclaredExits(slotName, first.declared, features.contributions(slotName)));
  }

  return problems;
}

/**
 * Warns about the named exits of contributions that a slot declaring no outcomes ignores: the
 * slot hands over to its next contribution as after `done`.
 *
 * @param slotName - Name of the slot.
 * @param contributions - The contributions of the slot.
 * @returns One warning per contribution and outcome.
 */
function ignoredExits(slotName: string, contributions: readonly Contribution[]): string[] {
  return contributions.flatMap(({ flow }) =>
    declaredOutcomes(flow.outcomes).map(
      outcome =>
        `[game] Slot "${slotName}": flow "${flow.id}" exits "${outcome}", which the slot ignores.\n  Declare slot("${slotName}", { ${outcome}: type() }) to route it, or exit "done".`
    )
  );
}

/**
 * Warns about contributions without `when` in a slot that declares outcomes: a named exit leaves
 * the slot, so a later one runs only when the one before it exits `done`.
 *
 * @param slotName - Name of the slot.
 * @param contributions - The contributions of the slot, in order.
 * @returns One warning per contribution without `when` after the first one.
 */
function unguardedContributions(
  slotName: string,
  contributions: readonly Contribution[]
): string[] {
  const warnings: string[] = [];
  let earlier: Contribution | undefined;

  for (const contribution of contributions) {
    if (contribution.when !== undefined) continue;

    if (earlier !== undefined) {
      warnings.push(
        `[game] Slot "${slotName}": the flows "${earlier.flow.id}" and "${contribution.flow.id}" have no when.\n  A named exit leaves the slot, so "${contribution.flow.id}" runs only when "${earlier.flow.id}" exits done; give them when.`
      );
    }

    earlier = contribution;
  }

  return warnings;
}

/**
 * Warns about the named outcomes of slots: a named exit a slot that declares none ignores, and
 * contributions without `when` in a slot that declares some.
 *
 * @param flows - Every collected flow by id.
 * @param features - Features API, read for the contributions of every slot.
 * @returns One warning per finding.
 */
function slotOutcomeWarnings(flows: ReadonlyMap<string, AnyFlow>, features: FeaturesApi): string[] {
  const warnings: string[] = [];

  for (const [slotName, [first]] of slotDeclarations(flows)) {
    const contributions = features.contributions(slotName);

    warnings.push(
      ...(first.declared.length === 0
        ? ignoredExits(slotName, contributions)
        : unguardedContributions(slotName, contributions))
    );
  }

  return warnings;
}

/**
 * Reads the scene id of one entry of a feature's `scenes` list. The list holds whatever
 * `defineScene` returns; validation reads the `id` and ignores everything else.
 *
 * @param value - One entry of the list.
 * @returns The id, or `undefined` when the entry names none.
 * @example
 * ```ts
 * sceneIdOf({ id: "board", bundle: "board.core" }); // "board"
 * sceneIdOf("board"); // undefined: a scene is an object with an id
 * ```
 */
function sceneIdOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("id" in value)) return undefined;

  return typeof value.id === "string" ? value.id : undefined;
}

/**
 * Collects the scene ids of the registered features. When no feature brought a `scenes` key at
 * all nothing is declared and nothing is checked, so a headless app composed from `logicOnly`
 * features never fails on a scene name.
 *
 * @param features - Features API: the registered descriptions.
 * @returns The declared ids, or `undefined` when no feature brought a `scenes` key.
 */
function declaredScenes(features: FeaturesApi): ReadonlySet<string> | undefined {
  const lists = features
    .all()
    .map(feature => feature.description.scenes)
    .filter(scenes => scenes !== undefined);

  if (lists.length === 0) return undefined;

  const ids = new Set<string>();

  for (const list of lists) {
    if (!Array.isArray(list)) continue;

    for (const scene of list) {
      const id = sceneIdOf(scene);

      if (id !== undefined) ids.add(id);
    }
  }

  return ids;
}

/**
 * Reports the scenes the nodes name: a scene id no feature registers, and an `over` node that
 * names a scene at all. An `over` node is drawn over the node below it, so switching the scene
 * under it would leave that node on the wrong screen.
 *
 * @param flows - Every collected flow by id.
 * @param features - Features API: the registered descriptions.
 * @returns One sentence per problem.
 */
function sceneProblems(flows: ReadonlyMap<string, AnyFlow>, features: FeaturesApi): string[] {
  const problems: string[] = [];
  const declared = declaredScenes(features);

  for (const flow of flows.values()) {
    for (const [name, entry] of Object.entries(flow.nodes)) {
      if (entry.kind !== "node" || entry.scene === undefined) continue;

      if (entry.over) {
        problems.push(
          `[game] Flow "${flow.id}": the over node "${name}" names the scene "${entry.scene}".\n  Remove scene from node "${name}": an over node keeps the scene under it.`
        );
        continue;
      }

      if (declared === undefined || declared.has(entry.scene)) continue;

      problems.push(
        `[game] Flow "${flow.id}": the scene "${entry.scene}" of node "${name}" is not registered.\n  List it in the scenes of a feature.`
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
 * @param features - Features API, read for a safe node inside a slot contribution.
 * @returns One sentence, or none.
 * @example
 * ```ts
 * // config: { mainFlow, safeNode: "board/awaitIntent", … } of the merge game
 * safeNodeProblems(config, features); // one sentence: the safe node is not a checkpoint
 * ```
 */
function safeNodeProblems(config: Readonly<Config>, features: FeaturesApi): string[] {
  const { mainFlow, safeNode } = config;

  if (!mainFlow || safeNode === undefined) return [];

  const location = findNode(mainFlow, safeNode, features.contributions);

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
 * Warns about a `recover` on a node that is not the safe node. The runner calls `recover` only in
 * the safe node, after it gave up on a transition, so the hook never runs anywhere else. The safe
 * node is the configured one, or the start of the main flow. Nothing is warned about while that
 * path names no node: a wrong `safeNode` is a problem of its own, and behind a start that is a
 * sub-flow or a slot the node the loop enters is not known before the game runs.
 *
 * @param flows - Every collected flow by id.
 * @param features - Features API, read for a safe node inside a slot contribution.
 * @param config - Resolved flow config: `mainFlow`, `safeNode`.
 * @returns One warning per node whose `recover` never runs.
 */
function recoverWarnings(
  flows: ReadonlyMap<string, AnyFlow>,
  features: FeaturesApi,
  config: Readonly<Config>
): string[] {
  const { mainFlow } = config;

  if (!mainFlow) return [];

  const safePath = config.safeNode ?? mainFlow.start;
  const safe = findNode(mainFlow, safePath, features.contributions);

  if (safe?.entry.kind !== "node") return [];

  const warnings: string[] = [];

  for (const flow of flows.values()) {
    for (const [name, entry] of Object.entries(flow.nodes)) {
      if (entry.kind !== "node" || entry.recover === undefined) continue;
      // The same name in another flow is another node: the flow and the name together tell.
      if (safe.flow.id === flow.id && safe.name === name) continue;

      warnings.push(
        `[game] Flow "${flow.id}": node "${name}" has recover but is not the safe node.\n  The engine runs recover only in the safe node "${safePath}". Move recover there or remove it.`
      );
    }
  }

  return warnings;
}

/**
 * Warns when two contributions of one slot have a node with the same name. A bookmark path keeps
 * node names only, so `restore` cannot tell the two apart and enters the first one in order.
 *
 * @param flows - Every collected flow by id.
 * @param features - Features API, read for the contributions of every slot.
 * @returns One warning per slot, node name and pair of flows.
 */
function slotNameWarnings(flows: ReadonlyMap<string, AnyFlow>, features: FeaturesApi): string[] {
  const warnings: string[] = [];

  for (const slotName of slotNames(flows)) {
    const owners = new Map<string, string>();

    for (const { flow } of features.contributions(slotName)) {
      for (const nodeName of Object.keys(flow.nodes)) {
        const first = owners.get(nodeName);

        if (first === undefined) {
          owners.set(nodeName, flow.id);
        } else if (first !== flow.id) {
          warnings.push(
            `[game] Slot "${slotName}": the flows "${first}" and "${flow.id}" both have a node "${nodeName}".\n  A bookmark path keeps node names only, so restore enters "${first}". Give the nodes different names.`
          );
        }
      }
    }
  }

  return warnings;
}

/**
 * Warns about a flow that grew past fifteen nodes. It is a warning, never a problem: a big flow
 * still runs, it is only hard to read.
 *
 * @param flow - The flow being validated.
 * @returns One sentence, or none.
 * @example
 * ```ts
 * sizeWarnings(boardFlow); // []: five nodes, the warning starts above fifteen
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
 * `order`, one flow contributed twice to a slot, one slot name declared with different outcomes,
 * a contribution of a slot that declares outcomes which exits another one, `inbox` type that is
 * not an outcome, rest node with neither `run` nor outcomes, a `recover` on a node that is not a
 * rest node, a scene id no feature registers, an `over` node that names a scene, `safeNode` that
 * is not a checkpoint, colliding ids. A `recover` on a node that is not the safe node is a
 * warning: it never runs there. So are a named exit a slot that declares no outcomes ignores, and
 * two contributions without `when` in a slot that declares some. Types are bypassed by JSON data
 * and casts, so this runs even though the edge table is checked at compile time.
 *
 * @param flows - Every collected flow by id, the main flow first.
 * @param features - Features API: slot contributions and feature names.
 * @param config - Resolved flow config: `mainFlow`, `safeNode`.
 * @returns Problems that stop `run()`, and warnings for the caller to log.
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
      ...recoverProblems(flow),
      ...reachProblems(flow),
      ...cycleProblems(flow)
    );
    warnings.push(...sizeWarnings(flow));
  }

  warnings.push(
    ...slotNameWarnings(flows, features),
    ...slotOutcomeWarnings(flows, features),
    ...recoverWarnings(flows, features, config)
  );

  problems.push(
    ...flowIdProblems(flows),
    ...featureProblems(flows, features),
    ...slotOutcomeProblems(flows, features),
    ...sceneProblems(flows, features),
    ...safeNodeProblems(config, features)
  );

  return { problems, warnings };
}
