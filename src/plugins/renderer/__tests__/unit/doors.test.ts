import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import { run } from "../../../flow/doors/run";
import { cheatsOf } from "../../../flow/doors/session";
import type { Bookmark, Api as FlowApi, FlowState } from "../../../flow/types";
import { Layer } from "../../../world/ecs/define";
import { Parent, Sprite, Transform } from "../../components";
import { captureCommand, debugCommand } from "../../control";
import { atSource, renderSource } from "../../inspect";
import type { Api, Captured, CaptureOptions } from "../../types";
import { FAKE_PNG, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test: the renderer source and commands of the doors over the real
// renderer modules of the mock plugin
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Builds the app the doors reach the mock renderer through.
 *
 * @param mock - The mock renderer.
 * @returns The app.
 */
function appOf(mock: MockRenderer) {
  return { ...createApp(), renderer: mock.api, world: mock.world };
}

/**
 * The message of an input field of `game.capture` with the wrong shape.
 *
 * @param field - The field.
 * @param expected - What to pass instead.
 * @returns The message.
 */
function shape(field: string, expected: string): string {
  return `[game] game.capture: ${field} has the wrong shape.\n  Pass ${expected}.`;
}

/**
 * Lets the promise callbacks queued so far run, and the ones they queue in turn.
 */
async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("game.render", () => {
  it("is a frame source that reads the renderer counters", () => {
    const mock = createMockRenderer({ dom: false });

    expect(renderSource.id).toBe("game.render");
    expect(renderSource.changes).toBe("frame");
    expect(read(appOf(mock), renderSource)).toEqual({
      fps: 0,
      frameMs: 0,
      textures: 0,
      textureMb: 0,
      views: 0,
      pooled: 0,
      renderPasses: 0
    });
  });
});

describe("game.at", () => {
  it("is a frame source over a page point", () => {
    expect(atSource.id).toBe("game.at");
    expect(atSource.changes).toBe("frame");
    expect(atSource.input).toEqual({ x: "number", y: "number" });
  });

  it("maps a page point to reference units and names what lies under it, topmost first", async () => {
    // A 390 px wide phone: 390 / 1080 CSS px a reference unit.
    const mock = createMockRenderer({ width: 390, height: 844 });

    await mock.start();
    mock.api.sync.textures.provide(() => new FakeTexture({}) as never);
    mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
    mock.modules.sync.pass();

    const items = { kind: "projection", name: "board.items" } as const;
    const cell = mock.world.ecs.spawn(items, [
      Layer({ name: "items" }),
      Transform({ x: 540, y: 300 }),
      Sprite({ texture: "board.cell" })
    ]);

    mock.world.projection.registerKey("board.items", "c7", cell);
    mock.modules.sync.pass();

    const shine = mock.world.ecs.spawn({ kind: "plugin", name: "fx" }, [
      Transform(),
      Sprite({ texture: "fx.shine" }),
      Parent({ entity: cell })
    ]);

    mock.modules.sync.pass();

    const point = mock.api.viewport.toScreen({ x: 540, y: 300 });

    expect([cell, shine]).toEqual([1_048_576, 1_048_577]);
    expect(point.x).toBeCloseTo(195, 6);
    expect(point.y).toBeCloseTo(108.33, 2);
    expect(read(appOf(mock), atSource, point)).toEqual([
      { entity: shine, owner: { kind: "plugin", name: "fx" }, key: undefined, layer: undefined },
      {
        entity: cell,
        owner: items,
        key: { projection: "board.items", key: "c7" },
        layer: "items"
      }
    ]);
    expect(read(appOf(mock), atSource, { x: 10, y: 10 })).toEqual([]);
  });

  it("answers an empty list while the renderer is inert", () => {
    const mock = createMockRenderer({ dom: false });

    expect(read(appOf(mock), atSource, { x: 195, y: 108 })).toEqual([]);
  });

  it("leaves out an entity that despawned this frame, whose view goes in the next pass", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.api.sync.textures.provide(() => new FakeTexture({}) as never);
    mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

    const below = mock.world.ecs.spawn({ kind: "plugin", name: "test" }, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);
    const gone = mock.world.ecs.spawn({ kind: "plugin", name: "test" }, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();
    // A stale entity reads as the identity pose: its view at the origin is still under the point.
    mock.world.ecs.despawn(gone);

    expect(mock.api.sync.hitAll(0, 0)).toEqual([gone, below]);
    expect(read(appOf(mock), atSource, { x: 0, y: 0 }).map(under => under.entity)).toEqual([below]);
  });
});

describe("game.capture", () => {
  it("is a read command with the four options", () => {
    expect(captureCommand.id).toBe("game.capture");
    expect(captureCommand.effect).toBe("read");
    expect(captureCommand.input).toEqual({
      legend: "boolean?",
      layers: "json?",
      sheet: "json?",
      diff: "json?"
    });
  });

  it("resolves the PNG of the canvas taken at the end of the next frame", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer();

    await mock.start();

    const pending = run(appOf(mock), captureCommand);

    mock.setNow(0);
    mock.runPhase("input");
    mock.setNow(2);
    mock.runPhase("render");

    const ran = await pending;

    expect(ran.value).toEqual({ png: FAKE_PNG });
    expect(ran.state.tainted).toBe(false);
  });

  it("resolves undefined headless", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ dom: false });

    const ran = await run(appOf(mock), captureCommand);

    expect(ran.value).toBeUndefined();
  });

  it("passes legend, layers and sheet through to renderer.capture", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, capture } = diffApp();

    await run(app, captureCommand, { legend: true, layers: ["board", "hud"] });
    await run(app, captureCommand, { sheet: { frames: 6, everyMs: 100 } });
    await run(app, captureCommand, { legend: false });

    expect(capture.mock.calls).toEqual([
      [{ legend: true, layers: ["board", "hud"] }],
      [{ sheet: { frames: 6, everyMs: 100 } }],
      [{ legend: false }]
    ]);
  });

  it("checks the shape of every option before anything runs", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, capture, restored } = diffApp();

    await expect(run(app, captureCommand, { layers: "hud" })).rejects.toThrow(
      shape("layers", 'an array of layer names, such as ["board", "hud"]')
    );
    await expect(run(app, captureCommand, { layers: ["hud", 2] })).rejects.toThrow(
      shape("layers", 'an array of layer names, such as ["board", "hud"]')
    );
    await expect(
      run(app, captureCommand, { sheet: { frames: "6", everyMs: 100 } })
    ).rejects.toThrow(shape("sheet", "{ frames, everyMs }, two numbers"));
    await expect(run(app, captureCommand, { sheet: [6, 100] })).rejects.toThrow(
      shape("sheet", "{ frames, everyMs }, two numbers")
    );
    await expect(run(app, captureCommand, { diff: { path: 3 } })).rejects.toThrow(
      shape("diff", "a bookmark, the value of game.bookmark")
    );
    expect(capture).not.toHaveBeenCalled();
    expect(restored).toEqual([]);
  });

  it("refuses diff with sheet before anything runs", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, restored } = diffApp();

    await expect(
      run(app, captureCommand, { diff: bookmarkAt("shop"), sheet: { frames: 2, everyMs: 100 } })
    ).rejects.toThrow(
      "[game] game.capture takes a sheet on its own.\n  Drop legend and against, or drop sheet."
    );
    expect(restored).toEqual([]);
    expect(cheatsOf(app)).toEqual([]);
  });

  it("refuses diff while the game is not at rest", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, flow, restored } = diffApp();

    flow.state = { ...flow.state, pending: { fx: "delay" } };

    await expect(run(app, captureCommand, { diff: bookmarkAt("shop") })).rejects.toThrow(
      "[game] game.capture diff needs the game at rest.\n  Wait for the gate, then capture."
    );

    flow.state = { ...flow.state, pending: {} };

    await expect(run(app, captureCommand, { diff: bookmarkAt("shop") })).rejects.toThrow(
      "[game] game.capture diff needs the game at rest."
    );
    expect(restored).toEqual([]);
    expect(cheatsOf(app)).toEqual([]);
  });

  it("journals itself, restores the bookmark and back, and diffs against the earlier picture", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, capture, restored } = diffApp();
    const diff = bookmarkAt("shop");
    const ran = await drive(
      app,
      run(app, captureCommand, { diff, legend: true, layers: ["board"] })
    );

    expect(cheatsOf(app)).toMatchObject([{ id: "game.capture", input: { diff } }]);
    expect(restored.map(bookmark => bookmark.path)).toEqual(["shop", "home"]);
    expect(capture.mock.calls).toEqual([
      [{ layers: ["board"] }],
      [{ layers: ["board"], legend: true, against: "data:image/png;base64,theirs" }]
    ]);
    expect(ran.value).toEqual({ png: "data:image/png;base64,diff-2" });
    expect(ran.state.tainted).toBe(true);
  });

  it("waits for the bookmark to rest, and two more drawn frames, before each picture", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, flow, capture } = diffApp();
    const frames: number[] = [];

    // The restore lands while an effect still runs; it rests three drawn frames later.
    flow.restore = async (bookmark: Bookmark) => {
      flow.restoredPaths.push(bookmark.path);
      flow.state = { ...flow.state, path: bookmark.path, pending: { fx: "fly" } };
      flow.restFrames = 3;
    };
    capture.mockImplementation(async () => {
      frames.push(app.time.snapshot().frame);

      return { png: "data:image/png;base64,theirs" };
    });

    await drive(app, run(app, captureCommand, { diff: bookmarkAt("shop") }));

    // 3 frames to rest and 2 more: frame 5; back home: 5 more, frame 10.
    expect(frames).toEqual([5, 10]);
  });

  it("steps the frames it waits on while the clock is paused, and comes back where it stood", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, flow, capture } = diffApp();
    const frames: number[] = [];

    // The editor paused the game: no frame comes, so the command steps each one it waits on.
    app.time.pause();
    flow.restore = async (bookmark: Bookmark) => {
      flow.restoredPaths.push(bookmark.path);
      flow.state = { ...flow.state, path: bookmark.path, pending: { fx: "fly" } };
      flow.restFrames = 3;
    };
    capture.mockImplementation(async () => {
      frames.push(app.time.snapshot().frame);

      return { png: "data:image/png;base64,theirs" };
    });

    const ran = await run(app, captureCommand, { diff: bookmarkAt("shop") });

    expect(ran.value).toEqual({ png: "data:image/png;base64,theirs" });
    expect(frames).toEqual([5, 10]);
    expect(flow.restoredPaths).toEqual(["shop", "home"]);
    expect(app.flow.state()).toMatchObject({ path: "home", pending: { gate: ["play"] } });
    expect(app.time.isPaused()).toBe(true);
    // Ten frames of 1000 / 60 ms, the step of game.step.
    expect(app.time.snapshot().elapsed).toBeCloseTo(10 * (1000 / 60), 6);
  });

  it("gives up when the bookmark does not rest in 600 drawn frames, and goes back anyway", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, flow, capture } = diffApp();

    // The bookmark of "shop" never rests; home rests at once.
    flow.restore = async (bookmark: Bookmark) => {
      const shop = bookmark.path === "shop";

      flow.restoredPaths.push(bookmark.path);
      flow.state = {
        ...flow.state,
        path: bookmark.path,
        pending: shop ? { fx: "fly" } : { gate: ["play"] }
      };
      flow.restFrames = shop ? Number.POSITIVE_INFINITY : 0;
    };

    const outcome = drive(app, run(app, captureCommand, { diff: bookmarkAt("shop") })).then(
      () => "resolved",
      (error: Error) => error.message
    );

    await expect(outcome).resolves.toBe(
      "[game] game.capture diff: the bookmark did not come to rest in 600 frames.\n  Capture a bookmark taken at a gate."
    );
    expect(flow.restoredPaths).toEqual(["shop", "home"]);
    expect(capture).not.toHaveBeenCalled();
  });

  it("steps the frames a restore needs before it resolves, while the clock is paused", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, flow, capture } = diffApp();
    const pictures: { frame: number; path: string }[] = [];

    // A bookmark of a transit node: the restore resolves at its gate, three drawn frames away,
    // and on a paused clock only the command steps a frame.
    app.time.pause();
    resolveAtGate(app, flow);
    capture.mockImplementation(async () => {
      pictures.push({ frame: app.time.snapshot().frame, path: app.flow.state().path });

      return { png: "data:image/png;base64,theirs" };
    });

    const ran = await run(app, captureCommand, { diff: bookmarkAt("shop") });

    expect(ran.value).toEqual({ png: "data:image/png;base64,theirs" });
    expect(pictures.map(picture => picture.path)).toEqual(["shop", "home"]);
    // Three frames to the gate and two more, at the least.
    expect(pictures[0]?.frame).toBeGreaterThanOrEqual(5);
    expect(flow.restoredPaths).toEqual(["shop", "home"]);
    expect(app.flow.state()).toMatchObject({ path: "home", pending: { gate: ["play"] } });
    expect(app.time.isPaused()).toBe(true);
  }, 2000);

  it("does not take the gate of the node it leaves for the rest of the bookmark", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, flow, capture } = diffApp();
    const pictures: { path: string; pending: FlowState["pending"] }[] = [];

    // The gate the game waits at stays open until the loop left its node: a popup's does. The
    // bookmark's own gate opens three drawn frames after the restore resolved.
    flow.restore = async (bookmark: Bookmark) => {
      flow.restoredPaths.push(bookmark.path);
      await settle();
      flow.state = { ...flow.state, path: bookmark.path, pending: {} };
      flow.restFrames = 3;
    };
    capture.mockImplementation(async () => {
      const { path, pending } = app.flow.state();

      pictures.push({ path, pending });

      return { png: "data:image/png;base64,theirs" };
    });

    await drive(app, run(app, captureCommand, { diff: bookmarkAt("shop") }));

    expect(pictures).toEqual([
      { path: "shop", pending: { gate: ["play"] } },
      { path: "home", pending: { gate: ["play"] } }
    ]);
  });

  it("answers the error of a refused restore at the next frame, and goes back", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, flow, capture } = diffApp();
    const refused = new Error("[game] The bookmark was refused.");
    const unhandled = watchUnhandled(refused);

    try {
      // The bookmark of "shop" is refused after the gate was shut; home rests at once.
      flow.restore = async (bookmark: Bookmark) => {
        flow.restoredPaths.push(bookmark.path);

        if (bookmark.path === "shop") {
          flow.state = { ...flow.state, pending: {} };

          throw refused;
        }

        flow.state = { ...flow.state, path: bookmark.path, pending: { gate: ["play"] } };
      };

      const outcome = run(app, captureCommand, { diff: bookmarkAt("shop") }).then(
        () => "resolved",
        (error: Error) => error.message
      );

      // The restore rejects while the command waits on a frame: nobody may leave it unhandled.
      await task();
      await drive(app, outcome);

      await expect(outcome).resolves.toBe("[game] The bookmark was refused.");
      expect(unhandled.stop()).toEqual([]);
    } finally {
      unhandled.stop();
    }
    expect(flow.restoredPaths).toEqual(["shop", "home"]);
    expect(capture).not.toHaveBeenCalled();
    expect(app.time.snapshot().frame).toBeLessThan(10);
  });

  it("gives up on a restore that never resolves, after 600 frames, and goes back", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, flow, capture } = diffApp();

    // The node of "shop" opens no gate, never rests and never ends; home rests at once.
    app.time.pause();
    flow.restore = (bookmark: Bookmark) => {
      flow.restoredPaths.push(bookmark.path);

      if (bookmark.path === "shop") {
        flow.state = { ...flow.state, path: bookmark.path, pending: {} };

        return new Promise<void>(() => undefined);
      }

      flow.state = { ...flow.state, path: bookmark.path, pending: { gate: ["play"] } };

      return Promise.resolve();
    };

    await expect(run(app, captureCommand, { diff: bookmarkAt("shop") })).rejects.toThrow(
      "[game] game.capture diff: the bookmark did not come to rest in 600 frames.\n  Capture a bookmark taken at a gate."
    );
    expect(flow.restoredPaths).toEqual(["shop", "home"]);
    expect(app.flow.state()).toMatchObject({ path: "home", pending: { gate: ["play"] } });
    expect(capture).not.toHaveBeenCalled();
    expect(app.time.snapshot().frame).toBeGreaterThanOrEqual(600);
  }, 2000);

  it("leaves no restore unhandled when a frame it waits on fails first", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, flow } = diffApp();
    const refused = new Error("[game] The bookmark was refused.");
    const unhandled = watchUnhandled(refused);
    try {
      const broken = {
        ...app,
        time: {
          ...app.time,
          step: () => {
            throw new Error("the frame failed");
          }
        }
      };

      // The frame fails at once; the restore is refused one task later.
      app.time.pause();
      flow.restore = async (bookmark: Bookmark) => {
        flow.restoredPaths.push(bookmark.path);
        flow.state = { ...flow.state, pending: {} };
        await task();

        throw refused;
      };

      await expect(run(broken, captureCommand, { diff: bookmarkAt("shop") })).rejects.toThrow(
        "the frame failed"
      );
      await task();
      await task();

      expect(unhandled.stop()).toEqual([]);
    } finally {
      unhandled.stop();
    }
    expect(flow.restoredPaths).toEqual(["shop", "home"]);
  });

  it("answers undefined, back where it started, when the earlier picture cannot be read", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, capture, restored } = diffApp();

    capture.mockResolvedValue(undefined);

    const ran = await drive(app, run(app, captureCommand, { diff: bookmarkAt("shop") }));

    expect(ran.value).toBeUndefined();
    expect(restored.map(bookmark => bookmark.path)).toEqual(["shop", "home"]);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("answers undefined and touches nothing while the renderer is inert", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, restored } = diffApp({ ready: false });

    const ran = await run(app, captureCommand, { diff: bookmarkAt("shop") });

    expect(ran.value).toBeUndefined();
    expect(restored).toEqual([]);
    expect(ran.state.tainted).toBe(false);
  });
});

describe("game.debug", () => {
  it("is a cosmetic command with the nine-slice switch", () => {
    expect(debugCommand.id).toBe("game.debug");
    expect(debugCommand.effect).toBe("cosmetic");
    expect(debugCommand.input).toEqual({ nineSlice: "boolean" });
  });

  it("switches the nine-slice outlines and answers the switches", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ dom: false });

    const on = await run(appOf(mock), debugCommand, { nineSlice: true });

    expect(on.value).toEqual({ nineSlice: true });
    expect(mock.api.sync.debug.state()).toEqual({ nineSlice: true });

    const off = await run(appOf(mock), debugCommand, { nineSlice: false });

    expect(off.value).toEqual({ nineSlice: false });
  });
});

describe("the renderer commands", () => {
  it("refuse outside a dev build and leave a moku:dev entry inside one", async () => {
    const mock = createMockRenderer({ dom: false });
    const app = appOf(mock);

    expect(() => captureCommand.run(app, {})).toThrow("dev builds only");
    expect(() => debugCommand.run(app, { nineSlice: true })).toThrow("dev builds only");
    expect(mock.api.sync.debug.state()).toEqual({ nineSlice: false });

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    mock.world.projection.setLayers([{ name: "hud", sort: "none" }]);
    await run(app, debugCommand, { nineSlice: true });
    await run(app, captureCommand);
    await run(app, captureCommand, { legend: true, layers: ["hud"] });

    expect(app.log.trace().slice(-3)).toEqual([
      expect.objectContaining({
        event: "moku:dev",
        data: { command: "game.debug", nineSlice: true }
      }),
      expect.objectContaining({ event: "moku:dev", data: { command: "game.capture" } }),
      expect.objectContaining({
        event: "moku:dev",
        data: { command: "game.capture", options: ["legend", "layers"] }
      })
    ]);
  });
});

// ---------------------------------------------------------------------------
// A hand-made flow and renderer for the diff of game.capture: the frames are
// the real time plugin's, stepped by `drive`
// ---------------------------------------------------------------------------

/** An app whose frames a test steps. */
type Steppable = { readonly time: { step(deltaMs: number): void } };

/** The hand-made flow: the state a test moves and the bookmarks it restored. */
type FakeFlow = {
  state: FlowState;
  restoredPaths: string[];
  /** Drawn frames until the state rests at its gate again. */
  restFrames: number;
  restore(bookmark: Bookmark): Promise<void>;
};

/**
 * A bookmark of a rest node, as JSON.
 *
 * @param path - The node path.
 * @returns The bookmark.
 */
function bookmarkAt(path: string) {
  return {
    path,
    input: {},
    player: { coins: 7 },
    session: {},
    rng: { seed: 1, streams: {} },
    graph: "0badf00d"
  };
}

/**
 * Builds an app over the real time plugin with a hand-made flow resting at "home" and a
 * renderer whose `capture` is a spy answering two pictures in turn.
 *
 * @param options - Whether the renderer draws.
 * @param options.ready - False for an inert renderer.
 * @returns The app, the flow, the capture spy and the restored bookmarks.
 */
function diffApp(options: { ready?: boolean } = {}) {
  const base = createApp();
  const restored: Bookmark[] = [];
  const flow: FakeFlow = {
    state: {
      running: true,
      path: "home",
      stack: [],
      pending: { gate: ["play"] },
      mode: "live"
    },
    restoredPaths: [],
    restFrames: 0,
    restore: async (bookmark: Bookmark) => {
      flow.restoredPaths.push(bookmark.path);
      flow.state = { ...flow.state, path: bookmark.path };
    }
  };
  let pictures = 0;
  const capture = vi.fn(async (_options?: CaptureOptions): Promise<Captured | undefined> => {
    pictures += 1;

    return {
      png:
        pictures === 1 ? "data:image/png;base64,theirs" : `data:image/png;base64,diff-${pictures}`
    };
  });
  const mock = createMockRenderer({ dom: false });
  const renderer: Api = {
    ...mock.api,
    host: { ...mock.api.host, ready: () => options.ready !== false },
    capture
  };
  const flowApi = {
    ...base.flow,
    state: () => flow.state,
    bookmark: () => bookmarkAt(flow.state.path),
    restore: async (bookmark: Bookmark) => {
      restored.push(bookmark);
      await flow.restore(bookmark);
    }
  } as unknown as FlowApi;

  base.time.onFrame("render", () => {
    if (flow.restFrames <= 0) return;

    flow.restFrames -= 1;
    if (flow.restFrames === 0) flow.state = { ...flow.state, pending: { gate: ["play"] } };
  });

  const app = { ...base, flow: flowApi, renderer, world: mock.world };

  return { app, flow, capture, restored };
}

/**
 * Makes the hand-made flow restore the way a bookmark of a transit node does: the gate is shut at
 * once, opens three drawn frames later, and only then does the restore resolve.
 *
 * @param app - The app whose frames open the gate.
 * @param app.time - Its time, for the frame hook.
 * @param app.time.onFrame - Registers the frame hook.
 * @param flow - The hand-made flow.
 */
function resolveAtGate(
  app: { readonly time: { onFrame(phase: "render", callback: () => void): unknown } },
  flow: FakeFlow
): void {
  const waiting: (() => void)[] = [];

  app.time.onFrame("render", () => {
    if (flow.state.pending.gate === undefined) return;

    for (const resolve of waiting.splice(0)) resolve();
  });
  flow.restore = (bookmark: Bookmark) => {
    flow.restoredPaths.push(bookmark.path);
    flow.state = { ...flow.state, path: bookmark.path, pending: {} };
    flow.restFrames = 3;

    return new Promise<void>(resolve => {
      waiting.push(resolve);
    });
  };
}

/**
 * Waits one task: a rejection nobody handles is reported only after the microtasks ran dry.
 */
async function task(): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

/**
 * Collects the rejections with one error that nobody handled, from now until `stop`. The listener
 * is process-wide, so a rejection another test of the worker left behind is not counted.
 *
 * @param own - The error the test rejects with.
 * @returns The stop function, which answers the unhandled rejections with `own`.
 */
function watchUnhandled(own: Error): { stop(): unknown[] } {
  const reasons: unknown[] = [];
  /**
   * Keeps one unhandled rejection of the test's own error.
   *
   * @param reason - What the promise rejected with.
   */
  const keep = (reason: unknown): void => {
    if (reason === own) reasons.push(reason);
  };

  process.on("unhandledRejection", keep);

  return {
    stop: () => {
      process.off("unhandledRejection", keep);

      return reasons;
    }
  };
}

/**
 * Steps drawn frames of the real time plugin until a command settles: what the frame loop of a
 * dev page does while the editor waits.
 *
 * @param app - The app whose time is stepped.
 * @param pending - The command run.
 * @returns What the command resolved with.
 */
async function drive<T>(app: Steppable, pending: Promise<T>): Promise<T> {
  let done = false;

  pending.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );

  for (let frame = 0; frame < 2000 && !done; frame += 1) {
    await settle();
    if (!done) app.time.step(16);
  }

  return pending;
}
