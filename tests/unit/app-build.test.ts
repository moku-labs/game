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
import { appIdOf, buildIdOf, definesOf } from "../../src/app/build";
import type { CliDeps } from "../../src/app/cli";
import { runCommand } from "../../src/app/cli";
import { copyMiniGame, removeCopies } from "../integration/app-helpers";

/** What the stub seams saw. */
type Seen = { info: string[]; warnings: string[]; errors: string[]; scans: string[][] };

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
 * @param change - Seams to replace; a debug build needs the resolver, the clock and the warnings.
 * @returns The exit code and what the seams saw.
 */
async function build(
  argv: string[],
  root: string,
  pack: Readonly<Record<string, string>> = MANIFEST_ONLY,
  code = 0,
  change: (seen: Seen) => Partial<CliDeps> = () => ({})
): Promise<{ code: number; seen: Seen }> {
  const seen: Seen = { info: [], warnings: [], errors: [], scans: [] };
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
    watchKeys: unused,
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
    visual: unused,
    now: unused,
    home: "/home/tester",
    exists: unused,
    readPackageVersion: unused,
    ...change(seen)
  };
  const exit = await runCommand(["build", "--root", root, ...argv], deps);

  return { code: exit, seen };
}

afterAll(() => {
  removeCopies(copies);
});

/**
 * Writes a `--serve-plugin` into a game that keeps every `.webp` external, so Bun leaves its links
 * into the game and the build's fallback copies the files.
 *
 * @param root - The game folder.
 * @returns The plugin file.
 */
function keepWebp(root: string): string {
  const plugin = path.join(root, "keep-icons.ts");

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

  return plugin;
}

describe("the defines and the build id of a page", () => {
  it("a release page defines the three flags false, a debug page AGENT true and CONTROL by its profile", () => {
    const page = {
      build: "debug-20261014T153012Z",
      engine: "0.14.12+9c41e0",
      editor: "127.0.0.1:47600",
      app: undefined
    };

    expect(definesOf(undefined)).toEqual({
      __MOKU_GAME_DEV__: "false",
      __MOKU_GAME_AGENT__: "false",
      __MOKU_GAME_CONTROL__: "false"
    });
    expect(definesOf({ ...page, level: "read" })).toEqual({
      __MOKU_GAME_DEV__: "false",
      __MOKU_GAME_AGENT__: "true",
      __MOKU_GAME_CONTROL__: "false",
      __MOKU_GAME_BUILD__: '"debug-20261014T153012Z"',
      __MOKU_GAME_ENGINE__: '"0.14.12+9c41e0"',
      __MOKU_GAME_EDITOR__: '"127.0.0.1:47600"'
    });
    expect(definesOf({ ...page, level: "full" }).__MOKU_GAME_CONTROL__).toBe("true");
  });

  it("a debug page of a game with a native identifier defines the app id; one without leaves it out", () => {
    const page = {
      level: "full" as const,
      build: "debug-20261014T153012Z",
      engine: "0.14.12+9c41e0",
      editor: "127.0.0.1:47600"
    };

    expect(definesOf({ ...page, app: "com.mokulabs.timber.debug" }).__MOKU_GAME_APP__).toBe(
      '"com.mokulabs.timber.debug"'
    );
    expect(definesOf({ ...page, app: undefined })).not.toHaveProperty("__MOKU_GAME_APP__");
  });

  it("the app id is the native identifier, with .debug when native builds its debug app", () => {
    expect(appIdOf("com.mokulabs.timber", "debug")).toBe("com.mokulabs.timber.debug");
    expect(appIdOf("com.mokulabs.timber", undefined)).toBe("com.mokulabs.timber");
    expect(appIdOf(undefined, "debug")).toBeUndefined();
  });

  it("names a debug build debug-<stamp> by the UTC time of the run, whatever its profile", () => {
    expect(buildIdOf(Date.UTC(2026, 9, 14, 15, 30, 12))).toBe("debug-20261014T153012Z");
  });
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
    const plugin = keepWebp(root);

    writeFileSync(
      path.join(root, "config.ts"),
      'export default { page: { title: "t", icons: { favicon: "features/ui/assets/fx-spark.webp" } } };\n'
    );

    const { code, seen } = await build(["--serve-plugin", plugin, "--out", "dist/web"], root);
    const html = readFileSync(path.join(root, "dist", "web", "index.html"), "utf8");

    expect(seen.errors).toEqual([]);
    expect(code).toBe(0);
    expect(html).toContain('<link rel="icon" href="./fx-spark.webp" />');
    expect(existsSync(path.join(root, "dist", "web", "fx-spark.webp"))).toBe(true);
  });

  // Bug: a boot picture Bun left as a link points into the game, which the built page cannot reach.
  it("copies the boot picture a plugin leaves as a link beside the page and links it ./", async () => {
    const root = game();
    const plugin = keepWebp(root);

    put(path.join(root, "art", "boot.webp"), "webp");
    writeFileSync(
      path.join(root, "config.ts"),
      'export default { page: { title: "t", boot: { image: "art/boot.webp" } } };\n'
    );

    const { code, seen } = await build(["--serve-plugin", plugin, "--out", "dist/web"], root);
    const html = readFileSync(path.join(root, "dist", "web", "index.html"), "utf8");

    expect(seen.errors).toEqual([]);
    expect(code).toBe(0);
    expect(html).toContain('<img id="moku-boot" src="./boot.webp" alt="" />');
    expect(readFileSync(path.join(root, "dist", "web", "boot.webp"), "utf8")).toBe("webp");
  });

  // Bug: two page files with one name overwrite each other beside the page, and one link shows the other picture.
  it("refuses a boot picture and an icon left in the game with one name beside the page", async () => {
    const root = game();
    const plugin = keepWebp(root);

    put(path.join(root, "art", "fx-spark.webp"), "webp");
    writeFileSync(
      path.join(root, "config.ts"),
      'export default { page: { title: "t", icons: { favicon: "features/ui/assets/fx-spark.webp" }, boot: { image: "art/fx-spark.webp" } } };\n'
    );

    const { code, seen } = await build(["--serve-plugin", plugin, "--out", "dist/web"], root);

    expect(code).toBe(1);
    expect(seen.errors).toEqual([
      '[game] build: page.boot.image and page.icons.favicon share the name "fx-spark.webp" beside the page.'
    ]);
  });

  // Bug: the clash check of the boot picture also refuses a game with no boot whose two icons share a name.
  it("builds two icons left in the game with one name as before, with no boot", async () => {
    const root = game();
    const plugin = keepWebp(root);

    put(path.join(root, "art", "fx-spark.webp"), "webp");
    writeFileSync(
      path.join(root, "config.ts"),
      'export default { page: { title: "t", icons: { favicon: "features/ui/assets/fx-spark.webp", appleTouch: "art/fx-spark.webp" } } };\n'
    );

    const { code, seen } = await build(["--serve-plugin", plugin, "--out", "dist/web"], root);

    expect(seen.errors).toEqual([]);
    expect(code).toBe(0);
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

/** The version of the engine repo: a debug page of a copy names the engine `<version>+src`. */
const VERSION = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

/** A string only the fake editor agent holds: a page that bundles it carries it. */
const AGENT_MARKER = "fake-editor-agent-3c9e1f";

/**
 * Writes a fake `@moku-labs/editor` into a game: `./agent/page` default-exports an agent that
 * logs a marker.
 *
 * @param root - The game folder.
 */
function fakeEditor(root: string): void {
  const folder = path.join(root, "node_modules", "@moku-labs", "editor");

  put(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: "@moku-labs/editor",
      type: "module",
      exports: { "./agent/page": "./page.js" }
    })
  );
  put(
    path.join(folder, "page.js"),
    `export default function agent({ app }) { app.log.info("${AGENT_MARKER}"); }\n`
  );
}

/**
 * The seams of a debug build: Bun's resolver, the clock at 2026-10-14 15:30:12 UTC, and the
 * warnings recorded.
 *
 * @param seen - What the seams saw.
 * @returns The seams to replace.
 */
function debugSeams(seen: Seen): Partial<CliDeps> {
  return {
    resolve: (specifier, from) => Bun.resolveSync(specifier, from),
    now: () => Date.UTC(2026, 9, 14, 15, 30, 12),
    ui: {
      info: message => seen.info.push(message),
      line: unused,
      warn: message => seen.warnings.push(message),
      error: message => seen.errors.push(message)
    }
  };
}

describe.skipIf(typeof Bun === "undefined")("moku-game build --debug, the bundle", () => {
  it("a debug build without @moku-labs/editor fails with the install line and writes nothing", async () => {
    const root = game();
    const { code, seen } = await build(["--debug"], root, MANIFEST_ONLY, 0, debugSeams);

    expect(code).toBe(1);
    expect(seen.errors).toEqual([
      "[game] build --debug needs @moku-labs/editor in the game.\n  Install it: bun add -d @moku-labs/editor."
    ]);
    expect(seen.scans).toEqual([]);
    expect(existsSync(path.join(root, "dist"))).toBe(false);
  });

  it("--debug=read builds a read-only page: CONTROL false, the debug-<stamp> id, the app id with .debug under the native debug profile, and no alias note", async () => {
    const root = game();

    fakeEditor(root);
    put(
      path.join(root, "config.ts"),
      'export default { page: { title: "mini-game" }, native: { name: "Mini", identifier: "com.mini.game" } };\n'
    );

    const { code, seen } = await build(["--debug=read"], root, MANIFEST_ONLY, 0, recorded => ({
      ...debugSeams(recorded),
      env: { MOKU_NATIVE_PROFILE: "debug" }
    }));
    const out = path.join(root, "dist", "web");
    const html = readFileSync(path.join(out, "index.html"), "utf8");
    const script = /<script type="module" crossorigin src="([^"]+)"/.exec(html)?.[1] ?? "";
    const bundled = readFileSync(path.join(out, script), "utf8");

    expect(seen.errors).toEqual([]);
    expect(code).toBe(0);
    expect(seen.warnings).toEqual([
      `build: a DEBUG page with the editor agent, control: read and cosmetic commands. Build debug-20261014T153012Z, engine ${VERSION}+src, editor 127.0.0.1:47600. Never ship it to a store.`
    ]);
    expect(seen.info).toEqual([expect.stringMatching(/^built ".+": \d+ files, \d+ KB\.$/)]);
    expect(html).toContain("<title>mini-game Debug</title>");
    expect(bundled).toContain(AGENT_MARKER);
    expect(bundled).toContain('"debug-20261014T153012Z"');
    expect(bundled).toContain('"com.mini.game.debug"');
    expect(bundled).toMatch(/__MOKU_GAME_CONTROL__\s*=\s*(?:false|!1)/);
  });
});
