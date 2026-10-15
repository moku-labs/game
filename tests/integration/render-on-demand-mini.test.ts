/**
 * @file Root integration — the mini game drawn on demand (spec 14 T2): Home at rest draws
 * nothing for two seconds; the info button opens the popup with its spark burst and the honey
 * glow, the popup closes, and Home rests again. Every view kind of the fixture is drawn by the
 * real renderer over Pixi's own objects (sprites, nine-slices, shapes, text, filters, particles),
 * and the tree oracle checks every frame: a frame skipped over a changed picture fails the test.
 */
import { readFile } from "node:fs/promises";
import type { Assets } from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homeFeature } from "../fixtures/mini-game/features/home";
import { infoFeature } from "../fixtures/mini-game/features/info";
import { mainFlow } from "../fixtures/mini-game/flows/main";
import { startingPlayer, startingSession } from "../fixtures/mini-game/state";
import { diskIo, openPage, type Watched, watch } from "./drawn-helpers";

/** The folder of the fixture: the manifest's paths start from it. */
const MINI = new URL("../fixtures/mini-game/", import.meta.url);

/** Two seconds of the loop at 62.5 frames a second. */
const TWO_SECONDS = 125;

/**
 * The mini game as `index.ts` defines it, with the renderer drawing on demand.
 *
 * @returns The game.
 */
function onDemandGame() {
  return defineGameApp({
    flow: mainFlow,
    safeNode: "home",
    player: startingPlayer,
    session: startingSession,
    features: [homeFeature, infoFeature],
    pluginConfigs: { log: { mode: "test" }, renderer: { onDemand: true } }
  });
}

/** The screen app of the mini game. */
type App = ReturnType<ReturnType<typeof onDemandGame>["screen"]>["app"];

const running: Array<{ app: App; watched: Watched }> = [];

afterEach(async () => {
  for (const { app, watched } of running.splice(0)) {
    watched.oracle.expectNoMissedFrame();
    watched.oracle.expectPicturesCurrent();
    await app.stop();
  }

  vi.unstubAllGlobals();
});

/**
 * Runs frames until a condition holds.
 *
 * @param watched - The frame driver.
 * @param done - The condition.
 * @param limit - The most frames.
 */
async function until(watched: Watched, done: () => boolean, limit = 300): Promise<void> {
  for (let frame = 0; frame < limit && !done(); frame += 1) await watched.frames(1);

  if (!done()) throw new Error(`the mini game did not get there in ${limit} frames`);
}

/**
 * Starts the mini game drawn on demand, in a dev build, and lets Home come to rest.
 *
 * @returns The app and its frame driver.
 */
async function startOnHome(): Promise<{ app: App; watched: Watched }> {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);

  const page = openPage(1080, 1920);
  const manifest = JSON.parse(
    await readFile(new URL("generated/manifest.json", MINI), "utf8")
  ) as Assets.Manifest;
  const { app } = onDemandGame().screen({
    manifest,
    io: diskIo(MINI, manifest),
    renderer: page.renderer
  });

  await app.start();
  app.flow.run().catch(() => undefined);

  const watched = watch(app, page);
  const started = { app, watched };

  running.push(started);
  await until(watched, () => app.flow.state().path === "home" && app.renderer.host.ready());
  await watched.frames(60);

  return started;
}

describe("the mini game drawn on demand", () => {
  it("draws nothing on Home at rest for two seconds, though its button glows", async () => {
    const { app, watched } = await startOnHome();

    expect(await watched.frames(TWO_SECONDS)).toBe(0);
    expect(app.renderer.stats().drawn).toBe(0);
    expect(app.effects.stats().filters).toBe(1);
  });

  it("draws the popup with its spark burst, closes it, and rests on Home again", async () => {
    const { app, watched } = await startOnHome();

    expect(app.input.tap(app.ui.find("info") ?? 0)).toBe(true);
    await until(watched, () => app.flow.state().path === "info/show");

    const opening = await watched.each(10);

    // The popup comes in and the sparks fly: those frames are drawn.
    expect(opening.filter(Boolean).length).toBeGreaterThan(0);

    await until(watched, () => app.effects.stats().particles === 0);
    expect(app.input.tap(app.ui.find("infoOk") ?? 0)).toBe(true);
    await until(watched, () => app.flow.state().path === "home");
    await watched.frames(60);

    expect(await watched.frames(TWO_SECONDS)).toBe(0);
  });
});
