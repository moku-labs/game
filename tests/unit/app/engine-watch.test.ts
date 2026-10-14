/**
 * @file The engine watch of `moku-game dev` on a fake install in a temp folder: what it watches,
 * the batch after 300 ms of quiet, restart against patch-only, the watchers opened again, the
 * unreadable engine, `close()`, and the warning lines. The fingerprint itself is spec 10's
 * (`engine.test.ts`).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { engineFingerprint } from "../../../src/app/engine";
import {
  type EngineChange,
  type EngineSeams,
  engineChangeLines,
  watchEngineAt
} from "../../../src/app/engine-watch";

/** The temp folders of a test, removed after it. */
const made: string[] = [];

/** A fake install: the game folder, the engine folder and its hot plugin. */
type Install = { root: string; engine: string; hot: string; patch: string };

/** What the stub seams saw, and the switch that makes the resolver throw. */
type Seen = {
  watches: { file: string; listener: (event: string) => void; closed: boolean }[];
  refuse: string | undefined;
};

/**
 * Writes a file, making its folder first.
 *
 * @param file - The absolute path.
 * @param text - The text.
 */
function put(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * Makes a game with an installed engine 0.14.12, a declared patch and a lock file.
 *
 * @returns The paths of the install.
 */
function makeInstall(): Install {
  const root = mkdtempSync(path.join(tmpdir(), "moku-engine-watch-"));
  const engine = path.join(root, "node_modules", "@moku-labs", "game");
  const patch = path.join(root, "patches", "game.patch");

  made.push(root);
  put(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "g",
      patchedDependencies: { "@moku-labs/game@0.14.12": "patches/game.patch" }
    })
  );
  put(patch, "one\n");
  put(path.join(root, "bun.lock"), "{}\n");
  put(
    path.join(engine, "package.json"),
    JSON.stringify({ name: "@moku-labs/game", version: "0.14.12" })
  );
  put(path.join(engine, "dist", "hot.mjs"), "export default 1;\n");
  put(path.join(engine, "dist", "app", "x.mjs"), "export {};\n");

  return { root, engine, hot: path.join(engine, "dist", "hot.mjs"), patch };
}

/**
 * Makes the stub seams: a watch that records its listeners, a resolver that answers the hot plugin.
 *
 * @param hot - The path the resolver answers.
 * @returns The seams and what they saw.
 */
function fakeSeams(hot: string): { seams: EngineSeams; seen: Seen } {
  const seen: Seen = { watches: [], refuse: undefined };
  const seams: EngineSeams = {
    watch: (file, listener) => {
      const watched = { file, listener, closed: false };

      seen.watches.push(watched);

      return {
        close: () => {
          watched.closed = true;
        }
      };
    },
    resolve: () => {
      if (seen.refuse !== undefined) throw new Error(seen.refuse);

      return hot;
    }
  };

  return { seams, seen };
}

/**
 * Starts the watch of an install.
 *
 * @param install - The install.
 * @returns The watch, its changes, its errors and what the seams saw.
 */
function startWatch(install: Install) {
  const { seams, seen } = fakeSeams(install.hot);
  const changes: EngineChange[] = [];
  const errors: string[] = [];
  const start = engineFingerprint(install.root, install.hot);
  const watcher = watchEngineAt(
    install.root,
    start,
    seams,
    change => changes.push(change),
    message => errors.push(message)
  );

  return { start, watcher, changes, errors, seen };
}

/**
 * Fires an event at the first open watcher.
 *
 * @param seen - What the seams saw.
 */
function poke(seen: Seen): void {
  seen.watches.find(watched => !watched.closed)?.listener("change");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("watchEngineAt", () => {
  it("an engine resolved to its sources, or an unidentified one, opens no watcher", () => {
    const { seams, seen } = fakeSeams("/e/src/hot.ts");
    const folder = "/e";

    watchEngineAt("/g", { id: "0.0.0+src", version: "0.0.0", dist: "src", folder }, seams, vi.fn());
    watchEngineAt(
      "/g",
      { id: "unknown", version: "unknown", dist: "unknown", folder },
      seams,
      vi.fn()
    );

    expect(seen.watches).toEqual([]);
  });

  it("watches the scope, the engine, every dist folder, the patch folder, the package.json and the lock", () => {
    const install = makeInstall();
    const { seen } = startWatch(install);

    expect(seen.watches.map(watched => watched.file).toSorted()).toEqual(
      [
        path.dirname(install.engine),
        install.engine,
        path.join(install.engine, "dist"),
        path.join(install.engine, "dist", "app"),
        path.dirname(install.patch),
        path.join(install.root, "package.json"),
        path.join(install.root, "bun.lock")
      ].toSorted()
    );
  });

  it("a dist change seen by a watcher calls onChange with restart true after 300 ms of quiet, once for a burst of events", async () => {
    const install = makeInstall();
    const { start, changes, seen } = startWatch(install);

    put(install.hot, "export default 2;\n");
    poke(seen);
    await vi.advanceTimersByTimeAsync(200);
    poke(seen);
    await vi.advanceTimersByTimeAsync(299);

    expect(changes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);

    expect(changes).toEqual([
      { before: start, after: engineFingerprint(install.root, install.hot), restart: true }
    ]);
  });

  it("a version change of the same dist restarts too", async () => {
    const install = makeInstall();
    const { changes, seen } = startWatch(install);

    put(
      path.join(install.engine, "package.json"),
      JSON.stringify({ name: "@moku-labs/game", version: "0.14.13" })
    );
    poke(seen);
    await vi.advanceTimersByTimeAsync(300);

    expect(changes.map(change => [change.after.version, change.restart])).toEqual([
      ["0.14.13", true]
    ]);
  });

  it("a patch-only change calls onChange with restart false, and an event with nothing changed calls nothing", async () => {
    const install = makeInstall();
    const { start, changes, seen } = startWatch(install);

    poke(seen);
    await vi.advanceTimersByTimeAsync(300);

    expect(changes).toEqual([]);

    put(install.patch, "two\n");
    poke(seen);
    await vi.advanceTimersByTimeAsync(300);

    expect(changes).toHaveLength(1);
    expect(changes[0]?.restart).toBe(false);
    expect(changes[0]?.before).toEqual(start);
    expect(changes[0]?.after.patch?.hash).not.toBe(start.patch?.hash);
  });

  it("every watcher is closed and opened again after a batch, a new dist folder with them", async () => {
    const install = makeInstall();
    const { seen } = startWatch(install);
    const first = seen.watches.length;

    put(path.join(install.engine, "dist", "web", "y.mjs"), "export {};\n");
    poke(seen);
    await vi.advanceTimersByTimeAsync(300);

    const opened = seen.watches.slice(first);

    expect(seen.watches.slice(0, first).every(watched => watched.closed)).toBe(true);
    expect(opened.every(watched => !watched.closed)).toBe(true);
    expect(opened.map(watched => watched.file)).toContain(path.join(install.engine, "dist", "web"));
  });

  it("an engine that cannot be resolved during a batch goes to onError and the next event checks again", async () => {
    const install = makeInstall();
    const { changes, errors, seen } = startWatch(install);

    seen.refuse = "Cannot find module";
    put(install.hot, "export default 2;\n");
    poke(seen);
    await vi.advanceTimersByTimeAsync(300);

    expect(errors).toEqual([
      "[game] dev: the engine cannot be read (Cannot find module). Waiting for the next change."
    ]);
    expect(changes).toEqual([]);

    seen.refuse = undefined;
    poke(seen);
    await vi.advanceTimersByTimeAsync(300);

    expect(changes.map(change => change.restart)).toEqual([true]);
  });

  it("close stops the batcher: an event after close calls nothing", async () => {
    const install = makeInstall();
    const { watcher, changes, seen } = startWatch(install);
    const listeners = seen.watches.map(watched => watched.listener);

    put(install.hot, "export default 2;\n");
    listeners[0]?.("change");
    watcher.close();
    listeners[1]?.("change");
    await vi.advanceTimersByTimeAsync(1000);

    expect(changes).toEqual([]);
    expect(seen.watches.every(watched => watched.closed)).toBe(true);
  });
});

describe("engineChangeLines", () => {
  /** The engine before the change. */
  const before = { id: "0.14.12+1a2b3c", version: "0.14.12", dist: "1a2b3c", folder: "/e" };

  it("a version change adds the line about this process's tools; a dist change of the same version does not", () => {
    const rebuilt = { ...before, id: "0.14.12+9c41e0", dist: "9c41e0" };
    const bumped = { ...before, id: "0.14.13+77d0aa", version: "0.14.13", dist: "77d0aa" };

    expect(engineChangeLines({ before, after: rebuilt, restart: true })).toEqual([
      "[game] dev: the engine changed (0.14.12+1a2b3c -> 0.14.12+9c41e0), restarting the dev server."
    ]);
    expect(engineChangeLines({ before, after: bumped, restart: true })).toEqual([
      "[game] dev: the engine changed (0.14.12+1a2b3c -> 0.14.13+77d0aa), restarting the dev server.",
      "  This process keeps the tools of 0.14.12 (the keys watch); restart moku-game dev to use 0.14.13's."
    ]);
  });

  it("a patch-only change asks for bun install, with none for an absent patch", () => {
    const patched = { ...before, patch: { file: "/g/p.patch", hash: "3f2a7b0000" } };

    expect(engineChangeLines({ before, after: patched, restart: false })).toEqual([
      "[game] dev: the engine's patch changed (none -> 3f2a7b), but the installed engine did not.",
      "  Run bun install; the dev server restarts by itself when the engine changes."
    ]);
  });
});
