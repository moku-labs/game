/**
 * @file `moku-game build` end to end, the test bin on a copy of the mini game with an icon, a boot
 * picture and a marked scenario: the assets packed, the page bundled with every link `./`, the packed manifest
 * beside it, the two startup marks, and no dev code in the output. Plus the refusal of an output
 * folder at the game root, a build run from another folder with the tree plugin, and the Bun log
 * of a page that does not bundle. Plus a game that names only `haptics` with a memory save: it
 * builds where `@tauri-apps/plugin-store` cannot resolve, and its bundle holds no store. Plus
 * `build --debug` with a fake `@moku-labs/editor` in the copy, and the refusal of a release page
 * that imports it.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
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

/** A string only the fake editor agent holds: a page that bundles the agent carries it. */
const AGENT_MARKER = "fake-editor-agent-81d4b0";

/** A string only the `.dev` module of the debug copy holds. */
const DEV_MODULE_MARKER = "dev-module-marker-6e2a19";

/** The version of the engine repo: a copy resolves the engine's sources, `<version>+src`. */
const VERSION = (
  JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as { version: string }
).version;

/**
 * Writes a fake `@moku-labs/editor` into a game: `./agent/page` default-exports an agent that
 * logs a marker, and the module logs an editor line when it loads, as the real agent bundle
 * carries the `[moku-editor]` prefix.
 *
 * @param root - The game folder.
 */
function fakeEditor(root: string): void {
  const folder = path.join(root, "node_modules", "@moku-labs", "editor");

  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: "@moku-labs/editor",
      type: "module",
      exports: { "./agent/page": "./page.js" }
    })
  );
  writeFileSync(
    path.join(folder, "page.js"),
    [
      'console.info("[moku-editor] the fake agent loaded.");',
      `export default function agent({ app }) { app.log.info("${AGENT_MARKER}"); }`,
      ""
    ].join("\n")
  );
}

/**
 * Reads the code of a built page: every `.js` and `.html` file of the output.
 *
 * @param out - The output folder.
 * @returns The texts, joined.
 */
function pageCode(out: string): string {
  return filesUnder(out)
    .filter(file => file.endsWith(".js") || file.endsWith(".html"))
    .map(file => readFileSync(path.join(out, file), "utf8"))
    .join("\n");
}

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
 * Copies the mini game with a favicon, a boot picture and a marked scenario.
 *
 * @param prefix - The start of the folder name.
 * @returns The copy.
 */
function iconGame(prefix: string): string {
  const root = copyMiniGame(prefix);

  made.push(root);
  writeFileSync(
    path.join(root, "config.ts"),
    'export default { page: { title: "mini-game", icons: { favicon: "features/ui/assets/fx-spark.webp" }, boot: { image: "features/ui/assets/font-body.png" } } };\n'
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
    expect(code).not.toContain('"renderer.monitor"');
    expect(code).not.toContain(SCENARIO_MARKER);
  });

  it("carries the two startup marks and no engine id", () => {
    const code = pageCode(built.out);

    expect(code).toContain('"moku:script"');
    expect(code).toContain('"moku:main"');
    expect(code).not.toContain(`${VERSION}+src`);
  });

  it("the icon link starts with ./", () => {
    const html = readFileSync(path.join(built.out, "index.html"), "utf8");
    const icon = /<link rel="icon" href="([^"]+)"/.exec(html)?.[1] ?? "";

    expect(icon).toMatch(/^\.\//);
    expect(existsSync(path.join(built.out, icon))).toBe(true);
    expect(html).not.toContain("../");
  });

  // Bug: the built page links its boot picture into the game, so the release shows only the background.
  it("the boot picture is a file of the output and the page links it with ./", () => {
    const html = readFileSync(path.join(built.out, "index.html"), "utf8");
    const boot = /<img id="moku-boot" src="([^"]+)"/.exec(html)?.[1] ?? "";

    expect(boot).toMatch(/^\.\/.+\.png$/);
    expect(readFileSync(path.join(built.out, boot))).toEqual(
      readFileSync(path.join(built.root, "features", "ui", "assets", "font-body.png"))
    );
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

/** The debug build of this file, made once. */
const debug = { root: "", out: "", code: -1 as number | null, stderr: "" };

describe("moku-game build --debug", () => {
  beforeAll(async () => {
    debug.root = iconGame("build-debug");
    debug.out = path.join(mkdtempSync(path.join(tmpdir(), "moku-game-debug-")), "web");
    made.push(path.dirname(debug.out));
    fakeEditor(debug.root);
    writeFileSync(
      path.join(debug.root, "features", "home", "home.dev.ts"),
      `export const marker = "${DEV_MODULE_MARKER}";\n`
    );

    const ran = await runBin(["build", "--root", debug.root, "--debug", "--out", debug.out]);

    debug.code = ran.code;
    debug.stderr = ran.stderr;
  }, 180_000);

  it("starts the editor's page agent with the .dev modules and control, names the build, the engine and the editor, and marks the page", () => {
    expect(debug.code).toBe(0);

    const code = pageCode(debug.out);

    expect(code).toContain(AGENT_MARKER);
    expect(code).toContain(DEV_MODULE_MARKER);
    expect(code).toMatch(/"debug-\d{8}T\d{6}Z"/);
    expect(code).toMatch(/__MOKU_GAME_CONTROL__\s*=\s*(?:true|!0)/);
    expect(code).toContain(`"${VERSION}+src"`);
    expect(code).toContain('"127.0.0.1:47600"');
    expect(code).toContain('"moku:script"');
    expect(code).toContain('"moku:main"');
    expect(code).toContain("<title>mini-game Debug</title>");
  });

  it("carries no hot swap, no scenario, no frame recorder and no audio journal", () => {
    const code = pageCode(debug.out);

    expect(code).not.toContain("__moku_hot");
    expect(code).not.toContain("import.meta.hot");
    expect(code).not.toContain(SCENARIO_MARKER);
    expect(code).not.toContain("world:history-on");
    expect(code).not.toMatch(/journal:\s*200/);
  });

  it("warns once naming the profile, the build, the engine and the editor, and writes nothing under .moku", () => {
    const version = VERSION.replaceAll(".", String.raw`\.`);

    expect(debug.stderr).toMatch(
      new RegExp(
        String.raw`build: a DEBUG page with the editor agent, control: every command, the state-changing ones too\. Build debug-\d{8}T\d{6}Z, engine ${version}\+src, editor 127\.0\.0\.1:47600\. Never ship it to a store\.`
      )
    );
    expect(debug.stderr.match(/a DEBUG page/g)).toHaveLength(1);
    expect(existsSync(path.join(debug.root, ".moku"))).toBe(false);
  });

  it("a release page that imports the editor outside any guard is refused, and its output folder is gone", async () => {
    const root = iconGame("build-agent");
    const out = path.join(mkdtempSync(path.join(tmpdir(), "moku-game-agent-")), "web");
    const index = path.join(root, "index.ts");

    made.push(path.dirname(out));
    fakeEditor(root);
    writeFileSync(index, `import "@moku-labs/editor/agent/page";\n${readFileSync(index, "utf8")}`);

    const ran = await runBin(["build", "--root", root, "--out", out]);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toMatch(
      /\[game] build: the release page carries the editor agent \("\[moku-editor]" in page\/[^)]+\.js\)\./
    );
    expect(ran.stderr).toContain(
      "Import @moku-labs/editor only behind __MOKU_GAME_DEV__, or build a debug page with --debug."
    );
    expect(existsSync(out)).toBe(false);
  }, 180_000);
});
