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
 * @example
 * ```ts
 * if (accepts(ctx.state.gate, answer)) deliver(ctx.state.gate, answer);
 * ```
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
 * @example
 * ```ts
 * shut(ctx.state.gate);
 * ```
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
 * @example
 * ```ts
 * deliver(ctx.state.gate, { intent: "play" });
 * ```
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
 * @example
 * ```ts
 * hold(ctx, { intent: "play" });
 * ```
 */
function hold(ctx: FlowCtx, answer: Answer): void {
  if (ctx.state.fx.mode === "fast") return;
  if (!ctx.deps.time.isRunning()) return;
  if (ctx.state.gate.held !== undefined) return;

  ctx.state.gate.held = { answer, frame: ctx.deps.time.read().frame };
}

/**
 * Offers the held answer to the gate that has just opened. It is offered once: an answer the new
 * gate does not accept is dropped, not kept for the next one.
 *
 * @param ctx - Domain context of the flow plugin.
 * @example
 * ```ts
 * offerHeld(ctx);
 * ```
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
 * @example
 * ```ts
 * const gate = createGateApi(ctx);
 * const answer = await gate.open({ allowed: ["play", "shop"] });
 * ```
 */
export function createGateApi(ctx: FlowCtx): GateApi & GateInternal {
  return {
    /**
     * Gives one answer. Accepted only while the gate is open and the intent is allowed. An answer
     * to a closed gate is held for one frame and re-offered when the gate opens within it.
     *
     * @param answer - Intent and optional payload.
     * @returns Whether the answer was accepted.
     * @example
     * ```ts
     * app.flow.gate.answer({ intent: "merge", payload: { from: "c2", to: "c3" } });
     * ```
     */
    answer: (answer: Answer): boolean => {
      if (ctx.state.gate.open === undefined) {
        hold(ctx, answer);
        return false;
      }

      if (!accepts(ctx.state.gate, answer)) return false;

      deliver(ctx.state.gate, answer);
      return true;
    },

    /**
     * Records that a pointer is down. While true the runner delays entering an `over` node, so a
     * popup never appears mid-drag.
     *
     * @param active - True while the pointer is down.
     * @example
     * ```ts
     * app.flow.gate.pointer(true);
     * ```
     */
    pointer: (active: boolean): void => {
      ctx.state.gate.pointerActive = active;
    },

    /**
     * Reads what the gate takes right now.
     *
     * @returns Whether the gate is open, the allowed intents and whether a `guide` narrows it.
     * @example
     * ```ts
     * expect(app.flow.gate.state().allowed).toEqual(["play"]);
     * ```
     */
    state: (): { open: boolean; allowed: readonly string[]; narrowed: boolean } => ({
      open: ctx.state.gate.open !== undefined,
      allowed: ctx.state.gate.open?.allowed ?? [],
      narrowed: ctx.state.gate.narrow !== undefined
    }),

    /**
     * Opens the gate for the intents of one node and waits for the answer. An answer held from
     * this frame is offered at once, so the promise can be resolved before it is returned.
     *
     * @param spec - The intents this gate accepts.
     * @returns The answer that closed the gate.
     * @throws {Error} When the gate is already open.
     * @example
     * ```ts
     * const answer = await modules.gate.open({ allowed: ["again", "home"] });
     * ```
     */
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

    /**
     * Shuts the gate without an answer. Used when the node is left for another reason: an abort, a
     * world event from the inbox. A running narrow survives.
     *
     * @example
     * ```ts
     * modules.gate.close();
     * ```
     */
    close: (): void => {
      shut(ctx.state.gate);
    },

    /**
     * Narrows the gate to one answer, or lifts the narrow with `undefined`. This is what `guide`
     * does while a tutorial step runs.
     *
     * @param allow - The one answer that passes, or `undefined` to lift the narrow.
     * @example
     * ```ts
     * modules.gate.narrow({ intent: "merge", payload: { from: "c2", to: "c3" } });
     * ```
     */
    narrow: (allow: Allow | undefined): void => {
      ctx.state.gate.narrow = allow;
    },

    /**
     * Drops an answer that was held in an earlier frame. Wired to `time.onFrame("signals")` by the
     * plugin root, so a hold lives for exactly the frame it was given in.
     *
     * @param frame - The frame that is running now.
     * @example
     * ```ts
     * time.onFrame("signals", ({ frame }) => gate.clearHeld(frame));
     * ```
     */
    clearHeld: (frame: number): void => {
      if (ctx.state.gate.held === undefined) return;
      if (ctx.state.gate.held.frame === frame) return;

      ctx.state.gate.held = undefined;
    }
  };
}
