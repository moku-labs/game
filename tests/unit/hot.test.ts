import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BunPlugin } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import defaultPlugin, { type HotBuild, type HotPlugin, hot } from "../../src/hot";

// ---------------------------------------------------------------------------
// Unit test: the `./hot` Bun plugin appends the hot swap footer to view
// modules of the game root (the dev server's working directory) only, with
// the loader of the file's extension
// ---------------------------------------------------------------------------

/** The load callback the plugin registers. */
type Load = Parameters<HotBuild["onLoad"]>[1];

/** What one `setup` call registered: the filter and the load callback. */
type Registered = { filter: RegExp; load: Load };

/** The source every temp file holds. */
const SOURCE = 'export const title = "Home";\n';

/** The temp folder of the files this suite loads, and the stubbed working directory. */
let root = "";

/**
 * Runs `setup` of a plugin with a fake builder that keeps the one `onLoad` registration.
 *
 * @param plugin - The hot plugin.
 * @returns The filter and the load callback.
 * @throws {Error} When the plugin registered no load callback.
 */
function register(plugin: HotPlugin): Registered {
  let registered: Registered | undefined;

  plugin.setup({
    onLoad(options, callback) {
      registered = { filter: options.filter, load: callback };
    }
  });

  if (registered === undefined) throw new Error("The plugin registered no onLoad callback.");

  return registered;
}

/**
 * Writes a temp file under the suite's folder.
 *
 * @param relative - The path under the temp folder, `/` separated.
 * @returns The absolute path of the file.
 */
async function writeTemp(relative: string): Promise<string> {
  const file = path.join(root, relative);

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, SOURCE);

  return file;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "moku-hot-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.spyOn(process, "cwd").mockReturnValue(root);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hot()", () => {
  it("names itself and is the default export with the default filters", () => {
    expect(defaultPlugin.name).toBe("@moku-labs/game/hot");
    expect(register(defaultPlugin).filter.source).toBe(register(hot()).filter.source);
  });

  it("fits Bun's plugin type", () => {
    const plugin: BunPlugin = hot();

    expect(typeof plugin.setup).toBe("function");
  });

  it("matches .tsx, styles.ts and view.ts, and no logic module", () => {
    const { filter } = register(hot());

    expect(filter.test("/game/features/home/logo.tsx")).toBe(true);
    expect(filter.test("/game/features/home/styles.ts")).toBe(true);
    expect(filter.test("/game/features/home/view.ts")).toBe(true);
    expect(filter.test("/game/features/home/state.ts")).toBe(false);
    expect(filter.test("/game/features/home/nodes.ts")).toBe(false);
    expect(filter.test("/game/features/home/index.ts")).toBe(false);
  });

  it("matches animations.ts, effects.ts and the generated strings of a locale", () => {
    const { filter } = register(hot());

    expect(filter.test("/game/features/board/animations.ts")).toBe(true);
    expect(filter.test("/game/features/board/effects.ts")).toBe(true);
    expect(filter.test("/game/generated/strings.ru.ts")).toBe(true);
    expect(filter.test("/game/generated/strings.pt-BR.ts")).toBe(true);
    expect(filter.test("/game/generated/assets.ts")).toBe(false);
  });

  it("matches a .ts file directly in a styles/, motion/, effects/ or views/ folder", () => {
    const { filter } = register(hot());

    for (const file of [
      "/game/features/board/motion/motions.ts",
      "/game/features/board/effects/stars.ts",
      "/game/features/board/styles/board.ts",
      "/game/features/board/views/cell.ts",
      "/game/shared/styles/text.ts",
      "/game/shared/styles/tokens.ts",
      "/game/shared/motion/pop-in.ts",
      "/game/shared/views/item-look.ts"
    ]) {
      expect(filter.test(file), file).toBe(true);
    }
  });

  it("matches world/projections and world/layout, and no world/components or world/systems", () => {
    const { filter } = register(hot());

    expect(filter.test("/game/features/board/world/projections/cells.ts")).toBe(true);
    expect(filter.test("/game/features/board/world/layout/grid.ts")).toBe(true);
    expect(filter.test("/game/features/board/world/components/item.ts")).toBe(false);
    expect(filter.test("/game/features/board/world/systems/hover-look.ts")).toBe(false);
  });

  it("matches no logic folder and nothing nested deeper in a kind folder", () => {
    const { filter } = register(hot());

    for (const file of [
      "/game/features/board/flow/board.ts",
      "/game/features/board/rules/merge.ts",
      "/game/features/board/index.ts",
      "/game/shared/flow/confirm.ts",
      "/game/plugins/loading/index.ts",
      "/game/features/board/views/deep/x.ts",
      "/game/features/board/world/projections/deep/x.ts",
      "/game/generated/assets.ts"
    ]) {
      expect(filter.test(file), file).toBe(false);
    }
  });

  it("appends the footer to a kind-folder module with loader ts", async () => {
    const load = register(hot()).load;

    for (const relative of [
      "shared/styles/text.ts",
      "features/board/motion/motions.ts",
      "features/board/world/projections/cells.ts",
      "features/board/world/layout/grid.ts"
    ]) {
      const file = await writeTemp(relative);
      const loaded = await load({ path: file });

      expect(loaded.loader).toBe("ts");
      expect(loaded.contents.startsWith(SOURCE)).toBe(true);
      expect(loaded.contents).toContain(`swap(next, ${JSON.stringify(file)});`);
    }
  });

  it("loads a test file of a kind folder unchanged", async () => {
    const load = register(hot()).load;

    for (const relative of [
      "features/board/styles/styles.test.ts",
      "features/board/__tests__/unit/styles.test.ts",
      "features/board/__tests__/isolated/views/cell.ts"
    ]) {
      const file = await writeTemp(relative);
      const loaded = await load({ path: file });

      expect(loaded.contents).toBe(SOURCE);
    }
  });

  it("keeps the default include when only exclude is given", () => {
    expect(register(hot({ exclude: /x/ })).filter.source).toBe(register(hot()).filter.source);
  });

  it("anchors the view names and the kind folders in one default filter", () => {
    expect(register(hot()).filter.source).toBe(
      String.raw`(\.tsx|\/styles\.ts|\/view\.ts|\/animations\.ts|\/effects\.ts|\/generated\/strings\.[\w-]+\.ts|` +
        String.raw`\/(?:styles|motion|effects|views)\/[^/]+\.ts|\/world\/(?:projections|layout)\/[^/]+\.ts|` +
        String.raw`\/\.moku\/assets-stamp\.ts)$`
    );
  });

  it("matches the stamp module of the keys watch, and no other file of .moku/", () => {
    const { filter } = register(hot());

    expect(filter.test("/g/.moku/assets-stamp.ts")).toBe(true);

    for (const file of [
      "/g/.moku/main.ts",
      "/g/.moku/dev.ts",
      "/g/.moku/visual/main.ts",
      "/g/.moku/visual/assets-stamp.ts",
      "/g/features/home/assets-stamp.ts"
    ]) {
      expect(filter.test(file), file).toBe(false);
    }
  });

  it("appends the footer to .moku/assets-stamp.ts: the default exclude does not take it", async () => {
    const file = await writeTemp(".moku/assets-stamp.ts");
    const loaded = await register(hot()).load({ path: file });

    expect(loaded.loader).toBe("ts");
    expect(loaded.contents.startsWith(SOURCE)).toBe(true);
    expect(loaded.contents).toContain("  import.meta.hot.accept(next => {");
    expect(loaded.contents).toContain(`swap(next, ${JSON.stringify(file)});`);
  });

  it("appends the footer to animations.ts, effects.ts and a generated strings file", async () => {
    const load = register(hot()).load;

    for (const relative of [
      "features/board/animations.ts",
      "features/board/effects.ts",
      "generated/strings.ru.ts"
    ]) {
      const file = await writeTemp(relative);
      const loaded = await load({ path: file });

      expect(loaded.loader).toBe("ts");
      expect(loaded.contents.startsWith(SOURCE)).toBe(true);
      expect(loaded.contents).toContain(`swap(next, ${JSON.stringify(file)});`);
    }
  });

  it("appends the footer to a .tsx file with loader tsx", async () => {
    const file = await writeTemp("features/home/logo.tsx");
    const loaded = await register(hot()).load({ path: file });

    expect(loaded.loader).toBe("tsx");
    expect(loaded.contents.startsWith(SOURCE)).toBe(true);
    expect(loaded.contents).toContain("if (import.meta.hot) {");
    expect(loaded.contents).toContain("  import.meta.hot.accept();");
    expect(loaded.contents).toContain("  import.meta.hot.accept(next => {");
    expect(loaded.contents).toContain("const swap = globalThis.__moku_hot;");
    expect(loaded.contents).toContain(
      String.raw`throw new Error("[game] No running game takes the hot swap.\n  Open the game page, then save again.");`
    );
    expect(loaded.contents).toContain(`swap(next, ${JSON.stringify(file)});`);
  });

  it("appends the footer to styles.ts and view.ts with loader ts", async () => {
    const load = register(hot()).load;

    for (const relative of ["features/home/styles.ts", "features/home/view.ts"]) {
      const file = await writeTemp(relative);
      const loaded = await load({ path: file });

      expect(loaded.loader).toBe("ts");
      expect(loaded.contents).toContain(`swap(next, ${JSON.stringify(file)});`);
    }
  });

  it("loads excluded paths unchanged", async () => {
    const load = register(hot()).load;
    const excluded = [
      "web/main.tsx",
      "node_modules/kit/button.tsx",
      "generated/assets/view.ts",
      "features/home/__tests__/view.tsx",
      "features/home/logo.test.tsx"
    ];

    for (const relative of excluded) {
      const file = await writeTemp(relative);
      const loaded = await load({ path: file });

      expect(loaded.contents).toBe(SOURCE);
      expect(loaded.loader).toBe(relative.endsWith(".tsx") ? "tsx" : "ts");
    }
  });

  it.skipIf(process.platform === "win32")(
    "tests exclude on a Windows path with / separators",
    async () => {
      // On macOS and Linux a backslash is a plain file name character: one file stands in for
      // the Windows path `C:\game\web\view.tsx`.
      const file = await writeTemp(String.raw`C:\game\web\view.tsx`);
      const loaded = await register(hot()).load({ path: file });

      expect(loaded.contents).toBe(SOURCE);
    }
  );

  it("takes include and exclude from the options", async () => {
    const { filter, load } = register(
      hot({ include: /\/look\/.*\.ts$/, exclude: /\/look\/skip\// })
    );
    const taken = await writeTemp("features/home/look/card.ts");
    const skipped = await writeTemp("features/home/look/skip/card.ts");

    expect(filter.test(taken)).toBe(true);
    expect(filter.test(path.join(root, "features/home/logo.tsx"))).toBe(false);
    const loadedTaken = await load({ path: taken });
    const loadedSkipped = await load({ path: skipped });

    expect(loadedTaken.contents).toContain("import.meta.hot.accept();");
    expect(loadedSkipped.contents).toBe(SOURCE);
  });

  it.skipIf(typeof Bun === "undefined")(
    "emits a module Bun transpiles, and Bun drops the footer outside the dev server",
    async () => {
      const file = await writeTemp("features/home/view.tsx");
      const loaded = await register(hot()).load({ path: file });
      const output = new Bun.Transpiler({ loader: loaded.loader }).transformSync(loaded.contents);

      expect(output).toContain('export const title = "Home";');
      expect(output).toContain("if (undefined) {}");
      expect(output).not.toContain("__moku_hot");
    }
  );
});

describe("hot() and the game root", () => {
  /** The game root sits under a `tests/` folder, as the fixture game does. */
  const game = "work/tests/game";

  /**
   * Loads one temp file with the default plugin, the dev server running in the game root.
   *
   * @param relative - The path under the temp folder, `/` separated.
   * @returns The contents the plugin hands to Bun.
   */
  async function loadInGame(relative: string): Promise<string> {
    const file = await writeTemp(relative);

    vi.spyOn(process, "cwd").mockReturnValue(path.join(root, game));
    const loaded = await register(hot()).load({ path: file });

    return loaded.contents;
  }

  it("appends the footer to a view under features/ although a tests/ folder is above the root", async () => {
    expect(await loadInGame(`${game}/features/home/view.tsx`)).toContain(
      "import.meta.hot.accept();"
    );
  });

  it("loads a view under the game's own tests/ folder unchanged", async () => {
    expect(await loadInGame(`${game}/tests/view.tsx`)).toBe(SOURCE);
  });

  it("loads a file outside the game root unchanged, such as the engine source next to it", async () => {
    expect(await loadInGame("work/src/plugins/flow/runner/view.ts")).toBe(SOURCE);
  });
});
