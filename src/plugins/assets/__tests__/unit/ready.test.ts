import { describe, expect, it } from "vitest";
import { ready } from "../../bundles";
import { createMockAssets, type MockAssets, manifestOf, packedManifest } from "./mock-assets";

const manifest = manifestOf({
  board: { feature: "board", tier: "scene", keys: ["board.cell", "board.item"] },
  ui: { feature: "ui", tier: "scene", keys: ["ui.panel"] }
});

/** Where the fake io serves the one file of the bundle "ui". */
const PANEL = "/features/ui/assets/panel.png";

/**
 * Starts the mock plugin, connected.
 *
 * @param options - Config overrides.
 * @returns The started mock.
 */
async function started(options: Parameters<typeof createMockAssets>[0] = {}): Promise<MockAssets> {
  const mock = createMockAssets({ manifest, ...options });

  mock.connect();
  await mock.start();

  return mock;
}

/**
 * Runs the `ready` handler the plugin registered, as a live node's `fx(ready(bundles))` does.
 *
 * @param mock - The started mock.
 * @param bundles - The bundles the node names.
 * @returns What the handler answered.
 */
function askReady(mock: MockAssets, bundles: string | readonly string[]): unknown {
  return mock.flow.handlers
    .get("ready")
    ?.run(ready(bundles), { signal: new AbortController().signal, mode: "live" });
}

/**
 * Holds the next upload of the fake renderer until the test answers it.
 *
 * @param mock - The mock plugin.
 * @returns The answer switch.
 */
function holdUpload(mock: MockAssets): { answer: (ok: boolean) => void } {
  const held = { answer: (_ok: boolean): void => undefined };

  mock.renderer.upload.mockImplementationOnce(
    () =>
      new Promise<boolean>(resolve => {
        held.answer = resolve;
      })
  );

  return held;
}

/**
 * Lets every queued microtask run.
 *
 * @returns A promise that resolves after the queue drained.
 */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe("the ready effect (F52)", () => {
  // Bug: a bundle already on the GPU is uploaded again or posts `ready`, so the node rests for nothing.
  it("answers true at once for a loaded and warmed bundle, and posts nothing", async () => {
    const mock = await started();

    await mock.api.warm("board");
    mock.renderer.upload.mockClear();

    expect(askReady(mock, "board")).toBe(true);

    await tick();

    expect(mock.flow.posted).toEqual([]);
    expect(mock.renderer.upload).not.toHaveBeenCalled();
  });

  // Bug: a bundle the preload brought counts as ready, and the scene shows its textures cold (55 ms on the A26).
  it("answers false for a loaded bundle that was never warmed, and posts one ready after its upload", async () => {
    const mock = await started();

    await mock.api.load("board");

    const upload = holdUpload(mock);

    expect(askReady(mock, "board")).toBe(false);

    await tick();

    expect(mock.renderer.upload).toHaveBeenCalledOnce();
    expect(mock.flow.posted).toEqual([]);

    upload.answer(true);
    await tick();

    expect(mock.flow.posted).toEqual([{ type: "ready" }]);
    expect(askReady(mock, "board")).toBe(true);
  });

  // Bug: nothing starts the load and the node rests forever, or `ready` comes per bundle and the node asks too early.
  it("loads the bundles that are not loaded and posts one ready after the last of them", async () => {
    const mock = await started();

    mock.io.control.gated = true;

    expect(askReady(mock, ["board", "ui"])).toBe(false);

    await tick();
    mock.io.release(url => url.includes("/board/"));
    await tick();

    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.flow.posted).toEqual([]);

    mock.io.release(url => url.includes("/ui/"));
    await tick();

    expect(mock.flow.posted).toEqual([{ type: "ready" }]);
    expect(askReady(mock, ["board", "ui"])).toBe(true);
  });

  // Bug: a broken file rests the node on its bundle forever.
  it("counts a bundle whose load failed as there until a later load of it succeeds", async () => {
    const mock = await started();

    mock.io.status.set(PANEL, 404);

    expect(askReady(mock, "ui")).toBe(false);

    await tick();

    expect(mock.flow.posted).toEqual([{ type: "ready" }]);
    expect(mock.log.warn).toHaveBeenCalledWith("assets:ready-failed", {
      bundle: "ui",
      error: expect.stringContaining('bundle "ui" failed at "features/ui/assets/panel.png" (404)')
    });
    expect(askReady(mock, "ui")).toBe(true);

    // The file is back: a load succeeds, and the bundle has to be warmed before it is there again.
    mock.io.status.delete(PANEL);
    await mock.api.load("ui");

    expect(askReady(mock, "ui")).toBe(false);

    await tick();

    // The failed warm was forgotten, so this one uploads instead of joining the failure.
    expect(mock.renderer.upload).toHaveBeenCalledOnce();
    expect(askReady(mock, "ui")).toBe(true);
  });

  // Bug: an unload during the load marks the bundle failed, and the next `ready` lets the scene show without it.
  it("posts ready after an aborted load and does not count the bundle as there", async () => {
    const mock = await started();

    mock.io.control.gated = true;

    expect(askReady(mock, "board")).toBe(false);

    await tick();
    mock.api.unload("board");
    await tick();

    expect(mock.flow.posted).toEqual([{ type: "ready" }]);
    expect(mock.log.warn).not.toHaveBeenCalledWith("assets:ready-failed", expect.anything());
    expect(askReady(mock, "board")).toBe(false);
  });

  // Bug: a headless game checks names it never loads, or makes its transit node wait for a load that never runs.
  it("answers true headless, before any name check", async () => {
    const mock = await started({ io: undefined });

    expect(askReady(mock, ["board", "bord"])).toBe(true);
    expect(mock.flow.posted).toEqual([]);
  });

  // Bug: a misspelt bundle answers false and the node waits for a ready that never comes.
  it("throws the error of load for a bundle the manifest lacks", async () => {
    const mock = await started();

    expect(() => askReady(mock, ["board", "bord"])).toThrow('no bundle "bord" in the manifest');
    expect(mock.renderer.upload).not.toHaveBeenCalled();
  });
});

describe("assets.warm (F60)", () => {
  // Bug: the atlas pages are left out, so a packed bundle still uploads its pages in the show frame.
  it("loads a bundle that is not loaded, then hands every texture and page of it to the upload", async () => {
    const mock = createMockAssets({ manifest: packedManifest() });

    mock.connect();
    await mock.start();
    await mock.api.warm("ui");

    expect(mock.api.isLoaded("ui")).toBe(true);
    expect(mock.renderer.upload).toHaveBeenCalledOnce();
    expect(new Set(mock.renderer.upload.mock.calls[0]?.[0])).toEqual(
      new Set([...mock.io.created, ...mock.io.sliced])
    );
  });

  // Bug: the node's `ready` and the game's own `warm` queue the same bundle twice, or warm resolves before the upload.
  it("joins a running warm and a finished one: one upload, every caller resolved after it", async () => {
    const mock = await started();
    const upload = holdUpload(mock);
    const resolved: string[] = [];

    const first = mock.api.warm("board").then(() => resolved.push("first"));
    const second = mock.api.warm("board").then(() => resolved.push("second"));

    await tick();

    expect(resolved).toEqual([]);

    upload.answer(true);
    await Promise.all([first, second]);
    await mock.api.warm("board");

    expect(resolved).toEqual(["first", "second"]);
    expect(mock.renderer.upload).toHaveBeenCalledOnce();
  });

  // Bug: a warm outlives the unload, so a reloaded bundle is never uploaded before its show frame.
  it("warms again after the bundle was unloaded", async () => {
    const mock = await started();

    await mock.api.warm("board");
    mock.api.unload("board");

    expect(askReady(mock, "board")).toBe(false);

    await mock.api.warm("board");

    expect(mock.api.isLoaded("board")).toBe(true);
    expect(mock.renderer.upload).toHaveBeenCalledTimes(2);
  });

  // Bug: a renderer that cannot upload (no device, `uploads: 0`) makes warm reject, and the node never moves on.
  it("resolves when the upload answered false, and the bundle counts as ready", async () => {
    const mock = await started();

    mock.renderer.upload.mockResolvedValueOnce(false);

    await expect(mock.api.warm("board")).resolves.toBeUndefined();
    expect(askReady(mock, "board")).toBe(true);
  });

  // Bug: a misspelt bundle resolves, and the scene shows placeholders with no word why.
  it("rejects a bundle the manifest lacks, as load does", async () => {
    const mock = await started();

    await expect(mock.api.warm("bord")).rejects.toThrow('no bundle "bord" in the manifest');
  });

  // Bug: a headless game's warm waits on a renderer that never draws.
  it("resolves at once headless and hands nothing to the renderer", async () => {
    const mock = await started({ io: undefined });

    await expect(mock.api.warm("board")).resolves.toBeUndefined();
    expect(mock.renderer.upload).not.toHaveBeenCalled();
  });
});
