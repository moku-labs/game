/**
 * @file flow/fx — declares an effect of the game: a typed descriptor constructor with its kind and
 * the registration of its one handler. Pure apart from `handle`, which hands the handler to the
 * gateway it is given.
 */
import type { Json } from "../../model/types";
import type { Descriptor, Effect, EffectHandler, EffectOptions, FxApi } from "./types";

/**
 * Builds the descriptor of one declared effect: the payload key only when there is a payload, the
 * cosmetic flag only when the effect is cosmetic, so the descriptor stays plain JSON.
 *
 * @param kind - The effect kind.
 * @param payload - The payload the node passed, or `undefined` for an effect without one.
 * @param cosmetic - Whether the effect was declared cosmetic.
 * @returns The descriptor, frozen.
 * @example
 * ```ts
 * descriptorOf("view-env.read", { notice: true }, false); // { kind: "view-env.read", payload: { notice: true } }
 * ```
 */
function descriptorOf(kind: string, payload: Json | undefined, cosmetic: boolean): Descriptor {
  const base: Descriptor = payload === undefined ? { kind } : { kind, payload };

  return Object.freeze(cosmetic ? { ...base, cosmetic: true } : base);
}

/**
 * Declares an effect whose handler runs in a fast walk too: `await fx(effect(payload))` resolves
 * `Result`. `fast: "run"` is the promise of the effect's owner: its handler is registered with
 * `runInFast` and in every app that awaits the effect, the headless app of the tests included. An
 * app with no handler for the kind still resolves `undefined`, which this type does not show.
 *
 * @param kind - The effect kind, as `fx.handle` and the journal name it.
 * @param options - How it behaves.
 * @param options.fast - `"run"`: the handler also runs in a fast walk.
 * @param options.cosmetic - Not set or `false`: a cosmetic effect may resolve `undefined`.
 * @returns The descriptor constructor with `kind` and `handle`.
 * @example
 * ```ts
 * // shared/effects.ts of a game: the page read, typed once.
 * export const envRead = defineEffect<{ notice: boolean }, { reducedMotion: boolean; saveFallback: boolean }>(
 *   "view-env.read",
 *   { fast: "run" }
 * );
 * // In a node: no guard any more.
 * const env = await fx(envRead({ notice: true })); // { reducedMotion: false, saveFallback: true }
 * // In the plugin that owns it, at its start:
 * const off = envRead.handle(ctx.require(flowPlugin).fx, payload => readPage(payload.notice));
 * ```
 */
export function defineEffect<
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` is the payload of an effect without one, on purpose
  Payload extends Json | void,
  Result
>(kind: string, options: { fast: "run"; cosmetic?: false }): Effect<Payload, Result, Result>;

/**
 * Declares an effect that may resolve `undefined`: `await fx(effect(payload))` resolves
 * `Result | undefined`, because a fast walk skips its handler, or a cosmetic effect whose handler
 * failed resolves `undefined`.
 *
 * @param kind - The effect kind, as `fx.handle` and the journal name it.
 * @param options - How it behaves.
 * @param options.fast - `"skip"` (the default): the handler does not run in a fast walk.
 * @param options.cosmetic - `true`: a handler error never reaches the node.
 * @returns The descriptor constructor with `kind` and `handle`.
 * @example
 * ```ts
 * // shared/effects.ts of a game: a confetti burst, nothing a fast walk needs.
 * export const confetti = defineEffect<{ cell: string }, void>("board.confetti", { cosmetic: true });
 * confetti({ cell: "c3" }); // { kind: "board.confetti", payload: { cell: "c3" }, cosmetic: true }
 * ```
 */
export function defineEffect<
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` is the payload of an effect without one, on purpose
  Payload extends Json | void,
  Result
>(kind: string, options?: EffectOptions): Effect<Payload, Result, Result | undefined>;

/**
 * The one implementation behind the two overloads.
 *
 * @param kind - The effect kind.
 * @param options - How it behaves.
 * @returns The descriptor constructor with `kind` and `handle`.
 */
export function defineEffect<
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` is the payload of an effect without one, on purpose
  Payload extends Json | void,
  Result
>(kind: string, options: EffectOptions = {}): Effect<Payload, Result, Result | undefined> {
  const cosmetic = options.cosmetic === true;
  const runInFast = options.fast === "run";
  // An effect without a payload is `void` to its declaration and `undefined` at run time.
  const build = (payload?: Payload): Descriptor =>
    descriptorOf(kind, payload as Json | undefined, cosmetic);
  const handle = (fx: FxApi, handler: EffectHandler<Payload, Result>): (() => void) =>
    fx.handle(
      kind,
      // The payload is typed as the constructor writes it; a descriptor of the same kind built by
      // hand is the caller's own claim.
      (descriptor, context) => handler(descriptor.payload as Payload, context),
      { runInFast }
    );

  // The constructor's argument list and result are typed by the declaration, not by the arrow.
  return Object.assign(build, { kind, handle }) as Effect<Payload, Result, Result | undefined>;
}
