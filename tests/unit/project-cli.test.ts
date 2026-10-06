import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/project";
import { whereLine } from "../../src/project/cli";
import type { IndexUi } from "../../src/project/types";

// ---------------------------------------------------------------------------
// Unit test: the command line `moku-game-index`. A tiny game is written into a
// temp folder; a recorder stands in for the branded console and keeps every
// line with its kind.
// ---------------------------------------------------------------------------

/** The kit of the tiny game. */
const KIT = `import { defineGame } from "@moku-labs/game";

export const { defineNode, defineFlow, defineScene, defineStyle } = defineGame<{ player: object }>();
`;

/** A scene, declared on line 3. */
const HOME = `import { defineScene } from "./kit";

export const homeScene = defineScene("home", {});
`;

/** A style in an object const: unresolved, never a failure. */
const LOOKS = `import { defineStyle } from "./kit";

export const look = { card: defineStyle({ width: 1 }) };
`;

/** The temp folders of this file, removed after each test. */
const made: string[] = [];

/** What the recorder saw, as `<kind> <text>` lines. */
type Recorded = { ui: IndexUi; lines: string[] };

/**
 * A recorder for the command line's console.
 *
 * @returns The ui to pass and the lines it kept.
 */
function recorder(): Recorded {
  const lines: string[] = [];

  return {
    lines,
    ui: {
      line: text => lines.push(`line ${text}`),
      info: text => lines.push(`info ${text}`),
      error: text => lines.push(`error ${text}`)
    }
  };
}

/**
 * Write a tiny game into a fresh temp folder.
 *
 * @param files - Root-relative path to text.
 * @returns The game root.
 */
function writeGame(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "moku-project-cli-"));

  made.push(root);

  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }

  return root;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("moku-game-index --json", () => {
  it("prints the index as pretty JSON", async () => {
    const root = writeGame({ "kit.ts": KIT, "home.ts": HOME, "manifest.json": "{}" });
    const { ui, lines } = recorder();

    expect(await runCli(["--root", root, "--json"], ui)).toBe(0);
    expect(lines).toHaveLength(1);

    const printed = lines[0]?.replace(/^line /, "") ?? "";
    const index = JSON.parse(printed) as {
      schemaVersion: number;
      manifest: string;
      symbols: object;
    };

    expect(index.schemaVersion).toBe(1);
    expect(index.manifest).toBe("manifest.json");
    expect(index.symbols).toHaveProperty("scene:home");
    expect(printed).toContain('\n  "schemaVersion": 1,');
  });

  it("takes --manifest as a root-relative path", async () => {
    const root = writeGame({ "kit.ts": KIT, "public/manifest.json": "{}" });
    const { ui, lines } = recorder();

    expect(await runCli(["--root", root, "--manifest", "public/manifest.json", "--json"], ui)).toBe(
      0
    );
    expect(lines[0]).toContain('"manifest": "public/manifest.json"');
  });
});

describe("moku-game-index where", () => {
  it("prints one path:line per place", async () => {
    const root = writeGame({ "kit.ts": KIT, "home.ts": HOME });
    const { ui, lines } = recorder();

    expect(await runCli(["--root", root, "where", "scene:home"], ui)).toBe(0);
    expect(lines).toEqual(["line home.ts:3"]);
  });

  it("skips a file broken from its first parse, and marks an answer from a last good parse", async () => {
    const root = writeGame({
      "kit.ts": KIT,
      "home.ts": HOME,
      "away.ts":
        'import { defineScene } from "./kit";\n\nexport const away = defineScene("home", {;\n'
    });
    const { ui, lines } = recorder();

    expect(await runCli(["--root", root, "where", "scene:home"], ui)).toBe(0);
    expect(lines).toEqual(["line home.ts:3"]);
    expect(
      whereLine({ path: "home.ts", line: 3, range: [3, 1, 3, 48], hash: "ab", broken: true })
    ).toBe("home.ts:3 (broken)");
  });

  it("exits 1 with a message for an unknown key", async () => {
    const root = writeGame({ "kit.ts": KIT, "home.ts": HOME });
    const { ui, lines } = recorder();

    expect(await runCli(["--root", root, "where", "scene:nowhere"], ui)).toBe(1);
    expect(lines).toEqual([
      `error [game] The key "scene:nowhere" is not in the index of "${root}".\n  Run "moku-game-index --root ${root} --json" to list the keys.`
    ]);
  });

  it("needs a key after where", async () => {
    const root = writeGame({ "kit.ts": KIT });
    const { ui, lines } = recorder();

    expect(await runCli(["--root", root, "where"], ui)).toBe(1);
    expect(lines[0]).toContain('"where" needs a key');
  });
});

describe("moku-game-index --check", () => {
  it("lists unresolved items as info and exits 0", async () => {
    const root = writeGame({ "kit.ts": KIT, "home.ts": HOME, "looks.ts": LOOKS });
    const { ui, lines } = recorder();

    expect(await runCli(["--root", root, "--check"], ui)).toBe(0);
    expect(lines).toEqual([
      "info 3 files, 1 key: 0 broken, 0 in conflict, 1 unresolved.",
      'info unresolved looks.ts: defineStyle in "look" is not bound to a module-level const'
    ]);
  });

  it("exits 1 on a broken file and on a key in conflict", async () => {
    const root = writeGame({
      "kit.ts": KIT,
      "home.ts": HOME,
      "again.ts":
        'import { defineScene } from "./kit";\n\nexport const again = defineScene("home", {});\n',
      "broken.ts": "export const = 1;\n"
    });
    const { ui, lines } = recorder();

    expect(await runCli(["--root", root, "--check"], ui)).toBe(1);
    expect(lines).toEqual([
      "info 4 files, 1 key: 1 broken, 1 in conflict, 1 unresolved.",
      "error broken broken.ts: broken.ts:1:14 Variable declaration expected.",
      "error conflict scene:home: again.ts, home.ts",
      "info unresolved broken.ts: broken.ts:1:14 Variable declaration expected."
    ]);
  });
});

describe("moku-game-index and the tsconfig", () => {
  /** A scene that reaches the kit through the alias `@kit`, declared on line 3. */
  const ALIASED = `import { defineScene } from "@kit";

export const aliasScene = defineScene("alias", {});
`;

  /** A tsconfig that maps `@kit` to the kit. */
  const TSCONFIG = JSON.stringify({ compilerOptions: { paths: { "@kit": ["./kit.ts"] } } });

  it("reads --tsconfig, and --check names the aliases after the summary", async () => {
    const root = writeGame({
      "kit.ts": KIT,
      "alias.ts": ALIASED,
      "tsconfig.game.json": TSCONFIG
    });
    const where = recorder();
    const check = recorder();

    expect(
      await runCli(
        ["--root", root, "--tsconfig", "tsconfig.game.json", "where", "scene:alias"],
        where.ui
      )
    ).toBe(0);
    expect(where.lines).toEqual(["line alias.ts:3"]);
    expect(
      await runCli(["--root", root, "--tsconfig", "tsconfig.game.json", "--check"], check.ui)
    ).toBe(0);
    expect(check.lines).toEqual([
      "info 2 files, 1 key: 0 broken, 0 in conflict, 0 unresolved.",
      "info aliases: tsconfig.game.json, 1 pattern"
    ]);
  });

  it("reads tsconfig.json by default and carries it through --json", async () => {
    const root = writeGame({ "kit.ts": KIT, "alias.ts": ALIASED, "tsconfig.json": TSCONFIG });
    const { ui, lines } = recorder();

    expect(await runCli(["--root", root, "--json"], ui)).toBe(0);

    const index = JSON.parse(lines[0]?.replace(/^line /, "") ?? "") as {
      tsconfig: string;
      symbols: object;
    };

    expect(index.tsconfig).toBe("tsconfig.json");
    expect(index.symbols).toHaveProperty("scene:alias");
  });

  it("says so when the tsconfig holds no paths, and stays quiet when there is none", async () => {
    const plain = writeGame({ "kit.ts": KIT, "tsconfig.json": "{}" });
    const bare = writeGame({ "kit.ts": KIT });
    const first = recorder();
    const second = recorder();

    expect(await runCli(["--root", plain, "--check"], first.ui)).toBe(0);
    expect(first.lines).toEqual([
      "info 1 file, 0 keys: 0 broken, 0 in conflict, 0 unresolved.",
      "info aliases: none (no tsconfig paths)"
    ]);
    expect(await runCli(["--root", bare, "--check"], second.ui)).toBe(0);
    expect(second.lines).toEqual(["info 1 file, 0 keys: 0 broken, 0 in conflict, 0 unresolved."]);
  });

  it("refuses a --tsconfig that leaves the root, by name, and one without its path", async () => {
    const root = writeGame({ "kit.ts": KIT });
    const outside = recorder();
    const missing = recorder();

    expect(
      await runCli(["--root", root, "--tsconfig", "../tsconfig.json", "--check"], outside.ui)
    ).toBe(1);
    expect(outside.lines[0]).toContain('The path "../tsconfig.json" leaves the project root');
    expect(await runCli(["--root", root, "--tsconfig"], missing.ui)).toBe(1);
    expect(missing.lines[0]).toContain('"--tsconfig" needs a path');
    expect(missing.lines[0]).toContain("[--tsconfig <path>]");
  });
});

describe("moku-game-index flags", () => {
  it("needs --root", async () => {
    const { ui, lines } = recorder();

    expect(await runCli(["where", "scene:home"], ui)).toBe(1);
    expect(lines).toEqual([
      'error [game] index: "--root" is required.\n  Name the game folder: moku-game-index --root <dir> where <key>.'
    ]);
  });

  it("refuses an unknown flag, a flag without its value, no command and two commands", async () => {
    const root = writeGame({ "kit.ts": KIT });
    const cases = [
      [["--root", root, "--json", "--fast"], 'unknown option "--fast"'],
      [["--root"], '"--root" needs a path'],
      [["--root", root], "name one command"],
      [["--root", root, "--json", "--check"], "name one command"]
    ] as const;

    for (const [argv, message] of cases) {
      const { ui, lines } = recorder();

      expect(await runCli([...argv], ui)).toBe(1);
      expect(lines[0]).toContain(message);
    }
  });

  it("reports a root that is not a directory", async () => {
    const root = writeGame({ "kit.ts": KIT });
    const { ui, lines } = recorder();

    expect(await runCli(["--root", path.join(root, "kit.ts"), "--json"], ui)).toBe(1);
    expect(lines[0]).toContain("is not a directory");
  });
});
