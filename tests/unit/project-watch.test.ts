import { mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openProject } from "../../src/project";
import { diffIndexes } from "../../src/project/change";
import { openSession, syncWithDisk } from "../../src/project/session";
import type { ProjectChange, ProjectIndex } from "../../src/project/types";
import { createBatcher, createHub, type WatchFunction, watchTree } from "../../src/project/watch";

// ---------------------------------------------------------------------------
// Unit test: how the index follows the disk. The batch walk runs directly, no
// OS events: the test edits the files of a temp game and calls the walk. The
// watcher and the debounce run against a fake fs.watch and fake timers; one
// test goes through the real fs.watch of the platform.
// ---------------------------------------------------------------------------

/** The kit of the tiny game. */
const KIT = `import { defineGame } from "@moku-labs/game";

export const { defineNode, defineFlow, defineScene } = defineGame<{ player: object }>();
`;

/** A node file. */
const TOAST = `import { defineNode } from "../kit";

export const toast = defineNode({ outcomes: {} });
`;

/** The flow that names the node through `../nodes/toast`. */
const BOARD = `import { defineFlow } from "../kit";
import { toast } from "../nodes/toast";

export const boardFlow = defineFlow("board", { nodes: { toast }, start: "toast", edges: {} });
`;

/** A scene file. */
const HOME = `import { defineScene } from "../kit";

export const homeScene = defineScene("home", {});
`;

/** The temp folders of this file, removed after each test. */
const made: string[] = [];

/**
 * Write a tiny game into a fresh temp folder.
 *
 * @returns The game root.
 */
function writeGame(): string {
  const root = mkdtempSync(path.join(tmpdir(), "moku-project-watch-"));

  made.push(root);
  put(root, "kit.ts", KIT);
  put(root, "nodes/toast.ts", TOAST);
  put(root, "flows/board.ts", BOARD);
  put(root, "features/home.ts", HOME);

  return root;
}

/**
 * Write one file of a game, making its folder first.
 *
 * @param root - The game root.
 * @param file - The root-relative path.
 * @param text - The contents.
 */
function put(root: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

/**
 * An index with one anchor per key, for the diff.
 *
 * @param symbols - Key to the paths that define it.
 * @returns The index.
 */
function indexOf(symbols: Record<string, string[]>): ProjectIndex {
  return {
    schemaVersion: 1,
    revision: "r",
    symbols: Object.fromEntries(
      Object.entries(symbols).map(([key, paths]) => [
        key,
        { def: paths.map(file => ({ path: file })) }
      ])
    ),
    files: {},
    unresolved: []
  };
}

/** One watcher of the fake fs.watch: its listener, and whether it was closed. */
type FakeWatcher = { listener: (event: string, file: string | null) => void; closed: boolean };

/**
 * A fake fs.watch: records each watcher and lets the test fire its events.
 *
 * @param recursive - Whether the fake platform watches recursively.
 * @returns The watchers by folder, and the watch function.
 */
function fakeWatch(recursive: boolean): {
  watchers: Map<string, FakeWatcher>;
  watchFunction: WatchFunction;
} {
  const watchers = new Map<string, FakeWatcher>();
  const watchFunction: WatchFunction = (folder, options, listener) => {
    if (options.recursive && !recursive) throw new Error("ERR_FEATURE_UNAVAILABLE_ON_PLATFORM");

    const entry: FakeWatcher = { listener, closed: false };

    watchers.set(folder, entry);

    return {
      close: () => {
        entry.closed = true;
      },
      on: () => entry
    };
  };

  return { watchers, watchFunction };
}

afterEach(() => {
  vi.useRealTimers();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the batch walk", () => {
  it("finds nothing when nothing changed, and nothing for a save with the same bytes", async () => {
    const root = writeGame();
    const session = await openSession({ root });
    const later = new Date(Date.now() + 5000);

    expect(await syncWithDisk(session)).toBeUndefined();

    put(root, "nodes/toast.ts", TOAST);
    utimesSync(path.join(root, "nodes/toast.ts"), later, later);

    expect(await syncWithDisk(session)).toBeUndefined();
  });

  it("re-reads an edited file and reports the new revision", async () => {
    const root = writeGame();
    const session = await openSession({ root });
    const before = session.index.revision;

    put(root, "features/home.ts", `// moved down\n${HOME}`);

    const change = await syncWithDisk(session);

    expect(change).toEqual({
      revision: session.index.revision,
      files: ["features/home.ts"],
      moved: [],
      removed: []
    });
    expect(change?.revision).not.toBe(before);
  });

  it("reports a node file moved to another folder as a move, and a deleted file as removed keys", async () => {
    const root = writeGame();
    const session = await openSession({ root });

    mkdirSync(path.join(root, "nodes/board"));
    renameSync(path.join(root, "nodes/toast.ts"), path.join(root, "nodes/board/toast.ts"));
    put(root, "nodes/board/toast.ts", TOAST.replace("../kit", "../../kit"));
    put(root, "flows/board.ts", BOARD.replace("../nodes/toast", "../nodes/board/toast"));
    rmSync(path.join(root, "features/home.ts"));

    expect(await syncWithDisk(session)).toEqual({
      revision: session.index.revision,
      files: ["features/home.ts", "flows/board.ts", "nodes/board/toast.ts", "nodes/toast.ts"],
      moved: [{ key: "node:board/toast", from: "nodes/toast.ts", to: "nodes/board/toast.ts" }],
      removed: ["scene:home"]
    });
  });

  it("reports a new file and keeps the entries of a file that breaks", async () => {
    const root = writeGame();
    const session = await openSession({ root });

    put(root, "features/board.ts", HOME.replaceAll("home", "board"));
    put(root, "features/home.ts", HOME.replace("{});", "{;"));

    const change = await syncWithDisk(session);

    expect(change?.files).toEqual(["features/board.ts", "features/home.ts"]);
    expect(session.index.symbols["scene:board"]).toBeDefined();
    expect(session.index.symbols["scene:home"]).toBeDefined();
    expect(session.index.files["features/home.ts"]?.state).toBe("broken");
  });
});

describe("diffIndexes", () => {
  it("pairs the files a key left with the files it arrived in", () => {
    const before = indexOf({
      "jsx:row": ["a.tsx", "b.tsx"],
      "jsx:cell": ["a.tsx", "b.tsx"],
      "scene:home": ["home.ts"],
      "flow:x": ["x.ts"]
    });
    const after = indexOf({
      "jsx:row": ["b.tsx", "c.tsx"],
      "jsx:cell": ["c.tsx"],
      "scene:home": ["home.ts", "again.ts"]
    });
    const change: ProjectChange = diffIndexes(before, { ...after, revision: "s" }, [
      "x.ts",
      "a.tsx"
    ]);

    expect(change).toEqual({
      revision: "s",
      files: ["a.tsx", "x.ts"],
      moved: [
        { key: "jsx:row", from: "a.tsx", to: "c.tsx" },
        { key: "jsx:cell", from: "a.tsx", to: "c.tsx" }
      ],
      removed: ["flow:x"]
    });
  });
});

describe("watchTree", () => {
  it("watches the root recursively and ignores events in skipped folders", () => {
    const { watchers, watchFunction } = fakeWatch(true);
    const onEvent = vi.fn();
    const tree = watchTree("/game", onEvent, watchFunction);

    tree.rearm(["", "nodes"]);
    watchers.get("/game")?.listener("rename", "nodes/merge.ts");
    watchers.get("/game")?.listener("rename", "node_modules/pkg/index.ts");
    // eslint-disable-next-line unicorn/no-null -- fs.watch passes null when the platform names no file
    watchers.get("/game")?.listener("change", null);

    expect([...watchers.keys()]).toEqual(["/game"]);
    expect(onEvent).toHaveBeenCalledTimes(2);

    tree.close();

    expect(watchers.get("/game")?.closed).toBe(true);
  });

  it("falls back to one watcher per folder, re-armed on every walk", () => {
    const { watchers, watchFunction } = fakeWatch(false);
    const onEvent = vi.fn();
    const tree = watchTree("/game", onEvent, watchFunction);

    tree.rearm(["", "nodes", "flows"]);

    expect([...watchers.keys()]).toEqual(["/game", "/game/nodes", "/game/flows"]);

    tree.rearm(["", "flows", "features"]);
    watchers.get("/game/features")?.listener("rename", "home.ts");

    expect(watchers.get("/game/nodes")?.closed).toBe(true);
    expect(watchers.get("/game/flows")?.closed).toBe(false);
    expect(onEvent).toHaveBeenCalledTimes(1);

    tree.close();

    expect([...watchers.values()].every(entry => entry.closed)).toBe(true);
  });
});

describe("createBatcher", () => {
  it("runs once after a quiet period, however many events came", async () => {
    vi.useFakeTimers();

    const run = vi.fn(() => Promise.resolve());
    const batcher = createBatcher(75, run);

    batcher.poke();
    await vi.advanceTimersByTimeAsync(50);
    batcher.poke();
    await vi.advanceTimersByTimeAsync(50);

    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs a batch during an endless burst once the longest wait is over", async () => {
    vi.useFakeTimers();

    const run = vi.fn(() => Promise.resolve());
    const batcher = createBatcher(75, run);

    for (let tick = 0; tick < 30; tick += 1) {
      batcher.poke();
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(run).toHaveBeenCalledTimes(1);
    batcher.cancel();
  });

  it("queues one more batch for events that came while a batch ran", async () => {
    vi.useFakeTimers();

    const releases: (() => void)[] = [];
    const run = vi.fn(
      () =>
        new Promise<void>(resolve => {
          releases.push(resolve);
        })
    );
    const batcher = createBatcher(10, run);

    batcher.poke();
    await vi.advanceTimersByTimeAsync(10);
    batcher.poke();
    await vi.advanceTimersByTimeAsync(10);

    expect(run).toHaveBeenCalledTimes(1);

    releases.shift()?.();
    await vi.advanceTimersByTimeAsync(10);

    expect(run).toHaveBeenCalledTimes(2);

    releases.shift()?.();
    batcher.cancel();
  });
});

describe("createHub", () => {
  it("finds a write the platform watcher never reported: a walk at start, then the backstop", async () => {
    const root = writeGame();
    const session = await openSession({ root });
    const silent: WatchFunction = () => ({ close: () => root, on: () => root });
    const hub = createHub(session, 10, silent, 100);
    const listener = vi.fn();

    put(root, "features/home.ts", `// before watch\n${HOME}`);
    hub.add(listener);

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1), { timeout: 3000 });

    put(root, "features/home.ts", `// after the first walk\n${HOME}`);

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2), { timeout: 3000 });

    hub.close();

    expect(listener.mock.calls.map(call => call[1].files)).toEqual([
      ["features/home.ts"],
      ["features/home.ts"]
    ]);
  });

  it("stops the watcher with the last caller and starts it again with the next", async () => {
    const root = writeGame();
    const session = await openSession({ root });
    const { watchers, watchFunction } = fakeWatch(true);
    const hub = createHub(session, 10, watchFunction, 100);
    const stop = hub.add(vi.fn());

    stop();

    expect(watchers.get(session.root)?.closed).toBe(true);

    hub.add(vi.fn());

    expect(watchers.get(session.root)?.closed).toBe(false);
    hub.close();
  });
});

describe("ProjectApi.watch", () => {
  it("calls every caller once per batch, stops one caller, and closes", {
    timeout: 20_000
  }, async () => {
    const root = writeGame();
    const project = await openProject({ root, debounceMs: 20 });
    const first = vi.fn();
    const second = vi.fn(() => {
      throw new Error("a broken caller");
    });

    const stopFirst = project.watch(first);

    project.watch(second);
    put(root, "features/home.ts", `// one line down\n${HOME}`);

    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1), { timeout: 8000 });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first.mock.calls[0]?.[1]).toMatchObject({ files: ["features/home.ts"] });

    stopFirst();
    put(root, "features/home.ts", `// two lines down\n\n${HOME}`);

    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(2), { timeout: 8000 });

    expect(first).toHaveBeenCalledTimes(1);

    project.close();

    expect(() => project.watch(first)).toThrow("[game] The project is closed.");
  });
});
