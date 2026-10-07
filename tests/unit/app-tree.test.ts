import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import treeBundle, {
  entryOf,
  entrySource,
  type TreeBuild,
  type TreeResolve,
  treeEntries,
  treeRoot
} from "../../scripts/tree/bundle";
import {
  distPattern,
  type PreloadBuild,
  type PreloadLoad,
  treePreload
} from "../../scripts/tree/preload";

// ---------------------------------------------------------------------------
// Unit test: the working-tree recipe of the engine repo. The preload sends
// `node_modules/@moku-labs/game/dist/<entry>.mjs` to `<tree>/src/<entry>.ts`;
// the bundle plugin sends `@moku-labs/game[/entry]` to the same source and
// resolves the tree's Pixi, core and common from the game root.
// ---------------------------------------------------------------------------

/** One `onResolve` registration of the bundle plugin. */
type Resolver = { filter: RegExp; resolve: TreeResolve };

/** The engine repo, where this test file lives two folders down. */
const REPO = path.resolve(import.meta.dirname, "../..");

/** The exports of the repo's package.json, read here on their own. */
const EXPORTS = Object.keys(
  (JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as { exports: object }).exports
);

/** The export keys that name an entry: every key but a `*` pattern. */
const ENTRY_KEYS = EXPORTS.filter(key => !key.includes("*"));

/** A source file of the tree, as the importer of the tree's own imports. */
const TREE_IMPORTER = path.join(REPO, "src/plugins/renderer/index.ts");

/**
 * Runs `setup` of the bundle plugin with a fake builder that keeps every `onResolve`.
 *
 * @returns The registrations, in order.
 */
function registerBundle(): Resolver[] {
  const resolvers: Resolver[] = [];
  const build: TreeBuild = {
    onResolve(options, resolve) {
      resolvers.push({ filter: options.filter, resolve });
    }
  };

  treeBundle.setup(build);

  return resolvers;
}

/**
 * Resolves one import the way Bun does: the first registration whose filter matches answers.
 *
 * @param specifier - The import.
 * @param importer - The file that imports it.
 * @returns The path the plugin gives, or `undefined` when it leaves the import alone.
 */
function resolveImport(specifier: string, importer: string): string | undefined {
  const resolver = registerBundle().find(({ filter }) => filter.test(specifier));

  return resolver?.resolve({ path: specifier, importer })?.path;
}

/**
 * Runs `setup` of the preload with a fake builder that keeps the one `onLoad`.
 *
 * @returns The filter and the load callback.
 * @throws {Error} When the preload registered no load callback.
 */
function registerPreload(): { filter: RegExp; load: PreloadLoad } {
  let registered: { filter: RegExp; load: PreloadLoad } | undefined;
  const build: PreloadBuild = {
    onLoad(options, load) {
      registered = { filter: options.filter, load };
    }
  };

  treePreload.setup(build);

  if (registered === undefined) throw new Error("The preload registered no onLoad callback.");

  return registered;
}

/**
 * The text the preload loads for one dist file of the installed engine.
 *
 * @param entry - The entry, such as `visual`.
 * @returns The module text.
 */
function preloadText(entry: string): string {
  const { filter, load } = registerPreload();
  const file = `/game/node_modules/@moku-labs/game/dist/${entry}.mjs`;

  expect(filter.test(file)).toBe(true);

  return load({ path: file }).contents;
}

describe("tree root and entries", () => {
  it("finds the engine tree from its own file", () => {
    expect(treeRoot).toBe(REPO);
  });

  it("the entry mapping covers every export of package.json", () => {
    const expected = ENTRY_KEYS.map(key => (key === "." ? "index" : key.slice(2)));

    expect(treeEntries().toSorted()).toEqual(expected.toSorted());
  });

  it.each(ENTRY_KEYS)("the export %s maps to an existing src file", key => {
    const specifier = key === "." ? "@moku-labs/game" : `@moku-labs/game/${key.slice(2)}`;
    const entry = entryOf(specifier);

    expect(entry).toBeDefined();
    expect(existsSync(entrySource(entry ?? ""))).toBe(true);
  });

  it("a pattern export such as ./fonts/* is not an entry", () => {
    expect(EXPORTS).toContain("./fonts/*");
    expect(treeEntries()).not.toContain("fonts/*");
  });

  it("maps an import to its entry name, nested entries too", () => {
    expect(entryOf("@moku-labs/game")).toBe("index");
    expect(entryOf("@moku-labs/game/testing")).toBe("testing");
    expect(entryOf("@moku-labs/game/app/page")).toBe("app/page");
    expect(entryOf("@moku-labs/gamer")).toBeUndefined();
    expect(entryOf("pixi.js")).toBeUndefined();
  });

  it("puts an entry's source under src of the tree", () => {
    expect(entrySource("app/page")).toBe(path.join(REPO, "src", "app", "page.ts"));
  });
});

describe("the tree bundle plugin", () => {
  let game = "";

  beforeAll(async () => {
    game = await realpath(await mkdtemp(path.join(tmpdir(), "moku-tree-game-")));

    const packages: [string, object, string][] = [
      ["pixi.js", { name: "pixi.js", main: "index.js" }, "index.js"],
      ["@moku-labs/core", { name: "@moku-labs/core", main: "index.js" }, "index.js"],
      [
        "@moku-labs/common",
        { name: "@moku-labs/common", exports: { ".": "./index.js", "./cli": "./cli.js" } },
        "cli.js"
      ]
    ];

    for (const [name, manifest, file] of packages) {
      const folder = path.join(game, "node_modules", name);

      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, "package.json"), JSON.stringify(manifest));
      await writeFile(path.join(folder, file), "export {};\n");
      await writeFile(path.join(folder, "index.js"), "export {};\n");
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await rm(game, { recursive: true, force: true });
  });

  it("is a named Bun plugin", () => {
    expect(treeBundle.name).toBe("moku-game-tree");
  });

  it("the tree bundle plugin resolves @moku-labs/game/testing to src/testing.ts", () => {
    expect(resolveImport("@moku-labs/game/testing", path.join(game, "index.ts"))).toBe(
      path.join(REPO, "src/testing.ts")
    );
  });

  it("resolves @moku-labs/game to src/index.ts, also for the tree's own imports", () => {
    expect(resolveImport("@moku-labs/game", path.join(game, "index.ts"))).toBe(
      path.join(REPO, "src/index.ts")
    );
    expect(resolveImport("@moku-labs/game/jsx-dev-runtime", TREE_IMPORTER)).toBe(
      path.join(REPO, "src/jsx-dev-runtime.ts")
    );
  });

  it("leaves an engine import that is no entry alone", () => {
    expect(resolveImport("@moku-labs/game/nope", path.join(game, "index.ts"))).toBeUndefined();
  });

  it.each([
    ["pixi.js", "node_modules/pixi.js/index.js"],
    ["@moku-labs/core", "node_modules/@moku-labs/core/index.js"],
    ["@moku-labs/common/cli", "node_modules/@moku-labs/common/cli.js"]
  ])("resolves the tree's import of %s from the game root", (specifier, file) => {
    vi.spyOn(process, "cwd").mockReturnValue(game);

    expect(resolveImport(specifier, TREE_IMPORTER)).toBe(path.join(game, file));
  });

  it("leaves the game's own import of pixi.js alone", () => {
    vi.spyOn(process, "cwd").mockReturnValue(game);

    expect(resolveImport("pixi.js", path.join(game, "index.ts"))).toBeUndefined();
  });

  it("does not take a package whose name only starts with a shared one", () => {
    expect(registerBundle().some(({ filter }) => filter.test("@moku-labs/corex"))).toBe(false);
  });
});

describe("the tree preload", () => {
  it("the tree preload maps dist/visual.mjs to src/visual.ts", () => {
    expect(preloadText("visual")).toBe(
      `export * from ${JSON.stringify(path.join(REPO, "src/visual.ts"))};`
    );
  });

  it.each(["hot", "lint"])("keeps the default export of %s", entry => {
    const file = JSON.stringify(path.join(REPO, `src/${entry}.ts`));

    expect(preloadText(entry)).toBe(`export * from ${file}; export { default } from ${file};`);
  });

  it("maps dist/index.mjs to src/index.ts", () => {
    expect(preloadText("index")).toContain(JSON.stringify(path.join(REPO, "src/index.ts")));
  });

  it("takes only the dist files of the entries", () => {
    const filter = distPattern(["index", "app/page"]);

    expect(filter.test("/g/node_modules/@moku-labs/game/dist/app/page.mjs")).toBe(true);
    expect(filter.test(String.raw`C:\g\node_modules\@moku-labs\game\dist\app\page.mjs`)).toBe(true);
    expect(filter.test("/g/node_modules/@moku-labs/game/dist/chunk-x1.mjs")).toBe(false);
    expect(filter.test("/g/node_modules/@moku-labs/game/dist/index.d.mts")).toBe(false);
    expect(filter.test("/g/node_modules/other/dist/index.mjs")).toBe(false);
  });

  it("maps a Windows dist path of a nested entry to its source", () => {
    const { load } = registerPreload();
    const file = String.raw`C:\g\node_modules\@moku-labs\game\dist\visual.mjs`;

    expect(load({ path: file }).contents).toContain(
      JSON.stringify(path.join(REPO, "src/visual.ts"))
    );
  });

  it("loads the tree's hot plugin for a game's import under bun --preload", async () => {
    const game = await realpath(await mkdtemp(path.join(tmpdir(), "moku-tree-preload-")));

    try {
      const installed = path.join(game, "node_modules/@moku-labs/game");

      await mkdir(path.join(installed, "dist"), { recursive: true });
      await writeFile(
        path.join(installed, "package.json"),
        JSON.stringify({
          name: "@moku-labs/game",
          type: "module",
          exports: { "./hot": "./dist/hot.mjs" }
        })
      );
      await writeFile(path.join(installed, "dist/hot.mjs"), 'throw new Error("dist loaded");\n');
      await writeFile(
        path.join(game, "probe.ts"),
        [
          'import plugin, { hot } from "@moku-labs/game/hot";',
          "console.log(JSON.stringify({ name: plugin.name, hot: typeof hot }));",
          ""
        ].join("\n")
      );

      // The Bun that runs this suite (`bun --bun vitest`) runs the probe.
      const ran = spawnSync(
        process.execPath,
        ["--preload", path.join(REPO, "scripts/tree/preload.ts"), "probe.ts"],
        { cwd: game, encoding: "utf8" }
      );

      expect(ran.stderr).toBe("");
      expect(JSON.parse(ran.stdout)).toEqual({ name: "@moku-labs/game/hot", hot: "function" });
    } finally {
      await rm(game, { recursive: true, force: true });
    }
  });
});
