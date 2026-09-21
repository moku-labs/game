/**
 * @file flow/runner — the one loop. The only place that calls `transaction.commit()`: state
 * changes on the edge, never inside a node.
 */
import type { Json, Transaction } from "../../model/types";
import type { Contribution, FeaturesApi } from "../features/types";
import type { Descriptor, Hint, NodeFx } from "../fx/types";
import type { Allow, Answer } from "../gate/types";
import type { WorldEvent } from "../inbox/types";
import type { FlowCtx } from "../types";
import { createOut } from "./define";
import { compact, pushEntry } from "./journal";
import { collectFlows, findNode, framePath, slotNames } from "./registry";
import type {
  AnyFlow,
  AnyNode,
  AnyNodeContext,
  Bookmark,
  FlowEntry,
  Frame,
  JournalEntry,
  LoopSeam,
  Modules,
  NodeInfo,
  Result,
  RunnerState,
  SlotNode,
  Stage
} from "./types";
import { validateGraph } from "./validate";

/** The stages of entering a node, in the order they run. */
const stages: readonly Stage[] = ["load", "scene"];

/** How deep the graph may nest or exit before the runner calls it a mistake. */
const maxDepth = 32;

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

/** Where one frame points: the flow, the name inside it and the entry itself. */
type Location = { flow: AnyFlow; name: string; entry: FlowEntry };

/** Why the runner aborted the active node. */
type AbortReason = "stop" | "inbox" | "restore";

/** What one node run produced. Nothing here throws: the loop reads the variant. */
type NodeOutcome =
  | { kind: "result"; result: Result }
  | { kind: "event"; event: WorldEvent }
  | { kind: "aborted"; reason: AbortReason }
  | { kind: "failed"; error: unknown };

/** What one turn of the loop decided: keep running, or end because `onStop` aborted. */
type StepOutcome = "continue" | "stop";

/** Where the loop goes after one result, or the problem that stops it going anywhere. */
type Plan =
  | { stack: Frame[]; next: string; rest: boolean; checkpoint: boolean }
  | { problem: string };

/** One node run in progress. */
type Step = {
  location: Location;
  node: AnyNode;
  transaction: Transaction;
  abort: AbortController;
  signal: AbortSignal;
  now: number;
  path: string;
  input: Json;
  gateOpened: () => void;
};

/** One result ready to be committed onto its edge. */
type Commit = {
  location: Location;
  transaction: Transaction;
  result: Result;
  barrier: boolean;
  now: number;
  path: string;
};

/** Whether the loop is already recovering inside the safe node. A failure there is fatal. */
type Safe = { inside: boolean };

/**
 * Does nothing. It stands in for an unsubscribe function until the real one arrives.
 *
 * @example
 * ```ts
 * const watch = { off: noop };
 * ```
 */
function noop(): void {
  // Nothing to undo yet.
}

/** The event delivered by the inbox to the node that is running. */
type Delivery = { event: WorldEvent | undefined };

// ─── graph ────────────────────────────────────────────────────

/**
 * Reads the main flow of the config.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns The top-level flow.
 * @throws {Error} When no main flow was configured.
 * @example
 * ```ts
 * const main = requireMainFlow(ctx);
 * ```
 */
function requireMainFlow(ctx: FlowCtx): AnyFlow {
  const main = ctx.config.mainFlow;

  if (main === undefined) {
    throw new Error(
      "[game] flow.run() needs a main flow.\n  Pass it as pluginConfigs.flow.mainFlow."
    );
  }

  return main;
}

/**
 * Collects every flow of the graph: the main flow, everything it reaches by reference, the flows
 * added with `register` and the sub-flows features contributed to a slot.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param features - Features API, read for the slot contributions.
 * @returns Flow id to flow, the main flow first.
 * @example
 * ```ts
 * ctx.state.runner.flows = collectGraph(ctx, modules.features);
 * ```
 */
export function collectGraph(ctx: FlowCtx, features: FeaturesApi): Map<string, AnyFlow> {
  const main = requireMainFlow(ctx);
  const registered = [...ctx.state.runner.flows.values()];
  const contributed: AnyFlow[] = [];

  for (const name of slotNames(collectFlows(main, registered))) {
    for (const contribution of features.contributions(name)) contributed.push(contribution.flow);
  }

  return collectFlows(main, [...registered, ...contributed]);
}

/**
 * Validates the collected graph. Warnings are logged, problems stop `run()` in one error.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param features - Features API, read for the slot contributions.
 * @throws {Error} When the graph has problems, all of them in one message.
 * @example
 * ```ts
 * checkGraph(ctx, modules.features);
 * ```
 */
function checkGraph(ctx: FlowCtx, features: FeaturesApi): void {
  const report = validateGraph(ctx.state.runner.flows, features, ctx.config);

  for (const warning of report.warnings) ctx.log.warn("flow:graph-warning", { warning });

  if (report.problems.length > 0) throw new Error(report.problems.join("\n"));
}

// ─── the seam the fast walk steers the loop with ──────────────

/**
 * Creates the empty substitution table. It lives in its own function because the plugin's lint
 * rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty map of path to substituted result.
 * @example
 * ```ts
 * const substitutions = emptySubstitutions();
 * ```
 */
function emptySubstitutions(): Map<string, Result> {
  return new Map();
}

/**
 * Reads the seam the fast walk and `restore` steer the running loop with, and creates it on first
 * use. Everything in it is empty while the game just runs.
 *
 * @param state - Runner state.
 * @returns The seam of this runner.
 * @example
 * ```ts
 * loopSeam(ctx.state.runner).substitutions.set("level", { outcome: "win", payload: null });
 * ```
 */
export function loopSeam(state: RunnerState): LoopSeam {
  const existing = state.seam;

  if (existing !== undefined) return existing;

  const seam: LoopSeam = {
    substitutions: emptySubstitutions(),
    rest: [],
    gateOpen: [],
    restoring: undefined
  };

  state.seam = seam;

  return seam;
}

/**
 * Tells whether a sub-flow at this path is substituted, so the loop must not enter it.
 *
 * @param state - Runner state.
 * @param path - Path of the sub-flow node.
 * @returns True while a walk holds a result for it.
 * @example
 * ```ts
 * if (hasSubstitution(state, "level")) return;
 * ```
 */
function hasSubstitution(state: RunnerState, path: string): boolean {
  return state.seam?.substitutions.has(path) ?? false;
}

/**
 * Takes the substituted result of a sub-flow. It is used once.
 *
 * @param state - Runner state.
 * @param path - Path of the sub-flow node.
 * @returns The result a walk substituted, or `undefined`.
 * @example
 * ```ts
 * const substituted = takeSubstitution(state, framePath(state.stack));
 * ```
 */
function takeSubstitution(state: RunnerState, path: string): Result | undefined {
  const result = state.seam?.substitutions.get(path);

  if (result === undefined) return undefined;

  state.seam?.substitutions.delete(path);

  return result;
}

/**
 * Tells the walk and `restore` that the loop rests.
 *
 * @param state - Runner state.
 * @param path - Path of the rest node just entered.
 * @example
 * ```ts
 * notifyRest(state, plan.next);
 * ```
 */
function notifyRest(state: RunnerState, path: string): void {
  const listeners = state.seam?.rest;

  if (listeners === undefined) return;

  const current = [...listeners];

  for (const listener of current) listener(path);
}

/**
 * Tells the walk that the gate of a rest node is open. The loop is the one that opens the gate, so
 * the gate module never learns about the walk.
 *
 * @param state - Runner state.
 * @example
 * ```ts
 * notifyGateOpen(ctx.state.runner);
 * ```
 */
function notifyGateOpen(state: RunnerState): void {
  const listeners = state.seam?.gateOpen;

  if (listeners === undefined) return;

  const current = [...listeners];

  for (const listener of current) listener();
}

// ─── position ─────────────────────────────────────────────────

/**
 * Resolves what the deepest frame points at.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param frames - A position, outermost frame first.
 * @returns The flow, the name and the entry, or `undefined` when the position is unknown.
 * @example
 * ```ts
 * const location = locateFrames(ctx, ctx.state.runner.stack);
 * ```
 */
function locateFrames(ctx: FlowCtx, frames: readonly Frame[]): Location | undefined {
  const frame = frames.at(-1);

  if (frame === undefined) return undefined;

  const flow = ctx.state.runner.flows.get(frame.flow);
  const entry = flow?.nodes[frame.node];

  if (flow === undefined || entry === undefined) return undefined;

  return { flow, name: frame.node, entry };
}

/**
 * Turns the trail of a path into frames. Only the deepest frame carries the input.
 *
 * @param trail - One step per nesting level, outermost first.
 * @param input - Input of the node the path names.
 * @returns The frames of that position.
 * @example
 * ```ts
 * state.stack = framesOf(location.trail, bookmark.input);
 * ```
 */
function framesOf(trail: readonly { flow: string; node: string }[], input: Json): Frame[] {
  return trail.map((step, index) => ({
    flow: step.flow,
    node: step.node,
    input: index === trail.length - 1 ? input : noPayload
  }));
}

/**
 * Builds the frames of the safe node: the configured checkpoint, or the start of the main flow.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns The position of the safe node.
 * @throws {Error} When the configured safe node is not a node of the graph.
 * @example
 * ```ts
 * state.stack = safeFrames(ctx);
 * ```
 */
function safeFrames(ctx: FlowCtx): Frame[] {
  const main = requireMainFlow(ctx);
  const path = ctx.config.safeNode ?? main.start;
  const location = findNode(main, path);

  if (location === undefined) {
    throw new Error(
      `[game] The safe node "${path}" is not a node of the graph.\n  Set flow.safeNode to the path of a checkpoint.`
    );
  }

  return framesOf(location.trail, noPayload);
}

// ─── results ──────────────────────────────────────────────────

/**
 * Turns a world event into the outcome of the rest node that accepted it.
 *
 * @param event - The delivered event.
 * @returns The result the edge table reads.
 * @example
 * ```ts
 * const result = eventResult({ type: "elapsed", payload: { now: 10 } });
 * ```
 */
function eventResult(event: WorldEvent): Result {
  return { outcome: event.type, payload: event.payload ?? noPayload };
}

/**
 * Turns a gate answer into the outcome of the rest node that waited for it.
 *
 * @param answer - The accepted answer.
 * @returns The result the edge table reads.
 * @example
 * ```ts
 * const result = answerResult({ intent: "play" });
 * ```
 */
function answerResult(answer: Answer): Result {
  return { outcome: answer.intent, payload: answer.payload ?? noPayload };
}

/**
 * Tells whether a value is plain JSON. The mapper of a `to` edge is game code, so its result is
 * checked before it becomes the next node's input.
 *
 * @param value - Any value.
 * @returns True when the value is JSON all the way down.
 * @example
 * ```ts
 * if (!isJson(mapped)) return { problem: "..." };
 * ```
 */
function isJson(value: unknown): value is Json {
  if (value === null) return true;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return true;
  }

  if (Array.isArray(value)) {
    const items: unknown[] = value;

    return items.every(item => isJson(item));
  }

  if (typeof value !== "object") return false;

  const entries: [string, unknown][] = Object.entries(value);

  return entries.every(([, item]) => isJson(item));
}

// ─── planning the next position ───────────────────────────────

/**
 * Describes where the frames now point and descends into a sub-flow until a node or a slot is
 * reached. A sub-flow a walk substituted is not entered.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param frames - The position being planned; mutated while descending.
 * @returns The plan, or the problem that stops it.
 * @example
 * ```ts
 * return describePlan(ctx, frames);
 * ```
 */
function describePlan(ctx: FlowCtx, frames: Frame[]): Plan {
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const location = locateFrames(ctx, frames);

    if (location === undefined) {
      return {
        problem: `[game] No node at "${framePath(frames)}".\n  Check the edge targets of the flow.`
      };
    }

    const entry = location.entry;

    if (entry.kind === "flow" && !hasSubstitution(ctx.state.runner, framePath(frames))) {
      frames.push({ flow: entry.id, node: entry.start, input: frames.at(-1)?.input ?? noPayload });
      continue;
    }

    return {
      stack: frames,
      next: framePath(frames),
      rest: entry.kind === "node" && entry.rest,
      checkpoint: entry.kind === "node" && entry.checkpoint
    };
  }

  return {
    problem: `[game] The graph nests deeper than ${maxDepth} flows at "${framePath(frames)}".\n  Flatten the nested flows.`
  };
}

/**
 * Moves the deepest frame onto another node of the same flow.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param frames - The position being planned; mutated.
 * @param flow - The flow that holds both nodes.
 * @param name - Name of the target node.
 * @param input - Payload that becomes the target's input.
 * @returns The plan, or the problem that stops it.
 * @example
 * ```ts
 * return enterTarget(ctx, frames, location.flow, "home", payload);
 * ```
 */
function enterTarget(
  ctx: FlowCtx,
  frames: Frame[],
  flow: AnyFlow,
  name: string,
  input: Json
): Plan {
  if (flow.nodes[name] === undefined) {
    return {
      problem: `[game] Flow "${flow.id}": the edge target "${name}" is not a node of this flow.\n  Add the node or point the edge at an existing one.`
    };
  }

  frames.pop();
  frames.push({ flow: flow.id, node: name, input });

  return describePlan(ctx, frames);
}

/**
 * Picks the next contribution of a slot whose `when` passes. The snapshot is read here, so every
 * `when` sees the state the runner reached that contribution with.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param features - Features API.
 * @param slotName - Name of the slot.
 * @param from - Index of the first contribution to consider.
 * @returns The contribution to run, or `undefined` when the slot is done.
 * @example
 * ```ts
 * const next = pickContribution(ctx, modules.features, "afterWin", 0);
 * ```
 */
function pickContribution(
  ctx: FlowCtx,
  features: FeaturesApi,
  slotName: string,
  from: number
): Contribution | undefined {
  const snapshot = ctx.deps.model.store.snapshot();

  for (const [index, contribution] of features.contributions(slotName).entries()) {
    if (index < from) continue;
    if (contribution.when !== undefined && !contribution.when(snapshot)) continue;

    return contribution;
  }

  return undefined;
}

/**
 * Follows one result to the next position: a node of the same flow, a mapped node, or the exit of
 * a sub-flow, which hands the outcome to the parent.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param frames - The position being planned; mutated.
 * @param location - Where the result was produced.
 * @param outcome - Outcome name of the result.
 * @param payload - Payload of the result.
 * @param depth - How many sub-flows were left already.
 * @returns The plan, or the problem that stops it.
 * @example
 * ```ts
 * const plan = planFrom(ctx, modules, frames, location, "done", null, 0);
 * ```
 */
function planFrom(
  ctx: FlowCtx,
  modules: Modules,
  frames: Frame[],
  location: Location,
  outcome: string,
  payload: Json,
  depth: number
): Plan {
  if (depth > maxDepth) {
    return {
      problem: `[game] The graph leaves more than ${maxDepth} flows at "${framePath(frames)}".\n  Check the exit targets of the nested flows.`
    };
  }

  const target = location.flow.edges[location.name]?.[outcome];

  if (target === undefined) {
    return {
      problem: `[game] Flow "${location.flow.id}": outcome "${outcome}" of node "${location.name}" has no edge.\n  Add edges.${location.name}.${outcome}.`
    };
  }

  if (typeof target === "string") return enterTarget(ctx, frames, location.flow, target, payload);

  if (target.kind === "map") {
    // eslint-disable-next-line unicorn/no-array-callback-reference -- `target.map` is the edge mapper, not Array#map.
    const mapped: unknown = target.map(payload);
    const input = mapped === undefined ? noPayload : mapped;

    if (!isJson(input)) {
      return {
        problem: `[game] The mapper of edge "${location.name}.${outcome}" returned a value that is not JSON.\n  Return plain JSON from to("${target.target}", ...).`
      };
    }

    return enterTarget(ctx, frames, location.flow, target.target, input);
  }

  frames.pop();

  const parent = locateFrames(ctx, frames);

  if (parent === undefined) {
    return {
      problem: `[game] The main flow "${location.flow.id}" left with outcome "${target.outcome}".\n  Give the top-level flow an edge instead of exit("${target.outcome}").`
    };
  }

  if (parent.entry.kind === "slot") {
    return continueSlot(ctx, modules, frames, parent, parent.entry, location.flow.id);
  }

  return planFrom(ctx, modules, frames, parent, target.outcome, payload, depth + 1);
}

/**
 * Moves a slot to its next contribution, or ends the slot with `done` when none is left.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param frames - The position being planned; mutated.
 * @param location - The slot's own location.
 * @param slot - The slot node.
 * @param finished - Flow id of the contribution that just ended.
 * @returns The plan, or the problem that stops it.
 * @example
 * ```ts
 * return continueSlot(ctx, modules, frames, parent, parent.entry, "reward");
 * ```
 */
function continueSlot(
  ctx: FlowCtx,
  modules: Modules,
  frames: Frame[],
  location: Location,
  slot: SlotNode,
  finished: string
): Plan {
  const contributions = modules.features.contributions(slot.name);
  const index = contributions.findIndex(contribution => contribution.flow.id === finished);
  const next = pickContribution(ctx, modules.features, slot.name, index + 1);

  if (next === undefined) return planFrom(ctx, modules, frames, location, "done", noPayload, 0);

  frames.push({ flow: next.flow.id, node: next.flow.start, input: noPayload });

  return describePlan(ctx, frames);
}

// ─── the node context ─────────────────────────────────────────

/**
 * Reads the one answer a `guide` descriptor lets through.
 *
 * @param payload - Payload of the descriptor, as JSON.
 * @returns The allowed answer, or `undefined` when the payload names none.
 * @example
 * ```ts
 * const allow = guideAllow({ allow: { intent: "merge" } });
 * ```
 */
function guideAllow(payload: Json | undefined): Allow | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;

  const allow = payload.allow;

  if (allow === null || typeof allow !== "object" || Array.isArray(allow)) return undefined;

  const intent = allow.intent;

  if (typeof intent !== "string") return undefined;

  return allow.payload === undefined ? { intent } : { intent, payload: allow.payload };
}

/**
 * Builds the `fx` of a node context: awaited effects by call, cosmetic hints by `emit`. A `guide`
 * narrows the gate while it runs; the runner lifts the narrow when the node is left.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @returns The effects gateway of one node run.
 * @example
 * ```ts
 * const fx = nodeFx(modules, step);
 * ```
 */
function nodeFx(modules: Modules, step: Step): NodeFx {
  /**
   * Awaits one effect.
   *
   * @param descriptor - The descriptor the node awaits.
   * @returns The answer, the handler's value, or `undefined`.
   * @example
   * ```ts
   * const answer = await fx(popup);
   * ```
   */
  const run = (descriptor: Descriptor): Promise<unknown> => {
    if (descriptor.kind === "guide") {
      const allow = guideAllow(descriptor.payload);

      if (allow !== undefined) modules.gate.narrow(allow);
    }

    const value = modules.fx.run(descriptor, step.signal);

    if (descriptor.answers !== undefined) step.gateOpened();

    return value;
  };

  return Object.assign(run, {
    /**
     * Buffers one cosmetic hint until the transaction of this node commits.
     *
     * @param item - The hint.
     * @example
     * ```ts
     * fx.emit(hint("sparkle", { cell: "c3" }));
     * ```
     */
    emit: (item: Hint): void => {
      modules.fx.buffer(item);
    }
  });
}

/**
 * Builds the one object a node body receives.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @returns The node context.
 * @example
 * ```ts
 * const context = nodeContext(modules, step);
 * ```
 */
function nodeContext(modules: Modules, step: Step): AnyNodeContext {
  return {
    input: step.input,
    player: step.transaction.player,
    session: step.transaction.session,
    rng: step.transaction.rng,
    fx: nodeFx(modules, step),
    out: createOut(step.node.outcomes),
    signal: step.signal,
    now: step.now
  };
}

/**
 * Describes the node being entered for the `onEnter` callbacks.
 *
 * @param path - Runtime path of the node.
 * @param location - Where the node sits in the graph.
 * @param node - The node itself.
 * @returns What an `onEnter` callback learns.
 * @example
 * ```ts
 * await runEnterCallbacks(ctx, nodeInfo(path, location, node), signal);
 * ```
 */
function nodeInfo(path: string, location: Location, node: AnyNode): NodeInfo {
  return {
    path,
    flow: location.flow.id,
    node: location.name,
    rest: node.rest,
    over: node.over,
    checkpoint: node.checkpoint,
    barrier: node.barrier
  };
}

/**
 * Runs the `onEnter` callbacks stage by stage, registration order inside a stage, each awaited.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param info - The node being entered.
 * @param signal - The node's abort signal.
 * @example
 * ```ts
 * await runEnterCallbacks(ctx, info, signal);
 * ```
 */
async function runEnterCallbacks(ctx: FlowCtx, info: NodeInfo, signal: AbortSignal): Promise<void> {
  const mode = ctx.state.fx.mode;

  for (const stage of stages) {
    const callbacks = [...ctx.state.runner.enterCallbacks[stage]];

    for (const callback of callbacks) {
      await callback(info, { mode, signal });
    }
  }
}

// ─── running one node ─────────────────────────────────────────

/**
 * Reads the reason the active node was aborted with. Anything unexpected counts as `"stop"`.
 *
 * @param signal - The aborted signal.
 * @returns The reason the runner set.
 * @example
 * ```ts
 * const reason = abortReason(step.signal);
 * ```
 */
function abortReason(signal: AbortSignal): AbortReason {
  const reason: unknown = signal.reason;

  if (reason === "inbox" || reason === "restore") return reason;

  return "stop";
}

/**
 * Tells whether the runner was stopped. The abort of `onStop` survives between two nodes, so a
 * loop that is not inside a node ends at the next turn.
 *
 * @param state - Runner state.
 * @returns True once `stopRunner` aborted.
 * @example
 * ```ts
 * if (stopped(state)) return "stop";
 * ```
 */
function stopped(state: RunnerState): boolean {
  const signal = state.abort?.signal;

  if (signal === undefined || !signal.aborted) return false;

  return abortReason(signal) === "stop";
}

/**
 * Resolves as soon as the node is aborted, so a body that ignores its signal never holds the loop.
 *
 * @param signal - The node's abort signal.
 * @returns The abort outcome.
 * @example
 * ```ts
 * const outcome = await Promise.race([body, abortOutcome(signal)]);
 * ```
 */
function abortOutcome(signal: AbortSignal): Promise<NodeOutcome> {
  if (signal.aborted) return Promise.resolve({ kind: "aborted", reason: abortReason(signal) });

  return new Promise<NodeOutcome>(resolve => {
    signal.addEventListener(
      "abort",
      () => {
        resolve({ kind: "aborted", reason: abortReason(signal) });
      },
      { once: true }
    );
  });
}

/**
 * Calls the body of a node and turns what it does into an outcome. Nothing is thrown out of here.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @returns The result, the abort or the failure.
 * @example
 * ```ts
 * const outcome = await callBody(modules, step);
 * ```
 */
async function callBody(modules: Modules, step: Step): Promise<NodeOutcome> {
  try {
    const result = await step.node.run?.(nodeContext(modules, step));

    if (step.signal.aborted) return { kind: "aborted", reason: abortReason(step.signal) };

    if (result === undefined) {
      return {
        kind: "failed",
        error: new Error(
          `[game] The node "${step.path}" returned nothing.\n  End the body with out.<outcome>().`
        )
      };
    }

    return { kind: "result", result };
  } catch (error) {
    if (step.signal.aborted) return { kind: "aborted", reason: abortReason(step.signal) };

    return { kind: "failed", error };
  }
}

/**
 * Runs a node body against its abort signal.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @returns The outcome of the body or of the abort, whichever comes first.
 * @example
 * ```ts
 * const outcome = await runBody(modules, step);
 * ```
 */
function runBody(modules: Modules, step: Step): Promise<NodeOutcome> {
  return Promise.race([callBody(modules, step), abortOutcome(step.signal)]);
}

/**
 * Runs the body of a rest node while the inbox watches for a deliverable world event. Such an
 * event aborts the node with reason `"inbox"`: not an error and not a retry.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @param delivered - Holder of the event the inbox delivered.
 * @returns The outcome of the body, or the delivered event.
 * @example
 * ```ts
 * const outcome = await runRestBody(modules, step, delivered);
 * ```
 */
async function runRestBody(
  modules: Modules,
  step: Step,
  delivered: Delivery
): Promise<NodeOutcome> {
  /**
   * Looks for a deliverable event and aborts the node when one is there.
   *
   * @example
   * ```ts
   * check();
   * ```
   */
  const check = (): void => {
    if (delivered.event !== undefined) return;

    const event = modules.inbox.take(step.node.inbox);

    if (event === undefined) return;

    delivered.event = event;
    step.abort.abort("inbox");
  };
  const off = modules.inbox.onPost(check);

  check();

  try {
    const outcome = await runBody(modules, step);
    const event = delivered.event;

    if (outcome.kind === "aborted" && outcome.reason === "inbox" && event !== undefined) {
      return { kind: "event", event };
    }

    return outcome;
  } finally {
    off();
  }
}

/**
 * Waits at a rest node without a body: the gate answer whose intent names an outcome wins, and so
 * does a world event the node lists in its `inbox`. A node whose signal is already aborted — a stop
 * or a restore that arrived while the `onEnter` callbacks ran — never opens the gate.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @returns The outcome the player or the world produced.
 * @example
 * ```ts
 * const outcome = await waitForAnswer(modules, step);
 * ```
 */
function waitForAnswer(modules: Modules, step: Step): Promise<NodeOutcome> {
  if (step.signal.aborted) {
    return Promise.resolve({ kind: "aborted", reason: abortReason(step.signal) });
  }

  const queued = modules.inbox.take(step.node.inbox);

  if (queued !== undefined) return Promise.resolve({ kind: "result", result: eventResult(queued) });

  return new Promise<NodeOutcome>(resolve => {
    const race: { done: boolean; off: () => void } = { done: false, off: noop };
    /**
     * Ends the wait once, whoever answered first.
     *
     * @param outcome - What ended the wait.
     * @example
     * ```ts
     * finish({ kind: "result", result });
     * ```
     */
    const finish = (outcome: NodeOutcome): void => {
      if (race.done) return;

      race.done = true;
      race.off();
      modules.gate.close();
      resolve(outcome);
    };

    race.off = modules.inbox.onPost(() => {
      const event = modules.inbox.take(step.node.inbox);

      if (event !== undefined) finish({ kind: "result", result: eventResult(event) });
    });

    step.signal.addEventListener(
      "abort",
      () => {
        finish({ kind: "aborted", reason: abortReason(step.signal) });
      },
      { once: true }
    );

    const answered = modules.gate.open({ allowed: Object.keys(step.node.outcomes) });

    step.gateOpened();
    answered.then(
      answer => {
        finish({ kind: "result", result: answerResult(answer) });
      },
      (error: unknown) => {
        finish({ kind: "failed", error });
      }
    );
  });
}

/**
 * Produces the outcome of one node: a pure wait, a rest node with a body, or a transit node.
 *
 * @param modules - Injected sibling APIs.
 * @param step - The node run in progress.
 * @param delivered - Holder of the event the inbox delivered.
 * @returns The outcome of that node.
 * @example
 * ```ts
 * const outcome = await nodeOutcome(modules, step, delivered);
 * ```
 */
function nodeOutcome(modules: Modules, step: Step, delivered: Delivery): Promise<NodeOutcome> {
  if (step.node.run === undefined) return waitForAnswer(modules, step);
  if (step.node.rest) return runRestBody(modules, step, delivered);

  return runBody(modules, step);
}

/**
 * Waits while a pointer is down, so an `over` node never appears mid-drag. Without a running frame
 * loop nothing would ever wake the wait, so the node is entered at once. A stop ends the wait as
 * well: the runner must not hold the loop open for a pointer that is never lifted.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns A promise that resolves when the pointer is up or the runner was stopped.
 * @example
 * ```ts
 * if (node.over) await waitForPointer(ctx);
 * ```
 */
function waitForPointer(ctx: FlowCtx): Promise<void> {
  if (!ctx.state.gate.pointerActive) return Promise.resolve();
  if (!ctx.deps.time.isRunning()) return Promise.resolve();

  return new Promise<void>(resolve => {
    const watch: { off: () => void } = { off: noop };

    watch.off = ctx.deps.time.onFrame("signals", () => {
      if (ctx.state.gate.pointerActive && !stopped(ctx.state.runner)) return;

      watch.off();
      resolve();
    });
  });
}

// ─── taking the edge ──────────────────────────────────────────

/**
 * Commits the transaction of one node, releases its hints, journals the edge and emits
 * `flow:edge`. This is the only commit of the engine.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param step - The result ready to be committed.
 * @param next - Path the edge leads to.
 * @returns The journal entry of this edge.
 * @example
 * ```ts
 * const entry = commitEdge(ctx, modules, step, plan.next);
 * ```
 */
function commitEdge(ctx: FlowCtx, modules: Modules, step: Commit, next: string): JournalEntry {
  const commit = step.transaction.commit();

  modules.fx.release();

  const entry = pushEntry(
    ctx.state.runner,
    {
      path: step.path,
      outcome: step.result.outcome,
      payload: step.result.payload,
      next,
      now: step.now
    },
    ctx.config.journalLimit
  );

  ctx.emit("flow:edge", {
    flow: step.location.flow.id,
    node: step.location.name,
    outcome: step.result.outcome,
    payload: step.result.payload,
    next,
    patches: commit.patches,
    index: entry.index,
    now: step.now
  });

  return entry;
}

/**
 * Discards everything the failed node did, rolls back and decides between a retry and the safe
 * node. A failure while the loop already recovers in the safe node is fatal.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param transaction - The open transaction, when the node got that far.
 * @param error - What the node failed with.
 * @param path - Path of the failed node.
 * @param safe - Whether the loop is already recovering.
 * @returns Always `"continue"`: the loop re-enters a position.
 * @throws {Error} When the safe node itself failed.
 * @example
 * ```ts
 * return handleFailure(ctx, modules, transaction, error, path, safe);
 * ```
 */
function handleFailure(
  ctx: FlowCtx,
  modules: Modules,
  transaction: Transaction | undefined,
  error: unknown,
  path: string,
  safe: Safe
): StepOutcome {
  const state = ctx.state.runner;

  transaction?.discard();
  modules.fx.drop();
  modules.gate.close();
  ctx.deps.model.store.rollback();

  if (safe.inside) {
    throw new Error(
      `[game] The node "${path}" failed while the graph was recovering in the safe node.\n  Fix the node or point flow.safeNode at a checkpoint that cannot fail.`,
      { cause: error }
    );
  }

  state.failures += 1;

  const retry = state.failures <= ctx.config.retries;
  const target = retry ? (state.restFrame ?? safeFrames(ctx)) : safeFrames(ctx);

  ctx.emit("flow:error", { path, error, rolledBackTo: framePath(target), retry });

  state.stack = [...target];

  if (!retry) {
    safe.inside = true;
    state.failures = 0;
  }

  return "continue";
}

/**
 * Leaves the aborted node: the transaction is discarded, the hints are dropped and the gate is
 * shut. `"stop"` ends the loop; `"restore"` lets the next turn enter the bookmark.
 *
 * @param modules - Injected sibling APIs.
 * @param transaction - The open transaction of the aborted node.
 * @param reason - Why the node was aborted.
 * @returns `"stop"` when the runner was stopped, `"continue"` otherwise.
 * @example
 * ```ts
 * return handleAbort(modules, transaction, "stop");
 * ```
 */
function handleAbort(modules: Modules, transaction: Transaction, reason: AbortReason): StepOutcome {
  transaction.discard();
  modules.fx.drop();
  modules.gate.close();

  return reason === "stop" ? "stop" : "continue";
}

/**
 * Takes the edge of one result: plan, commit, mark the barrier or the rest point, move the
 * position and announce a rest node.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param step - The result ready to be committed.
 * @param safe - Whether the loop is already recovering.
 * @returns Always `"continue"`.
 * @example
 * ```ts
 * return finishNode(ctx, modules, step, safe);
 * ```
 */
async function finishNode(
  ctx: FlowCtx,
  modules: Modules,
  step: Commit,
  safe: Safe
): Promise<StepOutcome> {
  const state = ctx.state.runner;
  const plan = planFrom(
    ctx,
    modules,
    [...state.stack],
    step.location,
    step.result.outcome,
    step.result.payload,
    0
  );

  if ("problem" in plan) {
    return handleFailure(ctx, modules, step.transaction, new Error(plan.problem), step.path, safe);
  }

  const entry = commitEdge(ctx, modules, step, plan.next);

  if (step.barrier) {
    await ctx.deps.model.store.markBarrier(`${step.path}#${entry.index}@${step.now}`);
  } else if (plan.rest) {
    ctx.deps.model.store.markRest();
  }

  state.stack = plan.stack;
  safe.inside = false;

  if (plan.rest) {
    state.restFrame = [...plan.stack];
    state.failures = 0;

    if (plan.checkpoint) compact(state);

    ctx.emit("flow:rest", { path: plan.next, checkpoint: plan.checkpoint });
    notifyRest(state, plan.next);
  }

  return "continue";
}

/**
 * Takes the edge of a result no node body produced: a substituted sub-flow, a finished slot or the
 * world event that ended a rest node. The empty transaction keeps the commit, the journal entry
 * and the rest mark in one place.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param location - Where the result belongs.
 * @param result - The outcome to follow.
 * @param safe - Whether the loop is already recovering.
 * @param edge - The barrier flag of the node that produced it and the moment the edge is taken.
 * @param edge.barrier - True when the node the result belongs to is a barrier node.
 * @param edge.now - The moment the node was entered, journalled with the edge.
 * @returns Always `"continue"`.
 * @example
 * ```ts
 * return applyResult(ctx, modules, location, result, safe, { barrier: node.barrier, now });
 * ```
 */
function applyResult(
  ctx: FlowCtx,
  modules: Modules,
  location: Location,
  result: Result,
  safe: Safe,
  edge: { barrier: boolean; now: number }
): Promise<StepOutcome> {
  return finishNode(
    ctx,
    modules,
    {
      location,
      transaction: ctx.deps.model.store.begin(),
      result,
      barrier: edge.barrier,
      now: edge.now,
      path: framePath(ctx.state.runner.stack)
    },
    safe
  );
}

// ─── one turn of the loop ─────────────────────────────────────

/**
 * Runs one node: wait for the pointer, `onEnter` stages, open the transaction, produce the
 * outcome, then commit on the edge or recover.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param location - Where the node sits in the graph.
 * @param node - The node to run.
 * @param safe - Whether the loop is already recovering.
 * @returns `"stop"` when the runner was stopped, `"continue"` otherwise.
 * @example
 * ```ts
 * return runNode(ctx, modules, location, location.entry, safe);
 * ```
 */
async function runNode(
  ctx: FlowCtx,
  modules: Modules,
  location: Location,
  node: AnyNode,
  safe: Safe
): Promise<StepOutcome> {
  const state = ctx.state.runner;
  const path = framePath(state.stack);

  if (node.over) await waitForPointer(ctx);

  if (stopped(state)) return "stop";

  const abort = new AbortController();

  state.abort = abort;

  const now = ctx.deps.clock.now();

  try {
    await runEnterCallbacks(ctx, nodeInfo(path, location, node), abort.signal);
  } catch (error) {
    return handleFailure(ctx, modules, undefined, error, path, safe);
  }

  const step: Step = {
    location,
    node,
    transaction: ctx.deps.model.store.begin(),
    abort,
    signal: abort.signal,
    now,
    path,
    input: state.stack.at(-1)?.input ?? noPayload,
    /**
     * Tells a walk that this node's gate is open.
     *
     * @example
     * ```ts
     * step.gateOpened();
     * ```
     */
    gateOpened: (): void => {
      notifyGateOpen(state);
    }
  };
  const delivered: Delivery = { event: undefined };
  const outcome = await nodeOutcome(modules, step, delivered);

  // eslint-disable-next-line unicorn/no-useless-undefined -- `undefined` lifts a running guide.
  modules.gate.narrow(undefined);

  if (outcome.kind === "failed") {
    return handleFailure(ctx, modules, step.transaction, outcome.error, path, safe);
  }

  if (outcome.kind === "aborted") return handleAbort(modules, step.transaction, outcome.reason);

  if (outcome.kind === "event") {
    handleAbort(modules, step.transaction, "inbox");

    return applyResult(ctx, modules, location, eventResult(outcome.event), safe, {
      barrier: node.barrier,
      now
    });
  }

  return finishNode(
    ctx,
    modules,
    {
      location,
      transaction: step.transaction,
      result: outcome.result,
      barrier: node.barrier,
      now,
      path
    },
    safe
  );
}

/**
 * Enters a sub-flow at its start node, unless a walk substituted its result.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param location - Where the sub-flow node sits.
 * @param sub - The sub-flow.
 * @param safe - Whether the loop is already recovering.
 * @returns Always `"continue"`.
 * @example
 * ```ts
 * return enterSubFlow(ctx, modules, location, location.entry, safe);
 * ```
 */
function enterSubFlow(
  ctx: FlowCtx,
  modules: Modules,
  location: Location,
  sub: AnyFlow,
  safe: Safe
): Promise<StepOutcome> | StepOutcome {
  const state = ctx.state.runner;
  const substituted = takeSubstitution(state, framePath(state.stack));

  if (substituted !== undefined) {
    return applyResult(ctx, modules, location, substituted, safe, {
      barrier: false,
      now: ctx.deps.clock.now()
    });
  }

  state.stack = [
    ...state.stack,
    { flow: sub.id, node: sub.start, input: state.stack.at(-1)?.input ?? noPayload }
  ];

  return "continue";
}

/**
 * Enters a slot: the first contribution whose `when` passes, or the slot's `done` edge when the
 * slot has no contribution to run.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param location - Where the slot sits.
 * @param slot - The slot node.
 * @param safe - Whether the loop is already recovering.
 * @returns Always `"continue"`.
 * @example
 * ```ts
 * return enterSlot(ctx, modules, location, location.entry, safe);
 * ```
 */
function enterSlot(
  ctx: FlowCtx,
  modules: Modules,
  location: Location,
  slot: SlotNode,
  safe: Safe
): Promise<StepOutcome> | StepOutcome {
  const state = ctx.state.runner;
  const next = pickContribution(ctx, modules.features, slot.name, 0);

  if (next === undefined) {
    return applyResult(ctx, modules, location, { outcome: "done", payload: noPayload }, safe, {
      barrier: false,
      now: ctx.deps.clock.now()
    });
  }

  state.stack = [...state.stack, { flow: next.flow.id, node: next.flow.start, input: noPayload }];

  return "continue";
}

/**
 * Enters the node of a bookmark: the state is replaced, the rest point is marked and the position
 * becomes the bookmark's path.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param bookmark - The bookmark to enter.
 * @throws {Error} When the graph has no node at the bookmark's path.
 * @example
 * ```ts
 * enterBookmark(ctx, bookmark);
 * ```
 */
function enterBookmark(ctx: FlowCtx, bookmark: Bookmark): void {
  const state = ctx.state.runner;
  const location = findNode(requireMainFlow(ctx), bookmark.path);

  loopSeam(state).restoring = undefined;

  if (location === undefined) {
    throw new Error(
      `[game] The bookmark names no node "${bookmark.path}".\n  Bookmark a rest node of the running graph.`
    );
  }

  ctx.deps.model.store.restore({
    player: bookmark.player,
    session: bookmark.session,
    rng: bookmark.rng
  });
  ctx.deps.model.store.markRest();

  state.stack = framesOf(location.trail, bookmark.input);
  state.restFrame = [...state.stack];
  state.failures = 0;

  const entry = location.entry;

  ctx.emit("flow:rest", {
    path: bookmark.path,
    checkpoint: entry.kind === "node" && entry.checkpoint
  });
  notifyRest(state, bookmark.path);
}

/**
 * Runs one turn: enter a bookmark, descend into a sub-flow, step a slot, or run the node.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs.
 * @param safe - Whether the loop is already recovering.
 * @returns `"stop"` when the runner was stopped, `"continue"` otherwise.
 * @throws {Error} When the position names no node of the graph.
 * @example
 * ```ts
 * const outcome = await advance(ctx, modules, safe);
 * ```
 */
async function advance(ctx: FlowCtx, modules: Modules, safe: Safe): Promise<StepOutcome> {
  const state = ctx.state.runner;

  if (stopped(state)) return "stop";

  const restoring = state.seam?.restoring;

  if (restoring !== undefined) {
    enterBookmark(ctx, restoring);

    return "continue";
  }

  const location = locateFrames(ctx, state.stack);

  if (location === undefined) {
    throw new Error(
      `[game] The graph has no node at "${framePath(state.stack)}".\n  Check the edge targets of the flow or the bookmark that was restored.`
    );
  }

  if (location.entry.kind === "flow") {
    return enterSubFlow(ctx, modules, location, location.entry, safe);
  }

  if (location.entry.kind === "slot") {
    return enterSlot(ctx, modules, location, location.entry, safe);
  }

  return runNode(ctx, modules, location, location.entry, safe);
}

// ─── the loop ─────────────────────────────────────────────────

/**
 * Runs the graph until aborted: enter node, `onEnter` stages, begin a transaction, await the
 * body, commit on the edge, release hints, journal, emit `flow:edge`, follow the edge. An error
 * discards, rolls back and retries, then enters `safeNode`; a failure inside `safeNode` rejects.
 * Abort reasons: `"stop"` ends the loop, `"inbox"` turns the event into the outcome, `"restore"`
 * enters the bookmark's frame.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param modules - Injected sibling APIs: features, fx, gate, inbox.
 * @returns A promise that resolves when `onStop` aborted the loop.
 * @throws {Error} On a fatal error: validation, an unreadable save, a failure inside `safeNode`.
 * @example
 * ```ts
 * state.runner.running = runLoop(ctx, modules);
 * ```
 */
export async function runLoop(ctx: FlowCtx, modules: Modules): Promise<void> {
  const main = requireMainFlow(ctx);
  const state = ctx.state.runner;

  state.flows = collectGraph(ctx, modules.features);
  checkGraph(ctx, modules.features);
  modules.features.seal();

  await ctx.deps.model.store.load();

  state.stack = [{ flow: main.id, node: main.start, input: noPayload }];
  state.restFrame = [...state.stack];
  state.failures = 0;

  const safe: Safe = { inside: false };
  const loop = { running: true };

  while (loop.running) {
    loop.running = (await advance(ctx, modules, safe)) === "continue";
  }
}

// ─── entering a position from outside the loop ────────────────

/**
 * Restores a bookmark through the running loop: the active node is aborted with reason
 * `"restore"`, its transaction is discarded, the state is replaced and the node is entered.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param _modules - Injected sibling APIs.
 * @param bookmark - The bookmark to enter.
 * @returns A promise that resolves once the loop rests at the bookmark's node.
 * @throws {Error} When the loop is not running.
 * @example
 * ```ts
 * await restorePosition(ctx, modules, bookmark);
 * ```
 */
export function restorePosition(
  ctx: FlowCtx,
  _modules: Modules,
  bookmark: Bookmark
): Promise<void> {
  const state = ctx.state.runner;

  if (state.running === undefined) {
    throw new Error(
      "[game] flow.restore() needs a running graph.\n  Call flow.run() from the createApp onStart callback first."
    );
  }

  const seam = loopSeam(state);
  const entered = new Promise<void>(resolve => {
    /**
     * Resolves once, when the loop rests at the restored node.
     *
     * @example
     * ```ts
     * listener("home");
     * ```
     */
    const listener = (): void => {
      const index = seam.rest.indexOf(listener);

      if (index !== -1) seam.rest.splice(index, 1);

      resolve();
    };

    seam.rest.push(listener);
  });

  seam.restoring = bookmark;
  state.abort?.abort("restore");

  return entered;
}

// ─── teardown ─────────────────────────────────────────────────

/**
 * Waits for the frame loop to run `timeoutMs` of frames.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param timeoutMs - How long the deadline waits.
 * @returns The deadline and the way to cancel it.
 * @example
 * ```ts
 * const deadline = startDeadline(ctx, ctx.config.settleTimeoutMs);
 * ```
 */
function startDeadline(
  ctx: FlowCtx,
  timeoutMs: number
): { reached: Promise<void>; cancel(): void } {
  const watch: { left: number; off: () => void } = { left: timeoutMs, off: noop };
  const reached = new Promise<void>(resolve => {
    watch.off = ctx.deps.time.onFrame("signals", time => {
      watch.left -= time.delta;

      if (watch.left > 0) return;

      watch.off();
      resolve();
    });
  });

  return {
    reached,
    /**
     * Drops the deadline when the loop settled first.
     *
     * @example
     * ```ts
     * deadline.cancel();
     * ```
     */
    cancel: (): void => {
      watch.off();
    }
  };
}

/**
 * Waits for the aborted loop to settle, at most `settleTimeoutMs` of frames. Without a running
 * frame loop there is nothing to count, so the loop is simply awaited.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param running - The promise of `run()`.
 * @example
 * ```ts
 * await settle(ctx, running);
 * ```
 */
async function settle(ctx: FlowCtx, running: Promise<void>): Promise<void> {
  const quiet = running.then(noop, noop);

  if (!ctx.deps.time.isRunning()) {
    await quiet;
    return;
  }

  const deadline = startDeadline(ctx, ctx.config.settleTimeoutMs);

  try {
    await Promise.race([quiet, deadline.reached]);
  } finally {
    deadline.cancel();
  }
}

/**
 * Stops the runner: the active node is aborted with reason `"stop"`, the loop is given
 * `settleTimeoutMs` to settle, and a background flush that is still running is awaited. The loop
 * itself discards the open transaction and shuts the gate while it leaves the aborted node.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns A promise that resolves when the graph stands still.
 * @example
 * ```ts
 * teardown.register(ctx.global, "flow", () => stopRunner(flowCtx));
 * ```
 */
export async function stopRunner(ctx: FlowCtx): Promise<void> {
  const state = ctx.state.runner;
  const running = state.running;
  const active = state.abort;

  active?.abort("stop");

  if (active === undefined || abortReason(active.signal) !== "stop") {
    const stop = new AbortController();

    stop.abort("stop");
    state.abort = stop;
  }

  if (running !== undefined) await settle(ctx, running);

  state.running = undefined;
  state.abort = undefined;

  const flushing = state.flushing;

  if (flushing !== undefined) {
    state.flushing = undefined;
    await flushing;
  }
}
