/**
 * @file flow/gate — API factory. The single entry of player answers: close before deliver, a
 * one-frame hold for an answer that arrived a moment too early, and the `guide` narrow.
 */
import type { Json } from "../../model/types";
import type { FlowCtx } from "../types";
import type { Allow, Answer, GateApi, GateInternal, GateSpec, GateState } from "./types";

/**
 * Compares two JSON values by value. Used for the payload of a `guide`, which points at one
 * concrete move, not at any move of that intent.
 *
 * @param left - First value, `undefined` when the payload is absent.
 * @param right - Second value, `undefined` when the payload is absent.
 * @returns True when both sides carry the same data.
 * @example
 * ```ts
 * jsonEquals({ from: "c2" }, { from: "c2" }); // true
 * ```
 */
function jsonEquals(left: Json | undefined, right: Json | undefined): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left)) return Array.isArray(right) && arrayEquals(left, right);
  if (Array.isArray(right)) return false;

  return objectEquals(left, right);
}

/**
 * Compares two JSON arrays element by element.
 *
 * @param left - First array.
 * @param right - Second array.
 * @returns True when both arrays hold the same elements in the same order.
 * @example
 * ```ts
 * arrayEquals(["c3", 2], ["c3", 2]); // true
 * ```
 */
function arrayEquals(left: readonly Json[], right: readonly Json[]): boolean {
  if (left.length !== right.length) return false;

  return left.every((item, index) => jsonEquals(item, right[index]));
}

/**
 * Compares two JSON objects key by key.
 *
 * @param left - First object.
 * @param right - Second object.
 * @returns True when both objects hold the same keys with the same values.
 * @example
 * ```ts
 * objectEquals({ from: "c2" }, { from: "c2" }); // true
 * ```
 */
function objectEquals(left: { [key: string]: Json }, right: { [key: string]: Json }): boolean {
  const keys = Object.keys(left);

  if (keys.length !== Object.keys(right).length) return false;

  return keys.every(key => jsonEquals(left[key], right[key]));
}

/**
 * Tells whether a running `guide` lets this answer through. Without a narrow every answer passes;
 * with one the intent must match, and the payload too when the narrow names one.
 *
 * @param narrow - The one answer a `guide` lets through, or `undefined`.
 * @param answer - The answer given.
 * @returns True when the answer passes the narrow.
 * @example
 * ```ts
 * passesNarrow({ intent: "merge" }, { intent: "sell" }); // false
 * ```
 */
function passesNarrow(narrow: Allow | undefined, answer: Answer): boolean {
  if (narrow === undefined) return true;
  if (narrow.intent !== answer.intent) return false;
  if (narrow.payload === undefined) return true;

  return jsonEquals(narrow.payload, answer.payload);
}

/**
 * Tells whether the open gate takes this answer. A closed gate takes nothing.
 *
 * @param state - Gate state.
 * @param answer - The answer given.
 * @returns True when the gate is open, lists the intent and the narrow passes.
 */
function accepts(state: GateState, answer: Answer): boolean {
  if (state.open === undefined) return false;
  if (!state.open.allowed.includes(answer.intent)) return false;

  return passesNarrow(state.narrow, answer);
}

/**
 * Shuts the gate. The narrow survives: a `guide` is lifted by the runner on node exit, not by the
 * answer it was waiting for.
 *
 * @param state - Gate state.
 */
function shut(state: GateState): void {
  state.open = undefined;
  state.resolve = undefined;
}

/**
 * Hands one answer to the waiting node. The gate CLOSES BEFORE the answer is handed on, so the
 * second tap of a double tap hits a closed door (E1).
 *
 * @param state - Gate state.
 * @param answer - The accepted answer.
 */
function deliver(state: GateState, answer: Answer): void {
  const resolve = state.resolve;

  shut(state);
  resolve?.(answer);
}

/**
 * Keeps an answer that arrived at a closed gate for one frame. Nothing is held in fast mode or
 * while time is not running: there is no frame that could re-offer it. The first answer wins, a
 * second one in the same frame is dropped.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param answer - The answer the closed gate refused.
 */
function hold(ctx: FlowCtx, answer: Answer): void {
  if (ctx.state.fx.mode === "fast") return;
  if (!ctx.deps.time.isRunning()) return;
  if (ctx.state.gate.held !== undefined) return;

  ctx.state.gate.held = { answer, frame: ctx.deps.time.snapshot().frame };
}

/**
 * Offers the held answer to the gate that has just opened. It is offered once: an answer the new
 * gate does not accept is dropped, not kept for the next one.
 *
 * @param ctx - Domain context of the flow plugin.
 */
function offerHeld(ctx: FlowCtx): void {
  const held = ctx.state.gate.held;

  if (held === undefined) return;

  ctx.state.gate.held = undefined;

  if (!accepts(ctx.state.gate, held.answer)) return;

  deliver(ctx.state.gate, held.answer);
}

/**
 * Creates the gate API: the single entry of player answers. The gate closes before the answer is
 * handed on; an answer to a closed gate is held for one frame, first wins; `narrow` lets one
 * answer through; `pointer(true)` delays entering an `over` node.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns The public gate API plus the methods injected into `runner` and `fx`.
 */
export function createGateApi(ctx: FlowCtx): GateApi & GateInternal {
  return {
    answer: (answer: Answer): boolean => {
      if (ctx.state.gate.open === undefined) {
        hold(ctx, answer);
        return false;
      }

      if (!accepts(ctx.state.gate, answer)) return false;

      deliver(ctx.state.gate, answer);
      return true;
    },

    pointer: (active: boolean): void => {
      ctx.state.gate.pointerActive = active;
    },

    state: (): { open: boolean; allowed: readonly string[]; narrowed: boolean } => ({
      open: ctx.state.gate.open !== undefined,
      allowed: ctx.state.gate.open?.allowed ?? [],
      narrowed: ctx.state.gate.narrow !== undefined
    }),

    open: (spec: GateSpec): Promise<Answer> => {
      if (ctx.state.gate.open !== undefined) {
        throw new Error("[game] The gate is already open.\n  Close it before opening it again.");
      }

      return new Promise<Answer>(resolve => {
        ctx.state.gate.open = spec;
        ctx.state.gate.resolve = resolve;
        offerHeld(ctx);
      });
    },

    close: (): void => {
      shut(ctx.state.gate);
    },

    narrow: (allow: Allow | undefined): void => {
      ctx.state.gate.narrow = allow;
    },

    clearHeld: (frame: number): void => {
      if (ctx.state.gate.held === undefined) return;
      if (ctx.state.gate.held.frame === frame) return;

      ctx.state.gate.held = undefined;
    }
  };
}
