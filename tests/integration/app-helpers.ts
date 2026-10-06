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

/** A port held by this process on every address `localhost` resolves to. */
export type HeldPort = {
  /** The port, as `--port` takes it. */
  port: string;
  /** Stops the servers that hold it. */
  release: () => Promise<void>;
};

/**
 * Starts a server on one free address of `localhost` that answers "taken".
 *
 * @param port - The port, `0` for any.
 * @returns The server.
 */
function serveTaken(port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({ hostname: "localhost", port, fetch: () => new Response("taken") });
}

/**
 * Holds a free port on every address `localhost` resolves to. The dev server binds `localhost`,
 * and Bun binds the first of its addresses that is free, so a port is taken for it only when
 * every one of them is.
 *
 * @returns The port and its release.
 */
export function holdLocalhostPort(): HeldPort {
  const first = serveTaken(0);
  const held = [first];

  // Each bind takes the next free address of localhost; the one after the last one fails.
  for (let tries = 0; tries < 8; tries += 1) {
    try {
      held.push(serveTaken(first.port ?? 0));
    } catch {
      break;
    }
  }

  return {
    port: String(first.port),
    release: async () => {
      await Promise.all(held.map(server => server.stop(true)));
    }
  };
}
