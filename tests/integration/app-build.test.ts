/**
 * @file `moku-game build` end to end, the test bin on a copy of the mini game with an icon and a
 * marked scenario: the assets packed, the page bundled with every link `./`, the packed manifest
 * beside it, and no dev code in the output. Plus the refusal of an output folder at the game root,
 * a build run from another folder with the tree plugin, and the Bun log of a page that does not
 * bundle. Plus a game that names only `haptics` with a memory save: it builds where
 * `@tauri-apps/plugin-store` cannot resolve, and its bundle holds no store.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyMiniGame, REPO, removeCopies, runBin } from "./app-helpers";

/** A string only the marked scenario holds: a build that ships scenarios carries it. */
const SCENARIO_MARKER = "scenario-marker-7f3a2c";

/**
 * A Bun plugin that fails every import of `@tauri-apps/plugin-store`, as in a game that does not
 * install it. The other `@tauri-apps` packages stay external: the engine does not install them,
 * and the test reads their import in the bundle.
 */
const NO_PLUGIN_STORE = String.raw`export default {
  name: "no-plugin-store",
  setup(build) {
    build.onResolve({ filter: /^@tauri-apps\/plugin-store$/ }, () => {
      throw new Error("@tauri-apps/plugin-store is not installed");
    });
    build.onResolve({ filter: /^@tauri-apps\// }, args => ({ path: args.path, external: true }));
  }
};
`;

/** The copies and output folders of this file, removed after it. */
const made: string[] = [];

/**
 * Lists every file under a folder, `/` separated.
 *
 * @param folder - The folder.
 * @returns The relative paths.
 */
function filesUnder(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry =>
      path.relative(folder, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/")
    );
}

/**
 * Copies the mini game with a favicon and a marked scenario.
 *
 * @param prefix - The start of the folder name.
 * @returns The copy.
 */
function iconGame(prefix: string): string {
  const root = copyMiniGame(prefix);

  made.push(root);
  writeFileSync(
    path.join(root, "config.ts"),
    'export default { page: { title: "mini-game", icons: { favicon: "features/ui/assets/fx-spark.webp" } } };\n'
  );
  writeFileSync(
    path.join(root, "tests", "scenarios", "marked.ts"),
    `export default () => ({ player: { count: 0 }, session: { marker: "${SCENARIO_MARKER}" } });\n`
  );

  return root;
}

/** The build of this file, made once. */
const built = { root: "", out: "", code: -1 as number | null, stderr: "" };

beforeAll(async () => {
  built.root = iconGame("build");
  built.out = path.join(mkdtempSync(path.join(tmpdir(), "moku-game-build-")), "web");
  made.push(path.dirname(built.out));

  const ran = await runBin(["build", "--root", built.root, "--out", built.out]);

  built.code = ran.code;
  built.stderr = ran.stderr;
}, 180_000);

afterAll(() => {
  removeCopies(made);
});

describe("moku-game build", () => {
  it("writes index.html with a ./ script and the packed manifest beside it", () => {
    expect(built.stderr).toBe("");
    expect(built.code).toBe(0);

    const html = readFileSync(path.join(built.out, "index.html"), "utf8");
    const script = /<script type="module" crossorigin src="([^"]+)"/.exec(html)?.[1] ?? "";
    const manifest = readFileSync(path.join(built.out, "manifest.json"), "utf8");
    const packed = readFileSync(path.join(built.root, "dist", "assets", "manifest.json"), "utf8");

    expect(script).toMatch(/^\.\/.+\.js$/);
    expect(existsSync(path.join(built.out, script))).toBe(true);
    expect(manifest).toBe(packed);
    expect((JSON.parse(manifest) as { version: number }).version).toBe(2);
  });

  it("the output carries no dev code", () => {
    const code = filesUnder(built.out)
      .filter(file => file.endsWith(".js") || file.endsWith(".html"))
      .map(file => readFileSync(path.join(built.out, file), "utf8"))
      .join("\n");

    expect(code).toContain("prefers-reduced-motion");
    expect(code).not.toContain("__moku_hot");
    expect(code).not.toContain("import.meta.hot");
    expect(code).not.toContain("Control commands run in dev builds only");
    expect(code).not.toContain("renderer.drawCalls");
    expect(code).not.toContain(SCENARIO_MARKER);
  });

  it("the icon link starts with ./", () => {
    const html = readFileSync(path.join(built.out, "index.html"), "utf8");
    const icon = /<link rel="icon" href="([^"]+)"/.exec(html)?.[1] ?? "";

    expect(icon).toMatch(/^\.\//);
    expect(existsSync(path.join(built.out, icon))).toBe(true);
    expect(html).not.toContain("../");
  });

  it("build writes nothing under .moku", () => {
    expect(existsSync(path.join(built.root, ".moku"))).toBe(false);
  });

  it("refuses --out at the game root", async () => {
    const ran = await runBin(["build", "--root", built.root, "--out", built.root]);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain(
      `[game] build: --out "${built.root}" would replace the game or its packed assets. Name another folder.`
    );
    expect(existsSync(path.join(built.root, "index.ts"))).toBe(true);
  }, 60_000);

  it("build --root from another folder bundles with the tree plugin from the game root", async () => {
    const root = iconGame("build-elsewhere");
    const away = mkdtempSync(path.join(tmpdir(), "moku-game-away-"));
    const out = path.join(away, "web");

    made.push(away);

    // The tree plugin resolves Pixi, core and common from the working directory: the game's.
    const ran = await runBin(
      [
        "build",
        "--root",
        root,
        "--serve-plugin",
        path.join(REPO, "scripts", "tree", "bundle.ts"),
        "--out",
        out
      ],
      away
    );

    expect(ran.stderr).toBe("");
    expect(ran.code).toBe(0);
    expect(existsSync(path.join(out, "index.html"))).toBe(true);
    expect(existsSync(path.join(out, "manifest.json"))).toBe(true);
  }, 180_000);

  it("a game naming only haptics with a memory save builds without @tauri-apps/plugin-store", async () => {
    const root = copyMiniGame("build-haptics");
    const away = mkdtempSync(path.join(tmpdir(), "moku-game-no-store-"));
    const plugin = path.join(away, "no-plugin-store.ts");
    const out = path.join(away, "web");

    made.push(root, away);
    writeFileSync(
      path.join(root, "config.ts"),
      'export default { page: { title: "mini-game" }, system: ["haptics"], save: "memory" };\n'
    );
    writeFileSync(plugin, NO_PLUGIN_STORE);

    const ran = await runBin(["build", "--root", root, "--serve-plugin", plugin, "--out", out]);

    expect(ran.stderr).toBe("");
    expect(ran.code).toBe(0);

    const code = filesUnder(out)
      .filter(file => file.endsWith(".js"))
      .map(file => readFileSync(path.join(out, file), "utf8"))
      .join("\n");

    expect(code).toContain("@tauri-apps/plugin-haptics");
    expect(code).not.toContain("plugin-store");
  }, 180_000);

  it("a failed bundle exits 1 with the Bun log", async () => {
    const root = iconGame("build-broken");
    const out = path.join(root, "dist", "web");

    writeFileSync(
      path.join(root, "index.ts"),
      'import "./missing-module.ts";\nexport default {};\n'
    );

    const ran = await runBin(["build", "--root", root]);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain("[game] build: the page did not bundle.");
    expect(ran.stderr).toContain("missing-module");
    rmSync(out, { recursive: true, force: true });
  }, 180_000);
});
