/**
 * @file flow/gate — type definitions.
 */
import type { Json } from "../../model/types";

/**
 * One answer of the player, of an agent or of a test.
 *
 * @example
 * ```ts
 * const answer: Answer = { intent: "merge", payload: { from: "c2", to: "c3" } };
 * ```
 */
export type Answer = { intent: string; payload?: Json };

/**
 * The one answer a `guide` lets through. `payload` is compared by deep equality when present.
 *
 * @example
 * ```ts
 * const allow: Allow = { intent: "merge", payload: { from: "c2", to: "c3" } };
 * ```
 */
export type Allow = { intent: string; payload?: Json };

/**
 * What an open gate accepts.
 */
export type GateSpec = { allowed: readonly string[] };

/**
 * gate module state.
 */
export type GateState = {
  /** The spec of the open gate. `undefined`: the gate is closed. */
  open: GateSpec | undefined;
  /** Resolver of the promise returned by `open`. */
  resolve: ((answer: Answer) => void) | undefined;
  /** An answer given while the gate was closed, kept for one frame. */
  held: { answer: Answer; frame: number } | undefined;
  /** The one answer a running `guide` lets through. */
  narrow: Allow | undefined;
  /** True while a pointer is down. Entering an `over` node waits for false. */
  pointerActive: boolean;
  /** Ends the pending pointer wait of the runner. Set while the wait runs, so a stop needs no frame. */
  wake: (() => void) | undefined;
};

/**
 * gate module API, `app.flow.gate`: the single entry of player answers.
 *
 * @example
 * ```ts
 * // The screen turns a tap into an answer. A double tap is safe: the gate closes before the
 * // first answer is handed on.
 * app.flow.gate.answer({ intent: "play" }); // true: "home" rests and lists "play"
 * app.flow.gate.answer({ intent: "play" }); // false: the second tap hits a closed door
 * ```
 */
export type GateApi = {
  /**
   * Gives one answer. Accepted only while the gate is open and the intent is allowed. An answer
   * to a closed gate is held for one frame and re-offered when the gate opens within it.
   *
   * @param answer - Intent and optional payload.
   * @returns Whether the answer was accepted.
   * @example
   * ```ts
   * // The player dropped the item of cell c2 onto c3 while the board rests.
   * app.flow.gate.answer({ intent: "merge", payload: { from: "c2", to: "c3" } }); // true
   * app.flow.gate.answer({ intent: "quit" }); // false: the resting node does not list "quit"
   * ```
   */
  answer(answer: Answer): boolean;

  /**
   * Records that a pointer is down. While true the runner delays entering an `over` node, so a
   * popup never appears mid-drag.
   *
   * @param active - True while the pointer is down.
   * @example
   * ```ts
   * // The input layer reports a drag on the board.
   * app.flow.gate.pointer(true); // pointer down: an `over` node that comes next waits
   * app.flow.gate.pointer(false); // pointer up: the node is entered in the next `signals` phase
   * ```
   */
  pointer(active: boolean): void;

  /**
   * Reads what the gate takes right now.
   *
   * @returns Whether the gate is open, the allowed intents and whether a `guide` narrows it.
   * @example
   * ```ts
   * // The screen greys out a button whose intent the resting node does not take.
   * app.flow.gate.state(); // { open: true, allowed: ["play", "shop"], narrowed: false }
   * ```
   */
  state(): { open: boolean; allowed: readonly string[]; narrowed: boolean };
};

/**
 * gate methods injected into `runner` and `fx`. Not public.
 */
export type GateInternal = {
  /**
   * Opens the gate for the intents of one node and waits for the answer. An answer held from
   * this frame is offered at once, so the promise can be resolved before it is returned.
   *
   * @param spec - The intents this gate accepts.
   * @returns The answer that closed the gate.
   * @throws {Error} When the gate is already open.
   */
  open(spec: GateSpec): Promise<Answer>;

  /**
   * Shuts the gate without an answer. Used when the node is left for another reason: an abort, a
   * world event from the inbox. A running narrow survives.
   */
  close(): void;

  /**
   * Narrows the gate to one answer, or lifts the narrow with `undefined`. This is what `guide`
   * does while a tutorial step runs.
   *
   * @param allow - The one answer that passes, or `undefined` to lift the narrow.
   */
  narrow(allow: Allow | undefined): void;

  /**
   * Drops an answer that was held in an earlier frame. Wired to `time.onFrame("signals")` by the
   * plugin root, so a hold lives for exactly the frame it was given in.
   *
   * @param frame - The frame that is running now.
   */
  clearHeld(frame: number): void;
};
