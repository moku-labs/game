/**
 * @file Helpers of the `moku-game` tests: copies of the mini game inside the repo, and the test bin
 * started as a child process. A copy lives under `<repo>/.moku/tests/` (git ignores `.moku`), so
 * it resolves the engine through the root tsconfig `paths` exactly as the fixture does.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

/** The engine repo. */
export const REPO = path.resolve(import.meta.dirname, "../..");

/** The mini game fixture. */
export const MINI_GAME = path.join(REPO, "tests", "fixtures", "mini-game");

/** The test bin: `runCli` of `src/cli.ts`. */
export const BIN = path.join(REPO, "tests", "fixtures", "moku-game.ts");

/** The folder the copies go in. */
const COPIES = path.join(REPO, ".moku", "tests");

/** The folders of the fixture a copy leaves out: tool output and the old page. */
const LEFT_OUT = /^(?:\.moku|dist|web)(?:\/|$)/;

/** The bound URL line of `moku-game dev`. */
const URL_LINE = /^https?:\/\/\S+\/$/m;

/** A started test bin and what it printed. */
export type StartedBin = {
  /** The process. */
  child: ChildProcess;
  /** Everything it wrote on stdout so far. */
  stdout: () => string;
  /** Everything it wrote on stderr so far. */
  stderr: () => string;
  /** Resolves to the exit code once it ended. */
  exit: Promise<number | null>;
};

/**
 * Copies the mini game into a fresh folder inside the repo, without its tool output and its old
 * page.
 *
 * @param prefix - The start of the folder name.
 * @returns The copy, absolute.
 */
export function copyMiniGame(prefix: string): string {
  mkdirSync(COPIES, { recursive: true });

  const copy = mkdtempSync(path.join(COPIES, `${prefix}-`));

  cpSync(MINI_GAME, copy, {
    recursive: true,
    filter: source => !LEFT_OUT.test(path.relative(MINI_GAME, source).replaceAll("\\", "/"))
  });

  return copy;
}

/**
 * Removes copies made by a test file.
 *
 * @param copies - The folders.
 */
export function removeCopies(copies: string[]): void {
  for (const copy of copies.splice(0)) rmSync(copy, { recursive: true, force: true });
}

/**
 * Starts the test bin in a Bun child process, from the repo root unless another folder is given.
 *
 * @param args - The arguments after the bin.
 * @param cwd - The working directory of the bin.
 * @returns The started bin.
 */
export function startBin(args: readonly string[], cwd = REPO): StartedBin {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
  const child = spawn("bun", [BIN, ...args], { cwd });
  const out: string[] = [];
  const errors: string[] = [];

  child.stdout.on("data", (chunk: Buffer) => out.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk.toString("utf8")));

  return {
    child,
    stdout: () => out.join(""),
    stderr: () => errors.join(""),
    exit: new Promise(resolve => {
      child.on("close", code => resolve(code));
    })
  };
}

/**
 * Waits for the bound URL line of `moku-game dev`.
 *
 * @param started - The started bin.
 * @returns The URL, ending in `/`.
 */
export function urlOf(started: StartedBin): Promise<string> {
  return new Promise((resolve, reject) => {
    const look = (): void => {
      const url = URL_LINE.exec(started.stdout())?.[0];

      if (url !== undefined) resolve(url);
    };

    started.child.stdout?.on("data", look);
    look();
    started.exit.then(code => {
      reject(new Error(`moku-game ended with ${code}: ${started.stdout()}${started.stderr()}`));
    });
  });
}

/**
 * Runs the test bin to its end.
 *
 * @param args - The arguments after the bin.
 * @param cwd - The working directory of the bin.
 * @returns The exit code and what it printed.
 */
export async function runBin(
  args: readonly string[],
  cwd = REPO
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const started = startBin(args, cwd);
  const code = await started.exit;

  return { code, stdout: started.stdout(), stderr: started.stderr() };
}

/** A port held by this process on the address the dev server binds. */
export type HeldPort = {
  /** The port, as `--port` takes it. */
  port: string;
  /** Stops the server that holds it. */
  release: () => Promise<void>;
};

/**
 * Holds a free port on `127.0.0.1`, the address the dev server binds.
 *
 * @returns The port and its release.
 */
export function holdPort(): HeldPort {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("taken") });

  return {
    port: String(server.port),
    release: async () => {
      await server.stop(true);
    }
  };
}
