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
   * real effect can. A throw and a rejection stand for a handler that fails, and end as they do
   * in the game: the awaited effect rejects, except for a descriptor with `cosmetic: true`
   * (`sfx`, `play`, `haptic`, `music`), which resolves `undefined`. The game also writes the warn
   * entry `flow:fx-cosmetic-failed` there. The fake has no log and writes nothing.
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
 * `started`, `fx.emit(hint)` goes to `emitted`. `fx.cancel(promise)` resolves an awaited effect
 * that has not settled `undefined` and returns `true`, and returns `false` for any other promise.
 * `fx.start` refuses a descriptor with `answers` and a `guide` with the error the game throws. An
 * `answer` that fails rejects the awaited effect, and resolves `undefined` for a `cosmetic`
 * descriptor, as in the game. There is no handler, no log, no fast mode and no abort signal here:
 * for those, walk the graph with `createHeadless`.
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

  // The effects not settled yet, each with what ends it early: `cancel` takes it from here.
  const open = new Map<Promise<unknown>, () => void>();

  /**
   * Asks `options.answer` for one awaited effect. An `answer` that throws or rejects is a handler
   * that fails: the effect rejects, never the call. A `cosmetic` descriptor swallows that failure
   * and resolves `undefined`, as the gateway of the game does.
   *
   * @param descriptor - The descriptor the body awaits.
   * @returns A promise of what `options.answer` gives for it.
   */
  const answerOf = async (descriptor: Descriptor): Promise<unknown> => {
    try {
      return await options.answer?.(descriptor);
    } catch (error) {
      if (descriptor.cosmetic !== true) throw error;
    }
  };

  /**
   * Records one awaited effect and answers it. Both happen at the call. The effect stays open
   * until it settles, or until `cancel` resolves it `undefined`.
   *
   * @param descriptor - The descriptor the body awaits.
   * @returns A promise of what `options.answer` gives for it.
   */
  const run = (descriptor: Descriptor): Promise<unknown> => {
    awaited.push(descriptor);

    const answered = answerOf(descriptor);
    const early = { end: (): void => undefined };
    const effect = new Promise<unknown>((resolve, reject) => {
      early.end = () => {
        // eslint-disable-next-line unicorn/no-useless-undefined -- `Promise<unknown>` wants the value said.
        resolve(undefined);
      };
      answered.then(resolve, reject);
    });

    open.set(effect, early.end);
    // `finally` would hand the rejection on to a promise nobody holds: both branches settle quietly.
    answered.then(
      () => open.delete(effect),
      () => open.delete(effect)
    );

    return effect;
  };

  /**
   * Ends one open effect the fake returned: it resolves `undefined`.
   *
   * @param effect - A promise `run` returned.
   * @returns True when the effect was open and is ended now.
   */
  const cancel = (effect: Promise<unknown>): boolean => {
    const end = open.get(effect);

    if (end === undefined) return false;

    open.delete(effect);
    end();

    return true;
  };

  // The gateway is not generic: the result type is the descriptor's promise, kept by
  // `defineEffect` and the built-in helpers.
  const fx = Object.assign(run, {
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
    },
    cancel
  }) as NodeFx;

  return Object.freeze({ fx, awaited, started, emitted });
}
