/**
 * @file flow/fx — type definitions.
 */
import type { Json } from "../../model/types";
import type { Allow } from "../gate/types";

/**
 * An effect a node awaits. With `answers` the runner opens the gate for those intents.
 * `cosmetic: true` swallows a handler error and resolves `undefined`.
 *
 * @example
 * ```ts
 * const descriptor: Descriptor = { kind: "popup", payload: { name: "Retry" }, answers: ["again"] };
 * ```
 */
export type Descriptor = {
  kind: string;
  payload?: Json;
  answers?: readonly string[];
  cosmetic?: boolean;
};

/**
 * A fire-and-forget cosmetic effect. Released only after the commit of its transaction.
 *
 * @example
 * ```ts
 * const sparkle: Hint = { kind: "sparkle", payload: { cell: "c3" }, hint: true };
 * ```
 */
export type Hint = { kind: string; payload?: Json; hint: true };

/**
 * Options of the `guide` descriptor: the one allowed answer and its visual part.
 *
 * @example
 * ```ts
 * const options: GuideOptions = { allow: { intent: "merge" }, hand: "drag", text: "Merge them" };
 * ```
 */
export type GuideOptions = {
  allow: Allow;
  highlight?: readonly string[];
  hand?: "tap" | "drag";
  text?: string;
};

/**
 * Handler of one effect kind, registered by a plugin above `flow`.
 *
 * @example
 * ```ts
 * // The handler of "sfx": start the sound the node named, stop it when the node is aborted.
 * const playSound: FxHandler = (descriptor, { signal }) => {
 *   const sound = sounds.play(descriptor.payload); // payload: { name: "merge" }
 *
 *   signal.addEventListener("abort", () => sound.stop());
 * };
 *
 * app.flow.fx.handle("sfx", playSound);
 * ```
 */
export type FxHandler = (
  descriptor: Descriptor | Hint,
  ctx: { signal: AbortSignal; mode: "live" | "fast" }
) => unknown | Promise<unknown>;

/**
 * Listener of released hints, registered with `fx.onHint`. Every listener hears every hint, so it
 * reads `kind` itself.
 *
 * @example
 * ```ts
 * // The world plugin plays a motion for the hints it knows and ignores the rest.
 * const playMotion: HintListener = released => {
 *   if (released.kind === "merged") playMergeInto(released.payload);
 * };
 * ```
 */
export type HintListener = (hint: Hint) => void;

/**
 * fx module state.
 */
export type FxState = {
  /** One handler per effect kind. */
  handlers: Map<string, { run: FxHandler; runInFast: boolean }>;
  /** Hints of the open transaction. */
  buffered: Hint[];
  /** Listeners of released hints, in registration order. */
  hintListeners: HintListener[];
  /** Completions waiting for the `signals` phase, in start order. */
  settled: Array<() => void>;
  mode: "live" | "fast";
};

/**
 * fx module API, `app.flow.fx`: the effects gateway.
 *
 * @example
 * ```ts
 * // The popup layer owns the kind "popup". It shows the UI; the answer comes through the gate.
 * app.flow.fx.handle("popup", descriptor => showPopup(descriptor.payload));
 *
 * // A node then writes: await fx({ kind: "popup", answers: ["close"] });
 * ```
 */
export type FxApi = {
  /**
   * Registers the single handler of one effect kind. A second handler for the same kind throws:
   * an effect has exactly one owner.
   *
   * @param kind - Effect kind, for example `"sfx"`.
   * @param handler - Called with the descriptor and `{ signal, mode }`.
   * @param options - Registration options.
   * @param options.runInFast - `true` makes the handler run in fast mode too.
   * @returns The unregister function. It removes only the handler it registered.
   * @throws {Error} When the kind already has a handler.
   * @example
   * ```ts
   * // Preloading is real work, so it runs in a fast walk too. Sounds and popups do not.
   * const off = app.flow.fx.handle("load", preload, { runInFast: true });
   *
   * off(); // "load" has no handler again: the kind is free for another owner
   * ```
   */
  handle(kind: string, handler: FxHandler, options?: { runInFast?: boolean }): () => void;

  /**
   * Delivers a descriptor or a released hint to its handler and forgets about it. In fast mode
   * only a handler registered with `runInFast` is called, exactly as for an awaited effect. A
   * missing handler is not an error and a failing handler is logged, never thrown.
   *
   * @param descriptor - The descriptor or hint to deliver.
   * @example
   * ```ts
   * // The screen wants a haptic tick outside any node. Nothing waits for it.
   * app.flow.fx.dispatch({ kind: "haptic", payload: { style: "light" } });
   * ```
   */
  dispatch(descriptor: Descriptor | Hint): void;

  /**
   * Registers a listener for every released hint. A hint reaches it after the commit of its edge,
   * in the order the node emitted them; a discarded transaction sends nothing, and fast mode drops
   * hints altogether. The handler `handle` registered for the same kind is served as well: a
   * listener displaces nobody.
   *
   * @param listener - Called with each released hint.
   * @returns The unregister function. It removes only the listener it registered.
   * @example
   * ```ts
   * // The world plugin turns the hints of a committed edge into projection motions.
   * const off = app.flow.fx.onHint(hint => {
   *   if (hint.kind === "merged") playMergeInto(hint.payload); // payload: { from: "c1", to: "c2" }
   * });
   *
   * off(); // the plugin stopped: no hint reaches it any more
   * ```
   */
  onHint(listener: HintListener): () => void;
};

/**
 * fx methods injected into `runner`. Not public.
 */
export type FxInternal = {
  /**
   * Runs one awaited effect. With `answers` the gate decides; without it the handler does, and
   * while the frame loop runs the completion waits for the next `signals` phase.
   *
   * @param descriptor - The descriptor the node awaits.
   * @param signal - The node's abort signal, handed to the handler.
   * @returns The answer, the handler's value, or `undefined`.
   */
  run(descriptor: Descriptor, signal: AbortSignal): Promise<unknown>;

  /**
   * Buffers one hint of the open transaction. In fast mode the hint is dropped: a fast walk
   * shows nothing.
   *
   * @param hint - The hint produced by `fx.emit`.
   */
  buffer(hint: Hint): void;

  /**
   * Dispatches the buffered hints in the order they were emitted, hands each one to the `onHint`
   * listeners and empties the buffer. Called after the commit of the transaction they belong to.
   */
  release(): void;

  /**
   * Drops the buffered hints of a discarded transaction. Nothing the player would have seen for
   * a change that never happened is shown.
   */
  drop(): void;

  /**
   * Resolves every effect that settled since the last frame, in the order the effects were
   * started. Wired to `time.onFrame("signals")` by the plugin root.
   */
  flushSettled(): void;

  /**
   * Switches between live and fast mode. `walk` and `createHeadless` use it.
   *
   * @param mode - `"live"` runs the handlers, `"fast"` skips all but `runInFast`.
   */
  setMode(mode: "live" | "fast"): void;
};

/**
 * The `fx` of a node context: awaited effects by call, cosmetic hints by `emit`.
 *
 * @example
 * ```ts
 * // Inside a node body: wait for the player's pick, then sparkle once the edge has committed.
 * const pick = await fx({ kind: "popup", payload: { name: "Retry" }, answers: ["again", "home"] });
 * // pick: { intent: "again" }
 * fx.emit(hint("sparkle", { cell: "c3" }));
 * ```
 */
export type NodeFx = ((descriptor: Descriptor) => Promise<unknown>) & { emit(hint: Hint): void };
