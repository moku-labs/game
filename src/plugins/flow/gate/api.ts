/**
 * @file flow/gate — API factory. The single entry of player answers: close before deliver, a hold
 * for an answer that arrived while the gate was closed, and the `guide` narrow.
 */
import { jsonEquals } from "../guide";
import type { FlowCtx } from "../types";
import type { Allow, Answer, GateApi, GateInternal, GateSpec, GateState } from "./types";

/**
 * Logs, in a dev build, an answer a closed gate refused that no gate will take (F122): it was not
 * held (`fast`, `stopped`), or it was dropped (`aged`, `not-taken`, `jumped`). The
 * payload is built only when the line is written.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param answer - The answer that is lost.
 * @param reason - Why no gate takes it.
 */
function dropped(ctx: FlowCtx, answer: Answer, reason: string): void {
  if (!(typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__)) return;

  ctx.log.warn("flow: a held answer was dropped", { intent: answer.intent, reason });
}

/**
 * Tells whether an answer is the one a guide names: the intent matches, and the payload too when
 * the guide's answer carries one.
 *
 * @param named - The answer a `guide` names: the one it lets through, or the one of a blocked press.
 * @param answer - The answer given.
 * @returns True when the answer is that one.
 * @example
 * ```ts
 * matchesAnswer({ intent: "merge" }, { intent: "sell" }); // false
 * ```
 */
function matchesAnswer(named: Allow, answer: Answer): boolean {
  if (named.intent !== answer.intent) return false;
  if (named.payload === undefined) return true;

  return jsonEquals(named.payload, answer.payload);
}

/**
 * Tells whether a running `guide` lets this answer through. Without a narrow every answer passes;
 * with one it must be the answer the guide allows or the answer of a press outside its window.
 *
 * @param state - Gate state: the narrow and the answer of a blocked press.
 * @param answer - The answer given.
 * @returns True when the answer passes the narrow.
 */
function passesNarrow(state: GateState, answer: Answer): boolean {
  if (state.narrow === undefined) return true;
  if (matchesAnswer(state.narrow, answer)) return true;

  return state.blocked !== undefined && matchesAnswer(state.blocked, answer);
}

/**
 * Copies a guide's answer for a reader: the intent, and a copy of the payload when there is one.
 *
 * @param named - The answer the gate keeps.
 * @returns A copy nobody shares.
 * @example
 * ```ts
 * copyAnswer({ intent: "tutorialBlocked", payload: { step: 2 } }); // { intent: "tutorialBlocked", payload: { step: 2 } }
 * ```
 */
function copyAnswer(named: Allow): Allow {
  if (named.payload === undefined) return { intent: named.intent };

  return { intent: named.intent, payload: structuredClone(named.payload) };
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

  return passesNarrow(state, answer);
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
 * Keeps an answer that arrived at a closed gate, with the frame and the game time of the refusal.
 * Nothing is held in fast mode or while time is not running: there is no frame that could age it.
 * Without a hold time (`holdMs` 0 or less) the first answer wins and a second one is dropped. With
 * one, every refused answer replaces the held one: the last press is the one the player means.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param answer - The answer the closed gate refused.
 */
function hold(ctx: FlowCtx, answer: Answer): void {
  if (ctx.state.fx.mode === "fast") {
    dropped(ctx, answer, "fast");
    return;
  }
  if (!ctx.deps.time.isRunning()) {
    dropped(ctx, answer, "stopped");
    return;
  }
  // The first answer wins: it is held, and its fate is told.
  if (ctx.config.holdMs <= 0 && ctx.state.gate.held !== undefined) return;

  const { frame, elapsed } = ctx.deps.time.snapshot();
  // Refused after this frame's `signals`: the hold belongs to the next frame and lives through it.
  const heldFor = frame === ctx.state.gate.aged ? frame + 1 : frame;

  ctx.state.gate.held = { answer, frame: heldFor, at: elapsed };
}

/**
 * Offers the held answer to the gate that has just opened. It is offered once: an answer the new
 * gate does not accept is dropped, not kept for the next one. A gate that opens in fast mode gets
 * no offer: a fast walk answers its own gates, and a press of the live play before it is dropped.
 *
 * @param ctx - Domain context of the flow plugin.
 */
function offerHeld(ctx: FlowCtx): void {
  const held = ctx.state.gate.held;

  if (held === undefined) return;

  ctx.state.gate.held = undefined;

  if (ctx.state.fx.mode === "fast") {
    dropped(ctx, held.answer, "fast");

    return;
  }
  if (!accepts(ctx.state.gate, held.answer)) {
    dropped(ctx, held.answer, "not-taken");
    return;
  }

  deliver(ctx.state.gate, held.answer);
}

/**
 * Creates the gate API: the single entry of player answers. The gate closes before the answer is
 * handed on; an answer to a closed gate is held for the next gate, for one frame or for
 * `config.holdMs` of game time; `narrow` lets one answer through; `pointer(true)` delays entering
 * an `over` node.
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

    state: (): {
      open: boolean;
      allowed: readonly string[];
      narrowed: boolean;
      blocked?: Allow;
    } => {
      const { open, narrow, blocked } = ctx.state.gate;
      const read = {
        open: open !== undefined,
        allowed: open?.allowed ?? [],
        narrowed: narrow !== undefined
      };

      // A copy: the caller may keep it, never write the gate's own.
      return blocked === undefined ? read : { ...read, blocked: copyAnswer(blocked) };
    },

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

    narrow: (allow: Allow | undefined, blocked?: Allow): void => {
      ctx.state.gate.narrow = allow;
      // A lift takes the answer of a blocked press with it: it belongs to the guide.
      ctx.state.gate.blocked = allow === undefined ? undefined : blocked;
    },

    clearHeld: (frame: number, elapsed: number): void => {
      const held = ctx.state.gate.held;

      ctx.state.gate.aged = frame;

      if (held === undefined) return;
      if (held.frame === frame) return;
      // With a hold time the age decides, in game time: a paused game ages nothing.
      if (ctx.config.holdMs > 0 && elapsed - held.at <= ctx.config.holdMs) return;

      ctx.state.gate.held = undefined;
      dropped(ctx, held.answer, "aged");
    },

    dropHeld: (): void => {
      const held = ctx.state.gate.held;

      ctx.state.gate.held = undefined;
      if (held !== undefined) dropped(ctx, held.answer, "jumped");
    }
  };
}
