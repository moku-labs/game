/**
 * @file The package bin `moku-game`: the real bin is copied into a temp package whose
 * `dist/cli.mjs` re-exports `src/cli.ts`, as npm installs it beside the built door, and runs in a
 * Bun child.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/** The real bin of the package, the file npm ships. */
const BIN = fileURLToPath(new URL("../../bin/moku-game.mjs", import.meta.url));

/** The door the bin imports through `../dist/cli.mjs`. */
const CLI_DOOR = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

/** The temp package of this file. */
const folder = mkdtempSync(path.join(tmpdir(), "moku-game-bin-"));

/** The copied bin inside the temp package. */
const bin = path.join(folder, "package", "bin", "moku-game.mjs");

mkdirSync(path.dirname(bin), { recursive: true });
copyFileSync(BIN, bin);
mkdirSync(path.join(folder, "package", "dist"), { recursive: true });
writeFileSync(
  path.join(folder, "package", "dist", "cli.mjs"),
  `export * from ${JSON.stringify(CLI_DOOR)};\n`
);

/**
 * Runs the copied bin in a Bun child.
 *
 * @param argv - The arguments after the bin.
 * @returns The exit code and what it wrote.
 */
function runCopied(argv: string[]): { status: number | null; stdout: string; stderr: string } {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
  const ran = spawnSync("bun", [bin, ...argv], { encoding: "utf8", cwd: folder });

  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("the moku-game bin", () => {
  it("help exits 0", () => {
    const ran = runCopied(["help"]);

    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("moku-game <command> [options]");
    expect(ran.stderr).toBe("");
  });

  it("an unknown command exits 1 with the message on stderr", () => {
    const ran = runCopied(["serve"]);

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain(
      '[game] moku-game: no command "serve". Name one of dev, build, native, keys, pack, help.'
    );
    expect(ran.stdout).toBe("");
  });
});
