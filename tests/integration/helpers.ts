/**
 * @file Shared pieces of the root integration wave: the tiny game's types, its seams and the two
 * waits a test without a screen needs. Every graph of the wave is written in its own test file.
 */
import type { Flow, Model } from "@moku-labs/game";
import { createApp, createPlugin, defineGame, flowPlugin } from "@moku-labs/game";
import { fakeClock, memory } from "@moku-labs/game/testing";

/** The player tree of the tiny game: what a node may change and a save may carry. */
export type Player = { coins: number; visits: number; draws: number[] };

/** The session tree of the tiny game: what one run remembers. */
export type Session = { popups: number; resumed: string[] };

/** The authoring helpers bound to the tiny game's types. */
export const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** Where the fake clock starts. Not zero, so a stored moment of zero is really in the past. */
export const startMoment = 1_000_000;

/** The player a new save starts from. */
export const startingPlayer: Player = { coins: 0, visits: 0, draws: [] };

/** The session every run starts from. */
export const startingSession: Session = { popups: 0, resumed: [] };

/** The save seam, recording every call it gets. */
export type Provider = ReturnType<typeof memory>;

/** The time source the test steers. */
export type Clock = ReturnType<typeof fakeClock>;

/** The options of `createApp`, so a helper can hand plugins on without naming the kernel types. */
type AppOptions = NonNullable<Parameters<typeof createApp>[0]>;

/** The plugin list as `createApp` takes it: the tests add probes that listen to engine events. */
export type Plugins = NonNullable<AppOptions["plugins"]>;

/** What a test may pin when it creates the game. */
export type GameOptions = {
  /** The top-level flow of this test. */
  mainFlow: Flow.AnyFlow;
  /** Extra plugins, usually a probe that records events. */
  plugins?: Plugins;
  /** The save seam. A fresh in-memory provider by default: a new player. */
  provider?: Provider;
  /** The time source. A fake clock at `startMoment` by default. */
  clock?: Clock;
  /** The rng seed. Fixed, so two runs of one route draw the same numbers. */
  seed?: number;
  /** The player a new save starts from. */
  player?: Player;
  /** The checkpoint the graph enters after a failed retry. */
  safeNode?: string;
  /** Retries of a failed transition before the graph goes to `safeNode`. */
  retries?: number;
  /** Frame rate cap of the time plugin. */
  maxFps?: 30 | 60 | 120;
  /** Version of the save schema this build writes. */
  schemaVersion?: number;
  /** The migration chain of the save. */
  migrations?: readonly Model.Migration[];
};

/** The game and the two seams a test holds on to. */
export type Game = {
  app: ReturnType<typeof createApp>;
  clock: Clock;
  provider: Provider;
};

/**
 * Creates one tiny game with the real plugins: the in-memory provider and the fake clock are the
 * only doubles, and both are the engine's own.
 *
 * @param options - The flow to run and the seams a test pins.
 * @returns The app and the seams behind it.
 * @example
 * ```ts
 * const { app, clock } = createGame({ mainFlow });
 * ```
 */
export function createGame(options: GameOptions): Game {
  const provider = options.provider ?? memory();
  const clock = options.clock ?? fakeClock(startMoment);
  const app = createApp({
    plugins: options.plugins ?? [],
    pluginConfigs: {
      time: { maxFps: options.maxFps ?? 60 },
      model: {
        playerProvider: provider,
        initialPlayer: options.player ?? startingPlayer,
        initialSession: startingSession,
        seed: options.seed ?? 42,
        schemaVersion: options.schemaVersion ?? 1,
        migrations: options.migrations ?? []
      },
      clock: { source: clock },
      flow: {
        mainFlow: options.mainFlow,
        safeNode: options.safeNode ?? "home",
        retries: options.retries ?? 1
      }
    }
  });

  return { app, clock, provider };
}

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many microtasks to give up.
 * @example
 * ```ts
 * await tick();
 * ```
 */
export const tick = async (times = 60): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Creates the edge probe: an ordinary plugin above `flow` that listens to `flow:edge`. The type of
 * a plugin instance is inferred from its spec, so the factory never annotates it.
 *
 * @returns The plugin to add to the app and the outcomes it records.
 * @example
 * ```ts
 * const log = createEdgeLog();
 * const { app } = createGame({ mainFlow, plugins: [log.plugin] });
 * ```
 */
export function createEdgeLog() {
  const edges: string[] = [];
  const plugin = createPlugin("edgeLog", {
    depends: [flowPlugin],
    hooks: () => ({
      "flow:edge": (payload: { outcome: string }) => {
        edges.push(payload.outcome);
      }
    })
  });

  return { plugin, edges };
}

/** The stub frame source: the platform seam `time` asks for frames through. */
export type FrameSource = {
  /** Runs the pending frame callback with a timestamp in milliseconds. */
  run(timestamp: number): void;
  /** Takes the stub off `globalThis` again. */
  uninstall(): void;
};

/**
 * Installs a frame source on `globalThis`, so `time` starts its loop and `isRunning()` is true.
 * It is the platform seam, not an engine part: no frame arrives until the test asks for one.
 *
 * @returns The way to run a frame and to take the stub off again.
 * @example
 * ```ts
 * const source = installFrameSource();
 * source.run(1000);
 * source.uninstall();
 * ```
 */
export function installFrameSource(): FrameSource {
  const callbacks: FrameRequestCallback[] = [];

  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    callbacks.push(callback);
  globalThis.cancelAnimationFrame = (): void => {
    callbacks.length = 0;
  };

  return {
    run: (timestamp: number): void => {
      const next = callbacks.at(-1);

      callbacks.length = 0;
      // The engine schedules the next frame from inside this call, so the queue refills itself.
      next?.(timestamp);
    },
    uninstall: (): void => {
      Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    }
  };
}

/**
 * The journal as a list of readable edges, for an assertion that reads like the game.
 *
 * @param entries - The journal of the graph.
 * @returns One `"path -outcome->"` sentence per edge.
 * @example
 * ```ts
 * expect(edgesOf(game.history())).toEqual(["home -play->"]);
 * ```
 */
export const edgesOf = (entries: readonly { path: string; outcome: string }[]): string[] =>
  entries.map(entry => `${entry.path} -${entry.outcome}->`);
