/**
 * @file The `@moku-labs/game/app/page` entry: `startPage`, the page of a game. The generated
 * `.moku/main.ts` calls it with the game, its config and what the CLI found: scenarios, the system
 * shell, the dev agents and the `.dev` modules. It reaches the shell only through
 * `options.system`, never by an import, so a web-only page bundles no system code. Its dev parts
 * (the write door `/control`, the agents, the audio journal) sit behind the inline dev guard, so a
 * production build drops them.
 */
import { read, sources, watch } from "../inspect";
import { systemSource } from "../plugins/clock/system";
import type { ClockSource } from "../plugins/clock/types";
import { memory } from "../plugins/model/store/providers/memory";
import type { PlayerStateProvider } from "../plugins/model/store/types";
import { resolveConfig } from "./config";
import { pageSave } from "./save";
import type {
  AnyGameApp,
  GameConfig,
  PageOptions,
  ResolvedGameConfig,
  Scenario,
  ScreenAppOfGame,
  StartedPage,
  SystemShell
} from "./types";

/** The warn log a late problem goes to once the app exists. */
type WarnLog = { warn(event: string): void };

/** A reporter that keeps problems until the app exists, then hands them to its warn log. */
type LateReporter = {
  /** Reports one problem: kept until `attach`, then logged at once. */
  report: (problem: string) => void;
  /** Logs the kept problems, in order, and every later one at once. */
  attach: (log: WarnLog) => void;
};

/** The screen app of any game, as the page runs it. */
type PageApp = ScreenAppOfGame<AnyGameApp>;

/** How many started sounds the audio journal of the dev page keeps. */
const DEV_AUDIO_JOURNAL = 200;

/** The player and the session a `?player=` scenario returns. */
type ScenarioStart = ReturnType<Scenario>;

/** What the screen app of the page runs on, picked before it is made. */
type PageRuntime = {
  /** The resolved config. */
  settings: ResolvedGameConfig;
  /** The query of the page address. */
  query: URLSearchParams;
  /** The device clock. */
  clock: ClockSource;
  /** The system shell, or `undefined`. */
  shell: SystemShell | undefined;
  /** The save of the page. */
  provider: PlayerStateProvider;
  /** The start of a `?player=` scenario, or `undefined`. */
  start: ScenarioStart | undefined;
};

/**
 * Makes the reporter of the page: a problem found before the app exists (the scenario, the shell)
 * waits for the app's log.
 *
 * @returns The reporter.
 */
function lateReporter(): LateReporter {
  const kept: string[] = [];
  const sink: { log: WarnLog | undefined } = { log: undefined };

  return {
    report: problem => {
      if (sink.log === undefined) kept.push(problem);
      else sink.log.warn(problem);
    },
    attach: log => {
      sink.log = log;

      for (const problem of kept.splice(0)) log.warn(problem);
    }
  };
}

/**
 * Turns anything thrown into an `Error` for the log.
 *
 * @param thrown - What was thrown or rejected.
 * @returns The error itself, or an error with its text.
 * @example
 * ```ts
 * toError("no bridge").message; // "no bridge"
 * ```
 */
function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * Picks the start of the page from `?player=`: the named scenario's player and session, at the
 * device time. An unknown name is reported, and the page starts from the starting player.
 *
 * @param name - The value of `?player=`, or `null` without it.
 * @param scenarios - The scenarios of the page, by name.
 * @param now - The device time.
 * @param report - Where the unknown name goes.
 * @returns The player and session of the scenario, or `undefined`.
 */
function scenarioStart(
  name: string | null,
  scenarios: Readonly<Record<string, Scenario>>,
  now: number,
  report: (problem: string) => void
): ScenarioStart | undefined {
  if (name === null) return undefined;

  const scenario = scenarios[name];

  if (scenario !== undefined) return scenario(now);

  const known = Object.keys(scenarios).join(", ") || "none";

  report(
    `[game] No scenario "${name}".\n  Known: ${known}. The page starts from the starting player.`
  );

  return undefined;
}

/**
 * Makes the screen app of the page: the canvas on `#game`, the manifest next to the page, the
 * shell's platform, the save, the device clock, and the scenario's start when one is named.
 *
 * @param game - The game.
 * @param runtime - What the app runs on.
 * @returns The app, not started.
 */
function screenOf(game: AnyGameApp, runtime: PageRuntime): PageApp {
  const { settings, query, shell, start } = runtime;

  return game.screen({
    manifest: new URL("manifest.json", location.href).href,
    renderer: {
      mount: "#game",
      ...(query.get("renderer") === "webgl" ? { preference: "webgl" as const } : {})
    },
    ...(shell === undefined ? {} : { platform: shell.platform }),
    keepAwake: settings.system.includes("keepAwake"),
    provider: runtime.provider,
    ...(start === undefined ? {} : { player: start.player }),
    ...(start?.session === undefined ? {} : { session: start.session }),
    clock: runtime.clock,
    // The guard stays inline: a build defines the flag false and folds it (src/plugins/flow/doors/dev.ts).
    audio:
      typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__
        ? { journal: DEV_AUDIO_JOURNAL }
        : {}
  }).app;
}

/**
 * Sets the three handles of the page on `globalThis`: `game` for e2e, `system` for the shell,
 * `doors` for the editor. The write door `/control` is loaded in dev only.
 *
 * @param app - The screen app.
 * @param shell - The system shell, or `undefined`.
 * @returns Resolves when the handles are set.
 */
async function setHandles(app: PageApp, shell: SystemShell | undefined): Promise<void> {
  Reflect.set(globalThis, "game", app);
  Reflect.set(globalThis, "system", shell?.handle);

  const control =
    typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__
      ? await import("../control")
      : undefined;

  Reflect.set(globalThis, "doors", {
    read,
    watch,
    sources,
    ...(control === undefined ? {} : { run: control.run, commands: control.commands })
  });
}

/**
 * Follows the system setting of reduced motion, also when the player changes it while the page
 * runs.
 *
 * @param app - The screen app.
 */
function followReducedMotion(app: PageApp): void {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  app.anim.setReducedMotion(reducedMotion.matches);
  reducedMotion.addEventListener("change", event => app.anim.setReducedMotion(event.matches));
}

/**
 * Starts the dev agents, in order, after the app: each gets the app, the page title and the
 * game's `.dev` modules. A throwing agent is logged and the page keeps running.
 *
 * @param app - The running app.
 * @param settings - The resolved config.
 * @param options - The agents and the dev modules.
 * @returns Resolves when every agent started or failed.
 */
async function startAgents(
  app: PageApp,
  settings: ResolvedGameConfig,
  options: PageOptions
): Promise<void> {
  for (const agent of options.agents ?? []) {
    try {
      await agent({ app, name: settings.page.title, modules: options.devModules ?? [] });
    } catch (error) {
      app.log.error("[game] A page agent failed to start.", undefined, toError(error));
    }
  }
}

/**
 * Runs a game on its page: resolves `config.ts`, picks the start (a `?player=` scenario runs on a
 * fresh memory save, never on the stored one), builds the system shell when the page has one,
 * picks the save, makes the screen app on `#game` over the device clock and the manifest next to
 * the page, sets `globalThis.game`, `system` and `doors`, follows reduced motion, starts the shell,
 * then the app, and runs the graph. A graph that stops is logged, never thrown. In dev it then
 * starts the agents. Every problem goes to the app's log.
 *
 * @param game - The default export of the game's `index.ts`.
 * @param config - The default export of the game's `config.ts`.
 * @param options - What the CLI found: scenarios, the shell factory, agents, `.dev` modules.
 * @returns The running screen app, and the system app for `globalThis.system`.
 * @throws {Error} When `config.ts` holds a value TypeScript would refuse, or the save is `"store"`
 * and the page has no system shell.
 * @example
 * ```ts
 * // Written by moku-game dev. Do not edit.
 * import "./dev.ts";
 * import { startPage } from "@moku-labs/game/app/page";
 * import { systemShell } from "@moku-labs/game/app/system";
 * import game from "../index.ts";
 * import config from "../config.ts";
 * import scenario0 from "../tests/scenarios/empty.ts";
 * import scenario1 from "../tests/scenarios/full.ts";
 * import * as devModule0 from "../features/board/board.dev.ts";
 * import agent0 from "@moku-labs/editor/agent/page";
 *
 * await startPage(game, config, {
 *   scenarios: { "empty": scenario0, "full": scenario1 },
 *   system: systemShell,
 *   agents: [agent0],
 *   devModules: [devModule0]
 * });
 * ```
 */
export async function startPage<Game extends AnyGameApp>(
  game: Game,
  config: GameConfig,
  options: PageOptions = {}
): Promise<StartedPage<Game>> {
  const settings = resolveConfig(config);
  const query = new URLSearchParams(location.search);
  const { report, attach } = lateReporter();
  const clock = systemSource();
  const start = scenarioStart(query.get("player"), options.scenarios ?? {}, clock.now(), report);
  const shell = options.system === undefined ? undefined : await options.system(settings, report);
  const namespace = settings.native?.identifier ?? "moku-game";
  // A scenario plays on a fresh memory save: the stored player is never touched.
  const provider =
    start === undefined ? pageSave(settings.save, { namespace, shell, report }) : memory();
  const app = screenOf(game, { settings, query, clock, shell, provider, start });

  // The app exists now: the problems kept so far go to its log, the handles go on globalThis.
  attach(app.log);
  await setHandles(app, shell);
  followReducedMotion(app);

  // The shell starts first, so keep-awake finds it running.
  await shell?.start();
  await app.start();

  app.flow.run().catch((error: unknown) => {
    app.log.error("[game] The graph stopped.", undefined, toError(error));
  });

  // The agents come last, on the running game. The guard stays inline: the build folds it.
  if (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) {
    await startAgents(app, settings, options);
  }

  return { app: app as ScreenAppOfGame<Game>, system: shell?.handle };
}
