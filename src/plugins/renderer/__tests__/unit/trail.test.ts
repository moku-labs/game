import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDeps } from "../../lifecycle";
import {
  CUT_KEY,
  readCutRuns,
  startTrail,
  TRAIL_EVERY_MS,
  TRAIL_KEY,
  type TrailRecord
} from "../../trail";
import type { PixiTexture } from "../../types";
import { FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// F175: iOS ends the page's WebContent in the middle of play and the game starts again at the splash with nothing
// that says why. The renderer keeps a trail of the run in localStorage, and the next start reports a run that ended
// without pagehide.
// ---------------------------------------------------------------------------

/* eslint-disable unicorn/no-null -- `Storage` answers a missing key with null. */

/** A `localStorage` over a map; `failing` makes every write throw, as a full or refused storage does. */
function memoryStorage(): Storage & { items: Map<string, string>; failing: boolean } {
  const items = new Map<string, string>();
  const storage = {
    items,
    failing: false,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storage.failing) throw new Error("QuotaExceededError");
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size;
    }
  };

  return storage;
}

/** A kept trail of a run before this one. */
function lastRun(state: TrailRecord["state"], path = "ward/idle"): TrailRecord {
  return {
    startedAt: 1_790_000_000_000,
    at: 1_790_000_100_000,
    uptimeS: 100,
    state,
    path,
    paths: [{ path, atS: 40 }],
    kind: "webgpu",
    textureMb: 410.5,
    heapMb: undefined,
    fps: 59.5,
    uploadFrames: 3,
    writes: 50
  };
}

let storage: ReturnType<typeof memoryStorage>;

/** What the page clock (`performance.now()`) answers, ms. */
let pageMs = 0;

/** The trail the storage holds now. */
function trail(): TrailRecord {
  const text = storage.items.get(TRAIL_KEY);

  if (text === undefined) throw new Error("no trail was written");

  return JSON.parse(text) as TrailRecord;
}

/** Starts a mock renderer at a wall clock, with the storage in place. */
async function started(now = 1_790_000_200_000): Promise<MockRenderer> {
  const mock = createMockRenderer();

  mock.setNow(now);
  await mock.start();

  return mock;
}

beforeEach(() => {
  vi.useFakeTimers();
  storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
  pageMs = 0;
  vi.spyOn(globalThis.performance, "now").mockImplementation(() => pageMs);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the report of the run before (F175)", () => {
  // Bug: a kill in play leaves no line, so a restart at the splash cannot be explained.
  it("warns about a run that ended visible and keeps it among the cut runs", async () => {
    storage.items.set(TRAIL_KEY, JSON.stringify(lastRun("visible", "memory/m3")));

    const mock = await started();

    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer:run-cut-short",
      expect.objectContaining({ state: "visible", path: "memory/m3", textureMb: 410.5 })
    );
    expect(readCutRuns().map(run => run.path)).toEqual(["memory/m3"]);
    mock.stop();
  });

  // Bug: a background reclaim reads as a crash in play.
  it("reports a run that ended hidden as an info line, not a warning", async () => {
    storage.items.set(TRAIL_KEY, JSON.stringify(lastRun("hidden")));

    const mock = await started();

    expect(mock.log.warn).not.toHaveBeenCalledWith("renderer:run-cut-short", expect.anything());
    expect(mock.log.info).toHaveBeenCalledWith(
      "renderer:run-cut-short",
      expect.objectContaining({ state: "hidden" })
    );
    expect(readCutRuns()).toHaveLength(1);
    mock.stop();
  });

  // Bug: every start after a clean exit claims a cut run; a broken record throws or is reported.
  it.each([
    ["a run that closed", JSON.stringify(lastRun("closed"))],
    ["no record", undefined],
    ["text that is not JSON", "{not json"],
    ["a record without its fields", '{"at":1}'],
    ["a record with an unknown state", JSON.stringify({ ...lastRun("visible"), state: "gone" })]
  ])("reports nothing after %s", async (_name, kept) => {
    if (kept !== undefined) storage.items.set(TRAIL_KEY, kept);

    const mock = await started();

    mock.stop();
    expect(mock.log.warn).not.toHaveBeenCalledWith("renderer:run-cut-short", expect.anything());
    expect(mock.log.info).not.toHaveBeenCalledWith("renderer:run-cut-short", expect.anything());
    expect(storage.items.has(CUT_KEY)).toBe(false);
  });

  // Bug: the list of cut runs grows without end in the page's storage.
  it("keeps the newest ten cut runs", async () => {
    const kept = Array.from({ length: 10 }, (_, index) => lastRun("visible", `old/${index}`));

    storage.items.set(CUT_KEY, JSON.stringify(kept));
    storage.items.set(TRAIL_KEY, JSON.stringify(lastRun("visible", "new/one")));

    const mock = await started();
    const paths = readCutRuns().map(run => run.path);

    expect(paths).toHaveLength(10);
    expect(paths[0]).toBe("old/1");
    expect(paths.at(-1)).toBe("new/one");
    mock.stop();
  });
});

describe("the trail of this run (F175)", () => {
  // Bug: a kill before the first timer write leaves the record of the run before, reported twice; or the record
  // never names the backend.
  it("writes a visible trail at once on start, over the run before, and again once the application is up", async () => {
    storage.items.set(TRAIL_KEY, JSON.stringify(lastRun("visible")));

    const mock = await started(1_790_000_200_000);
    const record = trail();

    expect(record).toMatchObject({
      startedAt: 1_790_000_200_000,
      state: "visible",
      path: "home",
      kind: "webgpu",
      writes: 2
    });
    mock.stop();
  });

  // Bug: a page that starts hidden (opened in the background) and is reclaimed reads as a kill in play.
  it("starts hidden when the document is hidden", async () => {
    const mock = createMockRenderer();

    if (mock.dom === undefined) throw new Error("the fake dom is missing");
    mock.dom.document.hidden = true;
    await mock.start();

    expect(trail().state).toBe("hidden");
    mock.stop();
  });

  // Bug: the record goes stale (the timer never runs) or the counters carry over between windows.
  it("writes every 2 s with the drawn frames per second and the frames that uploaded", async () => {
    const mock = await started(1_000_000);

    for (let frame = 0; frame < 120; frame += 1) mock.drawFrame();

    mock.setNow(1_000_000 + TRAIL_EVERY_MS);
    pageMs = TRAIL_EVERY_MS;
    vi.advanceTimersByTime(TRAIL_EVERY_MS);

    expect(mock.drawnCount()).toBe(120);
    expect(trail()).toMatchObject({ at: 1_002_000, fps: 60, uploadFrames: 0, writes: 3 });

    mock.setNow(1_000_000 + 2 * TRAIL_EVERY_MS);
    pageMs = 2 * TRAIL_EVERY_MS;
    vi.advanceTimersByTime(TRAIL_EVERY_MS);

    expect(trail()).toMatchObject({ at: 1_004_000, fps: 0, writes: 4 });

    // Three textures at one upload a drawn frame: three frames that uploaded.
    const textures = Array.from(
      { length: 3 },
      () =>
        new FakeTexture({
          source: { width: 64, height: 64, destroyed: false }
        }) as unknown as PixiTexture
    );

    const uploading = mock.api.sync.textures.upload(textures);
    for (let frame = 0; frame < 6; frame += 1) mock.drawFrame();
    mock.setNow(1_000_000 + 3 * TRAIL_EVERY_MS);
    pageMs = 3 * TRAIL_EVERY_MS;
    vi.advanceTimersByTime(TRAIL_EVERY_MS);

    expect(trail()).toMatchObject({ fps: 3, uploadFrames: 3 });
    await expect(uploading).resolves.toBe(true);
    mock.stop();
  });

  // Bug: a frozen or moved game clock (dev control) reads as 0 fps: the span is taken from the page clock.
  it("takes the frames per second from the page clock, whatever the game clock does", async () => {
    const mock = await started(1_000_000);

    for (let frame = 0; frame < 60; frame += 1) mock.drawFrame();

    pageMs = TRAIL_EVERY_MS;
    vi.advanceTimersByTime(TRAIL_EVERY_MS);

    expect(trail().fps).toBe(30);
    mock.stop();
  });

  // Bug: a kill right after a scene change shows the scene before it; or the write runs inside the emit.
  it("writes a new rest path in the next page task, once, and keeps the last eight", async () => {
    const mock = await started();

    mock.setPath("board/awaitIntent");
    mock.hooks["flow:rest"]({ path: "board/awaitIntent", checkpoint: false });

    expect(trail().writes).toBe(2);
    vi.advanceTimersByTime(1);
    expect(trail()).toMatchObject({ path: "board/awaitIntent", writes: 3 });

    mock.hooks["flow:rest"]({ path: "board/awaitIntent", checkpoint: false });
    vi.advanceTimersByTime(1);
    expect(trail().writes).toBe(3);

    for (let index = 0; index < 10; index += 1) {
      mock.hooks["flow:rest"]({ path: `ward/step-${index}`, checkpoint: false });
    }

    vi.advanceTimersByTime(1);
    expect(trail().writes).toBe(4);

    const paths = trail().paths.map(entry => entry.path);

    expect(paths).toHaveLength(8);
    expect(paths.at(-1)).toBe("ward/step-9");
    mock.stop();
  });

  // Bug: a hidden page is reclaimed by iOS and the next start warns about a kill in play.
  it("follows the page: hidden, visible, closed on pagehide, visible again on a pageshow from the cache", async () => {
    const mock = await started();
    const dom = mock.dom;

    if (dom === undefined) throw new Error("the fake dom is missing");

    dom.document.hidden = true;
    dom.document.dispatch("visibilitychange");
    expect(trail().state).toBe("hidden");

    dom.document.hidden = false;
    dom.document.dispatch("visibilitychange");
    expect(trail().state).toBe("visible");

    dom.window.dispatch("pagehide", { persisted: true });
    expect(trail().state).toBe("closed");

    dom.window.dispatch("pageshow", { persisted: false });
    expect(trail().state).toBe("closed");

    dom.window.dispatch("pageshow", { persisted: true });
    expect(trail().state).toBe("visible");
    mock.stop();
  });

  // Bug: a clean stop leaves "visible", so the next start reports a kill that never happened; or the timer survives.
  it("writes closed on stop, then neither the timer nor the page writes again", async () => {
    const mock = await started();

    mock.stop();

    const writes = trail().writes;

    expect(trail().state).toBe("closed");

    vi.advanceTimersByTime(10 * TRAIL_EVERY_MS);
    mock.dom?.document.dispatch("visibilitychange");
    mock.dom?.window.dispatch("pagehide", { persisted: false });
    mock.dom?.window.dispatch("pageshow", { persisted: true });
    mock.hooks["flow:rest"]({ path: "elsewhere", checkpoint: false });
    vi.advanceTimersByTime(1);

    expect(trail()).toMatchObject({ state: "closed", writes });
  });

  // Bug: a rest path written after the stop calls the stopped plugins and turns the closed record visible.
  it("drops a rest write still waiting for its task when the renderer stops", async () => {
    const mock = await started();

    mock.hooks["flow:rest"]({ path: "ward/idle", checkpoint: false });
    mock.stop();

    const writes = trail().writes;

    vi.advanceTimersByTime(1);
    expect(trail()).toMatchObject({ state: "closed", writes });
  });

  // Bug: a second start doubles the timer and the listeners, or reports the run it just began as cut short.
  it("starts once", async () => {
    const mock = await started();
    const timers = vi.getTimerCount();

    startTrail(withDeps(mock.ctx));

    expect(vi.getTimerCount()).toBe(timers);
    expect(mock.log.warn).not.toHaveBeenCalledWith("renderer:run-cut-short", expect.anything());
    mock.stop();
  });

  // Bug: an inert renderer (no mount) keeps a timer and writes empty records.
  it("starts nothing on a renderer with no mount", async () => {
    const mock = createMockRenderer({ config: { mount: undefined } });

    await mock.start();

    expect(vi.getTimerCount()).toBe(0);
    expect(storage.items.has(TRAIL_KEY)).toBe(false);
    mock.stop();
  });

  // Bug: a page without storage keeps a timer for nothing; a refusing storage breaks the start or the frame.
  it("starts nothing without a storage, and runs on when the storage refuses writes", async () => {
    vi.stubGlobal("localStorage", undefined);

    const bare = await started();

    expect(vi.getTimerCount()).toBe(0);
    bare.stop();

    vi.stubGlobal("localStorage", storage);
    storage.failing = true;

    const mock = await started();

    expect(() => {
      mock.drawFrame();
      vi.advanceTimersByTime(TRAIL_EVERY_MS);
    }).not.toThrow();
    expect(storage.items.has(TRAIL_KEY)).toBe(false);
    mock.stop();
  });
});
