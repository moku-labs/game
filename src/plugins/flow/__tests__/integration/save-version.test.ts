import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, type } from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { memory } from "../../../model/store/providers/memory";
import type { Json } from "../../../model/types";
import { saveExportCommand, saveImportCommand } from "../../control";
import { run } from "../../doors/run";
import { createHeadless } from "../../headless";

// ---------------------------------------------------------------------------
// Integration: game.saveExport carries the save schema version and
// game.saveImport migrates an older export, or refuses one it cannot read (F207).
// ---------------------------------------------------------------------------

const { defineNode, defineFlow } = defineGame<{
  player: { coins: number };
  session: Record<string, never>;
  assets: string;
  strings: Record<string, unknown>;
}>();

const home = defineNode({ outcomes: { tap: type() }, rest: true, checkpoint: true });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  edges: { home: { tap: "home" } }
});

/** Schema 2 renames the `gold` of schema 1 to `coins`. */
const renameGold = {
  from: 1,
  up: (state: Json): Json => {
    const doc = state as { player: { gold: number } };

    return { ...(state as object), player: { coins: doc.player.gold } } as Json;
  }
};

/**
 * Creates a game on one save schema.
 *
 * @param schemaVersion - The schema this build writes.
 * @param initialPlayer - The player of a new save.
 * @returns The app, not started.
 */
const createVersionGame = (schemaVersion: number, initialPlayer: Json) =>
  createApp({
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        seed: 7,
        initialPlayer: initialPlayer as never,
        schemaVersion,
        migrations: [renameGold]
      },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow: main }
    }
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F207: the save export carries its schema version", () => {
  // Bug: an export of schema 1 lands in a schema-2 build as it is, and the game reads `coins` of undefined.
  it("migrates an export of an older schema through the game's chain", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const older = createVersionGame(1, { gold: 5 });
    const olderGame = await createHeadless(older);
    const { value: exported } = await run(older, saveExportCommand, {});

    await olderGame.stop();
    expect(exported).toMatchObject({ version: 1 });

    const newer = createVersionGame(2, { coins: 0 });
    const game = await createHeadless(newer);

    await run(newer, saveImportCommand, { save: exported as unknown as Json });

    expect(newer.model.store.snapshot().player).toEqual({ coins: 5 });
    await game.stop();
  });

  // Bug: an export of a newer build lands unread, or breaks the running game.
  it("refuses an export of a newer schema with a clear error and keeps the state", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createVersionGame(2, { coins: 4 });
    const game = await createHeadless(app);
    const save = { player: { coins: 9 }, session: {}, rng: { seed: 1, streams: {} }, version: 3 };

    await expect(run(app, saveImportCommand, { save })).rejects.toThrow(/version 3/);
    expect(app.model.store.snapshot().player).toEqual({ coins: 4 });
    // The game still runs: the gate of home takes the next tap.
    expect(app.flow.gate.answer({ intent: "tap" })).toBe(true);
    await game.stop();
  });

  // Bug: a version that is not a whole number is taken as the current one.
  it("refuses an export whose version is not a whole number", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createVersionGame(2, { coins: 4 });
    const game = await createHeadless(app);
    const save = { player: { coins: 9 }, session: {}, rng: { seed: 1, streams: {} }, version: "2" };

    await expect(run(app, saveImportCommand, { save })).rejects.toThrow("game.saveImport");
    expect(app.model.store.snapshot().player).toEqual({ coins: 4 });
    await game.stop();
  });

  it("imports an export without a version as this build's schema, as before", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createVersionGame(2, { coins: 0 });
    const game = await createHeadless(app);
    const save = { player: { coins: 3 }, session: {}, rng: { seed: 1, streams: {} } };

    await run(app, saveImportCommand, { save });

    expect(app.model.store.snapshot().player).toEqual({ coins: 3 });
    await game.stop();
  });
});
