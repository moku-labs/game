import { describe, expect, it } from "vitest";
import { lookupTexture } from "../../api";
import { enforceBudget } from "../../budget";
import { createHandlers } from "../../handlers";
import { loadBundle } from "../../tiers";
import type { Manifest } from "../../types";
import type { MockAssets } from "./mock-assets";
import { createMockAssets, manifestOf } from "./mock-assets";

// F184: the budget evicted bundles a view draws. The unload invalidated the keys, the views asked again, the miss
// loaded the bundle back and its own budget pass evicted the other drawn one: an endless evict/reload (iOS killed the
// page at 2 GB), or one magenta placeholder for a tiny drawn lazy bundle; on the A26 Pixi logged a texture destroyed
// while still bound to a shader.

/** The warning of a budget pass that found nothing it may unload. */
const OVER = "assets: over the texture budget with nothing to unload";

/**
 * Gives the bundles of a manifest the sizes a test needs.
 *
 * @param manifest - A manifest of `manifestOf`.
 * @param sizes - Bundle name to its megabytes.
 * @returns A copy with those bundles resized.
 */
function sized(manifest: Manifest, sizes: Record<string, number>): Manifest {
  const bundles = Object.entries(manifest.bundles).map(([name, entry]) => [
    name,
    { ...entry, mb: sizes[name] ?? entry.mb }
  ]);

  return { ...manifest, bundles: Object.fromEntries(bundles) as Manifest["bundles"] };
}

/**
 * Lets every running load settle: the fake io answers at once, so one macrotask is enough.
 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Runs frames of the renderer as a view sees them: a drawn key that was invalidated since the last frame asks the
 * provider again, and the loads it starts settle before the next frame.
 *
 * @param mock - The mock plugin.
 * @param count - How many frames.
 */
async function frames(mock: MockAssets, count: number): Promise<void> {
  let seen = mock.renderer.invalidated.length;

  for (let frame = 0; frame < count; frame += 1) {
    const fresh = mock.renderer.invalidated.slice(seen).flat();

    seen = mock.renderer.invalidated.length;

    for (const key of new Set(fresh)) {
      if (mock.renderer.drawn.has(key)) lookupTexture(mock.assetsCtx, key);
    }

    await settle();
  }
}

/**
 * The names of the bundles the plugin loaded, in order, one per `assets:bundle-loaded`.
 *
 * @param mock - The mock plugin.
 * @returns The bundle names.
 */
function loads(mock: MockAssets): string[] {
  return mock.emitted
    .filter(entry => entry.name === "assets:bundle-loaded")
    .map(entry => (entry.payload as { bundle: string }).bundle);
}

/**
 * The bundles the budget unloaded, in order.
 *
 * @param mock - The mock plugin.
 * @returns The bundle names.
 */
function budgetUnloads(mock: MockAssets): string[] {
  return mock.emitted
    .filter(
      entry =>
        entry.name === "assets:bundle-unloaded" &&
        (entry.payload as { reason: string }).reason === "budget"
    )
    .map(entry => (entry.payload as { bundle: string }).bundle);
}

/**
 * How many times the plugin warned one message.
 *
 * @param mock - The mock plugin.
 * @param message - The message.
 * @returns The count.
 */
function warnings(mock: MockAssets, message: string): number {
  return (mock.log.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
    call => call[0] === message
  ).length;
}

/** Two `budget` bundles that do not fit together: 46 + 11 MB against 50. */
const pair = sized(
  manifestOf({
    alpha: { feature: "alpha", tier: "lazy", keys: ["alpha.bg"] },
    beta: { feature: "beta", tier: "lazy", keys: ["beta.bg"] }
  }),
  { alpha: 46, beta: 11 }
);

describe("T1: two drawn bundles that do not fit together", () => {
  // Bug: the budget evicted the other drawn bundle on every load, its view asked again: an endless evict/reload.
  it("load once each, never evict each other, and warn once", async () => {
    const mock = createMockAssets({ manifest: pair, textureBudgetMb: 50 });

    await mock.start();
    mock.renderer.drawn = new Set(["alpha.bg", "beta.bg"]);
    await loadBundle(mock.assetsCtx, "alpha", undefined, "request");

    // A view of beta asks for its art.
    lookupTexture(mock.assetsCtx, "beta.bg");
    await frames(mock, 12);

    expect(loads(mock)).toEqual(["alpha", "beta"]);
    expect(budgetUnloads(mock)).toEqual([]);
    expect(mock.api.isLoaded("alpha")).toBe(true);
    expect(mock.api.isLoaded("beta")).toBe(true);
    expect(warnings(mock, OVER)).toBe(1);
  });
});

/** A one-file lazy bundle a view draws, an undrawn spare, and the board whose load overfills 12.5 MB. */
const rewards = sized(
  manifestOf({
    rewards: { feature: "ui", tier: "lazy", keys: ["ui.rewards.x"] },
    spare: { feature: "spare", tier: "lazy", keys: ["spare.bg"] },
    board: { feature: "board", tier: "lazy", keys: ["board.bg"] }
  }),
  { rewards: 1, spare: 2, board: 10 }
);

describe("T2: a drawn one-file lazy bundle and another load", () => {
  // Bug: `ui.rewards.x` was the least recently used, so the board's load evicted it: one magenta placeholder.
  it("keeps the drawn bundle and evicts the undrawn one instead", async () => {
    const mock = createMockAssets({ manifest: rewards, textureBudgetMb: 12.5 });

    await mock.start();
    mock.renderer.drawn = new Set(["ui.rewards.x"]);
    await loadBundle(mock.assetsCtx, "rewards", undefined, "request");
    await loadBundle(mock.assetsCtx, "spare", undefined, "request");
    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    expect(budgetUnloads(mock)).toEqual(["spare"]);
    expect(mock.api.isLoaded("rewards")).toBe(true);
    expect(mock.api.isLoaded("board")).toBe(true);
  });

  it("keeps the drawn bundle and warns when nothing undrawn may go", async () => {
    const mock = createMockAssets({ manifest: rewards, textureBudgetMb: 10.5 });

    await mock.start();
    mock.renderer.drawn = new Set(["ui.rewards.x"]);
    await loadBundle(mock.assetsCtx, "rewards", undefined, "request");
    await loadBundle(mock.assetsCtx, "board", undefined, "request");

    expect(budgetUnloads(mock)).toEqual([]);
    expect(mock.api.isLoaded("rewards")).toBe(true);
    expect(warnings(mock, OVER)).toBe(1);
  });
});

describe("T5: the budget never destroys a texture a view draws", () => {
  // Bug: on the A26 Pixi logged "a 'textureSource' was destroyed while still bound to a shader" at 249.5/250 MB.
  it("destroys none of the drawn keys' textures over budget", async () => {
    const mock = createMockAssets({ manifest: pair, textureBudgetMb: 60 });

    await mock.start();
    await loadBundle(mock.assetsCtx, "alpha", undefined, "request");
    await loadBundle(mock.assetsCtx, "beta", undefined, "request");

    const drawnTexture = mock.ctx.state.records.get("alpha")?.textures.get("alpha.bg");

    mock.renderer.drawn = new Set(["alpha.bg"]);
    mock.config.textureBudgetMb = 47;
    enforceBudget(mock.assetsCtx);

    expect(drawnTexture).toBeDefined();
    expect(mock.io.destroyed).not.toContain(drawnTexture);
    expect(mock.api.isLoaded("beta")).toBe(false);
  });
});

/** The warning of the loop guard. */
const ASKED = "assets: a view asked again for a bundle the budget unloaded";

/**
 * Starts the pair against 50 MB with nothing drawn that `renderer` tracks, and lets beta's load evict alpha.
 *
 * @returns The mock, alpha unloaded by the budget and beta loaded.
 */
async function alphaEvicted(): Promise<MockAssets> {
  const mock = createMockAssets({ manifest: pair, textureBudgetMb: 50, preloadDepth: 0 });

  await mock.start();
  await loadBundle(mock.assetsCtx, "alpha", undefined, "request");
  await loadBundle(mock.assetsCtx, "beta", undefined, "request");

  return mock;
}

/**
 * Announces a rest node to the plugin, as `flow` does.
 *
 * @param mock - The mock plugin.
 */
function rest(mock: MockAssets): void {
  createHandlers(mock.ctx)["flow:rest"]({ path: "main/alpha", checkpoint: false });
}

describe("T3: the loop guard of a consumer renderer does not track", () => {
  // Bug: a particle or a filter input draws a key `used` cannot see: the evict/reload loop came back through it.
  it("holds a bundle asked again right after its budget unload, past a rest, and warns once", async () => {
    const mock = await alphaEvicted();

    expect(budgetUnloads(mock)).toEqual(["alpha"]);

    lookupTexture(mock.assetsCtx, "alpha.bg");
    lookupTexture(mock.assetsCtx, "alpha.bg");
    await settle();

    // alpha's own pass evicted beta; alpha is held from now on, also once a rest cleared the marks.
    expect(budgetUnloads(mock)).toEqual(["alpha", "beta"]);
    mock.config.textureBudgetMb = 40;
    rest(mock);

    expect(mock.api.isLoaded("alpha")).toBe(true);
    expect(warnings(mock, OVER)).toBe(1);
    expect(warnings(mock, ASKED)).toBe(1);
    expect(mock.log.warn).toHaveBeenCalledWith(ASKED, { bundle: "alpha", budgetMb: 50 });
  });

  it("ends the hold at an unload call, and warns once per bundle for the whole session", async () => {
    const mock = await alphaEvicted();

    lookupTexture(mock.assetsCtx, "alpha.bg");
    await settle();
    mock.api.unload("alpha");
    await mock.api.load("alpha");
    await mock.api.load("beta");

    // No longer held: beta's pass evicts alpha again, and asked again it is held without a second line.
    expect(budgetUnloads(mock)).toEqual(["alpha", "beta", "alpha"]);

    lookupTexture(mock.assetsCtx, "alpha.bg");
    await settle();

    expect(budgetUnloads(mock)).toEqual(["alpha", "beta", "alpha", "beta"]);
    expect(warnings(mock, ASKED)).toBe(1);
  });

  it("does not hold a bundle asked again only after a rest followed its budget unload", async () => {
    const mock = await alphaEvicted();

    rest(mock);
    lookupTexture(mock.assetsCtx, "alpha.bg");
    await settle();
    // Not held: the next pass over budget may take it.
    mock.config.textureBudgetMb = 40;
    enforceBudget(mock.assetsCtx);

    expect(budgetUnloads(mock)).toEqual(["alpha", "beta", "alpha"]);
    expect(warnings(mock, ASKED)).toBe(0);
  });
});

/** Four 1 MB bundles: `drawn` is the oldest and a view draws it. */
const four = sized(
  manifestOf({
    drawn: { feature: "drawn", tier: "lazy", keys: ["drawn.bg"] },
    first: { feature: "first", tier: "lazy", keys: ["first.bg"] },
    second: { feature: "second", tier: "lazy", keys: ["second.bg"] },
    third: { feature: "third", tier: "lazy", keys: ["third.bg"] }
  }),
  { drawn: 1, first: 1, second: 1, third: 1 }
);

describe("T4: an undrawn bundle still leaves in LRU order", () => {
  // Bug: the drawn check skips every bundle, or breaks the order of the ones left.
  it("evicts the undrawn bundles oldest first and keeps the drawn one", async () => {
    const mock = createMockAssets({ manifest: four, textureBudgetMb: 10 });

    await mock.start();
    mock.renderer.drawn = new Set(["drawn.bg"]);

    for (const name of ["drawn", "first", "second", "third"]) {
      await loadBundle(mock.assetsCtx, name, undefined, "request");
    }

    mock.config.textureBudgetMb = 2.5;
    enforceBudget(mock.assetsCtx);

    expect(budgetUnloads(mock)).toEqual(["first", "second"]);
    expect(mock.api.isLoaded("drawn")).toBe(true);
  });
});

describe("T6: a load is never undone by its own budget pass", () => {
  // Bug: every older bundle drawn, the pass picked the bundle it was started for: a load that unloaded itself.
  it("keeps the new undrawn bundle and warns over budget", async () => {
    const mock = createMockAssets({ manifest: rewards, textureBudgetMb: 12.5 });

    await mock.start();
    mock.renderer.drawn = new Set(["ui.rewards.x", "spare.bg"]);
    await mock.api.load("rewards");
    await mock.api.load("spare");
    await mock.api.load("board");

    expect(mock.api.isLoaded("board")).toBe(true);
    expect(budgetUnloads(mock)).toEqual([]);
    expect(warnings(mock, OVER)).toBe(1);
    expect(warnings(mock, ASKED)).toBe(0);
  });
});
