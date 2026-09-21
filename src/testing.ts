/**
 * @file Testing entry skeleton (subpath `./testing`) — headless play, repro runs, and the
 * in-memory save provider and fake clock for tests.
 */
import type {
  Answer,
  Api as FlowApi,
  FlowState,
  JournalEntry,
  RouteStep
} from "./plugins/flow/types";
import type { Json, RngState } from "./plugins/model/types";
import type { Api as TimeApi } from "./plugins/time/types";

export { fakeClock } from "./plugins/clock/fake";
export { memory, saveOf } from "./plugins/model/store/providers/memory";

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
 * const game: HeadlessGame = await createHeadless(app);
 * await game.walk([{ at: "home", intent: "play" }]);
 * ```
 */
export type HeadlessGame = {
  walk(route: readonly RouteStep[]): Promise<FlowState>;
  answer(answer: Answer): boolean;
  state(): FlowState;
  history(): readonly JournalEntry[];
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
 * const { path, player }: ReproResult = await runRepro(app, repro);
 * ```
 */
export type ReproResult = { path: string[]; player: Json; session: Json };

/**
 * Starts an app headless: sets flow mode `"fast"`, awaits `app.start()` and starts `flow.run()`
 * unless the app's own `onStart` already did.
 *
 * @param _app - An app that is not started yet.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const game = await createHeadless(app);
 * await game.walk([{ at: "board/awaitIntent", intent: "merge", payload: { from: "c2", to: "c3" } }]);
 * await game.stop();
 * ```
 */
export function createHeadless(_app: HeadlessApp): Promise<HeadlessGame> {
  throw new Error("not implemented");
}

/**
 * Plays a repro: restores the checkpoint bookmark built from its state, then walks its route.
 *
 * @param _app - An app that is not started yet.
 * @param _repro - Starting state, optional checkpoint and the route.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const result = await runRepro(app, { player: saved, checkpoint: "home", route });
 * ```
 */
export function runRepro(_app: HeadlessApp, _repro: Repro): Promise<ReproResult> {
  throw new Error("not implemented");
}

/**
 * Steps the frame loop by hand: `count` calls of `app.time.step(deltaMs)`.
 *
 * @param _app - A started app.
 * @param _count - Number of frames.
 * @param _deltaMs - Milliseconds per frame.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * stepFrames(app, 60, 16);
 * ```
 */
export function stepFrames(_app: HeadlessApp, _count: number, _deltaMs: number): void {
  throw new Error("not implemented");
}
