/**
 * @file The command line of `moku-game` over stub seams: the flags of every command, the dev
 * parent (the written page, the re-run under the bunfig, the signals, the scenario watcher, the
 * advice), the dev child's server, `keys` and `pack` through the asset scanner, `native` through
 * `runNative`, the `--preload` re-run, and `runCli` with the real seams of this process.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, Signal, SpawnOptions } from "../../src/app/cli";
import { runCommand } from "../../src/app/cli";
import type { NativeVerb, NativeVerbOptions, NativeWhere } from "../../src/app/native";
import { staticPath } from "../../src/app/serve";
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
    "manifest.json": '{ "version": 1, "bundles": {} }\n',
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
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
    expect(read(root, ".moku/main.ts")).toContain('import "./dev.ts";');
    expect(read(root, ".moku/bunfig.toml")).toContain(`plugins = ["${HOT}"]`);
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

  it("dev warns when manifest.json is missing and when .moku is not ignored", async () => {
    const root = makeGame({ ".gitignore": "node_modules\n" }, ["manifest.json"]);
    const { code, seen } = await run(["dev"], root);

    expect(code).toBe(0);
    expect(seen.warnings).toEqual([
      `[game] dev: no manifest.json in "${root}".\n  Run "moku-game keys" first.`,
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
      "manifest.json": "{}\n"
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

  it("dev --packed refuses without a pack and passes --packed to the child with one", async () => {
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

  it("a second dev with the same game rewrites nothing", async () => {
    const root = makeGame();
    const files = ["index.html", "dev.ts", "main.ts", "bunfig.toml"].map(file =>
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
      "node_modules/x/index.js": "installed"
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
      "  build [--out dist/web]                pack the assets and build the page",
      "  native build <target> [--simulator]   build the native app (ios, macos, android)",
      "  native dev <target>                   run the native shell on the dev server",
      "  native doctor | native clean          check or remove the native project",
      "  keys [--check]                        write generated/assets.ts and manifest.json",
      "  pack [--no-cache]                     pack the assets into dist/assets",
      "  visual [--update] [--only <name>]     run tests/visual/index.ts: headless, pixels on a Mac",
      "    [--no-pixels | --pixels] [--webgl] [--dir tests/visual/baselines]",
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
        path.join(root, "manifest.json"),
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
      path.join(bare, "manifest.json")
    ]);
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

  it("runs keys --check through the real asset scanner", async () => {
    const copies = [copyMiniGame("cli-keys")];

    try {
      const { code, lines } = await runReal(["keys", "--check", "--root", copies[0] ?? ""]);

      expect(code).toBe(0);
      expect(lines.join("\n")).toContain("are up to date.");
    } finally {
      removeCopies(copies);
    }
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
