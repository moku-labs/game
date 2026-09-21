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
 * const playSound: FxHandler = (descriptor, { signal }) => audio.play(descriptor.payload, signal);
 * ```
 */
export type FxHandler = (
  descriptor: Descriptor | Hint,
  ctx: { signal: AbortSignal; mode: "live" | "fast" }
) => unknown | Promise<unknown>;

/**
 * fx module state.
 *
 * @example
 * ```ts
 * const fx: FxState = createFxState();
 * ```
 */
export type FxState = {
  /** One handler per effect kind. */
  handlers: Map<string, { run: FxHandler; runInFast: boolean }>;
  /** Hints of the open transaction. */
  buffered: Hint[];
  /** Completions waiting for the `signals` phase, in start order. */
  settled: Array<() => void>;
  mode: "live" | "fast";
};

/**
 * fx module API: the effects gateway.
 *
 * @example
 * ```ts
 * const off = app.flow.fx.handle("sfx", playSound);
 * ```
 */
export type FxApi = {
  handle(kind: string, handler: FxHandler, options?: { runInFast?: boolean }): () => void;
  dispatch(descriptor: Descriptor | Hint): void;
};

/**
 * fx methods injected into `runner`. Not public.
 *
 * @example
 * ```ts
 * const answer = await modules.fx.run(descriptor, signal);
 * ```
 */
export type FxInternal = {
  run(descriptor: Descriptor, signal: AbortSignal): Promise<unknown>;
  buffer(hint: Hint): void;
  release(): void;
  drop(): void;
  flushSettled(): void;
  setMode(mode: "live" | "fast"): void;
};

/**
 * The `fx` of a node context: awaited effects by call, cosmetic hints by `emit`.
 *
 * @example
 * ```ts
 * const pick = await fx(popup("Retry", ["again", "home"]));
 * fx.emit(hint("sparkle", { cell: "c3" }));
 * ```
 */
export type NodeFx = ((descriptor: Descriptor) => Promise<unknown>) & { emit(hint: Hint): void };
