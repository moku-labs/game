/**
 * @file `moku-game build` in this process, over a stub asset scanner: the refused output folders
 * (the game, a folder above it, the pack, a folder of the game outside `dist`), a failed pack, the
 * bundled page beside the pack, a pack file at a page path, the bundler plugins of
 * `--serve-plugin`, and the icon fallback for links Bun left into the game. The bundle runs
 * `Bun.build` on a copy of the mini game, so those cases need Bun.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CliDeps } from "../../src/app/cli";
import { runCommand } from "../../src/app/cli";
import { copyMiniGame, removeCopies } from "../integration/app-helpers";

/** What the stub seams saw. */
type Seen = { info: string[]; errors: string[]; scans: string[][] };

/** The copies of this file, removed after it. */
const copies: string[] = [];

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
 * Copies the mini game for one test.
 *
 * @returns The copy.
 */
function game(): string {
  const copy = copyMiniGame("build-unit");

  copies.push(copy);

  return copy;
}

/** The pack of a build that only needs a manifest. */
const MANIFEST_ONLY: Readonly<Record<string, string>> = {
  "manifest.json": '{ "version": 2, "bundles": {} }\n'
};

/**
 * A seam the build must not use.
 *
 * @throws {Error} Always.
 */
function unused(): never {
  throw new Error("The build uses no other seam.");
}

/**
 * Runs `moku-game build` over stub seams. The stub pack writes the given files into
 * `<root>/dist/assets` and answers the given code.
 *
 * @param argv - The arguments after the bin.
 * @param root - The game folder, also the working directory.
 * @param pack - The files the pack writes, by path under the pack folder.
 * @param code - What the pack answers.
 * @returns The exit code and what the seams saw.
 */
async function build(
  argv: string[],
  root: string,
  pack: Readonly<Record<string, string>> = MANIFEST_ONLY,
  code = 0
): Promise<{ code: number; seen: Seen }> {
  const seen: Seen = { info: [], errors: [], scans: [] };
  const deps: CliDeps = {
    ui: {
      info: message => seen.info.push(message),
      line: unused,
      warn: unused,
      error: message => seen.errors.push(message)
    },
    env: {},
    cwd: root,
    execPath: "/bin/bun",
    self: ["/bin/moku-game.mjs"],
    spawn: unused,
    onSignal: unused,
    watch: unused,
    assets: async scan => {
      seen.scans.push(scan);
      for (const [file, text] of Object.entries(pack)) {
        put(path.join(root, "dist", "assets", file), text);
      }

      return code;
    },
    native: unused,
    resolve: unused,
    loadPage: unused,
    visual: unused
  };
  const exit = await runCommand(["build", "--root", root, ...argv], deps);

  return { code: exit, seen };
}

afterAll(() => {
  removeCopies(copies);
});

describe("moku-game build, the checks", () => {
  it("refuses an --out that is the game, holds it, or is, holds or lies in the pack", async () => {
    const root = game();

    for (const out of [".", "..", "dist", "dist/assets", "dist/assets/web"]) {
      const { code, seen } = await build(["--out", out], root);

      expect(code, out).toBe(1);
      expect(seen.errors).toEqual([
        `[game] build: --out "${path.resolve(root, out)}" would replace the game or its packed assets. Name another folder.`
      ]);
      expect(seen.scans).toEqual([]);
    }
  });

  it("refuses an --out inside the game but outside dist, and deletes nothing", async () => {
    const root = game();

    for (const out of ["features", "tests", "web", ".moku"]) {
      const { code, seen } = await build(["--out", out], root);

      expect(code, out).toBe(1);
      expect(seen.errors).toEqual([
        `[game] build: --out "${path.resolve(root, out)}" would replace the game or its packed assets. Name another folder.`
      ]);
      expect(seen.scans).toEqual([]);
    }

    expect(existsSync(path.join(root, "features", "ui", "assets", "fx-spark.webp"))).toBe(true);
    expect(existsSync(path.join(root, "tests", "scenarios"))).toBe(true);
  });

  it("a failed pack stops the build with its code", async () => {
    const root = game();
    const { code, seen } = await build([], root, {}, 2);

    expect(code).toBe(2);
    expect(seen.scans[0]).toContain("--pack");
    expect(existsSync(path.join(root, "dist", "web"))).toBe(false);
  });
});

describe.skipIf(typeof Bun === "undefined")("moku-game build, the bundle", () => {
  it("bundles the page into dist/web beside the pack and reports its size", async () => {
    const root = game();
    const out = path.join(root, "dist", "web");
    const { code, seen } = await build([], root, {
      "manifest.json": '{ "version": 2, "bundles": {} }\n',
      "ui/ui.dot-0123456789.png": "png"
    });
    const html = readFileSync(path.join(out, "index.html"), "utf8");
    const script = /<script type="module" crossorigin src="([^"]+)"/.exec(html)?.[1] ?? "";

    expect(seen.errors).toEqual([]);
    expect(code).toBe(0);
    expect(script).toMatch(/^\.\/.+\.js$/);
    expect(existsSync(path.join(out, script))).toBe(true);
    expect(readFileSync(path.join(out, "manifest.json"), "utf8")).toContain('"version": 2');
    expect(readFileSync(path.join(out, "ui", "ui.dot-0123456789.png"), "utf8")).toBe("png");
    expect(seen.info).toEqual([expect.stringMatching(/^built ".+": 4 files, \d+ KB\.$/)]);
  });

  it("a pack file at a page path is refused", async () => {
    const root = game();
    const { code, seen } = await build([], root, {
      "manifest.json": "{}\n",
      "index.html": "<html></html>"
    });

    expect(code).toBe(1);
    expect(seen.errors).toEqual([
      '[game] build: "index.html" is both a page file and a packed asset.'
    ]);
  });

  it("bundles with the --serve-plugin plugins and copies the icons they leave as links", async () => {
    const root = game();
    const plugin = path.join(root, "keep-icons.ts");

    writeFileSync(
      path.join(root, "config.ts"),
      'export default { page: { title: "t", icons: { favicon: "features/ui/assets/fx-spark.webp" } } };\n'
    );
    writeFileSync(
      plugin,
      [
        "export default {",
        '  name: "keep-icons",',
        "  setup(build) {",
        String.raw`    build.onResolve({ filter: /\.webp$/ }, args => ({ path: args.path, external: true }));`,
        "  }",
        "};",
        ""
      ].join("\n")
    );

    const { code, seen } = await build(["--serve-plugin", plugin, "--out", "dist/web"], root);
    const html = readFileSync(path.join(root, "dist", "web", "index.html"), "utf8");

    expect(seen.errors).toEqual([]);
    expect(code).toBe(0);
    expect(html).toContain('<link rel="icon" href="./fx-spark.webp" />');
    expect(existsSync(path.join(root, "dist", "web", "fx-spark.webp"))).toBe(true);
  });

  it("a --serve-plugin without a Bun plugin is refused", async () => {
    const root = game();
    const plugin = path.join(root, "not-a-plugin.ts");

    writeFileSync(plugin, "export default 42;\n");

    const { code, seen } = await build(["--serve-plugin", plugin], root);

    expect(code).toBe(1);
    expect(seen.errors).toEqual([
      `[game] build: --serve-plugin "${plugin}" default-exports no Bun plugin.\n  End it with: export default { name, setup(build) { … } }.`
    ]);
  });
});
