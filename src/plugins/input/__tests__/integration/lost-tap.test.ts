import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, type Flow, screen, type } from "../../../../index";
import { Tappable } from "../../components";

// ---------------------------------------------------------------------------
// Integration: the dev log of a tap the gate took nothing for (F122). The real
// time, lifecycle, model, clock, flow, world, renderer and input plugins,
// headless; `app.input.tap` hands the answer to the real gate.
// ---------------------------------------------------------------------------

type Session = { guided: boolean; withBlocked: boolean };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { coins: number };
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const home = defineNode({
  rest: true,
  outcomes: { play: type(), settings: type(), nudge: type() },
  guide: ({ session }): Flow.GuideOptions | undefined => {
    if (!session.guided) return undefined;

    return session.withBlocked
      ? { allow: { intent: "play" }, blocked: { intent: "nudge" } }
      : { allow: { intent: "play" } };
  }
});

const level = defineNode({ rest: true, outcomes: { back: type() } });

const main = defineFlow("main", {
  nodes: { home, level },
  start: "home",
  edges: { home: { play: "level", settings: "home", nudge: "home" }, level: { back: "home" } }
});

const menu = defineFeature("menu", { flows: [main] });

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts the menu at home with three buttons: `play`, `settings` and `shop` (no node lists it).
 *
 * @param session - Whether a guide stands at home, and whether it names `blocked`.
 * @returns The started app and its buttons.
 */
async function startMenu(session?: Session) {
  const app = createApp({
    plugins: [...screen, menu],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: {
        initialPlayer: { coins: 0 },
        initialSession: session ?? { guided: false, withBlocked: false },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  const owner = { kind: "plugin", name: "test" } as const;
  const button = (intent: string): number => app.world.ecs.spawn(owner, [Tappable({ intent })]);

  return { app, play: button("play"), settings: button("settings"), shop: button("shop") };
}

type App = Awaited<ReturnType<typeof startMenu>>["app"];

/**
 * The F122 lines of the log: what a lost tap wrote.
 *
 * @param app - The started app.
 * @returns Level, event and payload of each line.
 */
function lostLines(app: App): Array<{ level: string; event: string; data: unknown }> {
  return app.log
    .trace()
    .filter(
      entry => entry.event.startsWith("input: counted") || entry.event.startsWith("flow: a held")
    )
    .map(({ level, event, data }) => ({ level, event, data }));
}

describe("a tap the gate took nothing for, in a dev build", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Bug caught: a good tap writes a line, so the log cries wolf on every button.
  it("logs nothing for a tap the gate takes", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, play } = await startMenu();

    expect(app.input.tap(play)).toBe(true);
    expect(lostLines(app)).toEqual([]);

    await app.stop();
  });

  // Bug caught: a button whose intent no edge takes does nothing, silently.
  it("warns no-edge for an intent the resting node does not list", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, shop } = await startMenu();

    expect(app.input.tap(shop)).toBe(false);
    expect(lostLines(app)).toEqual([
      {
        level: "warn",
        event: "input: counted, but the gate took nothing",
        data: { view: shop, intent: "shop", gate: "no-edge" }
      }
    ]);

    await app.stop();
  });

  // Bug caught: a guide's narrow drops a listed button and nobody sees why.
  it("warns refused for a press a guide drops with no blocked, and blocked when it names one", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const refused = await startMenu({ guided: true, withBlocked: false });

    expect(refused.app.input.tap(refused.settings)).toBe(false);
    expect(lostLines(refused.app)).toEqual([
      {
        level: "warn",
        event: "input: counted, but the gate took nothing",
        data: { view: refused.settings, intent: "settings", gate: "refused" }
      }
    ]);
    await refused.app.stop();

    const blocked = await startMenu({ guided: true, withBlocked: true });

    expect(blocked.app.input.tap(blocked.settings)).toBe(true);
    expect(lostLines(blocked.app)).toEqual([
      {
        level: "warn",
        event: "input: counted, but the gate took nothing",
        data: { view: blocked.settings, intent: "settings", gate: "blocked" }
      }
    ]);
    await blocked.app.stop();
  });

  // Bug caught: a tap held at a closed gate vanishes when the next gate does not list it.
  it("tells a held tap at debug level, and warns when the next gate does not take it", async () => {
    // A frame source that never calls back: time runs, so the closed gate holds the press.
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app, play } = await startMenu();

    expect(app.input.tap(play)).toBe(true);
    expect(app.input.tap(play)).toBe(false);
    await tick();

    expect(app.flow.state().path).toBe("level");
    expect(lostLines(app)).toEqual([
      {
        level: "debug",
        event: "input: counted, the gate is closed: held for the next gate",
        data: { view: play, intent: "play" }
      },
      {
        level: "warn",
        event: "flow: a held answer was dropped",
        data: { intent: "play", reason: "not-taken" }
      }
    ]);

    await app.stop();
  });

  // Bug caught: a release build pays for the log, or prints it to the player.
  it("logs nothing outside a dev build", async () => {
    const { app, shop } = await startMenu();

    expect(app.input.tap(shop)).toBe(false);
    expect(lostLines(app)).toEqual([]);

    await app.stop();
  });
});
