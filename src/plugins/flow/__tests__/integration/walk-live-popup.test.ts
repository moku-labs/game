import { describe, expect, it } from "vitest";
import { createApp, defineGame, type } from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { memory } from "../../../model/store/providers/memory";
import type { Descriptor } from "../../fx/types";
import type { AnyFlow } from "../../runner/types";

// ---------------------------------------------------------------------------
// Integration (F238): a walk on a live app that ends at a popup's gate shows that popup once the
// mode is live again. The walk runs fast, so the popup handler is not called while it plays; the
// gate it rests at would otherwise wait for an answer to a popup nobody sees.
// ---------------------------------------------------------------------------

type Player = { coins: number };
type Session = { opened: number };

const { defineNode, defineFlow } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/** The daily reward popup, closed with "done". */
const reward: Descriptor = { kind: "popup", payload: { name: "Reward" }, answers: ["done"] };

/** A popup the route answers on its way, closed with "ok". */
const notice: Descriptor = { kind: "popup", payload: { name: "Notice" }, answers: ["ok"] };

/**
 * The graph: `home` rests and takes an `elapsed` post; `daily` is a transit node that shows the
 * notice, then the reward, and goes back home.
 *
 * @returns The main flow.
 */
const mainFlow = (): AnyFlow => {
  const home = defineNode({
    rest: true,
    inbox: ["elapsed"],
    outcomes: { elapsed: type(), stay: type() }
  });
  const daily = defineNode({
    outcomes: { claimed: type() },
    run: async ({ fx, out }) => {
      await fx(notice);
      await fx(reward);

      return out.claimed();
    }
  });

  return defineFlow("daily", {
    nodes: { home, daily },
    start: "home",
    edges: { home: { elapsed: "daily", stay: "home" }, daily: { claimed: "home" } }
  });
};

/**
 * Builds the game.
 *
 * @returns The app.
 */
const createGame = () =>
  createApp({
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        seed: 7,
        initialPlayer: { coins: 0 },
        initialSession: { opened: 0 }
      },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow: mainFlow() }
    }
  });

type Game = ReturnType<typeof createGame>;

/** The popups the handler was asked to show, by name, with their signals. */
type Shown = { names: unknown[]; signals: AbortSignal[] };

/**
 * Starts the game with a popup handler that records every popup it shows.
 *
 * @param game - The app.
 * @param mode - The mode the app runs in.
 * @returns What the handler was shown.
 */
const start = async (game: Game, mode: "live" | "fast"): Promise<Shown> => {
  const shown: Shown = { names: [], signals: [] };

  game.flow.setMode(mode);
  await game.start();
  game.flow.fx.handle("popup", (descriptor, { signal }) => {
    shown.names.push((descriptor.payload as { name: string }).name);
    shown.signals.push(signal);
  });
  game.flow.run().catch(() => undefined);
  await tick();

  return shown;
};

describe("flow.walk on a live app that ends at a popup's gate", () => {
  it("shows the popup it rests at, not the one the route answered on its way", async () => {
    const game = createGame();
    const shown = await start(game, "live");

    game.flow.inbox.post({ type: "elapsed" });
    const state = await game.flow.walk([{ at: "daily", intent: "ok" }]);

    expect(state).toMatchObject({ path: "daily", pending: { gate: ["done"] } });
    // The notice was answered in the walk and never shown; the reward is shown, once.
    expect(shown.names).toEqual(["Reward"]);
    expect(shown.signals[0]?.aborted).toBe(false);

    expect(game.flow.gate.answer({ intent: "done" })).toBe(true);
    await tick();

    expect(shown.signals[0]?.aborted).toBe(true);
    expect(game.flow.state()).toMatchObject({ path: "home" });

    await game.stop();
  });

  it("shows the popup a walk with no steps rests at", async () => {
    const game = createGame();
    const shown = await start(game, "live");

    game.flow.inbox.post({ type: "elapsed" });
    await game.flow.walk([]);

    // The walk rests at the notice: that popup is shown.
    expect(game.flow.state()).toMatchObject({ path: "daily", pending: { gate: ["ok"] } });
    expect(shown.names).toEqual(["Notice"]);

    await game.stop();
  });

  it("shows nothing in fast mode: a headless walk stays as it was", async () => {
    const game = createGame();
    const shown = await start(game, "fast");

    game.flow.inbox.post({ type: "elapsed" });
    const state = await game.flow.walk([{ at: "daily", intent: "ok" }]);

    expect(state).toMatchObject({ path: "daily", pending: { gate: ["done"] } });
    expect(shown.names).toEqual([]);

    await game.stop();
  });
});
