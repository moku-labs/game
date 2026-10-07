/**
 * @file `moku-game visual` over stub seams: the flags read through `parseVisualArgv`, the tests
 * module (`tests/visual/index.ts` by default) and its refused shapes, the baselines folder, the
 * page of the pixel leg served in this process on a free port and stopped after, `--url` instead
 * of the server, the exit code from the report, and `runCli` with the real runner.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../../src/app/cli";
import { runCommand } from "../../src/app/cli";
import { runCli } from "../../src/cli";
import type { VisualOptions, VisualReport, VisualSetup, VisualTest } from "../../src/visual";
import { parseVisualArgv } from "../../src/visual";

/** One call of the stub runner. */
type Call = { setup: VisualSetup; tests: readonly VisualTest[]; options: VisualOptions };

/** What the stub seams saw. */
type Seen = { calls: Call[]; errors: string[]; pages: string[] };

/** How the stub runner answers a call. */
type Runner = (call: Call) => Promise<VisualReport>;

/** The tests module of a game whose app is never built: the runner is a stub. */
const SUITE = [
  'export const app = () => { throw new Error("not built"); };',
  'export default { app, tests: [{ name: "home" }] };',
  ""
].join("\n");

/** The message of a missing or wrong tests module. */
const refused = (file: string): string =>
  `[game] visual: ${file} must export default { app, tests }.`;

/** The temp folders of a test, removed after it. */
const made: string[] = [];

afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

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
 * Makes a temp game folder: `config.ts`, `index.ts`, `.gitignore` and `tests/visual/index.ts`,
 * plus the given files, minus the left-out ones.
 *
 * @param files - Files by path under the game.
 * @param leftOut - Default files to leave out.
 * @returns The game folder.
 */
function makeGame(files: Record<string, string> = {}, leftOut: string[] = []): string {
  const root = mkdtempSync(path.join(tmpdir(), "moku-game-visual-"));
  const all: Record<string, string> = {
    "config.ts": 'export default { page: { title: "t" } };\n',
    "index.ts": "export default {};\n",
    ".gitignore": ".moku/\n",
    "tests/visual/index.ts": SUITE,
    ...files
  };

  made.push(root);

  for (const [file, text] of Object.entries(all)) {
    if (!leftOut.includes(file)) put(path.join(root, file), text);
  }

  return root;
}

/**
 * A seam the command never calls.
 *
 * @throws {Error} Always.
 */
function unused(): never {
  throw new Error("unused seam");
}

/** The report of a run where every checkpoint passed. */
const passed: Runner = async () => ({ ok: true, tests: [] });

/**
 * Makes the stub seams of `moku-game visual`: a real `parseVisualArgv`, a stub runner, a stub
 * page loader. Every other seam is unused by the command and throws.
 *
 * @param cwd - The working directory.
 * @param runner - How the stub runner answers.
 * @returns The seams and what they saw.
 */
function fakeDeps(cwd: string, runner: Runner = passed): { deps: CliDeps; seen: Seen } {
  const seen: Seen = { calls: [], errors: [], pages: [] };
  const deps: CliDeps = {
    ui: {
      info: unused,
      line: unused,
      warn: unused,
      error: message => seen.errors.push(message)
    },
    env: {},
    cwd,
    execPath: "/bin/bun",
    self: ["/game/node_modules/@moku-labs/game/bin/moku-game.mjs"],
    spawn: unused,
    onSignal: unused,
    watch: unused,
    assets: unused,
    native: unused,
    resolve: () => "/engine/dist/hot.mjs",
    loadPage: async file => {
      seen.pages.push(file);

      return { default: new Response("<html>the page</html>") };
    },
    visual: async () => ({
      parseVisualArgv,
      runVisualTests: (setup, tests, options = {}) => {
        const call = { setup, tests, options };

        seen.calls.push(call);

        return runner(call);
      }
    })
  };

  return { deps, seen };
}

/**
 * Runs a command line over stub seams.
 *
 * @param argv - The arguments after the bin.
 * @param cwd - The working directory.
 * @param runner - How the stub runner answers.
 * @returns The exit code and what the seams saw.
 */
async function run(
  argv: string[],
  cwd: string,
  runner?: Runner
): Promise<{ code: number; seen: Seen }> {
  const { deps, seen } = fakeDeps(cwd, runner);
  const code = await runCommand(argv, deps);

  return { code, seen };
}

/**
 * Imports a tests module the way the command does, to compare what the runner got.
 *
 * @param file - The absolute path.
 * @returns The module.
 */
async function suiteAt(file: string): Promise<{ app: unknown }> {
  return (await import(pathToFileURL(file).href)) as { app: unknown };
}

/**
 * Fetches a URL and reads its body, or `"stopped"` when nothing answers.
 *
 * @param url - The URL.
 * @returns The body, or `"stopped"`.
 */
async function bodyAt(url: string): Promise<string> {
  try {
    const response = await fetch(url);

    return await response.text();
  } catch {
    return "stopped";
  }
}

describe("moku-game visual, the tests module and the baselines", () => {
  it("runs tests/visual/index.ts of the game against tests/visual/baselines", async () => {
    const root = makeGame();
    const { code, seen } = await run(["visual", "--no-pixels"], root);
    const suite = await suiteAt(path.join(root, "tests", "visual", "index.ts"));

    expect(code).toBe(0);
    expect(seen.errors).toEqual([]);
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]?.setup).toEqual({ app: suite.app });
    expect(seen.calls[0]?.tests).toEqual([{ name: "home" }]);
    expect(seen.calls[0]?.options).toEqual({
      pixels: false,
      dir: path.join(root, "tests", "visual", "baselines"),
      argv: []
    });
  });

  it("reads the module and the baselines of the --root game", async () => {
    const root = makeGame();
    const cwd = path.dirname(root);
    const { code, seen } = await run(["visual", "--root", path.basename(root), "--no-pixels"], cwd);

    expect(code).toBe(0);
    expect(seen.calls[0]?.tests).toEqual([{ name: "home" }]);
    expect(seen.calls[0]?.options.dir).toBe(path.join(root, "tests", "visual", "baselines"));
  });

  it("reads --tests and --dir against the cwd", async () => {
    const root = makeGame({ "suites/all.ts": SUITE.replace('"home"', '"all"') });
    const { code, seen } = await run(
      ["visual", "--tests", "suites/all.ts", "--dir", "shots", "--no-pixels"],
      root
    );

    expect(code).toBe(0);
    expect(seen.calls[0]?.tests).toEqual([{ name: "all" }]);
    expect(seen.calls[0]?.options.dir).toBe(path.join(root, "shots"));
  });

  it("takes a whole VisualSetup as app, its page kept", async () => {
    const root = makeGame({
      "tests/visual/index.ts":
        "export default { app: { app: () => 0, page: { url: 'unused', width: 430 } }, tests: [] };\n"
    });
    const { code, seen } = await run(["visual", "--pixels", "--url", "http://127.0.0.1:9/"], root);

    expect(code).toBe(0);
    expect(seen.calls[0]?.setup.page).toEqual({ url: "http://127.0.0.1:9/", width: 430 });
    expect(typeof seen.calls[0]?.setup.app).toBe("function");
  });

  it("refuses a missing module, named against the cwd, and runs nothing", async () => {
    const root = makeGame({}, ["tests/visual/index.ts"]);
    const own = await run(["visual", "--no-pixels"], root);
    const other = await run(
      ["visual", "--root", path.basename(root), "--no-pixels"],
      path.dirname(root)
    );

    expect(own.code).toBe(1);
    expect(own.seen.errors).toEqual([refused(path.join("tests", "visual", "index.ts"))]);
    expect(own.seen.calls).toEqual([]);
    expect(other.seen.errors).toEqual([
      refused(path.join(path.basename(root), "tests", "visual", "index.ts"))
    ]);
  });

  it.each([
    ["no default export", "export const app = () => 0;\n"],
    ["a default that is no object", "export default 5;\n"],
    ["no app", "export default { tests: [] };\n"],
    ["no tests", "export default { app: () => 0 };\n"],
    ["an app that is no function", "export default { app: 1, tests: [] };\n"],
    ["a setup without its app", "export default { app: { page: { url: 'x' } }, tests: [] };\n"],
    ["tests that are no list", "export default { app: () => 0, tests: {} };\n"]
  ])("refuses a module with %s", async (_shape, text) => {
    const root = makeGame({ "tests/visual/index.ts": text });
    const { code, seen } = await run(["visual", "--no-pixels"], root);

    expect(code).toBe(1);
    expect(seen.errors).toEqual([refused(path.join("tests", "visual", "index.ts"))]);
    expect(seen.calls).toEqual([]);
  });
});

describe("moku-game visual, the flags", () => {
  it("hands every flag of parseVisualArgv to the runner", async () => {
    const root = makeGame();
    const { code, seen } = await run(
      [
        "visual",
        "--update",
        "--only",
        "home",
        "--only",
        "info",
        "--webgl",
        "--no-pixels",
        "--dir",
        "shots"
      ],
      root
    );

    expect(code).toBe(0);
    expect(seen.calls[0]?.options).toEqual({
      update: true,
      only: ["home", "info"],
      renderer: "webgl",
      pixels: false,
      dir: path.join(root, "shots"),
      argv: []
    });
  });

  it("reads a flag with its value inline", async () => {
    const root = makeGame();
    const { seen } = await run(["visual", "--only=home", "--dir=shots", "--no-pixels"], root);

    expect(seen.calls[0]?.options).toEqual({
      only: ["home"],
      pixels: false,
      dir: path.join(root, "shots"),
      argv: []
    });
  });

  it("runs the pixel leg on a Mac only without --pixels or --no-pixels", async () => {
    const root = makeGame();
    const platform = Object.getOwnPropertyDescriptor(process, "platform") ?? { value: "darwin" };
    const pixelsOn = async (name: string, argv: string[] = []): Promise<unknown> => {
      Object.defineProperty(process, "platform", { value: name });

      const { seen } = await run(["visual", "--url", "http://127.0.0.1:9/", ...argv], root);

      return seen.calls[0]?.options.pixels;
    };

    try {
      expect(await pixelsOn("darwin")).toBe(true);
      expect(await pixelsOn("linux")).toBe(false);
      expect(await pixelsOn("linux", ["--pixels"])).toBe(true);
      expect(await pixelsOn("darwin", ["--no-pixels"])).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("refuses a flag it does not take, a flag without its value and an extra word", async () => {
    const root = makeGame();
    const errorsOf = async (argv: string[]): Promise<string[]> => {
      const { seen } = await run(argv, root);

      return seen.errors;
    };

    expect(await errorsOf(["visual", "--port", "3"])).toEqual([
      '[game] visual: unknown option "--port".'
    ]);
    expect(await errorsOf(["visual", "--only"])).toEqual([
      '[game] visual: "--only" needs a value.'
    ]);
    expect(await errorsOf(["visual", "--webgl=yes"])).toEqual([
      '[game] visual: "--webgl" takes no value.'
    ]);
    expect(await errorsOf(["visual", "now"])).toEqual([
      '[game] visual: unexpected argument "now".'
    ]);
  });
});

describe("moku-game visual, the page of the pixel leg", () => {
  it("serves the dev page in this process on a free port and stops it after", async () => {
    const root = makeGame();
    const bodies: string[] = [];
    const { code, seen } = await run(["visual", "--pixels"], root, async ({ setup }) => {
      bodies.push(await bodyAt(setup.page?.url ?? ""));

      return { ok: true, tests: [] };
    });
    const url = seen.calls[0]?.setup.page?.url ?? "";

    expect(code).toBe(0);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(bodies).toEqual(["<html>the page</html>"]);
    expect(seen.pages).toEqual([path.join(root, ".moku", "index.html")]);
    expect(existsSync(path.join(root, ".moku", "main.ts"))).toBe(true);
    expect(seen.calls[0]?.options.pixels).toBe(true);
    expect(await bodyAt(url)).toBe("stopped");
  });

  it("stops the server when the runner throws, and exits 1 with its message", async () => {
    const root = makeGame();
    const urls: string[] = [];
    const { code, seen } = await run(["visual", "--pixels"], root, async ({ setup }) => {
      urls.push(setup.page?.url ?? "");

      throw new Error("[game] The pixel leg needs playwright-core.");
    });

    expect(code).toBe(1);
    expect(seen.errors).toEqual(["[game] The pixel leg needs playwright-core."]);
    expect(await bodyAt(urls[0] ?? "")).toBe("stopped");
  });

  it("uses --url instead of a server", async () => {
    const root = makeGame();
    const { code, seen } = await run(["visual", "--pixels", "--url", "http://127.0.0.1:9/"], root);

    expect(code).toBe(0);
    expect(seen.calls[0]?.setup.page).toEqual({ url: "http://127.0.0.1:9/" });
    expect(seen.pages).toEqual([]);
    expect(existsSync(path.join(root, ".moku"))).toBe(false);
  });

  it("serves nothing and names no page with --no-pixels", async () => {
    const root = makeGame();
    const { seen } = await run(["visual", "--no-pixels"], root);

    expect(seen.calls[0]?.setup.page).toBeUndefined();
    expect(seen.pages).toEqual([]);
  });

  it("refuses to serve a game without config.ts", async () => {
    const root = makeGame({}, ["config.ts"]);
    const { code, seen } = await run(["visual", "--pixels"], root);

    expect(code).toBe(1);
    expect(seen.errors[0]).toBe(
      `[game] moku-game: no config.ts in "${root}".\n  A game keeps its page, native, system, save and assets data there.`
    );
    expect(seen.calls).toEqual([]);
  });
});

describe("moku-game visual, the exit code", () => {
  it("exits 1 when the report is not ok", async () => {
    const root = makeGame();
    const { code, seen } = await run(["visual", "--no-pixels"], root, async () => ({
      ok: false,
      tests: [{ name: "home", checkpoints: [], error: "boom" }]
    }));

    expect(code).toBe(1);
    expect(seen.errors).toEqual([]);
  });
});

describe.skipIf(typeof Bun === "undefined")("runCli visual", () => {
  it("runs the real runner in this process: no test, a passing report", async () => {
    const root = makeGame({
      "tests/visual/index.ts": "export default { app: () => 0, tests: [] };\n"
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await runCli(["visual", "--root", root, "--no-pixels"])).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});
