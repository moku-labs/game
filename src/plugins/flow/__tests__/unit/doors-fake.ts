/**
 * @file flow plugin — a hand-written app for the doors unit tests: a frame loop stepped by hand,
 * a graph state and a model snapshot the test moves, a recording log. Not a test file: the unit
 * project only collects `*.test.ts`.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Json, Snapshot } from "../../../model/types";
import type { FrameCallback, Phase, Time } from "../../../time/types";
import type { ControlApp, WatchApp } from "../../doors/types";
import type { Bookmark, FlowGraph, FlowState, JournalEntry, RouteStep } from "../../types";

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

const unregister = (): void => undefined;

/** The app the doors unit tests drive. */
export type DoorsApp = WatchApp & ControlApp;

/** The fake app and the handles a test moves it with. */
export type DoorsFake = {
  app: DoorsApp;
  phases: Phase[];
  answers: Array<{ intent: string; payload?: Json }>;
  routes: RouteStep[][];
  restored: Bookmark[];
  frame(): void;
  moveGraph(path: string): void;
  commit(player: Json): void;
  journal(entries: JournalEntry[]): void;
  callbacks(): number;
};

const graph: FlowGraph = {
  main: "main",
  flows: {
    main: {
      nodes: {},
      start: "home",
      edges: { home: { play: "board" } }
    }
  },
  slots: {}
};

/**
 * Builds a flow state that rests at a path.
 *
 * @param path - Slash-separated node path.
 * @returns A frozen state, a new object on every call.
 */
function stateAt(path: string): FlowState {
  const nodes = path === "" ? [] : path.split("/");

  return Object.freeze({
    running: true,
    path,
    stack: nodes.map((node, index) => ({
      flow: index === 0 ? "main" : (nodes[index - 1] ?? "main"),
      node,
      input: noPayload
    })),
    pending: { gate: ["play"] },
    mode: "live"
  });
}

/**
 * Builds a recording log: every call lands in the trace a test reads back.
 *
 * @returns The log API.
 */
function createLog(): Log.LogApi {
  const entries: Log.LogEntry[] = [];
  const write =
    (level: Log.LogLevel) =>
    (event: string, data?: unknown): void => {
      entries.push({ level, event, data, ts: 0 });
    };

  return {
    addSink: vi.fn(),
    clearSinks: vi.fn(),
    debug: write("debug"),
    error: write("error"),
    expect: vi.fn(),
    info: write("info"),
    reset: vi.fn(),
    trace: () => [...entries],
    warn: write("warn")
  };
}

/**
 * Creates the fake app. The graph rests at "home", the player has no coins, frame 0.
 *
 * @returns The app and its handles.
 */
export function createDoorsFake(): DoorsFake {
  const registered: Array<{ phase: Phase; callback: FrameCallback }> = [];
  const phases: Phase[] = [];
  const answers: Array<{ intent: string; payload?: Json }> = [];
  const routes: RouteStep[][] = [];
  const restored: Bookmark[] = [];
  const live = {
    time: { delta: 16, elapsed: 0, scale: 1, frame: 0, idle: false } as Time,
    state: stateAt("home"),
    snapshot: Object.freeze({
      player: { coins: 0 },
      session: {},
      rng: { seed: 1, streams: {} }
    }) as Snapshot,
    journal: [] as JournalEntry[]
  };
  const bookmark: Bookmark = {
    path: "home",
    input: noPayload,
    player: { coins: 0 },
    session: {},
    rng: { seed: 1, streams: {} },
    graph: "0badf00d"
  };
  const app: DoorsApp = {
    start: async (): Promise<void> => undefined,
    stop: async (): Promise<void> => undefined,
    log: createLog(),
    model: { store: { snapshot: () => live.snapshot } },
    time: {
      onFrame: (phase: Phase, callback: FrameCallback): (() => void) => {
        const entry = { phase, callback };

        phases.push(phase);
        registered.push(entry);

        return () => {
          registered.splice(registered.indexOf(entry), 1);
        };
      },
      snapshot: () => ({ ...live.time }),
      setScale: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      wake: vi.fn(),
      isPaused: vi.fn(),
      isRunning: () => true,
      step: vi.fn()
    },
    flow: {
      run: () => Promise.resolve(),
      onEnter: () => unregister,
      walk: async (route: readonly RouteStep[]): Promise<FlowState> => {
        routes.push([...route]);
        live.state = stateAt("board/awaitIntent");

        return live.state;
      },
      bookmark: (): Bookmark => bookmark,
      restore: async (entered: Bookmark): Promise<void> => {
        restored.push(entered);
        live.state = stateAt(entered.path);
      },
      describe: (): FlowGraph => graph,
      state: (): FlowState => live.state,
      history: (): readonly JournalEntry[] => [...live.journal],
      setMode: vi.fn(),
      gate: {
        answer: (answer): boolean => {
          answers.push(answer);

          return answer.intent === "play";
        },
        pointer: vi.fn(),
        state: vi.fn()
      },
      inbox: { post: vi.fn() },
      fx: { handle: () => unregister, dispatch: vi.fn(), onHint: () => unregister },
      features: { register: vi.fn(), all: () => [], contributions: () => [] }
    }
  };

  return {
    app,
    phases,
    answers,
    routes,
    restored,
    frame: (): void => {
      live.time = { ...live.time, frame: live.time.frame + 1 };

      // eslint-disable-next-line unicorn/no-useless-spread -- a callback may unregister itself.
      for (const entry of [...registered]) entry.callback(live.time);
    },
    moveGraph: (path: string): void => {
      live.state = stateAt(path);
    },
    commit: (player: Json): void => {
      live.snapshot = Object.freeze({ ...live.snapshot, player });
    },
    journal: (entries: JournalEntry[]): void => {
      live.journal = entries;
    },
    callbacks: (): number => registered.length
  };
}
