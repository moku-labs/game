/**
 * @file `startPage`, the page of a game, in a plain vitest run: `location`, `matchMedia` and
 * `localStorage` are stubbed, there is no `document`, so the renderer of the mini game stays inert
 * while the page still asks it to mount on `#game`. `game.screen` is spied on, so a test reads the
 * seams the page passed and still runs the real app.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../../src/app/config";
import { startPage } from "../../../src/app/page";
import type {
  GameConfig,
  PageAgent,
  PageOptions,
  SystemShell,
  SystemShellFactory
} from "../../../src/app/types";
import { commands, run } from "../../../src/control";
import { read, sources, watch } from "../../../src/inspect";
import { memory } from "../../../src/plugins/model/store/providers/memory";
import game from "../../fixtures/mini-game/index";
import ready from "../../fixtures/mini-game/tests/scenarios/ready";
import { fakeStorage, stubLocation, stubMedia } from "./fake-browser";

/** The config of the mini game: a title, every other field a default. */
const miniConfig: GameConfig = { page: { title: "mini-game" } };

/** The apps the tests started, stopped after each test. */
const running: { stop(): Promise<void> }[] = [];

/** The dev manifest of the mini game, the file the page fetches next to itself. */
const manifestText = readFileSync(
  new URL("../../fixtures/mini-game/generated/manifest.json", import.meta.url),
  "utf8"
);

/** The fetch of the runtime: Yoga loads its wasm through it. */
const realFetch = globalThis.fetch;

/**
 * Answers a fetch of a `manifest.json` with the mini game's manifest, and hands every other URL to
 * the real fetch. With no document the renderer is inert, so the manifest is the only file the
 * assets plugin fetches; Yoga still loads its wasm.
 *
 * @param input - What was fetched.
 * @param init - The options of the fetch.
 * @returns The response.
 */
function serveManifest(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (typeof input === "string" && input.endsWith("/manifest.json")) {
    return Promise.resolve(
      new Response(manifestText, { headers: { "content-type": "application/json" } })
    );
  }

  return realFetch(input, init);
}

/** What a test reads of the log of a running app. */
type Logged = { log: { trace(): readonly { level: string; event: string; data?: unknown }[] } };

beforeEach(() => {
  stubLocation("http://localhost:5173/");
  stubMedia(false);
  vi.stubGlobal("localStorage", fakeStorage().storage);
  vi.stubGlobal("fetch", vi.fn(serveManifest));
  // The app logs to the console in dev mode; the tests read the log trace instead.
  vi.spyOn(console, "warn").mockReturnValue();
  vi.spyOn(console, "error").mockReturnValue();
});

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();

  vi.unstubAllGlobals();
  vi.restoreAllMocks();

  for (const name of ["game", "system", "doors"]) Reflect.deleteProperty(globalThis, name);
});

/**
 * Starts the page of the mini game and remembers its app for the cleanup.
 *
 * @param config - The config of the game.
 * @param options - What the generated main.ts would pass.
 * @returns The started page.
 */
async function open(config: GameConfig = miniConfig, options?: PageOptions) {
  const page = await startPage(game, config, options);

  running.push(page.app);

  return page;
}

/** What a test reads of the spy on `game.screen`: its calls. */
type ScreenSpy = { mock: { calls: unknown[][] } };

/** Removes nothing: the remover of a subscription that holds nothing. */
const removeNothing = (): void => undefined;

/**
 * Reads the seams the page passed to `game.screen`.
 *
 * @param screen - The spy on `game.screen`.
 * @param call - Which call.
 * @returns The seams of that call.
 */
function seamsOf(screen: ScreenSpy, call = 0) {
  const seams = screen.mock.calls[call]?.[0];

  if (seams === undefined) throw new Error(`game.screen has no call ${call}`);

  return seams as NonNullable<Parameters<typeof game.screen>[0]>;
}

/**
 * Reads the log entries of one level.
 *
 * @param app - The running app.
 * @param level - The level.
 * @returns The entries of that level.
 */
function logged(app: Logged, level: "warn" | "error") {
  return app.log.trace().filter(entry => entry.level === level);
}

/** A shell whose calls are written into one order. */
type FakeShell = { shell: SystemShell; factory: ReturnType<typeof vi.fn<SystemShellFactory>> };

/**
 * Makes a system shell that records its start and what the platform plugin asks of it.
 *
 * @param order - Where the calls go, in order.
 * @param save - The store save of the shell.
 * @returns The shell and the factory the page calls.
 */
function fakeShell(order: string[], save?: SystemShell["save"]): FakeShell {
  const shell: SystemShell = {
    handle: { name: "the system app" },
    platform: {
      onPause: () => {
        order.push("onPause");

        return removeNothing;
      },
      onResume: () => {
        order.push("onResume");

        return removeNothing;
      },
      onBack: () => {
        order.push("onBack");

        return removeNothing;
      },
      haptic: kind => order.push(`haptic:${kind}`),
      keepAwake: on => order.push(`keepAwake:${on}`),
      exit: () => order.push("exit")
    },
    save,
    start: async () => {
      order.push("shell:start");
    },
    stop: async () => {
      order.push("shell:stop");
    }
  };

  return { shell, factory: vi.fn<SystemShellFactory>(async () => shell) };
}

describe("startPage: the seams of the screen app", () => {
  it("the page mounts on #game and reads the manifest next to the page", async () => {
    stubLocation("https://games.example/timber/index.html?x=1");

    const screen = vi.spyOn(game, "screen");
    const before = Date.now();
    const { app } = await open();
    const seams = seamsOf(screen);

    expect(seams.renderer).toEqual({ mount: "#game" });
    expect(seams.manifest).toBe("https://games.example/timber/manifest.json");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://games.example/timber/manifest.json");
    // The device clock, not the fake one at startMoment.
    expect(seams.clock?.now()).toBeGreaterThanOrEqual(before);
    expect(seams.clock?.now()).toBeLessThanOrEqual(Date.now());
    expect(app.renderer.host.kind()).toBe("none");
  });

  it("?renderer=webgl asks for webgl and no query keeps the game's preference", async () => {
    const screen = vi.spyOn(game, "screen");

    stubLocation("http://localhost:5173/?renderer=webgl");
    await open();
    stubLocation("http://localhost:5173/?renderer=webgpu");
    await open();

    expect(seamsOf(screen, 0).renderer).toEqual({ mount: "#game", preference: "webgl" });
    expect(seamsOf(screen, 1).renderer).toEqual({ mount: "#game" });
  });

  it("keepAwake follows config.system", async () => {
    const screen = vi.spyOn(game, "screen");
    const order: string[] = [];

    await open(
      { ...miniConfig, system: ["lifecycle", "keepAwake"] },
      {
        system: fakeShell(order).factory
      }
    );
    await open();

    expect(seamsOf(screen, 0).keepAwake).toBe(true);
    expect(seamsOf(screen, 1).keepAwake).toBe(false);
    expect(order).toContain("keepAwake:true");
  });

  it("a dev page keeps 200 sounds in the audio journal, a production page the game's", async () => {
    const screen = vi.spyOn(game, "screen");

    await open();
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await open();

    expect(seamsOf(screen, 0).audio).toEqual({});
    expect(seamsOf(screen, 1).audio).toEqual({ journal: 200 });
  });
});

describe("startPage: the save and the scenarios", () => {
  it("?player= starts from the scenario on a fresh memory save", async () => {
    const saved = JSON.stringify({
      state: { player: { count: 9 }, rng: { seed: 1, streams: {} } },
      version: 0
    });
    const { storage, items } = fakeStorage({ "moku-game:save": saved });
    const scenario = vi.fn(ready);
    const screen = vi.spyOn(game, "screen");

    vi.stubGlobal("localStorage", storage);
    stubLocation("http://localhost:5173/?player=ready");

    const before = Date.now();
    const { app } = await open(
      { ...miniConfig, save: "local" },
      { scenarios: { ready: scenario } }
    );

    await vi.waitFor(() => expect(app.flow.state().path).toBe("home"));
    expect(app.model.store.snapshot().player).toEqual({ count: 3 });
    expect(scenario.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(before);
    expect(seamsOf(screen).provider).toHaveProperty("calls");
    // The stored save is neither read nor written.
    expect(items.get("moku-game:save")).toBe(saved);
  });

  it("a scenario's session is the session of the page", async () => {
    const screen = vi.spyOn(game, "screen");

    stubLocation("http://localhost:5173/?player=popup");
    await open(miniConfig, {
      scenarios: { popup: () => ({ player: { count: 1 }, session: { opened: 2 } }) }
    });

    expect(seamsOf(screen).player).toEqual({ count: 1 });
    expect(seamsOf(screen).session).toEqual({ opened: 2 });
  });

  it("an unknown ?player= warns with the known names and starts from the starting player", async () => {
    stubLocation("http://localhost:5173/?player=nope");

    const { app } = await open(miniConfig, {
      scenarios: { empty: () => ({ player: { count: 0 } }), ready }
    });

    expect(logged(app, "warn").map(entry => entry.event)).toContain(
      '[game] No scenario "nope".\n  Known: empty, ready. The page starts from the starting player.'
    );
    expect(app.model.store.snapshot().player).toEqual({ count: 0 });
  });

  it("an unknown ?player= on a page without scenarios names none", async () => {
    stubLocation("http://localhost:5173/?player=ready");

    const { app } = await open();

    expect(logged(app, "warn").map(entry => entry.event)).toContain(
      '[game] No scenario "ready".\n  Known: none. The page starts from the starting player.'
    );
  });

  it("a local save lives under the native identifier", async () => {
    const { storage, items } = fakeStorage();

    vi.stubGlobal("localStorage", storage);

    const { app } = await open({
      ...miniConfig,
      save: "local",
      native: { name: "Mini", identifier: "com.example.mini" }
    });

    await vi.waitFor(() => expect(items.has("com.example.mini:save")).toBe(true));
    expect(app.flow.state().path).toBe("home");
  });

  it("save store runs on the shell's save", async () => {
    const screen = vi.spyOn(game, "screen");
    const save = memory();
    const { factory } = fakeShell([], save);

    await open({ ...miniConfig, save: "store" }, { system: factory });

    expect(seamsOf(screen).provider).toBe(save);
  });

  it("save store without a shell throws the store message", async () => {
    await expect(startPage(game, { ...miniConfig, save: "store" })).rejects.toThrow(
      '[game] config.save is "store", but the page has no system shell.\n  Run moku-game dev or build again: it passes the shell when config.ts names save "store".'
    );
  });
});

describe("startPage: the shell, the handles and the start", () => {
  it("the page builds the shell from the resolved config", async () => {
    const { factory } = fakeShell([]);
    const config: GameConfig = { ...miniConfig, system: ["haptics"] };

    await open(config, { system: factory });

    expect(factory).toHaveBeenCalledWith(resolveConfig(config), expect.any(Function));
  });

  it("the page sets game, system and doors on globalThis", async () => {
    const { shell, factory } = fakeShell([]);
    const { app, system } = await open(miniConfig, { system: factory });

    expect(Reflect.get(globalThis, "game")).toBe(app);
    expect(Reflect.get(globalThis, "system")).toBe(shell.handle);
    expect(system).toBe(shell.handle);
    expect(Reflect.get(globalThis, "doors")).toEqual({ read, watch, sources });
  });

  it("a page without a shell has no system handle", async () => {
    const { system } = await open();

    expect(system).toBeUndefined();
    expect(Reflect.get(globalThis, "system")).toBeUndefined();
  });

  it("doors carry run and commands in dev only", async () => {
    await open();
    expect(Reflect.get(globalThis, "doors")).not.toHaveProperty("run");

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await open();

    expect(Reflect.get(globalThis, "doors")).toEqual({ read, watch, sources, run, commands });
  });

  it("reduced motion follows the media query and its change event", async () => {
    const media = stubMedia(true);
    const { app } = await open();

    expect(media.queries).toEqual(["(prefers-reduced-motion: reduce)"]);
    expect(app.anim.reducedMotion()).toBe(true);

    media.change(false);
    expect(app.anim.reducedMotion()).toBe(false);
  });

  it("the shell starts before the app", async () => {
    const order: string[] = [];

    await open({ ...miniConfig, system: ["keepAwake"] }, { system: fakeShell(order).factory });

    expect(order).toEqual(["shell:start", "onPause", "onResume", "onBack", "keepAwake:true"]);
  });

  it("a problem reported before the app is logged once it exists, and one after at once", async () => {
    const reports: ((problem: string) => void)[] = [];
    const { shell } = fakeShell([]);
    const { app } = await open(miniConfig, {
      system: async (_config, report) => {
        report("[game] early.\n  First.");
        reports.push(report);

        return shell;
      }
    });

    reports[0]?.("[game] late.\n  Second.");

    expect(logged(app, "warn").map(entry => entry.event)).toEqual([
      "[game] early.\n  First.",
      "[game] late.\n  Second."
    ]);
  });

  it("a failing graph is logged, not thrown", async () => {
    vi.stubGlobal("localStorage", fakeStorage({ "moku-game:save": "{oops" }).storage);

    const { app } = await open({ ...miniConfig, save: "local" });

    await vi.waitFor(() =>
      expect(logged(app, "error").at(-1)?.event).toBe("[game] The graph stopped.")
    );
    expect(logged(app, "error").at(-1)?.data).toMatchObject({
      error: {
        message:
          '[game] The local save is not JSON.\n  Clear the site data or the key "moku-game:save".'
      }
    });
  });
});

describe("startPage: the dev agents", () => {
  it("agents run in dev with the app, the title and the dev modules", async () => {
    const agent = vi.fn<PageAgent>();
    const devModule = { boardDev: true };

    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { app } = await open(miniConfig, { agents: [agent], devModules: [devModule] });

    expect(agent).toHaveBeenCalledWith({ app, name: "mini-game", modules: [devModule] });
  });

  it("agents get no dev modules when the page names none", async () => {
    const agent = vi.fn<PageAgent>();

    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { app } = await open(miniConfig, { agents: [agent] });

    expect(agent).toHaveBeenCalledWith({ app, name: "mini-game", modules: [] });
  });

  it("a production page starts no agent", async () => {
    const agent = vi.fn<PageAgent>();

    await open(miniConfig, { agents: [agent] });

    expect(agent).not.toHaveBeenCalled();
  });

  it("a throwing agent is logged and the page keeps running", async () => {
    const next = vi.fn<PageAgent>();

    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { app } = await open(miniConfig, {
      agents: [
        () => Promise.reject(new Error("no editor")),
        () => {
          throw "no bridge";
        },
        next
      ]
    });

    const failed = logged(app, "error").filter(
      entry => entry.event === "[game] A page agent failed to start."
    );

    expect(failed.map(entry => entry.data)).toEqual([
      { error: expect.objectContaining({ message: "no editor" }) },
      { error: expect.objectContaining({ message: "no bridge" }) }
    ]);
    expect(next).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(app.flow.state().path).toBe("home"));
  });
});
