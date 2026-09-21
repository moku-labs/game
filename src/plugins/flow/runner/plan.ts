/**
 * @file flow/runner — planning the next position.
 */
import type { Json } from "../../model/types";
import type { Contribution, FeaturesApi } from "../features/types";
import type { FlowCtx } from "../types";
import type { Location, Plan } from "./loop-types";
import { maxDepth, noPayload } from "./loop-types";
import { isJson, locateFrames } from "./position";
import { framePath } from "./registry";
import { hasSubstitution } from "./seam";
import type { AnyFlow, Frame } from "./types";

/**
 * Describes where the frames now point and descends into a sub-flow until a node or a slot is
 * reached. A sub-flow a walk substituted is not entered. A slot is NOT descended here: its
 * contribution is picked by `when` against the committed state, and a plan is made before the
 * commit of the edge, so the loop enters the slot after the commit and plans from there.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param frames - The position being planned; mutated while descending.
 * @returns The plan, or the problem that stops it.
 */
export function describePlan(ctx: FlowCtx, frames: Frame[]): Plan {
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
 */
export function pickContribution(
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
 * @param frames - The position being planned; mutated.
 * @param location - Where the result was produced.
 * @param outcome - Outcome name of the result.
 * @param payload - Payload of the result.
 * @param depth - How many sub-flows were left already.
 * @returns The plan, or the problem that stops it.
 */
export function planFrom(
  ctx: FlowCtx,
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
    return continueSlot(frames, location.flow.id);
  }

  return planFrom(ctx, frames, parent, target.outcome, payload, depth + 1);
}

/**
 * Plans the return to a slot after one of its contributions ended. The next contribution is NOT
 * picked here: `when` reads the committed state, and a plan is made before the commit of the edge.
 * So the plan stands on the slot node and names the contribution that ended; the loop picks the
 * next one after the commit, or leaves the slot with its `done` edge.
 *
 * @param frames - The position, already popped back to the slot node.
 * @param finished - Id of the contribution flow that just ended.
 * @returns The plan that stands on the slot node.
 */
function continueSlot(frames: Frame[], finished: string): Plan {
  return {
    stack: frames,
    next: framePath(frames),
    rest: false,
    checkpoint: false,
    after: finished
  };
}
