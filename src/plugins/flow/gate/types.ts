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
 *
 * @example
 * ```ts
 * const spec: GateSpec = { allowed: ["play", "shop"] };
 * ```
 */
export type GateSpec = { allowed: readonly string[] };

/**
 * gate module state.
 *
 * @example
 * ```ts
 * const gate: GateState = createGateState();
 * ```
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
 * gate module API: the single entry of player answers.
 *
 * @example
 * ```ts
 * const accepted = app.flow.gate.answer({ intent: "play" });
 * ```
 */
export type GateApi = {
  answer(answer: Answer): boolean;
  pointer(active: boolean): void;
  state(): { open: boolean; allowed: readonly string[]; narrowed: boolean };
};

/**
 * gate methods injected into `runner` and `fx`. Not public.
 *
 * @example
 * ```ts
 * const answer = await modules.gate.open({ allowed: ["again", "home"] });
 * ```
 */
export type GateInternal = {
  open(spec: GateSpec): Promise<Answer>;
  close(): void;
  narrow(allow: Allow | undefined): void;
  clearHeld(frame: number): void;
};
