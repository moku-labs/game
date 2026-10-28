/**
 * @file flow/fx — type definitions.
 */
import type { Json } from "../../model/types";
import type { AnchorTarget } from "../../world/projection/types";
import type { Allow } from "../gate/types";

/**
 * An effect a node awaits. With `answers` the runner opens the gate for those intents.
 * `cosmetic: true` keeps a handler error away from the node: the effect resolves `undefined` and
 * the log gets the warn entry `flow:fx-cosmetic-failed` with `{ kind, message }`. `Result` is what
 * `await fx(descriptor)` resolves with: the built-in helpers and `defineEffect` declare it, a
 * descriptor written by hand is `Descriptor<unknown>`. It is carried by a member that is never set,
 * so a descriptor stays plain JSON.
 *
 * @example
 * ```ts
 * const descriptor: Descriptor = { kind: "popup", payload: { name: "Retry" }, answers: ["again"] };
 * const loading: Descriptor<LoadResult | undefined> = { kind: "load", payload: { bundles: ["board"] } };
 * ```
 */
export type Descriptor<Result = unknown> = {
  kind: string;
  payload?: Json;
  answers?: readonly string[];
  cosmetic?: boolean;
  /** Never set: the type of what `await fx(descriptor)` resolves with. */
  readonly $result?: () => Result;
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
 * Options of a guide: the `guide` descriptor a node awaits, and what the `guide` of a node returns.
 * `allow` is the one answer the gate lets through. `ui` dims the screen with a veil and cuts a
 * window over `target` (one target, or the union of the shown ones of a list), grown by `pad`; a
 * press outside the window reaches no view and answers `blocked` when it is set. A press inside the
 * window that the narrow drops answers `blocked` too: another intent, or the allowed intent with
 * another payload (a drop on the wrong cell). Without a target the veil covers the whole screen and
 * every press is outside.
 *
 * @example
 * ```ts
 * // The tutorial's step on the board: drag the item of c2 onto c3, a press elsewhere is "tutorialBlocked".
 * const options: GuideOptions = {
 *   allow: { intent: "merge", payload: { from: "c2", to: "c3" } },
 *   target: [
 *     { projection: "board.items", key: "c2" },
 *     { projection: "board.items", key: "c3" }
 *   ],
 *   pad: 8,
 *   veil: { color: 0x0d2f33, alpha: 0.6 },
 *   blocked: { intent: "tutorialBlocked" }
 * };
 * ```
 */
export type GuideOptions = {
  /** The one answer the gate lets through while the guide stands. */
  allow: Allow;
  /**
   * What the window is cut over: a view or a ui element by projection and key, or a list of them,
   * whose shown ones the window spans. Followed every frame: a target that moves or scrolls takes
   * the window with it. Without one, or while none is shown, the veil covers the whole screen.
   *
   * @example
   * ```ts
   * const order: GuideOptions = {
   *   allow: { intent: "deliver" },
   *   target: [{ projection: "board.strip", key: "order0" }, { projection: "board.strip", key: "deliver0" }]
   * }; // one window around the order card and its button
   * ```
   */
  target?: AnchorTarget | readonly AnchorTarget[];
  /**
   * How far the window grows outward on every side, in screen reference units. 0 when left out.
   *
   * @example
   * ```ts
   * const padded: GuideOptions = { allow: { intent: "seat" }, target: { projection: "board.strip", key: "seat0" }, pad: 4 };
   * // the seat drawn at { x: 40, y: 1500, w: 116, h: 120 }: the window at { x: 36, y: 1496, w: 124, h: 128 }
   * ```
   */
  pad?: number;
  /**
   * The veil around the window: its colour and alpha, black at 0.6 when left out. `alpha: 0` draws
   * nothing visible and still locks; `false` draws nothing at all and still locks, so the game
   * draws its own look in an `<anchor>` on the same targets.
   *
   * @example
   * ```ts
   * const clear: GuideOptions = { allow: { intent: "play" }, target: { projection: "hud", key: "play" }, veil: false };
   * // no veil: the game's <anchor to={{ projection: "hud", key: "play" }}> draws the rim, presses outside still reach nothing
   * ```
   */
  veil?: { color?: number; alpha?: number } | false;
  /**
   * The answer a press outside the window gives, with its payload, instead of reaching nothing. A
   * press inside the window that the narrow drops gives it too: another intent, or the allowed
   * intent with another payload (a drop on the wrong cell). A press at a closed gate is held as it
   * is, never turned into `blocked`. The gate takes it beside `allow`, so it must be an outcome of
   * the node that waits.
   *
   * @example
   * ```ts
   * const strict: GuideOptions = {
   *   allow: { intent: "merge", payload: { from: "c2", to: "c3" } },
   *   target: [
   *     { projection: "board.items", key: "c2" },
   *     { projection: "board.items", key: "c3" },
   *     { projection: "board.items", key: "c4" }
   *   ],
   *   blocked: { intent: "tutorialBlocked", payload: { step: 2 } }
   * };
   * // a press on the shop button outside the window, or a drop of c2 onto c4 inside it, answers
   * // { intent: "tutorialBlocked", payload: { step: 2 } }: the node shows the hand again
   * ```
   */
  blocked?: Allow;
  /**
   * Not drawn by the engine: draw it in an `<anchor>`. Kept in the descriptor for the game's own
   * handler; it goes in the next minor version.
   *
   * @deprecated Draw the highlight in an `<anchor>` on the targets.
   */
  highlight?: readonly string[];
  /**
   * Not drawn by the engine: draw the hand in an `<anchor>`. Kept in the descriptor for the game's
   * own handler; it goes in the next minor version.
   *
   * @deprecated Draw the hand in an `<anchor>` on the targets.
   */
  hand?: "tap" | "drag";
  /**
   * Not drawn by the engine: draw the text in an `<anchor>`. Kept in the descriptor for the game's
   * own handler; it goes in the next minor version.
   *
   * @deprecated Draw the text in an `<anchor>` beside the targets.
   */
  text?: string;
};

/**
 * Handler of one effect kind, registered by a plugin above `flow`. `signal` is the node's abort
 * signal, except for a descriptor with `answers` and for `guide`: those get a signal of their own,
 * aborted when the answer arrives or the narrow is lifted, so the handler unmounts what it showed.
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
  /** The child controllers of the `guide` handlers that are showing something right now. */
  guides: AbortController[];
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
   * app.flow.fx.dispatch({ kind: "haptic", payload: { kind: "light" } });
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
   * while the frame loop runs the completion waits for the next `signals` phase, except `schedule`, which resolves at
   * once (its handler only writes a moment). A descriptor with
   * `answers` and a `guide` reach their handler with a child of the node's signal, so what they
   * showed can be taken down before the node ends.
   *
   * @param descriptor - The descriptor the node awaits.
   * @param signal - The node's abort signal.
   * @returns The answer, the handler's value, or `undefined`.
   */
  run(descriptor: Descriptor, signal: AbortSignal): Promise<unknown>;

  /**
   * Aborts the signal of every `guide` handler that is showing something. Called by the runner
   * where it lifts the narrow, so the visual of a guide leaves with the narrow that carried it.
   */
  endGuides(): void;

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
 * The `fx` of a node context, and of the context of `recover`. Three ways to reach what is not
 * logic: `await fx(descriptor)` runs an effect and waits for it, `fx.start(descriptor)` starts one
 * now and does not wait, `fx.emit(hint)` keeps a cosmetic hint until the edge has committed. The
 * awaited value is typed by the descriptor: what its helper or its `defineEffect` declared,
 * `unknown` for a descriptor written by hand.
 *
 * @example
 * ```ts
 * // Inside a node body: wait for the player's pick, then sparkle once the edge has committed.
 * const pick = await fx(popup(Retry, {})); // Answer<"again" | "home">: { intent: "again" }
 * fx.emit(hint("sparkle", { cell: "c3" }));
 * ```
 */
export type NodeFx = (<Result>(descriptor: Descriptor<Result>) => Promise<Result>) & {
  /**
   * Buffers one cosmetic hint. It reaches its handler and the `onHint` listeners only after the
   * commit of the edge, so a node that fails shows nothing. Fast mode drops it.
   *
   * @param hint - The hint, built with `hint(kind, payload)`.
   * @example
   * ```ts
   * // The "merge" node: the sparkle belongs to the merge, so it is shown once the merge is real.
   * run: ({ fx, session, input, out }) => {
   *   session.merged.push(input.cell);
   *   fx.emit(hint("sparkle", { cell: "c3" })); // nothing is shown yet
   *
   *   return out.done(); // the edge commits, then the handler of "sparkle" gets the hint
   * }
   * ```
   */
  emit(hint: Hint): void;

  /**
   * Starts an effect now and does not wait for it: the handler is called at once and the body goes
   * on. Fast mode and the node's signal apply as for `await fx(descriptor)`. A handler that fails
   * never fails the node: the log gets the error entry `flow:fx-start-failed` with
   * `{ path, kind }`. For a `cosmetic` descriptor it gets the warn entry `flow:fx-cosmetic-failed`
   * with `{ kind, message }` instead, as it does when the effect is awaited. After the abort of the
   * node nothing is started, and a rejection that comes after the abort is not logged: the handler
   * was told to stop.
   *
   * @param descriptor - The effect to start. Not one with `answers` and not a `guide`.
   * @throws {Error} When the descriptor has `answers` or is a `guide`: an answer has to be awaited.
   * @example
   * ```ts
   * // The "place" node of a board game: the tap sound starts, the mark is placed at once.
   * run: ({ fx, session, input, out }) => {
   *   fx.start(sfx("ui.tap")); // undefined: the handler of "sfx" is already playing "ui.tap"
   *   session.marks.push(input.cell);
   *
   *   return out.placed(); // the edge commits while the sound still plays
   * }
   * ```
   */
  start(descriptor: Descriptor): void;
};

/**
 * How an effect a game declares behaves; see `defineEffect`. `fast: "run"` runs its handler in a
 * fast walk too, `"skip"` (the default) skips it there; `cosmetic: true` keeps a handler error
 * away from the node.
 *
 * @example
 * ```ts
 * const options: EffectOptions = { fast: "run" }; // the page read answers in a fast walk too
 * ```
 */
export type EffectOptions = { fast?: "run" | "skip"; cosmetic?: boolean };

/**
 * The handler of one declared effect: the typed payload in, the result out. The context is the
 * gateway's: the node's abort signal and the mode of the walk.
 *
 * @example
 * ```ts
 * const answerEnvRead: EffectHandler<{ notice: boolean }, { reducedMotion: boolean }> = payload => ({
 *   reducedMotion: payload.notice
 * });
 * ```
 */
export type EffectHandler<Payload, Result> = (
  payload: Payload,
  context: { signal: AbortSignal; mode: "live" | "fast" }
) => Result | Promise<Result>;

/**
 * True for an effect declared without a payload: its constructor then takes no argument.
 */
type IsVoidPayload<Payload> =
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` is the payload of an effect without one, compared on purpose
  [Payload] extends [void] ? true : false;

/**
 * An effect a game declares with `defineEffect`: called, it builds the descriptor; `kind` names
 * it; `handle` registers its one handler. `Resolves` is what `await fx(...)` gives: `Result`, or
 * `Result | undefined` (see `defineEffect`).
 *
 * @example
 * ```ts
 * type EnvRead = { reducedMotion: boolean; saveFallback: boolean };
 * const envRead: Effect<{ notice: boolean }, EnvRead, EnvRead> = defineEffect<{ notice: boolean }, EnvRead>(
 *   "view-env.read",
 *   { fast: "run" }
 * );
 * ```
 */
export type Effect<Payload, Result, Resolves> = {
  /**
   * Builds the descriptor a node awaits or starts. An effect without a payload takes no argument.
   *
   * @param payload - The payload the effect was declared with.
   * @returns The descriptor, frozen; `await fx(descriptor)` resolves `Resolves`.
   * @example
   * ```ts
   * envRead({ notice: true }); // { kind: "view-env.read", payload: { notice: true } }
   * ```
   */
  (...payload: IsVoidPayload<Payload> extends true ? [] : [payload: Payload]): Descriptor<Resolves>;

  /**
   * The effect kind, as `fx.handle` and the journal name it.
   *
   * @example
   * ```ts
   * envRead.kind; // "view-env.read"
   * ```
   */
  readonly kind: string;

  /**
   * Registers the one handler of this effect on the flow's gateway, with the fast-walk flag the
   * declaration chose. The handler gets the payload, not the descriptor.
   *
   * @param fx - The flow's effects gateway, `ctx.require(flowPlugin).fx`.
   * @param handler - Called with the payload and `{ signal, mode }`; returns the result.
   * @returns The remover: it unregisters this handler.
   * @throws {Error} When the kind already has a handler.
   * @example
   * ```ts
   * // plugins/view-env/index.ts of a game, in onStart:
   * ctx.state.off = envRead.handle(ctx.require(flowPlugin).fx, payload => answerEnvRead(ctx, payload));
   * ctx.state.off(); // in onStop: "view-env.read" has no handler again
   * ```
   */
  handle(fx: FxApi, handler: EffectHandler<Payload, Result>): () => void;
};
