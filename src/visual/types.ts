/**
 * @file visual — the types of the visual tests: the descriptor a game writes, the setup and the
 * options of the runner, and the report it answers. The headless leg reads the descriptor and
 * writes `state.json` and `describe.json`; the browser leg reads `page`, `pixels` and `tolerance`,
 * writes `screen.png` and fills the pixel fields of a checkpoint result. The Chrome types at the end
 * are the part of Playwright the browser leg calls, written out, so no type of `playwright-core`
 * enters the package.
 */
import type { AnimApi } from "../plugins/anim/types";
import type { commands } from "../plugins/flow/doors/commands";
import type { ControlApp, InputOf } from "../plugins/flow/doors/types";
import type { HeadlessApp, Repro } from "../plugins/flow/headless";
import type { Api as FlowApi } from "../plugins/flow/types";
import type { InputApi } from "../plugins/input/types";
import type { Api as LifecycleApi } from "../plugins/lifecycle/types";
import type { Json, Api as ModelApi, RngState } from "../plugins/model/types";
import type { Api as RendererApi } from "../plugins/renderer/types";
import type { Api as TimeApi } from "../plugins/time/types";
import type { UiApi, UiNode } from "../plugins/ui/types";
import type { Api as WorldApi } from "../plugins/world/types";

/** The base commands of the `/control` door, keyed by their short names. */
type Catalogue = typeof commands;

/**
 * The commands a step may name: the catalogue of `/control` minus `bookmark` (it only reads),
 * `capture` (the runner captures by itself) and `debug` (debug drawing would enter a baseline). A
 * command the catalogue gains is a step with no change to the runner.
 *
 * @example
 * ```ts
 * const name: StepCommand = "tap"; // also "answer", "walk", "step", "reducedMotion", ...
 * ```
 */
export type StepCommand = Exclude<keyof Catalogue, "bookmark" | "capture" | "debug">;

/**
 * Where a visual test starts: what `game.restore` loads, a repro without its route. The player
 * is required; the session, the rng and the checkpoint are optional, as in a repro.
 *
 * @example
 * ```ts
 * // A save with a plank ready for the first order, entered at Home.
 * const start: VisualStart = { player: { coins: 40, orders: [] }, checkpoint: "home" };
 * ```
 */
export type VisualStart = Omit<Repro, "route">;

/**
 * One step of a visual test: a `/control` command by its short name with that command's input,
 * typed from the catalogue, or a checkpoint by its name.
 *
 * @example
 * ```ts
 * // Tap Play, answer the order on the board, then compare the screen with its baseline.
 * const steps: VisualStep[] = [
 *   { tap: { key: "play" } },
 *   { answer: { intent: "deliver", payload: { orderId: "o1" } } },
 *   { checkpoint: "open" }
 * ];
 * ```
 */
export type VisualStep =
  | { checkpoint: string }
  | { [K in StepCommand]: { [P in K]: InputOf<Catalogue[K]["input"]> } }[StepCommand];

/**
 * A visual test as `defineVisualTest` answers it: its name, where it starts and its steps.
 * Frozen data; nothing runs at definition.
 *
 * @example
 * ```ts
 * const test: VisualTest = defineVisualTest("reward-popup", {
 *   start: { player: { coins: 40 }, checkpoint: "home" },
 *   steps: [{ tap: { key: "play" } }, { checkpoint: "board" }]
 * });
 * test.name; // "reward-popup"
 * Object.isFrozen(test.steps); // true
 * ```
 */
export type VisualTest = {
  readonly name: string;
  readonly start: Readonly<VisualStart>;
  readonly steps: readonly VisualStep[];
};

/**
 * What the runner needs of an app: the control app, the plugins the base commands act on and
 * the plugins the readers read. Every app composed with the screen set fits.
 *
 * @example
 * ```ts
 * const app: VisualApp = createApp({ plugins: [...screen, boardFeature], pluginConfigs });
 * ```
 */
export type VisualApp = ControlApp & {
  readonly anim: AnimApi;
  readonly ui: UiApi;
  readonly renderer: RendererApi;
  readonly world: WorldApi;
  readonly model: ModelApi;
  readonly input: InputApi;
  readonly lifecycle: LifecycleApi;
};

/**
 * The dev page the browser leg opens: its URL, the viewport width in CSS px (390 by default), the
 * device scale (2 by default) and which Chrome to launch. The page height follows the inert frame
 * of the renderer: 520 for a 390 wide portrait game at the default 4:3. Without `browser` the leg
 * launches Playwright's own Chromium, and the system Chrome when that one is not installed.
 *
 * @example
 * ```ts
 * // The fixture's dev server, a 390 px wide phone at 2x, the system Chrome.
 * const page: VisualPage = { url: "http://localhost:3000/", browser: { channel: "chrome" } };
 * ```
 */
export type VisualPage = {
  url: string;
  width?: number;
  deviceScaleFactor?: number;
  browser?: { channel?: string; executablePath?: string };
};

/**
 * How the runner builds a game: a fresh app per test, not started, with the screen set
 * composed; the renderer stays inert in Bun. `page` is the dev page of the pixel leg.
 *
 * @example
 * ```ts
 * // tests/visual/run.ts of a game.
 * const setup: VisualSetup = { app: () => createScreenGame().app, page: { url: "http://localhost:3000/" } };
 * ```
 */
export type VisualSetup = {
  app: () => VisualApp;
  page?: VisualPage;
};

/**
 * How far a pixel may differ: `threshold` is the largest channel delta that still counts as the
 * same pixel, `ratio` the share of differing pixels a checkpoint tolerates.
 *
 * @example
 * ```ts
 * const tolerance: VisualTolerance = { ratio: 0.001, threshold: 24 }; // the defaults
 * ```
 */
export type VisualTolerance = { ratio: number; threshold: number };

/**
 * The options of a run. Each one left out comes from the command line (`argv`), then from its
 * default: `dir` `"tests/visual"`, `update` false, `pixels` true with a `page` on a Mac,
 * `settleFrames` 600, `tolerance` `{ ratio: 0.001, threshold: 24 }`, `argv`
 * `process.argv.slice(2)`. An option given here wins over a flag.
 *
 * @example
 * ```ts
 * // The same as `bun tests/visual/run.ts --only reward-popup --no-pixels`.
 * const options: VisualOptions = { only: ["reward-popup"], pixels: false };
 * ```
 */
export type VisualOptions = {
  dir?: string;
  update?: boolean;
  pixels?: boolean;
  only?: readonly string[];
  settleFrames?: number;
  tolerance?: VisualTolerance;
  argv?: readonly string[];
};

/**
 * What a comparison with a baseline file found: the same content, a different one, or no
 * baseline (or `--update`), so the file was written.
 *
 * @example
 * ```ts
 * const outcome: Outcome = "written"; // the first run of a new checkpoint
 * ```
 */
export type Outcome = "same" | "different" | "written";

/**
 * The outcome of one checkpoint. `first` is the JSON path of the first difference, the state's
 * before the describe's. `pixels` is `"skipped"` when the pixel leg did not run; `pixelRatio`
 * and `verdict` come with a pixel difference.
 *
 * @example
 * ```ts
 * // The player's coins differ from the baseline; the layout is the same.
 * const result: CheckpointResult = {
 *   name: "claimed", state: "different", describe: "same", pixels: "skipped", first: "player.coins"
 * };
 * ```
 */
export type CheckpointResult = {
  name: string;
  state: Outcome;
  describe: Outcome;
  pixels: Outcome | "skipped";
  pixelRatio?: number;
  first?: string;
  verdict?: "rendering" | "behaviour";
};

/**
 * The outcome of one visual test: every checkpoint it reached, and the error that ended it early.
 *
 * @example
 * ```ts
 * const result: VisualTestResult = {
 *   name: "reward-popup",
 *   checkpoints: [{ name: "open", state: "same", describe: "same", pixels: "skipped" }]
 * };
 * ```
 */
export type VisualTestResult = {
  name: string;
  checkpoints: readonly CheckpointResult[];
  error?: string;
};

/**
 * What `runVisualTests` answers: `ok` is true when no test failed and no outcome is
 * `"different"`.
 *
 * @example
 * ```ts
 * const report: VisualReport = await runVisualTests(setup, [rewardPopup], { argv: [] });
 * process.exitCode = report.ok ? 0 : 1;
 * ```
 */
export type VisualReport = { ok: boolean; tests: readonly VisualTestResult[] };

/** The options of a run with every default filled in; `only` left out selects every test. */
export type VisualRun = {
  dir: string;
  update: boolean;
  pixels: boolean;
  only?: readonly string[];
  settleFrames: number;
  tolerance: VisualTolerance;
};

/** What the command line asked for: the flags it carried, nothing else. */
export type VisualFlags = {
  dir?: string;
  update?: boolean;
  pixels?: boolean;
  only?: readonly string[];
};

/** What the settle loop needs of an app: the frame step and where the graph stands. */
export type SettleApp = {
  readonly time: Pick<TimeApi, "step">;
  readonly flow: Pick<FlowApi, "state">;
};

/** What the readers need of an app: the headless app plus the model, the world and the ui. */
export type ReaderApp = HeadlessApp & {
  readonly model: ModelApi;
  readonly world: WorldApi;
  readonly ui: UiApi;
};

/** The state a checkpoint saves in `state.json`: where the graph rests and the committed trees. */
export type VisualState = {
  path: string;
  player: Json;
  session: Json;
  rng: Readonly<RngState>;
};

/** One keyed view of a projection as `describe.json` keeps it: no entity id, no skipped component. */
export type VisualView = {
  projection: string;
  key: string;
  components: Record<string, Json>;
};

/** The screen a checkpoint saves in `describe.json`: the ui tree and the keyed views. */
export type VisualDescribe = { ui: UiNode; views: readonly VisualView[] };

/** What a comparison with one baseline file found, and the path of the first difference. */
export type Checked = { outcome: Outcome; first?: string };

/**
 * What the pixel comparison of a checkpoint found: `first` is `"size"` when the two pictures differ
 * in size, `pixelRatio` the share of differing pixels when it is over the tolerance.
 */
export type PixelCheck = Checked & { pixelRatio?: number };

/**
 * What the browser leg found at one checkpoint: the page's state against `state.json` (none when
 * the file is missing) and the pixels against `screen.png`.
 */
export type PixelFound = { state: Checked | undefined; pixels: PixelCheck };

/** The options of `chromium.launch` the leg passes: the Chrome, and the WebGPU flags. */
export type LaunchOptions = { channel?: string; executablePath?: string; args: string[] };

/** The options of `browser.newContext` the leg passes: a phone-shaped page with touch. */
export type ContextOptions = {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
};

/** The calls the leg makes on a Playwright page. */
export type ChromePage = {
  addInitScript(script: { content: string }): Promise<unknown>;
  goto(url: string): Promise<unknown>;
  waitForFunction(
    fn: () => boolean,
    argument: undefined,
    options: { timeout: number }
  ): Promise<unknown>;
  evaluate<R, A>(fn: (argument: A) => R | Promise<R>, argument: A): Promise<R>;
  close(): Promise<void>;
};

/** The call the leg makes on a Playwright browser context. */
export type ChromeContext = { newPage(): Promise<ChromePage> };

/** The calls the leg makes on a Playwright browser. */
export type ChromeBrowser = {
  newContext(options: ContextOptions): Promise<ChromeContext>;
  close(): Promise<void>;
};

/** The call the leg makes on `chromium` of `playwright-core`. */
export type Chromium = { launch(options: LaunchOptions): Promise<ChromeBrowser> };
