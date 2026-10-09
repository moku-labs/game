import { describe, expect, it, vi } from "vitest";
import type { Json } from "../../../model/types";
import {
  createHeadless,
  type HeadlessApp,
  reproBookmark,
  runRepro,
  stepFrames
} from "../../headless";
import type { Bookmark, FlowGraph, FlowState, GraphNode, RouteStep } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: the headless helpers over a hand-written app
// ---------------------------------------------------------------------------

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

const unregister = (): void => undefined;

const graph: FlowGraph = {
  main: "main",
  flows: { main: { nodes: {}, start: "boot", edges: {} } },
  slots: {}
};

const flags = { rest: false, over: false, checkpoint: false, barrier: false };

const described = (flow: string, name: string, changes: Partial<GraphNode> = {}): GraphNode => ({
  flow,
  node: name,
  ...flags,
  outcomes: ["done"],
  ...changes
});

/**
 * The graph of a game with nodes: the transit node `boot`, the rest checkpoint `home`, and the
 * sub-flow `info` whose transit node `show` waits for a popup and whose `confirm` rests.
 */
const popupGraph: FlowGraph = {
  main: "main",
  flows: {
    main: {
      nodes: {
        boot: described("main", "boot"),
        home: described("main", "home", { rest: true, checkpoint: true }),
        info: described("main", "info", { subFlow: "infoPopup" })
      },
      start: "boot",
      edges: {}
    },
    infoPopup: {
      nodes: {
        show: described("infoPopup", "show", { checkpoint: true }),
        confirm: described("infoPopup", "confirm", { rest: true })
      },
      start: "show",
      edges: {}
    }
  },
  slots: {}
};

type AppOptions = { running?: boolean; fatal?: Error; graph?: FlowGraph };

const createFakeApp = (options: AppOptions = {}) => {
  const calls: string[] = [];
  const routes: RouteStep[][] = [];
  const restored: Bookmark[] = [];
  const steps: number[] = [];
  // The loop of the fake: it rests — and so gets a path — only once a walk waited for it.
  const loop = Promise.withResolvers<void>();
  // What a walk after the loop died rejects with, the way the real `walk` reports a dead loop.
  const dead: { error: Error | undefined } = { error: undefined };
  const live = { running: options.running ?? false, mode: "live" as "live" | "fast", path: "" };
  const state = (): FlowState => ({
    running: live.running,
    path: live.path,
    stack: live.path === "" ? [] : [{ flow: "main", node: "home", input: noPayload }],
    pending: {},
    mode: live.mode
  });
  const app: HeadlessApp = {
    start: async (): Promise<void> => {
      calls.push("start");
    },
    stop: async (): Promise<void> => {
      calls.push("stop");
    },
    time: {
      onFrame: () => unregister,
      snapshot: () => ({ delta: 16, elapsed: 0, scale: 1, frame: 1, idle: false }),
      setScale: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      wake: vi.fn(),
      isPaused: vi.fn(),
      isRunning: () => false,
      step: (deltaMs: number): void => {
        steps.push(deltaMs);
      }
    },
    flow: {
      run: (): Promise<void> => {
        calls.push("run");
        live.running = true;

        if (options.fatal) return Promise.reject(options.fatal);

        return loop.promise;
      },
      onEnter: () => unregister,
      walk: async (route: readonly RouteStep[]): Promise<FlowState> => {
        calls.push("walk");
        routes.push([...route]);
        live.path = "home";

        if (dead.error) throw dead.error;

        return state();
      },
      bookmark: (): Bookmark => ({
        path: "home",
        input: noPayload,
        player: { coins: 3 },
        session: { visits: 1 },
        rng: { seed: 1, streams: {} },
        graph: "hash"
      }),
      restore: async (bookmark: Bookmark): Promise<void> => {
        calls.push("restore");
        restored.push(bookmark);
      },
      describe: (): FlowGraph => options.graph ?? graph,
      state,
      history: () => [],
      setMode: (mode: "live" | "fast"): void => {
        calls.push(`mode:${mode}`);
        live.mode = mode;
      },
      gate: { answer: vi.fn(() => true), pointer: vi.fn(), state: vi.fn() },
      inbox: { post: vi.fn() },
      fx: { handle: () => unregister, dispatch: vi.fn(), onHint: () => unregister },
      features: { register: vi.fn(), all: () => [], contributions: () => [] }
    }
  };

  /**
   * Kills the loop of the fake app the way a fatal error of `run()` does.
   *
   * @param error - What the loop failed with.
   * @example
   * ```ts
   * fake.fail(new Error("[game] The safe node failed."));
   * ```
   */
  const fail = (error: Error): void => {
    dead.error = error;
    loop.reject(error);
  };

  return { app, calls, fail, restored, routes, steps };
};

describe("createHeadless", () => {
  it("sets fast mode before the app starts", async () => {
    const fake = createFakeApp();

    await createHeadless(fake.app);

    expect(fake.calls.slice(0, 2)).toEqual(["mode:fast", "start"]);
  });

  it("starts the loop when the app did not", async () => {
    const fake = createFakeApp();

    await createHeadless(fake.app);

    expect(fake.calls).toContain("run");
  });

  it("does not call flow.run() twice when the app's onStart already did", async () => {
    const fake = createFakeApp({ running: true });

    await createHeadless(fake.app);

    expect(fake.calls).not.toContain("run");
  });

  it("waits for the first rest point of the loop", async () => {
    const fake = createFakeApp();

    const game = await createHeadless(fake.app);

    expect(game.state().path).toBe("home");
    expect(fake.routes).toEqual([[]]);
  });

  it("rejects when the loop fails fatally before the first rest point", async () => {
    const fatal = new Error("[game] flow.run() needs a main flow.");
    const fake = createFakeApp({ fatal });

    await expect(createHeadless(fake.app)).rejects.toThrow("[game] flow.run() needs a main flow.");
  });

  it("re-throws a fatal error of the loop from walk", async () => {
    const fake = createFakeApp();
    const game = await createHeadless(fake.app);

    fake.fail(new Error("[game] The save is unreadable."));

    await expect(game.walk([{ at: "home", intent: "play" }])).rejects.toThrow(
      "[game] The save is unreadable."
    );
  });

  it("re-throws a fatal error of the loop from stop", async () => {
    const fake = createFakeApp();
    const game = await createHeadless(fake.app);

    fake.fail(new Error("[game] The safe node failed."));

    await expect(game.stop()).rejects.toThrow("[game] The safe node failed.");
    expect(fake.calls).toContain("stop");
  });

  it("passes the route to flow.walk and reads state, history and the gate", async () => {
    const fake = createFakeApp();
    const game = await createHeadless(fake.app);
    const walked = await game.walk([{ at: "home", intent: "play" }]);

    expect(walked.path).toBe("home");
    expect(fake.routes).toEqual([[], [{ at: "home", intent: "play" }]]);
    expect(game.state().mode).toBe("fast");
    expect(game.history()).toEqual([]);
    expect(game.answer({ intent: "play" })).toBe(true);
  });
});

describe("runRepro", () => {
  it("restores the checkpoint bookmark and replays the route", async () => {
    const fake = createFakeApp();
    const result = await runRepro(fake.app, {
      player: { coins: 7 },
      session: { visits: 2 },
      checkpoint: "home",
      route: [{ at: "home", intent: "play" }]
    });

    expect(fake.restored).toHaveLength(1);
    expect(fake.restored[0]).toMatchObject({
      path: "home",
      player: { coins: 7 },
      session: { visits: 2 }
    });
    expect(fake.calls.indexOf("restore")).toBeLessThan(fake.calls.lastIndexOf("walk"));
    expect(result).toEqual({ path: ["home"], player: { coins: 3 }, session: { visits: 1 } });
  });

  it("starts at the main flow's start node when the repro names no checkpoint", async () => {
    const fake = createFakeApp();

    await runRepro(fake.app, { player: { coins: 0 }, route: [] });

    expect(fake.restored[0]?.path).toBe("boot");
    expect(fake.restored[0]?.rng).toEqual({ seed: 1, streams: {} });
  });

  it("refuses a checkpoint that names a transit node, before anything is restored", async () => {
    const fake = createFakeApp({ graph: popupGraph });

    await expect(
      runRepro(fake.app, { player: { coins: 7 }, checkpoint: "info/show", route: [] })
    ).rejects.toThrow(
      '[game] The bookmark "info/show" is not a rest node of the graph.\n  Restore a rest node, for example the checkpoint "home".'
    );
    expect(fake.restored).toEqual([]);
  });
});

describe("reproBookmark", () => {
  it.each([
    ["a transit node of the main flow", "boot"],
    ["a transit node that carries the checkpoint flag", "info/show"],
    ["a sub-flow", "info"]
  ])("refuses a checkpoint that names %s", (_name, checkpoint) => {
    const fake = createFakeApp({ graph: popupGraph });

    expect(() => reproBookmark(fake.app, { player: {}, checkpoint, route: [] })).toThrow(
      `[game] The bookmark "${checkpoint}" is not a rest node of the graph.`
    );
  });

  it("refuses a repro without a checkpoint when the start node is a transit node, as before", () => {
    const fake = createFakeApp({ graph: popupGraph });

    expect(() => reproBookmark(fake.app, { player: {}, route: [] })).toThrow(
      '[game] The bookmark "boot" is not a rest node of the graph.'
    );
  });

  it.each([
    ["a rest checkpoint", "home"],
    ["a plain rest node inside a sub-flow", "info/confirm"]
  ])("builds the bookmark of %s with the hash of the running graph", (_name, checkpoint) => {
    const fake = createFakeApp({ graph: popupGraph });
    const bookmark = reproBookmark(fake.app, { player: { coins: 7 }, checkpoint, route: [] });

    expect(bookmark).toMatchObject({ path: checkpoint, player: { coins: 7 }, session: {} });
    expect(bookmark.graph).toMatch(/^[\da-f]{8}$/);
    expect("rest" in bookmark).toBe(false);
  });

  it("leaves a path the graph does not have to restore, which names it as no node", () => {
    const fake = createFakeApp({ graph: popupGraph });

    expect(reproBookmark(fake.app, { player: {}, checkpoint: "nowhere", route: [] }).path).toBe(
      "nowhere"
    );
  });

  it("refuses a repro without a checkpoint when the graph has no main flow to start from", () => {
    const fake = createFakeApp({ graph: { main: "main", flows: {}, slots: {} } });

    expect(() => reproBookmark(fake.app, { player: {}, route: [] })).toThrow(
      '[game] runRepro() found no flow "main" to start from.\n  Name the checkpoint the repro was taken at.'
    );
  });

  it("names the start of the main flow when the graph has no checkpoint to suggest", () => {
    const nodes = { boot: described("main", "boot") };
    const fake = createFakeApp({
      graph: { main: "main", flows: { main: { nodes, start: "boot", edges: {} } }, slots: {} }
    });

    expect(() => reproBookmark(fake.app, { player: {}, checkpoint: "boot", route: [] })).toThrow(
      'Restore a rest node, for example the checkpoint "boot".'
    );
  });

  it("never suggests a transit node as the checkpoint, also when it carries the flag", () => {
    const nodes = {
      boot: described("main", "boot", { checkpoint: true }),
      home: described("main", "home", { rest: true, checkpoint: true })
    };
    const fake = createFakeApp({
      graph: { main: "main", flows: { main: { nodes, start: "boot", edges: {} } }, slots: {} }
    });

    expect(() => reproBookmark(fake.app, { player: {}, checkpoint: "boot", route: [] })).toThrow(
      'for example the checkpoint "home"'
    );
  });

  it("names a checkpoint inside a sub-flow with its flow", () => {
    const fake = createFakeApp({
      graph: {
        main: "main",
        flows: {
          main: { nodes: { boot: described("main", "boot") }, start: "boot", edges: {} },
          board: {
            nodes: { play: described("board", "play", { rest: true, checkpoint: true }) },
            start: "play",
            edges: {}
          }
        },
        slots: {}
      }
    });

    expect(() => reproBookmark(fake.app, { player: {}, checkpoint: "boot", route: [] })).toThrow(
      'for example the checkpoint "board/play"'
    );
  });
});

describe("stepFrames", () => {
  it("advances by exactly the number of frames asked for", () => {
    const fake = createFakeApp();

    stepFrames(fake.app, 3, 16);

    expect(fake.steps).toEqual([16, 16, 16]);
  });

  it("steps nothing for a count of zero", () => {
    const fake = createFakeApp();

    stepFrames(fake.app, 0, 16);

    expect(fake.steps).toEqual([]);
  });
});
