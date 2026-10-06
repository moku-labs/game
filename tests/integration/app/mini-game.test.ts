/**
 * @file The mini game in the layout of a game: `index.ts` is one `defineGameApp` object,
 * `config.ts` plain data, `tests/scenarios/ready.ts` a prepared save. Headless it runs its logic
 * to Home; on the screen it starts on the inert renderer, its art read from the fixture folder.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../../src/app/config";
import { startMoment } from "../../../src/app/define";
import type { Platform } from "../../../src/index";
import { createHeadless } from "../../../src/testing";
import config from "../../fixtures/mini-game/config";
import game from "../../fixtures/mini-game/index";
import ready from "../../fixtures/mini-game/tests/scenarios/ready";
import { folderIo, readManifest, startOnHome } from "../mini-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Removes nothing: the remover of a subscription that holds nothing. */
const removeNothing = (): void => undefined;

/**
 * A platform provider that records what the platform plugin asks of it.
 *
 * @returns The provider and the record.
 */
function recordingPlatform(): { provider: Platform.PlatformProvider; asked: string[] } {
  const asked: string[] = [];
  const provider: Platform.PlatformProvider = {
    onPause: () => removeNothing,
    onResume: () => removeNothing,
    onBack: () => removeNothing,
    haptic: kind => asked.push(`haptic:${kind}`),
    keepAwake: on => asked.push(`keepAwake:${on}`),
    exit: () => asked.push("exit")
  };

  return { provider, asked };
}

describe("the mini game, defined in two files", () => {
  it("the mini game runs headless from its definition to its first rest node", async () => {
    const { app, clock, provider } = game.headless();
    const run = await createHeadless(app);

    expect(run.state().path).toBe("home");
    expect(app.model.store.snapshot().player).toEqual({ count: 0 });
    expect(app.model.store.snapshot().rng.seed).toBe(42);
    expect(clock.now()).toBe(startMoment);
    // A new player: the graph loads the save and commits the new player at once.
    expect(provider.calls.map(call => call.method)).toEqual(["load", "commit"]);
    expect(app.has("renderer")).toBe(false);
    expect(app.has("info")).toBe(true);
    expect(app.has("home")).toBe(false);
    await run.stop();
  });

  it("the headless game starts from a scenario's player", async () => {
    const { app } = game.headless({ seed: 7, player: ready(startMoment).player });
    const run = await createHeadless(app);

    expect(run.state().path).toBe("home");
    expect(app.model.store.snapshot().player).toEqual({ count: 3 });
    expect(app.model.store.snapshot().rng.seed).toBe(7);
    await run.stop();
  });

  it("the mini game's screen app starts on the inert renderer and reaches home", async () => {
    const { app } = game.screen({ manifest: await readManifest(), io: folderIo().io });

    await startOnHome(app);
    expect(app.flow.state().path).toBe("home");
    expect(app.assets.isLoaded("ui")).toBe(true);
    expect(app.renderer.host.kind()).toBe("none");
    expect(app.platform.back()).toBe("none");
    await app.stop();
  });

  it("the screen app hands the platform seam the Back press and keeps the screen on", async () => {
    const { provider, asked } = recordingPlatform();
    const { app } = game.screen({
      manifest: await readManifest(),
      io: folderIo().io,
      platform: provider,
      keepAwake: true
    });

    await startOnHome(app);
    expect(asked).toEqual(["keepAwake:true"]);
    expect(app.platform.back()).toBe("exit");
    expect(asked).toEqual(["keepAwake:true", "exit"]);
    await app.stop();
    expect(asked.at(-1)).toBe("keepAwake:false");
  });

  it("config.ts is a page title, every other field a default", () => {
    expect(resolveConfig(config).page).toMatchObject({ title: "mini-game", lang: "en" });
    expect(resolveConfig(config).save).toBe("memory");
  });
});
