/**
 * @file flow/gate — type definitions.
 */
import type { Json } from "../../model/types";

/**
 * One answer of the player, of an agent or of a test. `Intent` narrows the intents: a popup's
 * answer names one of the outcomes of its component.
 *
 * @example
 * ```ts
 * const answer: Answer = { intent: "merge", payload: { from: "c2", to: "c3" } };
 * const pick: Answer<"again" | "home"> = { intent: "again" };
 * ```
 */
export type Answer<Intent extends string = string> = { intent: Intent; payload?: Json };

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
  /**
   * An answer given while the gate was closed, kept for the next gate: for the frame it was given
   * in, or for `config.holdMs` of game time. `frame` is the frame the hold lives through: the frame
   * of the refusal, or the next one for a refusal after its `signals` (see `aged`). `at` is
   * `time.snapshot().elapsed` at the refusal: the age is counted from it.
   */
  held: { answer: Answer; frame: number; at: number } | undefined;
  /**
   * The last frame whose `signals` phase aged the hold; 0 before the first, since frame 0 runs no
   * phases. An answer refused
   * after it (later in that frame, or between two frames, as a tap resolved at its DOM event) is
   * held for the next frame: it lives through that frame's `signals`, as one refused in its input
   * phase does.
   */
  aged: number;
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
   * to a closed gate is refused and held: it is offered once to the next gate that opens, which
   * takes it when it lists the intent and a running `guide` lets it through. With `holdMs: 0` the
   * hold lives for the frame the answer was given in, or through the next frame for an answer given
   * after that frame's `signals` or between two frames, and the first answer wins. With `holdMs`
   * above 0 the last answer wins and it is kept for that much game time. Nothing is held in fast
   * mode or while no frame source runs.
   *
   * @param answer - Intent and optional payload.
   * @returns Whether the answer was accepted. `false` for a held answer too: it is not taken yet.
   * @example
   * ```ts
   * // The player dropped the item of cell c2 onto c3 while the board rests.
   * app.flow.gate.answer({ intent: "merge", payload: { from: "c2", to: "c3" } }); // true
   * app.flow.gate.answer({ intent: "quit" }); // false: the resting node does not list "quit"
   * // With holdMs: 1100, a tap during the merge animation is played when the board rests again.
   * app.flow.gate.answer({ intent: "tap", payload: { cell: "c4" } }); // false now, taken later
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
   * Opens the gate for the intents of one node and waits for the answer. A held answer is offered
   * at once, so the promise can be resolved before it is returned. It is offered once: a gate that
   * does not take it drops it. A gate that opens in fast mode drops it without an offer: a fast
   * walk answers its own gates.
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
   * Ages the held answer. Wired to `time.onFrame("signals")` by the plugin root. An answer of the
   * running frame always stays. An answer of an earlier frame is dropped when `config.holdMs` is
   * 0 or less, so the hold lives for exactly the frame it was given in; with `holdMs` above 0 it is
   * dropped once `elapsed` is more than `holdMs` past the refusal. `Infinity` never drops it here.
   *
   * @param frame - The frame that is running now.
   * @param elapsed - Game time of that frame, `time.snapshot().elapsed`.
   */
  clearHeld(frame: number, elapsed: number): void;

  /**
   * Drops the held answer, whatever its age. The runner calls it where the position jumps: when
   * it enters a bookmark, and when it gives up on a transition and moves to the safe node. A
   * press made before the jump belongs to the position that was left. A retry keeps the press,
   * and a stop clears it for the next `run()`.
   */
  dropHeld(): void;
};
