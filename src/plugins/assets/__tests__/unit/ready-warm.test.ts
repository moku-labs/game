import { describe, expect, it } from "vitest";
import { ready } from "../../bundles";
import { READY_WARM_CAP_MS } from "../../ready";
import { createMockAssets, type MockAssets, manifestOf } from "./mock-assets";

// ---------------------------------------------------------------------------
// Unit (spec 33, slice F, F202, W5): the `ready` effect waits for the warm view the world builds aside. While
// `world.projection.left()` is finite a `ready` answers `false`, and its post waits until the build ended, at most
// `READY_WARM_CAP_MS` of game clock after the bundles settled; the system `assets.ready` (phase `sync`) posts it.
// ---------------------------------------------------------------------------

const manifest = manifestOf({
  board: { feature: "board", tier: "scene", keys: ["board.cell", "board.item"] }
});

/** A finite `left()`: a warm view is in work. */
const BUILDING = 3;

/**
 * Starts the mock plugin, connected.
 *
 * @returns The started mock.
 */
async function started(): Promise<MockAssets> {
  const mock = createMockAssets({ manifest });

  mock.connect();
  await mock.start();

  return mock;
}

/**
 * Runs the `ready` handler the plugin registered, as a node's `fx(ready(bundles))` does.
 *
 * @param mock - The started mock.
 * @param mode - The node's mode.
 * @returns What the handler answered.
 */
function askReady(mock: MockAssets, mode: "live" | "fast" = "live"): unknown {
  return mock.flow.handlers
    .get("ready")
    ?.run(ready("board"), { signal: new AbortController().signal, mode });
}

/**
 * Lets every queued microtask run.
 *
 * @returns A promise that resolves after the queue drained.
 */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe("the ready effect waits for a warm view in work (F202)", () => {
  // Bug: the open motion of a gated window starts while its view is still built aside: the swap lands mid-build and
  // the frame of the open is long (A26: worst 35–59 ms against 28–37 with the wait).
  it("answers false while a warm view is in work and posts once the build ended", async () => {
    const mock = await started();

    await mock.api.warm("board");
    mock.world.left = BUILDING;

    expect(askReady(mock)).toBe(false);

    mock.world.sync(0);
    mock.world.sync(16);

    expect(mock.flow.posted).toEqual([]);

    mock.world.left = Number.POSITIVE_INFINITY;
    mock.world.sync(32);

    expect(mock.flow.posted).toEqual([{ type: "ready" }]);
    expect(askReady(mock)).toBe(true);
  });

  // Bug: a build that never ends (a record stuck in work) holds the window shut for good; or the capped post repeats
  // every frame, or the re-ask answers false again and the node never moves on.
  it("posts at the cap with the build still in work, answers the re-ask true, and posts once", async () => {
    const mock = await started();

    await mock.api.warm("board");
    mock.world.left = BUILDING;

    expect(askReady(mock)).toBe(false);

    mock.world.sync(1000);
    mock.world.sync(1000 + READY_WARM_CAP_MS - 1);

    expect(mock.flow.posted).toEqual([]);

    mock.world.sync(1000 + READY_WARM_CAP_MS);

    expect(mock.flow.posted).toEqual([{ type: "ready" }]);
    expect(askReady(mock)).toBe(true);

    mock.world.sync(1000 + READY_WARM_CAP_MS + 16);
    mock.world.sync(1000 + 3 * READY_WARM_CAP_MS);

    expect(mock.flow.posted).toHaveLength(1);

    // The build ends: the next one is waited for again.
    mock.world.left = Number.POSITIVE_INFINITY;
    mock.world.sync(1000 + 3 * READY_WARM_CAP_MS + 16);
    mock.world.left = BUILDING;

    expect(askReady(mock)).toBe(false);
  });

  // Bug: a record discarded while the bundles of the open still load (a pause, a scene build, a restore) leaves the
  // `ready` waiting for the cap, or posts it before the bundles are there.
  it("posts in the frame after the build ended when it waited for the bundles and the build", async () => {
    const mock = await started();

    mock.io.control.gated = true;
    mock.world.left = BUILDING;

    expect(askReady(mock)).toBe(false);

    await tick();
    mock.io.release(() => true);
    await tick();

    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.flow.posted).toEqual([]);

    mock.world.sync(0);
    mock.world.left = Number.POSITIVE_INFINITY;
    mock.world.sync(16);

    expect(mock.flow.posted).toEqual([{ type: "ready" }]);
  });

  // Bug: a fast walk (a restore's replay) rests on a warm build a world that is not live never runs.
  it("waits for no warm view in fast mode", async () => {
    const mock = await started();

    await mock.api.warm("board");
    mock.world.left = BUILDING;

    expect(askReady(mock, "fast")).toBe(true);
  });
});
