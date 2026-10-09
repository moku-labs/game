/**
 * @file `watchKeysAt`, the watch behind `moku-game dev` and the editor's `watchKeys`, over stub
 * seams: a stub scan, a fake `fs.watch` the test fires, and a temp game folder with real files.
 * The quiet period runs on fake timers; the walk reads the real disk. A batch that scanned asks
 * for one trailing batch, so a test that counts timers lets it pass first. Most tests use the fake
 * platform without recursive watching: the end of a batch re-arms the folder watchers, so a folder
 * made before an event tells the test that the batch of that event ended.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keysArguments } from "../../src/app/build";
import { resolveConfig } from "../../src/app/config";
import {
  type KeysSeams,
  type KeysUi,
  type KeysWatcher,
  type WatchKeysOptions,
  watchKeysAt
} from "../../src/app/keys";
import type { WatchFunction } from "../../src/project/watch";

/** The quiet period that closes a batch: the spec names 100 ms. */
const QUIET_MS = 100;

/** How long a test waits for a batch before it fails. */
const WAIT = { timeout: 5000, interval: 5 } as const;

/** The real timer, kept before a test fakes `setTimeout`. */
const realSetTimeout = setTimeout;

/** The config of the temp game: a title, every other field a default. */
const SETTINGS = resolveConfig({ page: { title: "t" } });

/** The files of the temp game: one image and one string file that is not English. */
const BASE: Readonly<Record<string, string>> = {
  "features/ui/assets/dot.png": "png",
  "features/home/strings/ru.json": "{}\n"
};

/** The image of the temp game. */
const DOT = "features/ui/assets/dot.png";

/** The string file of the temp game. */
const RUSSIAN = "features/home/strings/ru.json";

/** What the stub scan prints on every call, as the real scanner prints its lines. */
const SCANNER_LINES = ["info scanned", "warn a note", "line a line"];

/** One watcher of the fake fs.watch: its listener and whether it was closed. */
type FakeWatcher = {
  listener: (event: string, file: string | null) => void;
  closed: boolean;
};

/** What the stub scan does on one call: it may print through the console it was handed. */
type ScanStep = (ui: KeysUi) => Promise<number> | number;

/** What the stub seams saw. */
type Seen = {
  /** The arguments of every scan, in order. */
  scans: string[][];
  /** Every line of the real console, with its kind first. */
  printed: string[];
  /** How many scans ran at the same time, at the most. */
  most: number;
};

/** The stub seams of one watch. */
type Stubs = {
  seams: KeysSeams;
  seen: Seen;
  watchers: Map<string, FakeWatcher>;
};

/** A started watch on a temp game. */
type Game = Stubs & { root: string; keys: KeysWatcher };

/** The temp folders of a test, removed after it. */
const made: string[] = [];

/** The watches of a test, closed after it. */
const opened: KeysWatcher[] = [];

/**
 * Writes one file of a game, making its folder first.
 *
 * @param root - The game folder.
 * @param file - The root-relative path.
 * @param text - The contents.
 */
function put(root: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

/**
 * Makes a temp game folder, its path real: the temp folder of macOS is a symlink.
 *
 * @param files - Files by root-relative path, besides the base ones.
 * @returns The game folder.
 */
function makeGame(files: Readonly<Record<string, string>> = {}): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "moku-game-keys-")));

  made.push(root);
  for (const [file, text] of Object.entries({ ...BASE, ...files })) put(root, file, text);

  return root;
}

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

/**
 * The scan of a game that is fine: it prints the three kinds of line and answers 0.
 *
 * @param ui - The console the scan was handed.
 * @returns The exit code `0`.
 */
function passes(ui: KeysUi): number {
  ui.info("scanned");
  ui.warn("a note");
  ui.line("a line");

  return 0;
}

/**
 * A scan that fails as the real scanner does: it prints its errors and answers 1.
 *
 * @param messages - The error lines.
 * @returns The step.
 */
function fails(...messages: string[]): ScanStep {
  return ui => {
    for (const message of messages) ui.error(message);

    return 1;
  };
}

/**
 * An `onError` of a caller that breaks: a batch has to survive it.
 *
 * @throws {Error} Always.
 */
function brokenLog(): never {
  throw new Error("the log of the editor is gone");
}

/**
 * A scan that runs until the test lets it end.
 *
 * @returns The step, and the function that ends it.
 */
function held(): { step: ScanStep; release: () => void } {
  const gate: { release: () => void } = { release: () => undefined };
  const waiting = new Promise<void>(resolve => {
    gate.release = resolve;
  });

  return { step: ui => waiting.then(() => passes(ui)), release: () => gate.release() };
}

/**
 * Makes the stub seams of a watch.
 *
 * @param recursive - Whether the fake platform watches recursively.
 * @param steps - What the scan does, by call number from 0. A call without a step passes.
 * @returns The seams and what they saw.
 */
function stubSeams(recursive: boolean, steps: Readonly<Record<number, ScanStep>> = {}): Stubs {
  const seen: Seen = { scans: [], printed: [], most: 0 };
  const { watchers, watchFunction } = fakeWatch(recursive);
  let active = 0;
  const seams: KeysSeams = {
    scan: async (argv, ui) => {
      const step = steps[seen.scans.length] ?? passes;

      seen.scans.push(argv);
      active += 1;
      seen.most = Math.max(seen.most, active);

      try {
        return await step(ui);
      } finally {
        active -= 1;
      }
    },
    watch: watchFunction,
    ui: {
      info: message => seen.printed.push(`info ${message}`),
      warn: message => seen.printed.push(`warn ${message}`),
      line: (text = "") => seen.printed.push(`line ${text}`),
      error: message => seen.printed.push(`error ${message}`)
    }
  };

  return { seams, seen, watchers };
}

/** How a test starts its watch. */
type Start = {
  /** True for a fake platform with recursive watching. */
  recursive?: boolean;
  /** What the scan does, by call number from 0. */
  steps?: Readonly<Record<number, ScanStep>>;
  /** Files of the game besides the base ones. */
  files?: Readonly<Record<string, string>>;
  /** The options of the watch. */
  options?: WatchKeysOptions;
};

/**
 * Starts a watch on a fresh temp game, over stub seams.
 *
 * @param start - The platform, the scan steps, the files and the options.
 * @returns The started watch, its game and what its seams saw.
 */
async function startGame(start: Start = {}): Promise<Game> {
  const root = makeGame(start.files);
  const stubs = stubSeams(start.recursive ?? false, start.steps);
  const keys = await watchKeysAt(root, SETTINGS, stubs.seams, start.options);

  opened.push(keys);

  return { root, keys, ...stubs };
}

/**
 * Fires one event of the root watcher.
 *
 * @param game - The started watch.
 * @param file - The path the platform names, relative to the root.
 * @param event - The event name.
 */
function fire(game: Stubs & { root: string }, file = "saved.ts", event = "rename"): void {
  game.watchers.get(game.root)?.listener(event, file);
}

/**
 * The folders with a live watcher, relative to the root; `""` is the root.
 *
 * @param game - The started watch.
 * @returns The folders, sorted.
 */
function watched(game: Game): string[] {
  return [...game.watchers]
    .filter(([, watcher]) => !watcher.closed)
    .map(([folder]) => path.relative(game.root, folder).replaceAll(path.sep, "/"))
    .toSorted();
}

/**
 * Runs one batch to its end: makes a folder, fires an event, lets the quiet period pass, and
 * waits until the folder has its watcher. The batch re-arms the watchers as its last step, so
 * everything the batch does is done by then. For the fake platform without recursive watching.
 *
 * @param game - The started watch.
 * @returns Resolves when the batch ended.
 */
async function batch(game: Game): Promise<void> {
  const mark = `mark-${game.watchers.size}`;

  mkdirSync(path.join(game.root, mark));
  fire(game);
  await vi.advanceTimersByTimeAsync(QUIET_MS);
  await vi.waitFor(() => expect(watched(game)).toContain(mark), WAIT);
}

/**
 * Waits in real time, also while `setTimeout` is fake.
 *
 * @param ms - How long.
 * @returns Resolves after the wait.
 */
function pause(ms: number): Promise<void> {
  return new Promise(resolve => {
    realSetTimeout(resolve, ms);
  });
}

/**
 * Lets the trailing batch of the last scan run to its end. A batch that scanned asks for one
 * more walk; on a game nobody saved in the meantime that walk finds no difference.
 *
 * @returns Resolves when the trailing batch ended.
 */
async function trailingBatch(): Promise<void> {
  await vi.advanceTimersByTimeAsync(QUIET_MS);
  await pause(10);
}

/**
 * Reads the stamp module of a game.
 *
 * @param root - The game folder.
 * @returns The text of `.moku/assets-stamp.ts`.
 */
function stampOf(root: string): string {
  return readFileSync(path.join(root, ".moku", "assets-stamp.ts"), "utf8");
}

/**
 * Sets the time stamps of a file.
 *
 * @param root - The game folder.
 * @param file - The root-relative path.
 * @param moment - The time.
 */
function stampAt(root: string, file: string, moment: Date): void {
  utimesSync(path.join(root, file), moment, moment);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  for (const keys of opened.splice(0)) keys.close();

  vi.useRealTimers();
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("watchKeysAt, the start", () => {
  it("runs the first scan before it resolves, with the arguments of keysArguments, the watcher started first", async () => {
    const root = makeGame();
    const watchersAtScan: number[] = [];
    const stubs = stubSeams(true, {
      0: ui => {
        watchersAtScan.push(stubs.watchers.size);

        return passes(ui);
      }
    });

    opened.push(await watchKeysAt(root, SETTINGS, stubs.seams));

    expect(stubs.seen.scans).toEqual([keysArguments(root, SETTINGS, false)]);
    expect(stubs.seen.scans[0]).toEqual([
      "--root",
      root,
      "--keys",
      path.join(root, "generated", "assets.ts"),
      "--manifest",
      path.join(root, "generated", "manifest.json")
    ]);
    expect(watchersAtScan).toEqual([1]);
    expect([...stubs.watchers.keys()]).toEqual([root]);
  });

  it("watches and scans the real path of a game folder behind a symlink", async () => {
    const root = makeGame();
    const link = `${root}-link`;
    const stubs = stubSeams(true);

    symlinkSync(root, link);
    made.push(link);
    opened.push(await watchKeysAt(link, SETTINGS, stubs.seams));

    expect([...stubs.watchers.keys()]).toEqual([root]);
    expect(stubs.seen.scans[0]?.slice(0, 2)).toEqual(["--root", root]);
    expect(stampOf(root)).toContain("export default");
  });

  it("passes the layers of the config to every scan", async () => {
    const root = makeGame();
    const layered = resolveConfig({ page: { title: "t" }, assets: { layers: { shared: "ui" } } });
    const stubs = stubSeams(false);
    const game: Game = { root, ...stubs, keys: await watchKeysAt(root, layered, stubs.seams) };

    opened.push(game.keys);
    put(root, "shared/assets/panel.png", "panel");
    await batch(game);

    expect(stubs.seen.scans).toHaveLength(2);
    expect(stubs.seen.scans[1]).toEqual(keysArguments(root, layered, false));
    expect(stubs.seen.scans[1]).toContain("shared=ui");
  });

  it("still resolves when the first scan fails, and scans again on the next save", async () => {
    const onError = vi.fn();
    const game = await startGame({ steps: { 0: fails("no key for dot") }, options: { onError } });

    expect(onError.mock.calls).toEqual([["no key for dot"]]);
    expect(game.seen.printed).toEqual([]);

    put(game.root, DOT, "other bytes");
    await batch(game);

    expect(game.seen.scans).toHaveLength(2);
    expect(game.seen.printed).toEqual([`info keys: ${DOT}`]);
  });

  it("closes its watcher and rejects when the first batch breaks outside the scan", async () => {
    const root = makeGame();
    const stubs = stubSeams(true, { 0: fails("x") });

    await expect(watchKeysAt(root, SETTINGS, stubs.seams, { onError: brokenLog })).rejects.toThrow(
      "the log of the editor is gone"
    );
    expect(stubs.watchers.get(root)?.closed).toBe(true);
  });
});

describe("watchKeysAt, what starts a scan", () => {
  it("closes a batch 100 ms after the last event", async () => {
    const game = await startGame();

    put(game.root, DOT, "other bytes");
    fire(game);
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
    fire(game);
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);

    expect(vi.getTimerCount()).toBe(2);
    expect(game.seen.scans).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(game.seen.scans).toHaveLength(2), WAIT);
    // The scan asked for its trailing walk; that walk finds nothing and asks for no more.
    await trailingBatch();

    expect(game.seen.scans).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs no scan and prints nothing for an event with no input change", async () => {
    const game = await startGame({
      files: { "node_modules/pkg/a.png": "a", "tests/visual/home.webp": "a" }
    });

    put(game.root, "features/home/view.ts", "export {};\n");
    put(game.root, "features/home/notes.json", "{}\n");
    put(game.root, "features/home/strings/deep/en.json", "{}\n");
    put(game.root, "node_modules/pkg/a.png", "other bytes");
    put(game.root, "tests/visual/home.webp", "other bytes");
    await batch(game);

    expect(game.seen.scans).toHaveLength(1);
    expect(game.seen.printed).toEqual(SCANNER_LINES);
  });

  it("scans for a changed image and rewrites the stamp", async () => {
    const game = await startGame();
    const before = stampOf(game.root);

    put(game.root, DOT, "other bytes");
    await batch(game);

    expect(game.seen.scans).toHaveLength(2);
    expect(stampOf(game.root)).not.toBe(before);
    expect(stampOf(game.root)).toMatch(
      /^\/\/ Written by moku-game dev\. Do not edit\.\nexport default "[0-9a-f]{40}";\n$/
    );
  });

  it("scans for an image saved with the same bytes at a later time, and for an upper-case extension", async () => {
    const game = await startGame();
    const before = stampOf(game.root);

    stampAt(game.root, DOT, new Date(Date.now() + 5000));
    await batch(game);

    const touched = stampOf(game.root);

    put(game.root, "features/ui/assets/LOUD.PNG", "png");
    await batch(game);

    expect(game.seen.scans).toHaveLength(3);
    expect(touched).not.toBe(before);
    expect(stampOf(game.root)).not.toBe(touched);
    expect(game.seen.printed.slice(-2)).toEqual([
      `info keys: ${DOT}`,
      "info keys: features/ui/assets/LOUD.PNG"
    ]);
  });

  it("scans for a changed strings file and leaves the stamp", async () => {
    const game = await startGame();
    const stamp = path.join(game.root, ".moku", "assets-stamp.ts");
    const old = new Date("2020-01-01T00:00:00Z");
    const before = stampOf(game.root);

    utimesSync(stamp, old, old);
    put(game.root, RUSSIAN, '{ "home.note": "Привет" }\n');
    await batch(game);

    expect(game.seen.scans).toHaveLength(2);
    expect(stampOf(game.root)).toBe(before);
    expect(statSync(stamp).mtimeMs).toBe(old.getTime());
    expect(game.seen.printed.at(-1)).toBe(`info keys: ${RUSSIAN}`);
  });

  it("puts --pseudo into the next scan once a first strings/en.json is added", async () => {
    const game = await startGame();

    put(game.root, "features/home/strings/en.json", '{ "home.note": "Hello" }\n');
    await batch(game);

    expect(game.seen.scans[0]).not.toContain("--pseudo");
    expect(game.seen.scans[1]?.at(-1)).toBe("--pseudo");
  });

  it("pokes nothing for an event under generated/, .moku/, node_modules/, dist/ or tests/", async () => {
    const game = await startGame({ recursive: true });

    // The trailing walk of the first scan ends first: after it no timer waits.
    await trailingBatch();
    put(game.root, DOT, "other bytes");

    for (const file of [
      "generated/assets.ts",
      ".moku/assets-stamp.ts",
      "node_modules/pkg/a.png",
      "dist/assets/ui/a.png",
      "tests/visual/home.webp"
    ]) {
      fire(game, file);
    }

    expect(vi.getTimerCount()).toBe(0);

    // The `.tmp` of an atomic save, reported as a change: events are not filtered by name.
    fire(game, `${DOT}.tmp`, "change");

    expect(vi.getTimerCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await vi.waitFor(() => expect(game.seen.scans).toHaveLength(2), WAIT);
  });

  it("skips a folder it cannot read instead of failing", async () => {
    const root = makeGame({ "art/locked/secret.png": "png" });
    const locked = path.join(root, "art", "locked");
    const stubs = stubSeams(false);

    chmodSync(locked, 0o000);

    try {
      opened.push(await watchKeysAt(root, SETTINGS, stubs.seams));
    } finally {
      chmodSync(locked, 0o755);
    }

    expect(stubs.seen.scans).toHaveLength(1);
  });
});

describe("watchKeysAt, the stamp", () => {
  it("writes the stamp with the first scan, and leaves it when the assets are the same at the next start", async () => {
    const root = makeGame();
    const stamp = path.join(root, ".moku", "assets-stamp.ts");
    const old = new Date("2020-01-01T00:00:00Z");
    const first = await watchKeysAt(root, SETTINGS, stubSeams(false).seams);

    first.close();
    utimesSync(stamp, old, old);

    const second = await watchKeysAt(root, SETTINGS, stubSeams(false).seams);

    second.close();

    expect(statSync(stamp).mtimeMs).toBe(old.getTime());
  });

  it("replaces the empty first stamp of the page, and a stamp of other assets", async () => {
    const root = makeGame({ ".moku/assets-stamp.ts": 'export default "";\n' });
    const first = await watchKeysAt(root, SETTINGS, stubSeams(false).seams);
    const written = stampOf(root);

    first.close();
    put(root, DOT, "other bytes");

    const second = await watchKeysAt(root, SETTINGS, stubSeams(false).seams);

    second.close();

    expect(written).toMatch(/export default "[0-9a-f]{40}";\n$/);
    expect(stampOf(root)).not.toBe(written);
  });
});

describe("watchKeysAt, a failed scan", () => {
  it("hands the error of a scan that answers 1 to onError, once, and prints nothing", async () => {
    const onError = vi.fn();
    const game = await startGame({ steps: { 1: fails("x") }, options: { onError } });

    put(game.root, DOT, "other bytes");
    await batch(game);

    expect(onError.mock.calls).toEqual([["x"]]);
    expect(game.seen.printed).toEqual(SCANNER_LINES);
  });

  it("joins the error lines of one scan with a newline", async () => {
    const onError = vi.fn();
    const game = await startGame({
      steps: { 1: fails("first", "second") },
      options: { onError }
    });

    put(game.root, DOT, "other bytes");
    await batch(game);

    expect(onError.mock.calls).toEqual([["first\nsecond"]]);
  });

  it("hands the message of a scan that throws to onError", async () => {
    const onError = vi.fn();
    const game = await startGame({
      steps: {
        1: () => {
          throw new Error("boom");
        },
        2: () => {
          // Anything can be thrown at a seam, not only an Error.
          throw "not an error";
        }
      },
      options: { onError }
    });

    put(game.root, DOT, "other bytes");
    await batch(game);
    put(game.root, DOT, "bytes once more");
    await batch(game);

    expect(onError.mock.calls).toEqual([["boom"], ["not an error"]]);
    expect(game.seen.printed).toEqual(SCANNER_LINES);
  });

  it("warns on the console when no onError is given", async () => {
    const game = await startGame({ steps: { 1: fails("x") } });

    put(game.root, DOT, "other bytes");
    await batch(game);

    expect(game.seen.printed).toEqual([...SCANNER_LINES, "warn [game] keys: x"]);
  });

  it("keeps watching: the same state is not scanned again, the next save is", async () => {
    const onError = vi.fn();
    const game = await startGame({ steps: { 1: fails("bad JSON") }, options: { onError } });

    put(game.root, RUSSIAN, "{ broken\n");
    await batch(game);
    await batch(game);

    expect(game.seen.scans).toHaveLength(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(watched(game)).toContain("features/home/strings");

    put(game.root, RUSSIAN, '{ "home.note": "Привет" }\n');
    await batch(game);

    expect(game.seen.scans).toHaveLength(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(game.seen.printed.at(-1)).toBe(`info keys: ${RUSSIAN}`);
  });

  it("scans again after a batch that broke outside the scan", async () => {
    const onError = vi.fn(brokenLog);
    const game = await startGame({ steps: { 1: fails("x") }, options: { onError } });

    put(game.root, DOT, "other bytes");
    fire(game);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1), WAIT);

    put(game.root, DOT, "bytes once more");
    await batch(game);

    expect(game.seen.scans).toHaveLength(3);
    expect(game.seen.printed.at(-1)).toBe(`info keys: ${DOT}`);
  });
});

describe("watchKeysAt, one scan at a time", () => {
  it("makes a batch that starts during the first scan wait for it: the two scans never overlap", async () => {
    const root = makeGame();
    const first = held();
    const stubs = stubSeams(true, { 0: first.step });
    const starting = watchKeysAt(root, SETTINGS, stubs.seams);

    await vi.waitFor(() => expect(stubs.seen.scans).toHaveLength(1), WAIT);

    put(root, DOT, "other bytes");
    fire({ root, ...stubs }, DOT, "change");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    // Real time for the queued batch: without the lock its scan would start here.
    await pause(50);

    expect(stubs.seen.scans).toHaveLength(1);

    first.release();
    opened.push(await starting);
    await vi.waitFor(() => expect(stubs.seen.printed).toContain(`info keys: ${DOT}`), WAIT);

    expect(stubs.seen.scans).toHaveLength(2);
    expect(stubs.seen.most).toBe(1);
  });

  it("gives exactly one more scan for the events during a running scan, then its trailing walk and no more", async () => {
    const second = held();
    const game = await startGame({ steps: { 1: second.step } });

    put(game.root, "features/ui/assets/a.png", "a");
    fire(game);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await vi.waitFor(() => expect(game.seen.scans).toHaveLength(2), WAIT);

    for (const name of ["b", "c", "d"]) {
      put(game.root, `features/ui/assets/${name}.png`, name);
      fire(game);
      await vi.advanceTimersByTimeAsync(QUIET_MS);
    }

    mkdirSync(path.join(game.root, "after"));

    // The three quiet periods ended while the scan ran: they wait as one queued batch.
    expect(vi.getTimerCount()).toBe(0);
    expect(game.seen.scans).toHaveLength(2);

    second.release();
    await vi.waitFor(() => expect(watched(game)).toContain("after"), WAIT);
    // The third scan asked for its trailing walk, as every scan does. It is the last batch: it
    // finds no difference, so it scans nothing and asks for nothing.
    await trailingBatch();

    expect(game.seen.scans).toHaveLength(3);
    expect(game.seen.most).toBe(1);
    expect(game.seen.printed.slice(-2)).toEqual([
      "info keys: features/ui/assets/a.png",
      "info keys: features/ui/assets/b.png and 2 more"
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("watchKeysAt, the trailing batch", () => {
  it("scans a save whose event was swallowed during the writes of a scan, and then ends", async () => {
    const root = makeGame();
    const hidden = "features/ui/assets/hidden.png";
    // The second scan saves an image while it runs, and the platform reports no event for it.
    const stubs = stubSeams(false, {
      1: ui => {
        put(root, hidden, "png");

        return passes(ui);
      }
    });
    const game: Game = { root, ...stubs, keys: await watchKeysAt(root, SETTINGS, stubs.seams) };

    opened.push(game.keys);
    put(root, DOT, "other bytes");
    await batch(game);

    expect(game.seen.scans).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(2);

    // No event is fired: only the walk the scan asked for can find the save.
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await vi.waitFor(() => expect(game.seen.printed).toContain(`info keys: ${hidden}`), WAIT);

    expect(game.seen.scans).toHaveLength(3);

    // That scan asked for a walk too. It finds no difference: no fourth scan, no timer left.
    await trailingBatch();

    expect(game.seen.scans).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("follows the first scan too, and a batch with no scan asks for nothing", async () => {
    const game = await startGame();

    expect(vi.getTimerCount()).toBe(2);

    await trailingBatch();

    expect(game.seen.scans).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    put(game.root, "features/home/view.ts", "export {};\n");
    await batch(game);
    await pause(10);

    expect(game.seen.scans).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("watchKeysAt, the folder watchers", () => {
  it("re-arms them with the folders of the walk after the first scan and after a batch", async () => {
    const game = await startGame({
      files: {
        "generated/assets.ts": "",
        "node_modules/pkg/a.png": "a",
        "tests/visual/home.webp": "a",
        "dist/assets/a.png": "a"
      }
    });

    expect(watched(game)).toEqual([
      "",
      "features",
      "features/home",
      "features/home/strings",
      "features/ui",
      "features/ui/assets"
    ]);

    mkdirSync(path.join(game.root, "features", "board", "assets"), { recursive: true });
    rmSync(path.join(game.root, "features", "home"), { recursive: true });
    fire(game);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await vi.waitFor(
      () =>
        expect(watched(game)).toEqual([
          "",
          "features",
          "features/board",
          "features/board/assets",
          "features/ui",
          "features/ui/assets"
        ]),
      WAIT
    );
  });
});

describe("watchKeysAt, the lines", () => {
  it("passes the lines of the first scan through, and prints one line of its own for a later scan", async () => {
    const game = await startGame();

    expect(game.seen.printed).toEqual(SCANNER_LINES);

    put(game.root, DOT, "other bytes");
    await batch(game);

    expect(game.seen.printed).toEqual([...SCANNER_LINES, `info keys: ${DOT}`]);

    put(game.root, DOT, "bytes once more");
    put(game.root, "features/ui/assets/new.png", "png");
    rmSync(path.join(game.root, RUSSIAN));
    await batch(game);

    expect(game.seen.printed).toEqual([
      ...SCANNER_LINES,
      `info keys: ${DOT}`,
      `info keys: ${RUSSIAN} and 2 more`
    ]);
  });
});

describe("watchKeysAt, close", () => {
  it("stops later scans, closes every watcher and is safe to call twice", async () => {
    const game = await startGame();

    game.keys.close();
    game.keys.close();
    put(game.root, DOT, "other bytes");
    fire(game);

    expect(vi.getTimerCount()).toBe(0);
    expect(watched(game)).toEqual([]);
    expect(game.seen.scans).toHaveLength(1);
  });

  it("lets a running scan finish, and arms no watcher after it", async () => {
    const second = held();
    const game = await startGame({ steps: { 1: second.step } });
    const before = stampOf(game.root);

    put(game.root, DOT, "other bytes");
    fire(game);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await vi.waitFor(() => expect(game.seen.scans).toHaveLength(2), WAIT);

    game.keys.close();
    fire(game);
    second.release();
    await vi.waitFor(() => expect(game.seen.printed).toContain(`info keys: ${DOT}`), WAIT);
    await pause(10);

    expect(stampOf(game.root)).not.toBe(before);
    expect(watched(game)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(game.seen.scans).toHaveLength(2);
  });
});
