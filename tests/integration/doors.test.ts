/**
 * @file The editor doors on the mini game, headless: an e2e script loads a prepared save through
 * `/control`, taps the info button, reads through `/inspect` where the game rests, where a button
 * sits and what the player heard, and taps OK. The game runs with its screen, the fixture's own
 * files behind the assets seam and a fake audio context, unlocked by a first pointer event.
 */
import { commands, run } from "@moku-labs/game/control";
import { read, sources } from "@moku-labs/game/inspect";
import type { Repro } from "@moku-labs/game/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakeContext,
  installFakeWindow
} from "../../src/plugins/audio/__tests__/fake-audio-context";
import type { MiniGame } from "../fixtures/mini-game/game";
import { createMiniGame } from "../fixtures/mini-game/game";
import { startingSession } from "../fixtures/mini-game/state";
import { ready } from "../fixtures/mini-game/web/scenarios";
import { folderIo, frames, readManifest, startOnHome, tick, until } from "./mini-helpers";

/** What a production build throws for every `/control` command. */
const refused = "[game] Control commands run in dev builds only.";

/** The bug report an e2e script loads: the `ready` save, entered at Home, with no route. */
const repro = {
  player: ready,
  session: startingSession,
  checkpoint: "home",
  route: []
} satisfies Repro;

/**
 * Starts the game the dev page runs, on Home: a new save, the fixture's files, a fake audio
 * context and the journal of 200 sounds. A first pointer event unlocks the context, since the
 * sounds are dropped until then.
 *
 * @returns The game, resting on `home` with the Home screen laid out and its audio unlocked.
 */
async function startDevGame(): Promise<MiniGame> {
  const page = installFakeWindow();
  const context = createFakeContext();
  const app = createMiniGame({
    manifest: await readManifest(),
    io: folderIo().io,
    audio: { context: () => context, journal: 200 }
  });

  await startOnHome(app);
  page.dispatch("pointerdown");
  await tick();
  expect(app.audio.unlocked()).toBe(true);

  return app;
}

/**
 * The keys of every sound the game started, oldest first, read through `/inspect`.
 *
 * @param app - The running game.
 * @returns The keys of the audio journal.
 */
function heard(app: MiniGame): string[] {
  return read(app, sources.sounds).map(sound => sound.key);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("doors — an e2e script on the dev build", () => {
  it("restores the ready save, taps the info button and OK, and hears the popup", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = await startDevGame();

    const restored = await run(app, commands.restore, { repro });

    expect(restored.value.path).toBe("home");
    expect(restored.state).toMatchObject({ path: "home", tainted: true });
    await frames(app);

    const opened = await run(app, commands.tap, { key: "info" });

    expect(opened.value).toBe(true);
    await until(app, () => read(app, sources.position).path === "info/show");
    await frames(app);

    expect(read(app, sources.position)).toMatchObject({ flow: "infoPopup", node: "show" });

    const ok = read(app, sources.locate, { key: "infoOk" });

    expect(ok).toBeDefined();
    expect(ok?.w).toBeGreaterThan(0);
    expect(ok?.h).toBeGreaterThan(0);
    expect(heard(app)).toEqual(["ui.popup"]);
    expect(read(app, sources.sounds)).toContainEqual(
      expect.objectContaining({ key: "ui.popup", bus: "sfx", kind: "sfx" })
    );

    const answered = await run(app, commands.tap, { key: "infoOk" });

    expect(answered.value).toBe(true);
    await until(app, () => read(app, sources.position).path === "home");

    expect(app.model.store.snapshot().player).toEqual({ count: ready.count + 1 });

    await app.stop();
  });

  it("keeps the session clean for a route command and taints it with a raw one", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = await startDevGame();

    const opened = await run(app, commands.tap, { key: "info" });

    expect(opened.state.tainted).toBe(false);
    await until(app, () => read(app, sources.position).path === "info/show");
    expect([read(app, sources.tainted), read(app, sources.cheats)]).toEqual([false, []]);

    const restored = await run(app, commands.restore, { repro });

    expect(restored.state).toMatchObject({ path: "home", tainted: true });
    expect(read(app, sources.tainted)).toBe(true);
    expect(read(app, sources.cheats)).toEqual([
      { id: "game.restore", input: { repro }, frame: restored.state.frame }
    ]);

    await app.stop();
  });
});

describe("doors — the same page without the dev flag", () => {
  it("refuses every command and leaves the game and the session untouched", async () => {
    const app = await startDevGame();

    await expect(run(app, commands.tap, { key: "info" })).rejects.toThrow(refused);
    await expect(run(app, commands.restore, { repro })).rejects.toThrow(refused);
    await frames(app);

    expect(read(app, sources.position).path).toBe("home");
    expect([read(app, sources.tainted), read(app, sources.cheats)]).toEqual([false, []]);
    expect(heard(app)).toEqual([]);

    await app.stop();
  });
});
