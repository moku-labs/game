/**
 * @file Flow plugin — headless play and repro runs, re-exported by the `./testing` entry. Thin
 * calls into `flow.walk`, `flow.restore` and `time.step`: a game played without a screen is the
 * same game, only its effects answer instantly.
 */
import type { Json, RngState } from "../model/types";
import type { Api as TimeApi } from "../time/types";
import { graphHash } from "./runner/registry";
import type { Answer, Bookmark, Api as FlowApi, FlowState, JournalEntry, RouteStep } from "./types";

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

/** Seed of a repro that pins no rng state, the seed `saveOf` writes. */
const defaultSeed = 1;

/**
 * The part of an app the headless helpers use. Structural on purpose: any app created with the
 * default plugins fits.
 *
 * @example
 * ```ts
 * const app: HeadlessApp = createApp({ pluginConfigs: { flow: { mainFlow } } });
 * ```
 */
export type HeadlessApp = {
  start(): Promise<void>;
  stop(): Promise<void>;
  time: TimeApi;
  flow: FlowApi;
};

/**
 * A game played without a screen: answers go through the gate, effects resolve instantly.
 *
 * @example
 * ```ts
 * // A test of the dice game: two rolls, no screen, no waiting.
 * const game = await createHeadless(app);
 * const state = await game.walk([{ at: "home", intent: "roll" }, { at: "home", intent: "roll" }]);
 *
 * state.path; // "home"
 * await game.stop();
 * ```
 */
export type HeadlessGame = {
  /**
   * Walks a route through the running loop.
   *
   * @param route - The player's answers and substituted sub-flow results, in order.
   * @returns The state the walk ended in.
   * @throws {Error} When a step is never reached, or the loop failed fatally.
   * @example
   * ```ts
   * // Open the board and tap the generator twice. Every node's logic runs for real.
   * const tap = { at: "board/awaitIntent", intent: "tap", payload: { generatorId: "sawmill" } };
   * const state = await game.walk([{ at: "home", intent: "play" }, tap, tap]);
   *
   * state.path; // "board/awaitIntent"
   * ```
   */
  walk(route: readonly RouteStep[]): Promise<FlowState>;

  /**
   * Gives one answer to the gate, the way a tap does.
   *
   * @param answer - Intent and optional payload.
   * @returns Whether the gate took it.
   * @example
   * ```ts
   * // One tap without a route. The test then waits for the loop by itself.
   * game.answer({ intent: "play" }); // true: "home" rests and lists "play"
   * ```
   */
  answer(answer: Answer): boolean;

  /**
   * Reads where the graph stands.
   *
   * @returns Whether it runs, the path, the stack, what it waits for and the mode.
   * @example
   * ```ts
   * // Right after createHeadless: the graph rests at its first rest node.
   * game.state().path; // "home"
   * game.state().pending; // { gate: ["play"] }
   * ```
   */
  state(): FlowState;

  /**
   * Reads the edges taken since the last checkpoint.
   *
   * @returns A copy of the journal.
   * @example
   * ```ts
   * // After a merge onto an empty cell: the last edge says why the move was refused.
   * const last = game.history().at(-1);
   * // last?.path: "board/merge", last?.outcome: "rejected", last?.payload: { reason: "empty" }
   * ```
   */
  history(): readonly JournalEntry[];

  /**
   * Stops the app, then re-throws a fatal error of the loop.
   *
   * @throws {Error} When the loop failed fatally.
   * @example
   * ```ts
   * // The last line of a headless test. A fatal error of the loop fails the test here.
   * await game.stop();
   * ```
   */
  stop(): Promise<void>;
};

/**
 * A reproducible run: a starting state, an optional checkpoint and the route played from it.
 *
 * @example
 * ```ts
 * const repro: Repro = { player: { coins: 0 }, checkpoint: "home", route: [{ at: "home", intent: "play" }] };
 * ```
 */
export type Repro = {
  player: Json;
  session?: Json;
  rng?: RngState;
  checkpoint?: string;
  route: RouteStep[];
};

/**
 * What a repro run ends with: the path where the loop rests and the committed state.
 *
 * @example
 * ```ts
 * const result: ReproResult = { path: ["home"], player: { coins: 3 }, session: { visits: 1 } };
 * ```
 */
export type ReproResult = { path: string[]; player: Json; session: Json };

/** Where the fatal error of `flow.run()` waits until `walk` or `stop` is called. */
type Fatal = { error: unknown };

/**
 * Turns whatever `run()` rejected with into an error that can be thrown again.
 *
 * @param value - The rejection value.
 * @returns The value itself when it is an error, a wrapped one otherwise.
 * @example
 * ```ts
 * asError("offline").message; // "[game] The headless run failed.\n  offline."
 * ```
 */
function asError(value: unknown): Error {
  if (value instanceof Error) return value;

  return new Error(`[game] The headless run failed.\n  ${String(value)}.`);
}

/**
 * Starts the one loop unless the app's own `onStart` already did, and keeps a fatal error until
 * someone asks for it. `run()` rejects only on a fatal error, and nobody awaits it here.
 *
 * @param app - The started app.
 * @returns The holder of the fatal error.
 */
function startLoop(app: HeadlessApp): Fatal {
  const fatal: Fatal = { error: undefined };

  if (app.flow.state().running) return fatal;

  app.flow.run().catch((error: unknown) => {
    fatal.error = error;
  });

  return fatal;
}

/**
 * Waits until the loop rests for the first time, or ends. An empty route walks nowhere: it only
 * waits for the gate the loop opens at the node it enters, so a start that is a chain of transit
 * nodes is played out before anything reads the game.
 *
 * @param app - The started app whose loop is running.
 * @param fatal - Holder of the fatal error of `run()`.
 * @returns Resolves once the loop rests at its first rest node.
 * @throws {Error} When the loop failed fatally instead of reaching a rest node.
 */
async function settleAtFirstRest(app: HeadlessApp, fatal: Fatal): Promise<void> {
  await app.flow.walk([]).catch((error: unknown) => {
    throw asError(fatal.error ?? error);
  });

  if (fatal.error !== undefined) throw asError(fatal.error);
}

/**
 * Starts an app headless: sets flow mode `"fast"`, awaits `app.start()`, starts `flow.run()`
 * unless the app's own `onStart` already did, and waits until the loop rests for the first time.
 * `game.state().path` therefore names the first rest node of the graph as soon as the call
 * resolves. A fatal error of the loop rejects this call, and a later one is re-thrown by `walk`
 * and by `stop`, so a headless test never loses it.
 *
 * @param app - An app that is not started yet.
 * @returns The game: walk it, answer it, read it, stop it.
 * @throws {Error} When the loop failed fatally before it reached its first rest node.
 * @example
 * ```ts
 * // A test starts the merge game without a screen. The call resolves at the first rest node.
 * const game = await createHeadless(app);
 *
 * game.state().path; // "home": the transit node "boot" was played out
 * game.state().mode; // "fast"
 * await game.stop();
 * ```
 */
export async function createHeadless(app: HeadlessApp): Promise<HeadlessGame> {
  app.flow.setMode("fast");

  await app.start();

  const fatal = startLoop(app);

  await settleAtFirstRest(app, fatal);

  return {
    walk: async (route: readonly RouteStep[]): Promise<FlowState> => {
      const state = await app.flow.walk(route).catch((error: unknown) => {
        throw asError(fatal.error ?? error);
      });

      if (fatal.error !== undefined) throw asError(fatal.error);

      return state;
    },

    answer: (answer: Answer): boolean => app.flow.gate.answer(answer),

    state: (): FlowState => app.flow.state(),

    history: (): readonly JournalEntry[] => app.flow.history(),

    stop: async (): Promise<void> => {
      await app.stop();

      if (fatal.error !== undefined) throw asError(fatal.error);
    }
  };
}

/**
 * Reads the rest node a repro starts at: its checkpoint, or the start of the main flow.
 *
 * @param app - The started app.
 * @param repro - Starting state, optional checkpoint and the route.
 * @returns The path of the node the repro enters.
 * @throws {Error} When the graph has no main flow to start from.
 */
function reproPath(app: HeadlessApp, repro: Repro): string {
  if (repro.checkpoint !== undefined) return repro.checkpoint;

  const graph = app.flow.describe();
  const start = graph.flows[graph.main]?.start;

  if (start === undefined) {
    throw new Error(
      `[game] runRepro() found no flow "${graph.main}" to start from.\n  Name the checkpoint the repro was taken at.`
    );
  }

  return start;
}

/**
 * Builds the bookmark a repro is entered with: its state, its checkpoint and the hash of the
 * graph that runs now, so a checkpoint is accepted and any other rest node is checked.
 *
 * @param app - The started app.
 * @param repro - Starting state, optional checkpoint and the route.
 * @returns The bookmark to restore.
 */
function reproBookmark(app: HeadlessApp, repro: Repro): Bookmark {
  return {
    path: reproPath(app, repro),
    input: noPayload,
    player: repro.player,
    session: repro.session ?? {},
    rng: repro.rng ?? { seed: defaultSeed, streams: {} },
    graph: graphHash(app.flow.describe())
  };
}

/**
 * Plays a repro: starts the app headless, restores the bookmark built from its state and
 * checkpoint, then walks its route. The app keeps running, so the caller can read more than the
 * result and stops it itself.
 *
 * @param app - An app that is not started yet.
 * @param repro - Starting state, optional checkpoint and the route.
 * @returns The path the run ended at, and the committed state.
 * @example
 * ```ts
 * // A bug report on the dice game: "reset keeps my coins". Replay it from the "home" checkpoint.
 * const reset = { at: "home", intent: "reset" };
 * const result = await runRepro(app, { player: { coins: 7 }, checkpoint: "home", route: [reset] });
 *
 * result.player; // { coins: 0 }; result.path is ["home"]
 * await app.stop(); // the app keeps running after the run
 * ```
 */
export async function runRepro(app: HeadlessApp, repro: Repro): Promise<ReproResult> {
  const game = await createHeadless(app);

  await app.flow.restore(reproBookmark(app, repro));

  const state = await game.walk(repro.route);
  const ended = app.flow.bookmark();

  return {
    path: state.stack.map(frame => frame.node),
    player: ended.player,
    session: ended.session
  };
}

/**
 * Steps the frame loop by hand: `count` calls of `app.time.step(deltaMs)`. A headless game has no
 * frame source, so this is the only thing that moves the frame phases.
 *
 * @param app - A started app.
 * @param count - Number of frames.
 * @param deltaMs - Milliseconds per frame.
 * @example
 * ```ts
 * // A headless game has no frame source: the test moves the six frame phases by hand.
 * stepFrames(app, 2, 16);
 * app.time.snapshot(); // frame: 2, delta: 16, elapsed: 32
 * ```
 */
export function stepFrames(app: HeadlessApp, count: number, deltaMs: number): void {
  for (let frame = 0; frame < count; frame += 1) app.time.step(deltaMs);
}
