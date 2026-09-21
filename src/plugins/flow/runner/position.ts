/**
 * @file flow/runner — position and results.
 */
import type { Json } from "../../model/types";
import type { Answer } from "../gate/types";
import type { WorldEvent } from "../inbox/types";
import type { FlowCtx } from "../types";
import { requireMainFlow } from "./graph";
import type { Location } from "./loop-types";
import { noPayload } from "./loop-types";
import { findNode } from "./registry";
import type { Frame, Result } from "./types";

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
export function locateFrames(ctx: FlowCtx, frames: readonly Frame[]): Location | undefined {
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
export function framesOf(trail: readonly { flow: string; node: string }[], input: Json): Frame[] {
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
export function safeFrames(ctx: FlowCtx): Frame[] {
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
export function eventResult(event: WorldEvent): Result {
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
export function answerResult(answer: Answer): Result {
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
export function isJson(value: unknown): value is Json {
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
