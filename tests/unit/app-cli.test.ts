/**
 * @file The command line of `moku-game` over stub seams: the flags of every command, the dev
 * parent (the keys watch, the written page with its stamp, the re-run under the bunfig, the
 * signals, the scenario watcher, the advice), the dev child's server, `keys` and `pack` through
 * the asset scanner, `native` through `runNative`, the `--preload` re-run, and `runCli` with the
 * real seams of this process.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, Signal, SpawnOptions } from "../../src/app/cli";
import { runCommand } from "../../src/app/cli";
import { resolveConfig } from "../../src/app/config";
import { engineFingerprint } from "../../src/app/engine";
import type { NativeVerb, NativeVerbOptions, NativeWhere } from "../../src/app/native";
import { serveParent, staticPath, writePage } from "../../src/app/serve";
import type { ResolvedGameConfig } from "../../src/app/types";
import { runCli } from "../../src/cli";
import { copyMiniGame, holdPort, removeCopies } from "../integration/app-helpers";

/** What the stub seams saw. */
type Seen = {
  out: string[];
  warnings: string[];
  errors: string[];
  spawns: { command: string[]; options: SpawnOptions }[];
  kills: Signal[];
  handlers: Map<Signal, (() => void)[]>;
  removed: Signal[];
  watches: { folder: string; listener: (event: string) => void; closed: boolean }[];
  keys: { root: string; settings: ResolvedGameConfig; closed: boolean }[];
  scans: string[][];
  natives: {
    verb: NativeVerb;
    settings: ResolvedGameConfig;
    where: NativeWhere;
    options: NativeVerbOptions;
  }[];
};

/** The hot plugin path the stub resolver answers. */
const HOT = "/engine/dist/hot.mjs";

/** The Bun the stubs run the bin with. */
const BUN = "/bin/bun";

/** The bin the stubs re-run. */
const SELF = "/game/node_modules/@moku-labs/game/bin/moku-game.mjs";

/** The home folder the stubs answer. */
const HOME = "/home/tester";

/** The temp folders of a test, removed after it. */
const made: string[] = [];

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
 * Makes a temp game folder: a `config.ts` with a title, an `index.ts`, a dev manifest and a
 * `.gitignore`, plus the given files, minus the left-out ones.
 *
 * @param files - Files by path under the game.
 * @param leftOut - Default files to leave out.
 * @returns The game folder.
 */
function makeGame(files: Record<string, string> = {}, leftOut: string[] = []): string {
  const root = mkdtempSync(path.join(tmpdir(), "moku-game-cli-"));
  const all: Record<string, string> = {
    "config.ts": 'export default { page: { title: "t" } };\n',
    "index.ts": "export default {};\n",
    "generated/manifest.json": '{ "version": 1, "bundles": {} }\n',
    ".gitignore": ".moku/\n",
    ...files
  };

  made.push(root);

  for (const [file, text] of Object.entries(all)) {
    if (!leftOut.includes(file)) put(path.join(root, file), text);
  }

  return root;
}

/**
 * Makes the stub seams of the command line.
 *
 * @param cwd - The working directory.
 * @param change - Seams to replace.
 * @param exited - What a spawned child exits with.
 * @returns The seams and what they saw.
 */
function fakeDeps(
  cwd: string,
  change: Partial<CliDeps> = {},
  exited: Promise<number> = Promise.resolve(0)
): { deps: CliDeps; seen: Seen } {
  const seen: Seen = {
    out: [],
    warnings: [],
    errors: [],
    spawns: [],
    kills: [],
    handlers: new Map(),
    removed: [],
    watches: [],
    keys: [],
    scans: [],
    natives: []
  };
  const deps: CliDeps = {
    ui: {
      info: message => seen.out.push(message),
      line: (text = "") => seen.out.push(text),
      warn: message => seen.warnings.push(message),
      error: message => seen.errors.push(message)
    },
    env: {},
    cwd,
    execPath: BUN,
    self: [SELF],
    spawn: (command, options) => {
      seen.spawns.push({ command, options });

      return { exited, kill: signal => seen.kills.push(signal ?? "SIGTERM") };
    },
    onSignal: (signal, handler) => {
      seen.handlers.set(signal, [...(seen.handlers.get(signal) ?? []), handler]);

      return () => seen.removed.push(signal);
    },
    watch: (folder, listener) => {
      const watched = { folder, listener, closed: false };

      seen.watches.push(watched);

      return {
        close: () => {
          watched.closed = true;
        }
      };
    },
    watchKeys: async (root, settings) => {
      const watching = { root, settings, closed: false };

      seen.keys.push(watching);

      return {
        close: () => {
          watching.closed = true;
        }
      };
    },
    assets: async argv => {
      seen.scans.push(argv);

      return 0;
    },
    native: async (verb, settings, where, options) => {
      seen.natives.push({ verb, settings, where, options });

      return true;
    },
    resolve: () => HOT,
    loadPage: async () => ({ default: new Response("<html>the page</html>") }),
    visual: () => Promise.reject(new Error("the visual runner is not loaded here")),
    now: () => Date.UTC(2026, 9, 14, 15, 30, 12),
    home: HOME,
    exists: () => false,
    readPackageVersion: () => undefined,
    ...change
  };

  return { deps, seen };
}

/**
 * Runs a command line over stub seams.
 *
 * @param argv - The arguments after the bin.
 * @param cwd - The working directory.
 * @param change - Seams to replace.
 * @returns The exit code and what the seams saw.
 */
async function run(
  argv: string[],
  cwd: string,
  change: Partial<CliDeps> = {}
): Promise<{ code: number; seen: Seen }> {
  const { deps, seen } = fakeDeps(cwd, change);
  const code = await runCommand(argv, deps);

  return { code, seen };
}

/**
 * Runs a command line over stub seams and gives what it printed as errors.
 *
 * @param argv - The arguments after the bin.
 * @param cwd - The working directory.
 * @param change - Seams to replace.
 * @returns The error lines.
 */
async function errorsOf(
  argv: string[],
  cwd: string,
  change: Partial<CliDeps> = {}
): Promise<string[]> {
  const { seen } = await run(argv, cwd, change);

  return seen.errors;
}

/**
 * Runs a command line over stub seams and gives what it printed as warnings.
 *
 * @param argv - The arguments after the bin.
 * @param cwd - The working directory.
 * @returns The warning lines.
 */
async function warningsOf(argv: string[], cwd: string): Promise<string[]> {
  const { seen } = await run(argv, cwd);

  return seen.warnings;
}

/**
 * Fetches a URL and reads its body as text.
 *
 * @param url - The URL.
 * @returns The body.
 */
async function textOf(url: string): Promise<string> {
  const response = await fetch(url);

  return response.text();
}

/**
 * Fetches a URL and reads its status.
 *
 * @param url - The URL.
 * @returns The status code.
 */
async function statusOf(url: string): Promise<number> {
  const response = await fetch(url);

  return response.status;
}

/**
 * Reads a file of a game.
 *
 * @param root - The game folder.
 * @param file - The path under it.
 * @returns The text.
 */
function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

afterEach(() => {
  vi.useRealTimers();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A game with an installed engine: the game folder, the engine's hot plugin and its folder. */
type EngineGame = { root: string; hot: string; engine: string };

/**
 * Makes a temp game with an installed engine 0.14.12 and a lock file.
 *
 * @param files - More files by path under the game.
 * @returns The game, the hot plugin and the engine folder.
 */
function makeEngineGame(files: Record<string, string> = {}): EngineGame {
  const engine = "node_modules/@moku-labs/game";
  const root = makeGame({
    "bun.lock": "{}\n",
    [`${engine}/package.json`]: JSON.stringify({ name: "@moku-labs/game", version: "0.14.12" }),
    [`${engine}/dist/hot.mjs`]: "export default 1;\n",
    ...files
  });

  return {
    root,
    hot: path.join(root, engine, "dist", "hot.mjs"),
    engine: path.join(root, engine)
  };
}

/** Children that exit with 0 when they are killed, and the lines printed before each started. */
type Children = {
  /** The spawn seam. */
  spawn: CliDeps["spawn"];
  /** Ends the last child by itself with a code. */
  exit(code: number): void;
  /** What was printed before each child started, one list per child. */
  printed: string[][];
};

/**
 * Makes a spawn whose children exit with 0 when killed, as the dev child does on SIGTERM.
 *
 * @param seen - What the stub seams saw; the spawns and the kills go there.
 * @returns The spawn, the exit of the last child and the printed lines.
 */
function killableChildren(seen: Seen): Children {
  const exits: ((code: number) => void)[] = [];
  const printed: string[][] = [];

  return {
    printed,
    spawn: (command, options) => {
      const exited = new Promise<number>(resolve => exits.push(resolve));
      const exit = exits.at(-1);

      seen.spawns.push({ command, options });
      printed.push([...seen.out]);

      return {
        exited,
        kill: signal => {
          seen.kills.push(signal ?? "SIGTERM");
          exit?.(0);
        }
      };
    },
    exit: code => exits.at(-1)?.(code)
  };
}

/**
 * Fires a change at the open watcher of a folder.
 *
 * @param seen - What the stub seams saw.
 * @param folder - The watched folder.
 */
function touch(seen: Seen, folder: string): void {
  seen.watches.find(watched => watched.folder === folder && !watched.closed)?.listener("change");
}

describe("moku-game dev, the parent", () => {
  it("dev defaults to port 3000 and the cwd", async () => {
    const root = makeGame();
    const { code, seen } = await run(["dev"], root);
    const spawned = seen.spawns[0];

    expect(code).toBe(0);
    expect(seen.errors).toEqual([]);
    expect(spawned?.command).toEqual([
      BUN,
      `--config=${path.join(root, ".moku", "bunfig.toml")}`,
      SELF,
      "dev",
      "--root",
      root,
      "--port",
      "3000"
    ]);
    expect(spawned?.options).toEqual({
      cwd: root,
      env: { MOKU_GAME_CHILD: "1" },
      stdio: ["inherit", "inherit", "inherit"],
      detached: true
    });
    expect(read(root, ".moku/index.html")).toContain("<title>t</title>");
    expect(read(root, ".moku/dev.ts")).toContain("globalThis.__MOKU_GAME_DEV__ = true;");
    expect(read(root, ".moku/main.ts")).toContain(
      'import "./dev.ts";\nimport "./assets-stamp.ts";\n'
    );
    expect(read(root, ".moku/bunfig.toml")).toContain(`plugins = ["${HOT}"]`);
  });

  it("dev starts the keys watch after the game is read, before the page is written and the child starts", async () => {
    const root = makeGame();
    const { deps, seen } = fakeDeps(root);
    const order: string[] = [];
    const code = await runCommand(["dev"], {
      ...deps,
      watchKeys: async (given, settings) => {
        // The watch takes a moment, as its first scan does.
        await new Promise(resolve => setTimeout(resolve, 5));
        order.push(
          `keys: page ${existsSync(path.join(root, ".moku"))}, child ${seen.spawns.length}`
        );

        return deps.watchKeys(given, settings);
      },
      spawn: (command, options) => {
        order.push(`child: keys closed ${seen.keys[0]?.closed}`);

        return deps.spawn(command, options);
      }
    });

    expect(code).toBe(0);
    expect(order).toEqual(["keys: page false, child 0", "child: keys closed false"]);
    expect(seen.keys.map(keys => [keys.root, keys.settings.page.title, keys.closed])).toEqual([
      [root, "t", true]
    ]);
  });

  it("dev keeps the keys watch open while the child runs and closes it when the child exits", async () => {
    const root = makeGame();
    const ended: { exit: (code: number) => void } = { exit: () => undefined };
    const exited = new Promise<number>(resolve => {
      ended.exit = resolve;
    });
    const { deps, seen } = fakeDeps(root, {}, exited);
    const running = runCommand(["dev"], deps);

    await waitFor(() => seen.spawns.length === 1);

    expect(seen.keys.map(keys => keys.closed)).toEqual([false]);

    ended.exit(0);

    expect(await running).toBe(0);
    expect(seen.keys.map(keys => keys.closed)).toEqual([true]);
  });

  it("dev closes the keys watch when the page is refused or the child does not start", async () => {
    const refused = makeGame();
    const unstarted = makeGame();
    const page = await run(["dev"], refused, {
      resolve: () => {
        throw new Error('Cannot find package "@moku-labs/game"');
      }
    });
    const child = await run(["dev"], unstarted, {
      spawn: () => {
        throw new Error("[game] spawn failed.");
      }
    });

    expect([page.code, child.code]).toEqual([1, 1]);
    expect(page.seen.keys.map(keys => keys.closed)).toEqual([true]);
    expect(child.seen.keys.map(keys => keys.closed)).toEqual([true]);
    expect(existsSync(path.join(refused, ".moku"))).toBe(false);
  });

  it("a --preload or --serve-plugin that is gone when the page is written closes the keys watch", async () => {
    const root = makeGame();
    const gone = path.join(root, "gone.ts");
    const base = { root, port: 0, packed: false, preload: [], servePlugins: [] };
    const preload = fakeDeps(root);
    const plugin = fakeDeps(root);

    await expect(serveParent({ ...base, preload: [gone] }, preload.deps)).rejects.toThrow(
      `[game] moku-game: --preload "${gone}" is not a file.`
    );
    await expect(serveParent({ ...base, servePlugins: [gone] }, plugin.deps)).rejects.toThrow(
      `[game] moku-game: --serve-plugin "${gone}" is not a file.`
    );
    expect(preload.seen.keys.map(keys => keys.closed)).toEqual([true]);
    expect(plugin.seen.keys.map(keys => keys.closed)).toEqual([true]);
    expect([...preload.seen.spawns, ...plugin.seen.spawns]).toEqual([]);
  });

  it("dev does not write the page or start the child when the keys watch is refused", async () => {
    const root = makeGame();
    const { code, seen } = await run(["dev"], root, {
      watchKeys: () => Promise.reject(new Error("[game] keys: the game folder is gone."))
    });

    expect(code).toBe(1);
    expect(seen.errors).toEqual(["[game] keys: the game folder is gone."]);
    expect(seen.spawns).toEqual([]);
    expect(existsSync(path.join(root, ".moku"))).toBe(false);
  });

  it("dev writes the empty first stamp and keeps a stamp that is there", async () => {
    const root = makeGame();
    const stamp = path.join(root, ".moku", "assets-stamp.ts");

    await run(["dev"], root);

    expect(readFileSync(stamp, "utf8")).toBe(
      "// Written by moku-game dev. Do not edit.\nexport default {\n  files: {},\n  changed: []\n};\n"
    );

    put(stamp, 'export default "the stamp of a keys watch";\n');
    await run(["dev"], root);

    expect(readFileSync(stamp, "utf8")).toBe('export default "the stamp of a keys watch";\n');
  });

  it("the page of visual in .moku/visual imports the same stamp from one folder up", () => {
    const root = makeGame();

    writePage(root, resolveConfig({ page: { title: "t" } }), {}, () => HOT, ".moku/visual");

    expect(read(root, ".moku/visual/main.ts")).toContain('import "../assets-stamp.ts";');
    expect(read(root, ".moku/assets-stamp.ts")).toContain(
      "export default {\n  files: {},\n  changed: []\n};"
    );
    expect(existsSync(path.join(root, ".moku", "visual", "assets-stamp.ts"))).toBe(false);
  });

  it("dev takes --port 0", async () => {
    const root = makeGame();
    const { seen } = await run(["dev", "--port", "0"], root);

    expect(seen.spawns[0]?.command.slice(-2)).toEqual(["--port", "0"]);
  });

  it("dev refuses --port 70000", async () => {
    const root = makeGame();

    for (const port of ["70000", "abc", "-1"]) {
      const { code, seen } = await run(["dev", `--port=${port}`], root);

      expect(code).toBe(1);
      expect(seen.errors).toEqual([
        `[game] dev: --port must be an integer 0-65535, got "${port}".`
      ]);
      expect(seen.spawns).toEqual([]);
    }
  });

  it("--preload and --serve-plugin repeat", async () => {
    const root = makeGame({ "a.ts": "", "b.ts": "", "p.ts": "", "q.ts": "" });
    const argv = ["dev", "--preload", "a.ts", "--serve-plugin", "p.ts"];
    const { code } = await run([...argv, "--preload", "b.ts", "--serve-plugin", "q.ts"], root);
    const bunfig = read(root, ".moku/bunfig.toml");

    expect(code).toBe(0);
    expect(bunfig).toContain(
      `preload = [${JSON.stringify(path.join(root, "a.ts"))}, ${JSON.stringify(path.join(root, "b.ts"))}]`
    );
    expect(bunfig).toContain(
      `plugins = ["${HOT}", ${JSON.stringify(path.join(root, "p.ts"))}, ${JSON.stringify(path.join(root, "q.ts"))}]`
    );
  });

  it("global flags work before the command word", async () => {
    const root = makeGame();
    const elsewhere = makeGame();
    const { code, seen } = await run(["--root", root, "dev", "--port", "0"], elsewhere);

    expect(code).toBe(0);
    expect(seen.spawns[0]?.command).toContain(root);
    expect(seen.spawns[0]?.options.cwd).toBe(root);
  });

  it("dev refuses a game where @moku-labs/game/hot does not resolve", async () => {
    const root = makeGame();
    const { code, seen } = await run(["dev"], root, {
      resolve: () => {
        throw new Error('Cannot find package "@moku-labs/game"');
      }
    });

    expect(code).toBe(1);
    expect(seen.errors).toEqual([
      `[game] dev: "@moku-labs/game/hot" does not resolve from "${root}".\n  Install @moku-labs/game in the game: bun add @moku-labs/game.`
    ]);
    expect(seen.spawns).toEqual([]);
  });

  it("dev refuses a game without config.ts or index.ts", async () => {
    const noConfig = makeGame({}, ["config.ts"]);
    const noIndex = makeGame({}, ["index.ts"]);

    expect(await errorsOf(["dev"], noConfig)).toEqual([
      `[game] moku-game: no config.ts in "${noConfig}".\n  A game keeps its page, native, system, save and assets data there.`
    ]);
    expect(await errorsOf(["dev"], noIndex)).toEqual([
      `[game] moku-game: no index.ts in "${noIndex}".\n  It default-exports defineGameApp({ ... }).`
    ]);
  });

  it("dev refuses a config.ts without a default export, a bad colour and a missing icon", async () => {
    const empty = makeGame({ "config.ts": "export const page = {};\n" });
    const colour = makeGame({
      "config.ts": 'export default { page: { title: "t", background: "red;}" } };\n'
    });
    const icon = makeGame({
      "config.ts": 'export default { page: { title: "t", icons: { favicon: "icon.png" } } };\n'
    });

    expect(await errorsOf(["dev"], empty)).toEqual([
      `[game] moku-game: config.ts in "${empty}" has no default export.\n  End it with: export default { page: { title: "…" } } satisfies GameConfig.`
    ]);
    expect(await errorsOf(["dev"], colour)).toEqual([
      '[game] moku-game: page.background "red;}" is not a CSS color.'
    ]);
    expect(await errorsOf(["dev"], icon)).toEqual([
      '[game] moku-game: page.icons.favicon "icon.png" is not a file in the game.'
    ]);
  });

  // Bug: the dev page links a boot picture that is not there, or writes a page with a broken fade.
  it("dev refuses a boot picture that is not a file and a negative boot fade", async () => {
    const missing = makeGame({
      "config.ts": 'export default { page: { title: "t", boot: { image: "boot.png" } } };\n'
    });
    const fade = makeGame({
      "config.ts":
        'export default { page: { title: "t", boot: { image: "boot.png", fadeMs: -1 } } };\n'
    });

    expect(await errorsOf(["dev"], missing)).toEqual([
      '[game] moku-game: page.boot.image "boot.png" is not a file in the game.'
    ]);
    expect(await errorsOf(["dev"], fade)).toEqual([
      "[game] config.page.boot.fadeMs is -1.\n  Use a number of milliseconds, 0 or more."
    ]);
  });

  it("dev hands Ctrl+C, SIGTERM and SIGHUP to the child and exits with its code", async () => {
    const root = makeGame();
    const ended: { exit: (code: number) => void } = { exit: () => undefined };
    const exited = new Promise<number>(resolve => {
      ended.exit = resolve;
    });
    const { deps, seen } = fakeDeps(root, {}, exited);
    const running = runCommand(["dev"], deps);

    await waitFor(() => seen.spawns.length === 1);

    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      for (const handler of seen.handlers.get(signal) ?? []) handler();
    }

    ended.exit(130);

    expect(await running).toBe(130);
    expect(seen.kills).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    expect(seen.removed.toSorted()).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);
  });

  it("dev warns when .moku is not ignored, and no more without generated/manifest.json", async () => {
    const root = makeGame({ ".gitignore": "node_modules\n" }, ["generated/manifest.json"]);
    const { code, seen } = await run(["dev"], root);

    expect(code).toBe(0);
    expect(seen.keys).toHaveLength(1);
    expect(seen.warnings).toEqual([
      '[game] dev: add ".moku/" to .gitignore. moku-game writes its dev page there.'
    ]);
  });

  it("dev reads .moku in a .gitignore above the game, up to the repository", async () => {
    const outer = makeGame({ ".gitignore": "dist\n.moku\n" });
    const root = path.join(outer, "games", "timber");
    const anchored = makeGame({ ".gitignore": "/.moku\n" });
    const below = path.join(anchored, "game");

    for (const [file, text] of Object.entries({
      "config.ts": 'export default { page: { title: "t" } };\n',
      "index.ts": "export default {};\n",
      "generated/manifest.json": "{}\n"
    })) {
      put(path.join(root, file), text);
      put(path.join(below, file), text);
    }

    // A repository between the game and the ignoring folder ends the walk.
    put(path.join(anchored, ".git", "HEAD"), "ref: refs/heads/main\n");

    expect(await warningsOf(["dev"], root)).toEqual([]);
    expect(await warningsOf(["dev"], below)).toEqual([
      '[game] dev: add ".moku/" to .gitignore. moku-game writes its dev page there.'
    ]);
  });

  it("dev --packed refuses without a pack, passes --packed to the child with one, and never watches the keys", async () => {
    const root = makeGame();
    const refused = await run(["dev", "--packed"], root);

    expect(refused.code).toBe(1);
    expect(refused.seen.errors).toEqual([
      `[game] dev: no packed build in "${path.join(root, "dist", "assets")}".\n  Run "moku-game pack" first.`
    ]);

    put(path.join(root, "dist", "assets", "manifest.json"), "{}\n");

    const packed = await run(["dev", "--packed", "--port", "0"], root);

    expect(packed.code).toBe(0);
    expect(packed.seen.spawns[0]?.command.slice(-3)).toEqual(["--port", "0", "--packed"]);
    expect([...refused.seen.keys, ...packed.seen.keys]).toEqual([]);
  });

  it("a new scenario file rewrites main.ts with its key, and the watcher closes with the child", async () => {
    const root = makeGame({ "tests/scenarios/ready.ts": "export default () => ({});\n" });
    const { seen } = await run(["dev"], root);
    const watched = seen.watches[0];

    expect(watched?.folder).toBe(path.join(root, "tests", "scenarios"));
    expect(watched?.closed).toBe(true);
    expect(read(root, ".moku/main.ts")).toContain('scenarios: { "ready": scenario0 }');

    put(path.join(root, "tests/scenarios/fresh.ts"), "export default () => ({});\n");
    watched?.listener("change");
    expect(read(root, ".moku/main.ts")).not.toContain("fresh");

    watched?.listener("rename");
    expect(read(root, ".moku/main.ts")).toContain(
      'scenarios: { "fresh": scenario0, "ready": scenario1 }'
    );
  });

  it("a spawn that throws leaves no scenario watcher open", async () => {
    const root = makeGame({ "tests/scenarios/ready.ts": "export default () => ({});\n" });
    const { code, seen } = await run(["dev"], root, {
      spawn: () => {
        throw new Error("[game] spawn failed.");
      }
    });

    expect(code).toBe(1);
    expect(seen.errors).toEqual(["[game] spawn failed."]);
    expect(seen.watches.filter(watched => !watched.closed)).toEqual([]);
  });

  it("a game without tests/scenarios gets no watcher", async () => {
    const root = makeGame();
    const { seen } = await run(["dev"], root);

    expect(seen.watches).toEqual([]);
    expect(read(root, ".moku/main.ts")).toContain("scenarios: {}");
  });

  it("an engine change stops the child with SIGTERM and starts a new one on a page written again", async () => {
    const { root, hot, engine } = makeEngineGame();
    const { deps, seen } = fakeDeps(root, { resolve: () => hot });
    const children = killableChildren(seen);
    const first = engineFingerprint(root, hot).id;

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const running = runCommand(["dev"], { ...deps, spawn: children.spawn });

    await vi.waitFor(() => expect(seen.spawns).toHaveLength(1));
    put(hot, "export default 2;\n");
    touch(seen, path.join(engine, "dist"));
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => expect(seen.spawns).toHaveLength(2));

    const second = engineFingerprint(root, hot).id;

    children.exit(0);

    expect(await running).toBe(0);
    expect(second).not.toBe(first);
    expect(seen.kills).toEqual(["SIGTERM"]);
    expect(seen.warnings).toEqual([
      `[game] dev: the engine changed (${first} -> ${second}), restarting the dev server.`
    ]);
    expect(read(root, ".moku/dev.ts")).toContain(second);
    // The engine line is the last one printed before each child.
    expect(children.printed.map(lines => lines.at(-1))).toEqual([
      `engine ${first}`,
      `engine ${second}`
    ]);
    expect(seen.watches.filter(watched => !watched.closed)).toEqual([]);
  });

  it("a child that exits on its own ends dev with its code and no restart", async () => {
    const { root, hot } = makeEngineGame();
    const { deps, seen } = fakeDeps(root, { resolve: () => hot });
    const children = killableChildren(seen);
    const running = runCommand(["dev"], { ...deps, spawn: children.spawn });

    await vi.waitFor(() => expect(seen.spawns).toHaveLength(1));

    expect(seen.watches.some(watched => !watched.closed)).toBe(true);

    children.exit(3);

    expect(await running).toBe(3);
    expect(seen.spawns).toHaveLength(1);
    expect(seen.watches.filter(watched => !watched.closed)).toEqual([]);
  });

  it("a patch-only change warns and keeps the child", async () => {
    const { root, hot } = makeEngineGame({
      "package.json": JSON.stringify({
        name: "g",
        patchedDependencies: { "@moku-labs/game@0.14.12": "patches/game.patch" }
      }),
      "patches/game.patch": "one\n"
    });
    const { deps, seen } = fakeDeps(root, { resolve: () => hot });
    const children = killableChildren(seen);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const running = runCommand(["dev"], { ...deps, spawn: children.spawn });
    const before = engineFingerprint(root, hot).patch?.hash.slice(0, 6);

    await vi.waitFor(() => expect(seen.spawns).toHaveLength(1));
    put(path.join(root, "patches", "game.patch"), "two\n");
    touch(seen, path.join(root, "patches"));
    await vi.advanceTimersByTimeAsync(300);

    const after = engineFingerprint(root, hot).patch?.hash.slice(0, 6);

    expect(seen.warnings).toEqual([
      `[game] dev: the engine's patch changed (${before} -> ${after}), but the installed engine did not.`,
      "  Run bun install; the dev server restarts by itself when the engine changes."
    ]);
    expect(seen.kills).toEqual([]);

    children.exit(0);

    expect(await running).toBe(0);
    expect(seen.spawns).toHaveLength(1);
  });

  it("a second dev with the same game rewrites nothing", async () => {
    const root = makeGame();
    const files = ["index.html", "dev.ts", "main.ts", "bunfig.toml", "assets-stamp.ts"].map(file =>
      path.join(root, ".moku", file)
    );
    const old = new Date("2020-01-01T00:00:00Z");

    await run(["dev"], root);
    for (const file of files) utimesSync(file, old, old);
    await run(["dev"], root);

    expect(files.map(file => statSync(file).mtimeMs)).toEqual(files.map(() => old.getTime()));
  });
});

/**
 * Waits until a condition holds, checking every few milliseconds.
 *
 * @param holds - The condition.
 * @returns Resolves once it holds.
 */
async function waitFor(holds: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !holds(); tries += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/**
 * Starts the dev child over stub seams.
 *
 * @param root - The game folder.
 * @param flags - The flags after `dev`.
 * @returns The run, its seams, and the URL it printed.
 */
async function startChild(
  root: string,
  flags: string[] = []
): Promise<{ running: Promise<number>; seen: Seen; url: string }> {
  const { deps, seen } = fakeDeps(root, { env: { MOKU_GAME_CHILD: "1" } });
  const running = runCommand(["dev", "--port", "0", ...flags], deps);

  await waitFor(() => seen.out.length >= 2 || seen.errors.length > 0);

  return { running, seen, url: seen.out[1] ?? "" };
}

/**
 * Stops a started child the way Ctrl+C does.
 *
 * @param seen - What its seams saw.
 */
function interrupt(seen: Seen): void {
  for (const handler of seen.handlers.get("SIGINT") ?? []) handler();
}

describe.skipIf(typeof Bun === "undefined")("moku-game dev, the child", () => {
  it("prints the bound URL on its own plain line and serves the page, the manifest and the files", async () => {
    const root = makeGame({
      "features/ui/assets/{button}.png": "png",
      "features/ui/assets/empty.png": "",
      ".moku/main.ts": "secret",
      "node_modules/x/index.js": "installed",
      "manifest.json": '{ "stale": true }\n'
    });
    const { running, seen, url } = await startChild(root);

    expect(seen.out[0]).toBe(`${path.basename(root)}: dev server, raw assets. Ctrl+C stops it.`);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(await textOf(url)).toBe("<html>the page</html>");
    expect(JSON.parse(await textOf(`${url}manifest.json`))).toEqual({ version: 1, bundles: {} });
    expect(await textOf(`${url}features/ui/assets/%7Bbutton%7D.png`)).toBe("png");

    for (const refused of [
      "features/ui/assets/empty.png",
      "features/ui/assets/missing.png",
      ".moku/main.ts",
      "node_modules/x/index.js",
      "features",
      "%E0"
    ]) {
      expect(await statusOf(`${url}${refused}`), refused).toBe(404);
    }

    interrupt(seen);
    expect(await running).toBe(0);
    expect(seen.removed.toSorted()).toEqual(["SIGINT", "SIGTERM"]);
    await expect(fetch(url)).rejects.toThrow();
  });

  it("answers a file and the manifest with no-store, so a reload shows the new bytes of an image", async () => {
    const root = makeGame({ "features/ui/assets/dot.png": "png" });
    const { running, seen, url } = await startChild(root);
    const first = await fetch(`${url}features/ui/assets/dot.png`);

    expect(await first.text()).toBe("png");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("content-type")).toBe("image/png");

    put(path.join(root, "features/ui/assets/dot.png"), "other bytes");

    const second = await fetch(`${url}features/ui/assets/dot.png`);
    const manifest = await fetch(`${url}manifest.json`);

    expect(await second.text()).toBe("other bytes");
    expect(manifest.headers.get("cache-control")).toBe("no-store");
    expect(await statusOf(`${url}features/ui/assets/missing.png`)).toBe(404);

    interrupt(seen);
    expect(await running).toBe(0);
  });

  it("binds the server to 127.0.0.1, never to every interface", async () => {
    const root = makeGame();
    const serve = vi.spyOn(Bun, "serve");

    try {
      const { running, seen, url } = await startChild(root);

      expect(serve.mock.calls[0]?.[0]).toMatchObject({ hostname: "127.0.0.1" });
      expect(new URL(url).hostname).toBe("127.0.0.1");

      interrupt(seen);
      expect(await running).toBe(0);
    } finally {
      serve.mockRestore();
    }
  });

  it("--packed serves the manifest and the files of dist/assets", async () => {
    const root = makeGame({
      "dist/assets/manifest.json": '{ "version": 2, "bundles": {} }\n',
      "dist/assets/ui/ui.dot-0123456789.png": "packed"
    });
    const { running, seen, url } = await startChild(root, ["--packed"]);

    expect(seen.out[0]).toContain("dev server, packed build.");
    expect(JSON.parse(await textOf(`${url}manifest.json`))).toEqual({ version: 2, bundles: {} });
    expect(await textOf(`${url}ui/ui.dot-0123456789.png`)).toBe("packed");
    expect(await statusOf(`${url}features/ui/assets/dot.png`)).toBe(404);

    interrupt(seen);
    expect(await running).toBe(0);
  });

  it("a taken port exits 1 with the --port 0 advice", async () => {
    const root = makeGame();
    const { port, release } = holdPort();
    const { deps, seen } = fakeDeps(root, { env: { MOKU_GAME_CHILD: "1" } });

    try {
      expect(await runCommand(["dev", "--port", port], deps)).toBe(1);
      expect(seen.errors).toEqual([
        `[game] dev: port ${port} is in use.\n  Pass --port 0 for a free port.`
      ]);
    } finally {
      await release();
    }
  });
});

describe("staticPath", () => {
  it("decodes the path and refuses dot segments, node_modules, backslashes and NUL", () => {
    const base = path.join(path.sep, "g");

    expect(staticPath(base, "/features/ui/assets/%7Bbutton%7D.png")).toBe(
      path.join(base, "features", "ui", "assets", "{button}.png")
    );

    for (const refused of [
      "/../x",
      "/a/%2E%2E/b",
      "/.git/HEAD",
      "/node_modules/a",
      "/a%5Cb",
      "/a%00"
    ]) {
      expect(staticPath(base, refused), refused).toBeUndefined();
    }
  });
});

describe("the command line", () => {
  it("an unknown option names the command", async () => {
    const root = makeGame();
    const { code, seen } = await run(["build", "--port", "1"], root);

    expect(code).toBe(1);
    expect(seen.errors).toEqual(['[game] build: unknown option "--port".']);
    expect(await errorsOf(["dev", "-x"], root)).toEqual(['[game] dev: unknown option "-x".']);
  });

  it("an option without a value is refused", async () => {
    const root = makeGame();

    expect(await errorsOf(["dev", "--port"], root)).toEqual([
      '[game] dev: "--port" needs a value.'
    ]);
    expect(await errorsOf(["dev", "--root", "--packed"], root)).toEqual([
      '[game] dev: "--root" needs a value.'
    ]);
  });

  it("a switch with a value and an extra argument are refused", async () => {
    const root = makeGame();

    expect(await errorsOf(["dev", "--packed=yes"], root)).toEqual([
      '[game] dev: "--packed" takes no value.'
    ]);
    expect(await errorsOf(["keys", "now"], root)).toEqual([
      '[game] keys: unexpected argument "now".'
    ]);
  });

  it("no command prints usage and exits 1", async () => {
    const root = makeGame();
    const { code, seen } = await run([], root);

    expect(code).toBe(1);
    expect(seen.out[0]).toBe("moku-game <command> [options]");
    expect(seen.errors).toEqual([
      "[game] moku-game: name a command: dev, build, native, keys, pack, visual, help."
    ]);
  });

  it("an unknown command is refused", async () => {
    const root = makeGame();
    const { code, seen } = await run(["serve"], root);

    expect(code).toBe(1);
    expect(seen.errors).toEqual([
      '[game] moku-game: no command "serve". Name one of dev, build, native, keys, pack, visual, help.'
    ]);
  });

  it("help exits 0 with the usage text", async () => {
    const root = makeGame();
    const usage = [
      "moku-game <command> [options]",
      "",
      "  dev [--port 3000] [--packed]          serve the game with hot reload",
      "  build [--out dist/web] [--debug [--editor host:port]]  pack the assets and build the page; --debug adds the editor agent and control",
      "  native build <target> [--simulator] [--debug [--editor host:port]]  build the native app (ios, macos, android)",
      "  native build <target> --store --build-number <n>  a store build: an .aab on android, an .ipa on ios",
      "  native build <target> --store --dev --build-number <n>  a store-signed test app from native.dev",
      "  native dev <target>                   run the native shell on the dev server",
      "  native doctor | native clean          check or remove the native project",
      "  keys [--check]                        write generated/assets.ts and generated/manifest.json",
      "  pack [--no-cache]                     pack the assets into dist/assets",
      "  visual [--update] [--only <name>]     run tests/visual/index.ts: headless, pixels on a Mac",
      "    [--no-pixels | --pixels] [--webgl] [--no-verify-frames] [--dir tests/visual/baselines]",
      "    [--tests tests/visual/index.ts] [--url <url>]",
      "  help                                  print this text",
      "",
      "Every command: --root <dir> (default .), --preload <path>, --serve-plugin <path>."
    ];

    for (const argv of [["help"], ["--help"], ["-h"], ["dev", "--help"]]) {
      const { code, seen } = await run(argv, root);

      expect(code, argv.join(" ")).toBe(0);
      expect(seen.out).toEqual(usage);
      expect(seen.errors).toEqual([]);
    }
  });

  it("a --preload or --serve-plugin that is not a file is refused", async () => {
    const root = makeGame();

    expect(await errorsOf(["dev", "--preload", "gone.ts"], root)).toEqual([
      `[game] moku-game: --preload "${path.join(root, "gone.ts")}" is not a file.`
    ]);
    expect(await errorsOf(["build", "--serve-plugin", "gone.ts"], root)).toEqual([
      `[game] moku-game: --serve-plugin "${path.join(root, "gone.ts")}" is not a file.`
    ]);
  });
});

describe("keys and pack", () => {
  /** A config with a layer, as merge-game has. */
  const layered =
    'export default { page: { title: "t" }, assets: { layers: { shared: "ui" } } };\n';

  /** An English string file. */
  const english = '{ "home.title": "Home" }\n';

  it("keys passes the config layers and --pseudo to the scan", async () => {
    const root = makeGame({ "config.ts": layered, "shared/strings/en.json": english });
    const { code, seen } = await run(["keys"], root);

    expect(code).toBe(0);
    expect(seen.scans).toEqual([
      [
        "--root",
        root,
        "--keys",
        path.join(root, "generated", "assets.ts"),
        "--layer",
        "shared=ui",
        "--manifest",
        path.join(root, "generated", "manifest.json"),
        "--pseudo"
      ]
    ]);
  });

  it("keys passes --pseudo for a feature's en strings, and none without an en string file", async () => {
    const featured = makeGame({ "features/home/strings/en.json": english });
    const russianOnly = makeGame({ "features/home/strings/ru.json": english });
    const bare = makeGame();

    const withEnglish = await run(["keys"], featured);
    const withRussian = await run(["keys"], russianOnly);
    const without = await run(["keys"], bare);

    expect(withEnglish.seen.scans[0]?.at(-1)).toBe("--pseudo");
    expect(withRussian.seen.scans[0]).not.toContain("--pseudo");
    expect(without.seen.scans[0]).toEqual([
      "--root",
      bare,
      "--keys",
      path.join(bare, "generated", "assets.ts"),
      "--manifest",
      path.join(bare, "generated", "manifest.json")
    ]);
  });

  it("keys passes --pseudo when only a sub-feature has strings/en.json", async () => {
    const root = makeGame({
      "features/episodes/index.ts": "export {};\n",
      "features/episodes/ep01/index.ts": "export {};\n",
      "features/episodes/ep01/strings/en.json": english
    });
    const { seen } = await run(["keys"], root);

    expect(seen.scans[0]?.at(-1)).toBe("--pseudo");
  });

  it("keys still runs the scan (and the scan reports it) when two folders share a feature name", async () => {
    const root = makeGame({
      "features/kit/index.ts": "export {};\n",
      "features/episodes/kit/index.ts": "export {};\n",
      "features/episodes/kit/strings/en.json": english
    });
    const scans: string[][] = [];
    const { code } = await run(["keys"], root, {
      assets: async argv => {
        scans.push(argv);

        return 1;
      }
    });

    expect(scans).toHaveLength(1);
    expect(code).toBe(1);
  });

  it("keys --check passes --check", async () => {
    const root = makeGame();
    const { seen } = await run(["keys", "--check"], root);

    expect(seen.scans[0]?.at(-1)).toBe("--check");
  });

  it("pack passes --pack <root>/dist/assets and --no-cache", async () => {
    const root = makeGame({ "config.ts": layered });
    const { seen } = await run(["pack", "--no-cache"], root);

    expect(seen.scans).toEqual([
      [
        "--root",
        root,
        "--keys",
        path.join(root, "generated", "assets.ts"),
        "--layer",
        "shared=ui",
        "--pack",
        path.join(root, "dist", "assets"),
        "--no-cache"
      ]
    ]);
  });

  it("keys and pack ignore --serve-plugin and answer the scanner's code", async () => {
    const root = makeGame();
    const { code } = await run(["pack", "--serve-plugin", "gone.ts"], root, {
      assets: async () => 1
    });

    expect(code).toBe(1);
  });
});

describe("native", () => {
  it("native build ios --simulator calls runNative with a command that carries the runner flags", async () => {
    const root = makeGame({
      "config.ts":
        'export default { page: { title: "t" }, native: { name: "T", identifier: "com.t" } };\n',
      "tree/preload.ts": "",
      "tree/bundle.ts": ""
    });
    const flags = ["--preload", "tree/preload.ts", "--serve-plugin", "tree/bundle.ts"];
    const { deps, seen } = fakeDeps(root, { env: { MOKU_GAME_CHILD: "1" } });
    const code = await runCommand(["native", "build", "ios", "--simulator", ...flags], deps);
    const call = seen.natives[0];

    expect(code).toBe(0);
    expect(call?.verb).toBe("build");
    expect(call?.settings.native).toEqual({ name: "T", identifier: "com.t" });
    expect(call?.options).toEqual({ target: "ios", simulator: true });
    expect(call?.where).toEqual({
      cwd: root,
      home: HOME,
      command: [
        BUN,
        SELF,
        "--root",
        root,
        "--preload",
        path.join(root, "tree/preload.ts"),
        "--serve-plugin",
        path.join(root, "tree/bundle.ts")
      ]
        .map(word => JSON.stringify(word))
        .join(" ")
    });
  });

  // Bug: a test project of 8 GB stays on the disk, since no command removes it.
  it("native clean adds the test projects that exist, one by one; doctor stays on the store project", async () => {
    const root = makeGame();
    const dev = path.join(root, ".moku/tauri-dev");
    const debug = path.join(root, ".moku/tauri-debug");
    const both = await run(["native", "clean"], root, { exists: everyFileThere });
    const one = await run(["native", "clean", "ios"], root, { exists: file => file === debug });
    const none = await run(["native", "clean"], root);
    const doctor = await run(["native", "doctor"], root, { exists: everyFileThere });

    expect(both.seen.natives[0]?.options).toEqual({ testProjects: [dev, debug] });
    expect(one.seen.natives[0]?.options).toEqual({ target: "ios", testProjects: [debug] });
    expect(none.seen.natives[0]?.options).toEqual({});
    expect(doctor.seen.natives[0]?.options).toEqual({});
  });

  it("native doctor without a target passes no target, and --simulator only goes with build", async () => {
    const root = makeGame();
    const { seen } = await run(["native", "doctor", "--simulator"], root);

    expect(seen.natives[0]?.verb).toBe("doctor");
    expect(seen.natives[0]?.options).toEqual({});
  });

  it("native false exits 1", async () => {
    const root = makeGame();
    const { code } = await run(["native", "dev", "ios"], root, { native: async () => false });

    expect(code).toBe(1);
  });

  it("native without a verb is refused", async () => {
    const root = makeGame();

    expect(await errorsOf(["native"], root)).toEqual([
      "[game] native: name a verb: build, dev, doctor, clean."
    ]);
    expect(await errorsOf(["native", "ship"], root)).toEqual([
      '[game] native: no verb "ship". Name one of build, dev, doctor, clean.'
    ]);
    expect(await errorsOf(["native", "build", "ios", "now"], root)).toEqual([
      '[game] native: unexpected argument "now".'
    ]);
  });

  it("a native error thrown by runNative is printed and exits 1", async () => {
    const root = makeGame();
    const { code, seen } = await run(["native", "doctor"], root, {
      native: () => Promise.reject(new Error("[game] config.ts has no native section."))
    });

    expect(code).toBe(1);
    expect(seen.errors).toEqual(["[game] config.ts has no native section."]);
  });
});

/**
 * A `config.ts` with the given `native.ios`.
 *
 * @param ios - The block as source text.
 * @returns The text of the file.
 */
function withIos(ios: string): string {
  return `export default { page: { title: "t" }, native: { name: "T", identifier: "com.t", ios: ${ios} } };\n`;
}

/**
 * The file check of a game whose files are all there.
 *
 * @returns True.
 */
function everyFileThere(): boolean {
  return true;
}

describe("native --store", () => {
  /** A config with a native section and nothing else, for the refusals. */
  const bare =
    'export default { page: { title: "t" }, native: { name: "T", identifier: "com.t" } };\n';

  /** What `--store` needs on iOS for no warning at all. */
  const complete = withIos(
    '{ privacyManifest: "ios/PrivacyInfo.xcprivacy", infoPlist: { ITSAppUsesNonExemptEncryption: false } }'
  );

  /** The warning of an iOS store build without a privacy manifest. */
  const noManifest =
    "native: --store on ios with no native.ios.privacyManifest. App Store Connect asks for one.";

  /** The warning of an iOS store build that does not answer the encryption question. */
  const noEncryption =
    "native: --store on ios with no ITSAppUsesNonExemptEncryption in native.ios.infoPlist. App Store Connect asks on every upload without it.";

  // Bug: a store build starts wrong and fails after a long compile, or Play refuses the number.
  it("refuses every wrong line before config.ts is read", async () => {
    const root = makeGame({}, ["config.ts"]);
    const refusals: [string[], string][] = [
      [["native", "dev", "ios", "--store"], "[game] native: --store goes with native build only."],
      [
        ["native", "doctor", "--store", "--build-number", "1"],
        "[game] native: --store goes with native build only."
      ],
      [
        ["native", "build", "ios", "--build-number", "12"],
        "[game] native: --build-number goes with --store."
      ],
      [
        ["native", "build", "ios", "--store"],
        "[game] native: --store needs --build-number, the number of this upload."
      ],
      [
        ["native", "build", "android", "--store", "--build-number", "1", "--debug"],
        "[game] native: --store does not go with --debug."
      ],
      [
        ["native", "build", "ios", "--store", "--build-number", "1", "--debug"],
        "[game] native: --store does not go with --debug."
      ],
      [
        ["native", "build", "android", "--store", "--build-number", "1", "--editor", "h:1"],
        "[game] native: --store does not go with --editor."
      ],
      [
        ["native", "build", "ios", "--store", "--build-number", "1", "--simulator"],
        "[game] native: --store does not go with --simulator."
      ],
      [["native", "build", "ios", "--dev"], "[game] native: --dev goes with --store."],
      [
        ["native", "build", "android", "--dev", "--build-number", "1"],
        "[game] native: --dev goes with --store."
      ],
      [
        ["native", "build", "android", "--store", "--dev", "--build-number", "1", "--debug"],
        "[game] native: --store does not go with --debug."
      ],
      [
        ["native", "build", "ios", "--store", "--dev", "--build-number", "1", "--simulator"],
        "[game] native: --store does not go with --simulator."
      ],
      [
        ["native", "build", "macos", "--store", "--build-number", "1"],
        "[game] native: --store builds ios or android, got macos."
      ],
      [
        ["native", "build", "--store", "--build-number", "1"],
        "[game] native: --store builds ios or android, got no target."
      ]
    ];

    for (const [argv, message] of refusals) {
      const { code, seen } = await run(argv, root);

      expect(code, argv.join(" ")).toBe(1);
      expect(seen.errors).toEqual([message]);
      expect(seen.natives).toEqual([]);
    }
  });

  it("--build-number takes an integer from 1 to 2100000000, boundaries included", async () => {
    const root = makeGame({ "config.ts": bare });
    const argv = ["native", "build", "android", "--store"];

    for (const number of ["0", "-1", "1.5", "12a", "2100000001", "1e3", " 7"]) {
      const { code, seen } = await run([...argv, `--build-number=${number}`], root);

      expect(code, number).toBe(1);
      expect(seen.errors).toEqual([
        `[game] native: --build-number takes an integer from 1 to 2100000000, got "${number}".`
      ]);
      expect(seen.natives).toEqual([]);
    }

    for (const [text, number] of [
      ["1", 1],
      ["2100000000", 2_100_000_000]
    ] as const) {
      const { seen } = await run([...argv, "--build-number", text], root);

      expect(seen.natives[0]?.options.store?.buildNumber).toBe(number);
    }
  });

  // Bug: runNative gets the checks' seams from nowhere, or the version of the wrong folder.
  it("--store hands native the number and the seams of its checks", async () => {
    const root = makeGame({ "config.ts": bare });
    const env = { KS_PASS: "set" };
    const roots: string[] = [];
    const { code, seen } = await run(
      ["native", "build", "android", "--store", "--build-number", "12"],
      root,
      {
        env,
        exists: everyFileThere,
        readPackageVersion: from => {
          roots.push(from);

          return "1.2.3";
        }
      }
    );

    expect(code).toBe(0);
    expect(roots).toEqual([root]);
    expect(seen.natives[0]?.options).toEqual({
      target: "android",
      version: "1.2.3",
      store: { buildNumber: 12, env, exists: everyFileThere }
    });
    expect(seen.natives[0]?.where.home).toBe(HOME);
  });

  // Bug: a test build goes down the players' road, with no dev flag for native and no test app.
  it("--store --dev marks the store block, and the iOS warnings of a store build stay", async () => {
    const config =
      'export default { page: { title: "t" }, native: { name: "T", identifier: "com.t", dev: { identifier: "com.t.dev" } } };\n';
    const root = makeGame({ "config.ts": config });
    const env = { KS_PASS: "set" };
    const { code, seen } = await run(
      ["native", "build", "ios", "--store", "--dev", "--build-number", "13"],
      root,
      { env, exists: everyFileThere }
    );

    expect(code).toBe(0);
    expect(seen.natives[0]?.options.store).toEqual({
      buildNumber: 13,
      dev: true,
      env,
      exists: everyFileThere
    });
    expect(seen.warnings).toEqual([noManifest, noEncryption]);
  });

  // Bug: a game without the block gets a cryptic failure from deep in native.
  it("--store --dev with no native.dev is refused once config.ts is read, and nothing runs", async () => {
    const root = makeGame({ "config.ts": bare });
    const { code, seen } = await run(
      ["native", "build", "android", "--store", "--dev", "--build-number", "13"],
      root
    );

    expect(code).toBe(1);
    expect(seen.errors).toEqual([
      "[game] native --dev: config.ts has no native.dev.\n  Add native.dev: { identifier } with an id ending in .dev."
    ]);
    expect(seen.natives).toEqual([]);
  });

  // Bug: a plain build ships native's 0.1.0 though the game has a version.
  it("a plain build carries the version of package.json too, and no store block", async () => {
    const root = makeGame({ "config.ts": bare });
    const { seen } = await run(["native", "build", "ios"], root, {
      readPackageVersion: () => "1.2.3"
    });

    expect(seen.natives[0]?.options).toEqual({ target: "ios", version: "1.2.3" });
  });

  // Bug: a store upload goes without the two things App Store Connect asks for, and nobody says so.
  it("an iOS store build warns about a missing manifest and encryption key, and still builds", async () => {
    const argv = ["native", "build", "ios", "--store", "--build-number", "12"];
    const neither = await run(argv, makeGame({ "config.ts": bare }));
    const plist = await run(
      argv,
      makeGame({ "config.ts": withIos("{ infoPlist: { ITSAppUsesNonExemptEncryption: true } }") })
    );
    const manifest = await run(
      argv,
      makeGame({ "config.ts": withIos('{ privacyManifest: "p.xcprivacy" }') })
    );
    const both = await run(argv, makeGame({ "config.ts": complete }));

    expect([neither, plist, manifest, both].map(ran => ran.seen.warnings)).toEqual([
      [noManifest, noEncryption],
      [noManifest],
      [noEncryption],
      []
    ]);
    expect([neither, plist, manifest, both].map(ran => ran.code)).toEqual([0, 0, 0, 0]);
  });

  // Bug: an iOS warning lands on an Android store build, which has no such questions.
  it("an Android store build prints no iOS warning", async () => {
    const root = makeGame({ "config.ts": bare });
    const { seen } = await run(
      ["native", "build", "android", "--store", "--build-number", "12"],
      root
    );

    expect(seen.warnings).toEqual([]);
  });

  // Bug: a store warning speaks over the plain error of a game with no native section.
  it("a game with no native section gets no store warning", async () => {
    const root = makeGame();
    const { seen } = await run(["native", "build", "ios", "--store", "--build-number", "1"], root);

    expect(seen.warnings).toEqual([]);
  });

  // Bug: a plain build with a signing block and no passwords fails after a whole compile.
  it("a plain android build without its passwords leaves the key out and says so", async () => {
    const root = makeGame({
      "config.ts":
        'export default { page: { title: "t" }, native: { name: "T", identifier: "com.t", signing: { android: { keystorePath: "k.jks", keystorePasswordEnv: "KS_PASS", keyPasswordEnv: "KEY_PASS", keyAlias: "a" } } } };\n'
    });
    const argv = ["native", "build", "android"];
    const without = await run(argv, root, { env: { KS_PASS: "ks-secret-value" } });

    expect(without.seen.natives[0]?.options.unsigned).toBe(true);
    expect(without.seen.warnings).toEqual([
      "native: KEY_PASS not set, so this build is an unsigned .apk."
    ]);

    const both = await run(argv, root, { env: { KS_PASS: "a", KEY_PASS: "b" } });

    expect(both.seen.natives[0]?.options).not.toHaveProperty("unsigned");
    expect(both.seen.warnings).toEqual([]);

    const debug = await run([...argv, "--debug"], root);

    expect(debug.seen.natives[0]?.options).not.toHaveProperty("unsigned");
  });

  // Bug: the store checks land on the plain device build, which Р6 keeps free of them.
  it("native build ios with signing and ios set prints no store warning and carries no store block", async () => {
    const root = makeGame({
      "config.ts":
        'export default { page: { title: "t" }, native: { name: "T", identifier: "com.t", signing: { apple: { teamId: "T1" } }, ios: { minimumVersion: "26.0" } } };\n'
    });
    const { code, seen } = await run(["native", "build", "ios"], root);

    expect(code).toBe(0);
    expect(seen.warnings).toEqual([]);
    expect(seen.natives[0]?.options).toEqual({ target: "ios" });
  });
});

describe("--debug and --editor", () => {
  /** A config with a native section, for the native verbs. */
  const native =
    'export default { page: { title: "t" }, native: { name: "T", identifier: "com.t" } };\n';

  /** The warning of a native debug build. */
  const nativeWarning =
    "native: a DEBUG app with the editor agent, installed beside the store app. Never ship it to a store.";

  /** The one line `--debug=full` prints: the alias is accepted and changes nothing. */
  const aliasNote = "--debug already includes control; =full is no longer needed";

  it("native build android takes --debug as full, --debug=full the same with the alias note once, --debug=read as read, and warns once", async () => {
    const root = makeGame({ "config.ts": native });
    const bare = await run(["native", "build", "android", "--debug"], root);
    const read = await run(["native", "build", "android", "--debug=read"], root);
    const full = await run(
      ["native", "build", "android", "--debug=full", "--editor", "192.168.1.20:47600"],
      root
    );
    const store = await run(["native", "build", "android"], root);

    expect(bare.seen.natives[0]?.options).toEqual({ target: "android", debug: "full" });
    expect(read.seen.natives[0]?.options).toEqual({ target: "android", debug: "read" });
    expect(full.seen.natives[0]?.options).toEqual({
      target: "android",
      debug: "full",
      editor: "192.168.1.20:47600"
    });
    expect(store.seen.natives[0]?.options).toEqual({ target: "android" });
    expect([bare, full, store].map(ran => ran.seen.warnings)).toEqual([
      [nativeWarning],
      [nativeWarning],
      []
    ]);
    expect([bare, read, full, store].map(ran => ran.seen.out)).toEqual([[], [], [aliasNote], []]);
  });

  it("build --debug=full prints the alias note once; build --debug and --debug=read print none", async () => {
    const root = makeGame();
    // The pack fails, so each run stops after the debug page is resolved and before the bundle.
    const stop = { assets: async () => 2 };
    const notes = async (flag: string): Promise<string[]> => {
      const { seen } = await run(["build", flag], root, stop);

      return seen.out.filter(line => line === aliasNote);
    };

    expect(await notes("--debug=full")).toEqual([aliasNote]);
    expect(await notes("--debug")).toEqual([]);
    expect(await notes("--debug=read")).toEqual([]);
  });

  // Bug: N4 stays closed, or the debug app of iOS goes out with no word on what it is.
  it("native build ios takes --debug with its editor address and warns as on Android", async () => {
    const root = makeGame({ "config.ts": native });
    const { code, seen } = await run(
      ["native", "build", "ios", "--debug", "--simulator", "--editor", "192.168.1.20:47600"],
      root
    );

    expect(code).toBe(0);
    expect(seen.natives[0]?.options).toEqual({
      target: "ios",
      simulator: true,
      debug: "full",
      editor: "192.168.1.20:47600"
    });
    expect(seen.warnings).toEqual([nativeWarning]);
  });

  it("native dev --debug is refused, native build macos --debug is refused as Android and iOS only, and --editor needs --debug", async () => {
    const root = makeGame({ "config.ts": native });

    expect(await errorsOf(["native", "dev", "android", "--debug"], root)).toEqual([
      "[game] native: --debug goes with native build only."
    ]);
    expect(await errorsOf(["native", "build", "macos", "--debug"], root)).toEqual([
      "[game] native: --debug builds Android and iOS only for now (got macos)."
    ]);
    expect(await errorsOf(["native", "build", "android", "--editor", "h:1"], root)).toEqual([
      "[game] native: --editor goes with --debug."
    ]);
    expect(await errorsOf(["native", "build", "android", "--debug", "full"], root)).toEqual([
      '[game] native: unexpected argument "full". Write --debug.'
    ]);
  });

  it("--debug=loud is refused naming the value, build --debug full says how to write it, and the other commands take no --debug", async () => {
    const root = makeGame();

    expect(await errorsOf(["build", "--debug=loud"], root)).toEqual([
      '[game] build: --debug takes no value, "read" or "full", got "loud".'
    ]);
    expect(await errorsOf(["build", "--debug", "full"], root)).toEqual([
      '[game] build: unexpected argument "full". Write --debug.'
    ]);
    expect(await errorsOf(["build", "--debug", "read"], root)).toEqual([
      '[game] build: unexpected argument "read". Write --debug=read.'
    ]);

    for (const command of ["dev", "keys", "pack", "visual"]) {
      expect(await errorsOf([command, "--debug"], root)).toEqual([
        `[game] ${command}: unknown option "--debug".`
      ]);
    }
  });

  it("--editor takes host:port, refuses phone, :47600 and host:70000, and is refused without --debug", async () => {
    const root = makeGame();

    for (const editor of ["phone", ":47600", "host:70000", "host:0", "two words:47600"]) {
      const { code, seen } = await run(["build", "--debug", "--editor", editor], root);

      expect(code, editor).toBe(1);
      expect(seen.errors).toEqual([`[game] build: --editor takes host:port, got "${editor}".`]);
      expect(seen.scans).toEqual([]);
    }

    expect(await errorsOf(["build", "--editor", "192.168.1.20:47600"], root)).toEqual([
      "[game] build: --editor goes with --debug."
    ]);
  });

  it("with MOKU_NATIVE_PROFILE=store build --debug is refused before anything is built; with debug and no --debug a release page is built", async () => {
    const root = makeGame();
    const store = await run(["build", "--debug"], root, { env: { MOKU_NATIVE_PROFILE: "store" } });
    const debug = await run(["build"], root, {
      env: { MOKU_NATIVE_PROFILE: "debug" },
      assets: async () => 2
    });

    expect(store.code).toBe(1);
    expect(store.seen.errors).toEqual([
      "[game] build: MOKU_NATIVE_PROFILE is store: a store page must not carry the editor agent.\n  Build the store app without --debug."
    ]);
    expect(store.seen.scans).toEqual([]);
    // The release page went on to the pack: nothing refused it.
    expect(debug.code).toBe(2);
    expect(debug.seen.errors).toEqual([]);
  });
});

describe("MOKU_NATIVE_PROFILE=dev", () => {
  /** The profile of native's web build for a test app. */
  const dev = { env: { MOKU_NATIVE_PROFILE: "dev" } };

  // Bug: a test app with no overlay: native's own check lets the page through.
  it("a release page is refused before anything is built", async () => {
    const { code, seen } = await run(["build"], makeGame(), dev);

    expect(code).toBe(1);
    expect(seen.errors).toEqual([
      "[game] build: MOKU_NATIVE_PROFILE is dev: a dev page carries the overlay."
    ]);
    expect(seen.scans).toEqual([]);
  });

  // Bug: a tester's phone dials a Mac that is not there, or the overlay's toggles are greyed out.
  it("--editor and --debug=read are refused, the read-only page and the address have no place on it", async () => {
    const root = makeGame();
    const editor = await run(["build", "--debug", "--editor", "127.0.0.1:47600"], root, dev);
    const read = await run(["build", "--debug=read"], root, dev);

    expect(editor.seen.errors).toEqual([
      "[game] build: MOKU_NATIVE_PROFILE is dev: a dev page has no editor link.\n  Build it without --editor."
    ]);
    expect(read.seen.errors).toEqual([
      "[game] build: MOKU_NATIVE_PROFILE is dev: a dev page runs every command.\n  Build it with --debug."
    ]);
    expect([...editor.seen.scans, ...read.seen.scans]).toEqual([]);
  });

  // Bug: an editor whose version nobody can read may be one that dials for ever.
  it("an editor whose version cannot be read is refused", async () => {
    // The stub resolver answers a path with no package.json above it.
    const { code, seen } = await run(["build", "--debug"], makeGame(), dev);

    expect(code).toBe(1);
    expect(seen.errors).toEqual([
      "[game] build: a dev page needs @moku-labs/editor 0.10.19 or newer, found no readable version.\n  An older one dials the editor for ever. Run: bun add -d @moku-labs/editor@latest."
    ]);
    expect(seen.scans).toEqual([]);
  });
});

describe("the --preload re-run", () => {
  it("--preload outside dev re-runs the bin once with --preload=", async () => {
    const root = makeGame({ "tree/preload.ts": "" });
    const argv = ["keys", "--preload", "tree/preload.ts"];
    const { deps, seen } = fakeDeps(root, { env: { HOME: "/home/a" } }, Promise.resolve(3));
    const code = await runCommand(argv, deps);

    expect(code).toBe(3);
    expect(seen.scans).toEqual([]);
    expect(seen.spawns).toEqual([
      {
        command: [BUN, `--preload=${path.join(root, "tree/preload.ts")}`, SELF, ...argv],
        options: {
          env: { HOME: "/home/a", MOKU_GAME_CHILD: "1" },
          stdio: ["inherit", "inherit", "inherit"]
        }
      }
    ]);
  });

  it("the re-run does not hop again, and dev never hops", async () => {
    const root = makeGame({ "tree/preload.ts": "" });
    const child = await run(["keys", "--preload", "tree/preload.ts"], root, {
      env: { MOKU_GAME_CHILD: "1" }
    });
    const dev = await run(["dev", "--preload", "tree/preload.ts"], root);

    expect(child.seen.spawns).toEqual([]);
    expect(child.seen.scans).toHaveLength(1);
    expect(dev.seen.spawns[0]?.command[1]).toBe(
      `--config=${path.join(root, ".moku", "bunfig.toml")}`
    );
  });
});

/**
 * Runs a command line with the real seams, the console caught.
 *
 * @param argv - The arguments after the bin.
 * @returns The exit code and the stdout lines.
 */
async function runReal(argv: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });

  try {
    return { code: await runCli(argv), lines };
  } finally {
    log.mockRestore();
  }
}

describe.skipIf(typeof Bun === "undefined")("runCli", () => {
  it("runs help in this process with the branded console", async () => {
    const { code, lines } = await runReal(["help"]);

    expect(code).toBe(0);
    expect(lines[0]).toBe("moku-game <command> [options]");
  });

  // The scanner loads the game's assets.ts, which imports the whole engine through its kit: slow
  // under coverage, so this test has its own timeout.
  it("runs keys --check through the real asset scanner", async () => {
    const copies = [copyMiniGame("cli-keys")];

    try {
      const { code, lines } = await runReal(["keys", "--check", "--root", copies[0] ?? ""]);

      expect(code).toBe(0);
      expect(lines.join("\n")).toContain("are up to date.");
    } finally {
      removeCopies(copies);
    }
  }, 30_000);

  // Bug: the real seams read the wrong folder, or leave `~/` to Gradle.
  it("runs the store checks over the real home folder, the real file check and package.json", async () => {
    const root = makeGame({
      "config.ts":
        'export default { page: { title: "t" }, native: { name: "T", identifier: "com.t", signing: { android: { keystorePath: "~/moku-no-such-key.jks", keystorePasswordEnv: "MOKU_NO_SUCH_VAR", keyAlias: "a" } } } };\n',
      "package.json": '{ "version": "1.2" }\n'
    });
    const errors: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });

    try {
      const { code } = await runReal([
        "native",
        "build",
        "android",
        "--store",
        "--build-number",
        "12",
        "--root",
        root
      ]);

      expect(code).toBe(1);
    } finally {
      error.mockRestore();
    }

    const text = errors.join("\n");

    expect(text).toContain(
      `The keystore ${path.join(homedir(), "moku-no-such-key.jks")} is not a file.`
    );
    expect(text).toContain("The env var MOKU_NO_SUCH_VAR is not set.");
    expect(text).toContain('package.json has version "1.2".');
  });

  // Bug: a broken package.json stops the build with a parse error instead of the plain problem.
  it("the real seam reads a broken or version-less package.json as no version", async () => {
    const config =
      'export default { page: { title: "t" }, native: { name: "T", identifier: "com.t" } };\n';
    const roots = [
      makeGame({ "config.ts": config, "package.json": "{ broken" }),
      makeGame({ "config.ts": config, "package.json": '{ "version": 1 }\n' }),
      makeGame({ "config.ts": config })
    ];
    const errors: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });

    try {
      for (const root of roots) {
        await runReal(["native", "build", "ios", "--store", "--build-number", "1", "--root", root]);
      }
    } finally {
      error.mockRestore();
    }

    expect(errors.filter(line => line.includes("package.json has no version."))).toHaveLength(3);
  });

  it("runs keys through the real scanner on a game with no string file", async () => {
    const copies = [copyMiniGame("cli-keys-bare")];
    const root = copies[0] ?? "";

    try {
      rmSync(path.join(root, "features", "home", "strings"), { recursive: true });

      const { code, lines } = await runReal(["keys", "--root", root]);

      expect(code).toBe(0);
      expect(lines.join("\n")).not.toContain("--pseudo");
    } finally {
      removeCopies(copies);
    }
  });
});
