import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, screen } from "../../../../index";

// ---------------------------------------------------------------------------
// Integration: input pushes the count of its listeners into the renderer
// monitor's leak counts in a debug build (U3): the renderer cannot depend on
// input, so input registers `inputListeners` in onStart, and the renderer's
// onStop drops it. The real app, headless: the renderer is inert, stats() reads
// the counts the sample of a debug build carries.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Starts the screen set of plugins headless.
 *
 * @returns The started app.
 */
async function startScreen() {
  const app = createApp({ plugins: [...screen] });

  await app.start();

  return app;
}

describe("the inputListeners count of a debug build", () => {
  // Bug caught: input never registers its count (or registers a reader of another state), so a
  // screen that leaks an onKey listener on every visit shows nothing in sample.counts.
  it("follows app.input.listeners() in the renderer's counts, a leaked listener included", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const app = await startScreen();
    const before = app.renderer.stats().counts?.inputListeners;

    expect(before).toBe(app.input.listeners());

    app.input.onKey(() => false);

    expect(app.renderer.stats().counts?.inputListeners).toBe((before ?? 0) + 1);

    await app.stop();

    // The renderer's onStop dropped the registration: a later start registers it again.
    expect(app.renderer.stats().counts).not.toHaveProperty("inputListeners");
  });
});
