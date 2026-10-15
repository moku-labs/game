import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, exit, type } from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { createRngView } from "../../../model/rng/api";
import { memory } from "../../../model/store/providers/memory";
import { saveExportCommand, saveImportCommand } from "../../control";
import { run } from "../../doors/run";
import { createHeadless } from "../../headless";

// ---------------------------------------------------------------------------
// Integration: game.saveImport over the real time, model and flow plugins
// ---------------------------------------------------------------------------

type Player = { coins: number };
type Session = { boots: number; roll: number };

const { defineNode, defineFlow } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** The transit start: counts the boot and draws from the rng, as a game's boot reads the page. */
const boot = defineNode({
  outcomes: { done: type() },
  run: ({ session, rng, out }) => {
    session.boots += 1;
    session.roll = rng.stream("dice").range(1, 1_000_000);
    return out.done();
  }
});

const home = defineNode({ outcomes: { tap: type() }, rest: true, checkpoint: true });

const tapped = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.coins += 1;
    return out.done();
  }
});

/** A main flow that starts at the transit node "boot" and comes to rest at "home". */
const bootFirst = defineFlow("main", {
  nodes: { boot, home, tapped },
  start: "boot",
  edges: { boot: { done: "home" }, home: { tap: "tapped" }, tapped: { done: "home" } }
});

/** A main flow that starts at the rest node "home". */
const homeFirst = defineFlow("main", {
  nodes: { home, tapped },
  start: "home",
  outcomes: { left: type() },
  edges: { home: { tap: "tapped" }, tapped: { done: exit("left") } }
});

/**
 * Creates a game over a memory store.
 *
 * @param mainFlow - The main flow of the game.
 * @param seed - The seed of a new save.
 * @returns The app, not started.
 */
const createSaveGame = (mainFlow: typeof bootFirst | typeof homeFirst, seed: number) =>
  createApp({
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        seed,
        initialPlayer: { coins: 0 },
        initialSession: { boots: 0, roll: 0 }
      },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow }
    }
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("game.saveImport over a real app", () => {
  it("plays a transit start again on the imported trees and rests where a fresh start rests", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    // The store app: booted with seed 7, two taps of progress.
    const store = createSaveGame(bootFirst, 7);
    const storeGame = await createHeadless(store);

    await storeGame.walk([
      { at: "home", intent: "tap" },
      { at: "home", intent: "tap" }
    ]);

    const { value: exported } = await run(store, saveExportCommand, {});

    // The debug app: its own save, seed 99, one boot of its own.
    const debug = createSaveGame(bootFirst, 99);
    const debugGame = await createHeadless(debug);
    const ran = await run(debug, saveImportCommand, { save: exported });

    expect(ran.value).toEqual({ restored: true });
    expect(ran.state).toMatchObject({ path: "home", tainted: true });
    expect(debug.model.store.snapshot().player).toEqual({ coins: 2 });
    // "boot" ran once more, on the imported session.
    expect(debug.model.store.snapshot().session).toMatchObject({ boots: 2 });

    // "boot" drew from the imported rng, not from the debug app's own seed 99.
    const imported = structuredClone(exported.rng);
    const roll = createRngView(imported).stream("dice").range(1, 1_000_000);

    expect(debug.model.store.snapshot().session).toEqual({ boots: 2, roll });
    expect(debug.model.store.snapshot().rng).toEqual(imported);
    // The gate of "home" is open when the command answers: the next tap is taken at once.
    expect(debug.flow.gate.answer({ intent: "tap" })).toBe(true);

    await debugGame.stop();
    await storeGame.stop();
  });

  it("restores a save at a rest start and answers once its gate is open", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const debug = createSaveGame(homeFirst, 99);
    const game = await createHeadless(debug);

    // A scene preload of "home" that takes a macrotask: the gate opens after the restore entered it.
    debug.flow.onEnter("load", () => new Promise(resolve => setTimeout(resolve, 0)));

    const save = {
      player: { coins: 40 },
      session: { boots: 3, roll: 12 },
      rng: { seed: 42, streams: { dice: 5 } }
    };
    const ran = await run(debug, saveImportCommand, { save });

    expect(ran.state).toMatchObject({ path: "home", tainted: true });
    expect(debug.model.store.snapshot()).toMatchObject(save);
    expect(debug.flow.gate.answer({ intent: "tap" })).toBe(true);

    await game.stop();
  });
});
