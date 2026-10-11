/**
 * @file The `fx` of a node context for a unit test, re-exported by the `./testing` entry. A test
 * that calls `node.run(context)` itself needs an `fx` that records what the body asked for and
 * answers what the test says. A root module, not a plugin file. It imports no `node:` module.
 */
import type { Descriptor, Hint, NodeFx } from "../plugins/flow/fx/types";
import { refuseStart } from "../plugins/flow/runner/node";

/** The node path a refused `fx.start` names when the test gives none. */
const defaultPath = "test";

/**
 * What a test tells `fakeFx`.
 *
 * @example
 * ```ts
 * const options: FakeFxOptions = {
 *   answer: descriptor => (descriptor.kind === "popup" ? { intent: "again" } : undefined),
 *   path: "board/place"
 * };
 * ```
 */
export type FakeFxOptions = {
  /**
   * What an awaited effect resolves with: a value, or a promise of one. Called once for every
   * `await fx(descriptor)`, at the call, with the descriptor itself. Without it every awaited
   * effect resolves `undefined`. A promise that never settles holds the body at its `await`, as a
   * real effect can. A throw and a rejection make the awaited effect reject, as a failing handler
   * does.
   *
   * @example
   * ```ts
   * // The popup is answered, a sound never ends: a body that waits for the sound stays there.
   * fakeFx({
   *   answer: descriptor =>
   *     descriptor.kind === "sfx" ? new Promise<never>(() => undefined) : { intent: "again" }
   * });
   * ```
   */
  answer?: (descriptor: Descriptor) => unknown;
  /**
   * The path of the node under test. Only the error of a refused `fx.start` names it. `"test"`
   * by default.
   */
  path?: string;
};

/**
 * What `fakeFx` returns: the `fx` for the node context, and the three lists it records into.
 * Each list is one array for the whole life of the fake: a list read before the body ran holds
 * the later calls too, and a test starts a list over with `list.length = 0`. The lists hold the
 * objects the body passed, not copies. The holder is frozen, so a list cannot be replaced by
 * another array the fake would not write to.
 *
 * @example
 * ```ts
 * const { fx, started }: FakeFx = fakeFx();
 *
 * fx.start({ kind: "sfx", payload: { key: "ui.tap" } });
 * started; // [{ kind: "sfx", payload: { key: "ui.tap" } }]
 * ```
 */
export type FakeFx = {
  /** The `fx` to put into the node context: `{ ...context, fx: fake.fx }`. */
  readonly fx: NodeFx;
  /** Every `await fx(descriptor)` in call order, recorded at the call, answered or not. */
  readonly awaited: Descriptor[];
  /** Every `fx.start(descriptor)` in call order. A refused start is not in it. */
  readonly started: Descriptor[];
  /** Every `fx.emit(hint)` in call order. */
  readonly emitted: Hint[];
};

/**
 * Builds the `fx` of a node context for a unit test that calls `node.run(context)` itself, with no
 * app and no runner. It records every call and plays no effect: `await fx(descriptor)` goes to
 * `awaited` and resolves with `options.answer(descriptor)`, `fx.start(descriptor)` goes to
 * `started`, `fx.emit(hint)` goes to `emitted`. `fx.start` refuses a descriptor with `answers`
 * and a `guide` with the error the game throws. There is no handler, no fast mode and no abort
 * signal here: for those, walk the graph with `createHeadless`.
 *
 * @param options - The answer of an awaited effect, and the node path for the refusal message.
 * @returns The `fx` and the lists `awaited`, `started` and `emitted`.
 * @example
 * ```ts
 * // The body of the node "place" runs fx.start(sfx("ui.tap")), then pushes input.cell to
 * // session.marks. `context` is the rest of its context: input, player, session, rng, out,
 * // signal and now.
 * const fx = fakeFx();
 *
 * await place.run?.({ ...context, fx: fx.fx });
 *
 * fx.started; // [{ kind: "sfx", payload: { key: "ui.tap", bus: "sfx" }, cosmetic: true }]
 * fx.awaited; // []: the body waited for no effect
 *
 * // The node "retry" awaits a popup that takes answers. The test gives the player's pick.
 * const picked = fakeFx({
 *   answer: descriptor => (descriptor.kind === "popup" ? { intent: "again" } : undefined)
 * });
 *
 * await retry.run?.({ ...context, fx: picked.fx });
 *
 * picked.awaited; // [{ kind: "popup", payload: { name: "Retry" }, answers: ["again", "home"] }]
 * ```
 */
export function fakeFx(options: FakeFxOptions = {}): FakeFx {
  const path = options.path ?? defaultPath;
  const awaited: Descriptor[] = [];
  const started: Descriptor[] = [];
  const emitted: Hint[] = [];

  /**
   * Records one awaited effect and answers it. Both happen at the call. The function is `async`
   * so that an `answer` that throws rejects the effect and never the call.
   *
   * @param descriptor - The descriptor the body awaits.
   * @returns A promise of what `options.answer` gives for it.
   */
  const run = async (descriptor: Descriptor): Promise<unknown> => {
    awaited.push(descriptor);

    return options.answer?.(descriptor);
  };

  const fx: NodeFx = Object.assign(run, {
    /**
     * Records one hint. Nothing releases it: the test has no edge to commit.
     *
     * @param item - The hint.
     */
    emit: (item: Hint): void => {
      emitted.push(item);
    },

    /**
     * Records one started effect, unless the real `fx.start` would refuse it.
     *
     * @param descriptor - The descriptor the body starts.
     * @throws {Error} When the descriptor has `answers` or is a `guide`.
     */
    start: (descriptor: Descriptor): void => {
      refuseStart(descriptor, path);
      started.push(descriptor);
    }
  });

  return Object.freeze({ fx, awaited, started, emitted });
}
