import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { read, sources } from "@moku-labs/game/inspect";
import { openProject, type ProjectApi } from "@moku-labs/game/project";
import { createHeadless } from "@moku-labs/game/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGame } from "./merge-game/game";

// ---------------------------------------------------------------------------
// Integration: the project index on the fixture game, read-only. The keys join
// the graph of a headless merge game exactly, every definer and every literal
// JSX key has its key, `find` answers the lines the editor pins, and the bin
// answers an agent. The cost is logged as a test annotation.
// ---------------------------------------------------------------------------

/** The fixture game, read and never written. */
const ROOT = fileURLToPath(new URL("merge-game/", import.meta.url));

/** The real bin of the package, the file npm ships. */
const BIN = fileURLToPath(new URL("../../bin/moku-game-index.mjs", import.meta.url));

/** The door the bin imports through `../dist/project.mjs`. */
const PROJECT_DOOR = fileURLToPath(new URL("../../src/project.ts", import.meta.url));

/** The cost bounds, loose on purpose: a slow CI box must not fail them. */
const OPEN_BOUND_MS = 1000;
const FIND_BOUND_MS = 20;

let project: ProjectApi;
let openMs = 0;

beforeAll(async () => {
  const started = performance.now();

  project = await openProject({ root: ROOT });
  openMs = performance.now() - started;
});

afterAll(() => {
  project.close();
});

/**
 * The keys of the index that start with a prefix, sorted.
 *
 * @param prefix - `flow:`, `node:` and so on.
 * @returns The keys.
 */
function keysOf(prefix: string): string[] {
  return Object.keys(project.index.symbols).filter(key => key.startsWith(prefix));
}

/**
 * Every literal value of an attribute in the fixture's `.tsx` sources, by file.
 *
 * @param attribute - A regular expression with the value as its first group.
 * @returns `path value` pairs.
 */
function literalAttributes(attribute: RegExp): string[] {
  const pairs: string[] = [];

  for (const file of Object.keys(project.index.files).filter(item => item.endsWith(".tsx"))) {
    const text = readFileSync(path.join(ROOT, file), "utf8");

    for (const match of text.matchAll(attribute)) pairs.push(`${file} ${match[1] ?? ""}`);
  }

  return pairs;
}

/**
 * Whether a literal attribute of a file is indexed as a JSX key of that file.
 *
 * @param pair - `path value`, as `literalAttributes` lists it.
 * @param kind - `literal` for a key, `idProp` for an id prop.
 * @returns True when the index holds it.
 */
function isIndexedAs(pair: string, kind: string): boolean {
  const [file, value] = pair.split(" ");
  const anchors = project.index.symbols[`jsx:${value}`]?.def ?? [];

  return anchors.some(anchor => anchor.path === file && anchor.kind === kind);
}

/**
 * The lines `find` answers for a key, as `path:line`.
 *
 * @param key - The key.
 * @returns The lines.
 */
async function linesOf(key: string): Promise<string[]> {
  const found = await project.find(key);

  return found.map(place => `${place.path}:${place.line}`);
}

/**
 * The unresolved item of a style built inside a function.
 *
 * @param file - The file.
 * @param around - The function the style is built in.
 * @returns The item.
 */
function builtStyle(file: string, around: string): { path: string; reason: string } {
  return { path: file, reason: `defineStyle in "${around}" is not bound to a module-level const` };
}

describe("the project index of merge-game", () => {
  it("opens in under a second, the TypeScript load included", async ({ annotate }) => {
    await annotate(
      `openProject: ${openMs.toFixed(1)} ms, ${Object.keys(project.index.files).length} files`,
      "cost"
    );

    expect(openMs).toBeLessThan(OPEN_BOUND_MS);
    expect(Object.keys(project.index.files)).toHaveLength(111);
    expect(project.index.manifest).toBe("manifest.json");
  });

  it("joins game.graph exactly: one node: key per <flow>/<node>, one flow: key per flow", async () => {
    const { app } = createGame();
    const game = await createHeadless(app);
    const graph = read(app, sources.graph);
    const pairs = Object.entries(graph.flows).flatMap(([flow, described]) =>
      Object.keys(described.nodes).map(node => `node:${flow}/${node}`)
    );

    await game.stop();

    expect(keysOf("node:")).toEqual(pairs.toSorted());
    expect(keysOf("flow:")).toEqual([
      "flow:board",
      "flow:main",
      "flow:rewardPopup",
      "flow:settingsPopup"
    ]);
    expect(Object.keys(graph.flows).toSorted()).toEqual([
      "board",
      "main",
      "rewardPopup",
      "settingsPopup"
    ]);
  });

  it("keys every scene, emitter, projection, feature and text style, with no conflict", () => {
    expect(keysOf("scene:")).toEqual(["scene:board", "scene:home", "scene:splash"]);
    expect(keysOf("emitter:")).toEqual([
      "emitter:fx.sparkles",
      "emitter:fx.stars",
      "emitter:fx.steam"
    ]);
    expect(keysOf("projection:")).toHaveLength(11);
    expect(keysOf("feature:")).toHaveLength(10);
    expect(keysOf("textStyle:")).toHaveLength(18);
    expect(keysOf("textStyle:").every(key => key.startsWith("textStyle:ui."))).toBe(true);
    expect(Object.values(project.index.symbols).filter(symbol => symbol.conflict)).toEqual([]);
    expect(Object.values(project.index.files).filter(file => file.state === "broken")).toEqual([]);
  });

  it("indexes every literal JSX key and every literal id= prop of a component", () => {
    const keys = literalAttributes(/\bkey="([^"]+)"/g);
    const props = literalAttributes(/\sid="([^"]+)"/g);
    expect(keys.length).toBeGreaterThan(40);
    expect(props.length).toBeGreaterThan(30);
    expect(keys.filter(pair => !isIndexedAs(pair, "literal"))).toEqual([]);
    expect(props.filter(pair => !isIndexedAs(pair, "idProp"))).toEqual([]);
  });

  it("reads the template and identifier keys of the order strip as card* patterns", async () => {
    const strip = keysOf("jsx:card");

    expect(strip).toContain("jsx:card*");
    expect(strip).toContain("jsx:card*Picture");
    expect(project.index.symbols["jsx:card*Picture"]?.def).toEqual([
      { path: "features/orders/strip.tsx", key: "card*Picture", kind: "template", stem: "card" }
    ]);
    const pattern = await project.find("jsx:card*Picture");
    const runtime = await project.find("jsx:card2Picture");

    expect(pattern.map(found => found.line)).toEqual([183]);
    expect(runtime.map(found => `${found.key}:${found.line}`)).toEqual([
      "card*Picture:183",
      "card*:216",
      "card*:263"
    ]);
  });

  it("finds the X of the settings board through the {id} pattern of the kit", async () => {
    const found = await project.find("jsx:settingsBoardClose");

    expect(found.map(place => `${place.path}:${place.line}:${place.kind}`)).toEqual([
      "features/ui/kit.tsx:844:template",
      "features/settings/settings.tsx:301:idProp"
    ]);
  });

  it("answers the lines the editor pins", async () => {
    expect(await linesOf("node:board/merge")).toEqual(["nodes/merge.ts:17"]);
    expect(await linesOf("flow:board")).toEqual(["flows/board.ts:21"]);
    expect(await linesOf("scene:home")).toEqual(["features/home/scene.ts:8"]);
    expect(await linesOf("projection:board.items")).toEqual(["view/projections.ts:179"]);
    expect(await linesOf("textStyle:ui.title")).toEqual(["features/ui/styles.ts:39"]);
    expect(await linesOf("style:features/ui/popup.tsx#popupScreen")).toEqual([
      "features/ui/popup.tsx:20"
    ]);
    const [board] = await project.find("jsx:settingsBoard");

    expect(board).toMatchObject({
      path: "features/settings/settings.tsx",
      line: 301,
      kind: "idProp",
      component: "Signboard"
    });
    expect(board?.range[0]).toBe(300);
  });

  it("pins the unresolved list: function-built styles and computed JSX keys", () => {
    expect(project.index.unresolved).toEqual([
      builtStyle("features/home/logo.tsx", "ropeStyle"),
      builtStyle("features/home/styles.ts", "postStyle"),
      {
        path: "features/settings/settings.tsx",
        reason: 'JSX key "key" on <button> resolves to "*"'
      },
      builtStyle("features/splash/view.tsx", "fillStyle"),
      builtStyle("features/splash/view.tsx", "bladeStyle"),
      builtStyle("features/ui/kit.tsx", "plankStyle"),
      builtStyle("features/ui/kit.tsx", "tapBoxStyle"),
      builtStyle("features/ui/kit.tsx", "roundStylesOf"),
      builtStyle("features/ui/kit.tsx", "roundStylesOf"),
      builtStyle("features/ui/kit.tsx", "roundStylesOf"),
      builtStyle("features/ui/kit.tsx", "pillStyle"),
      builtStyle("features/ui/kit.tsx", "boardStyle"),
      builtStyle("features/ui/kit.tsx", "boardStyle"),
      builtStyle("features/ui/kit.tsx", "hungRopeStyle"),
      {
        path: "features/ui/popup.tsx",
        reason: 'JSX key "props.amountKey" on <text> resolves to "*"'
      },
      {
        path: "features/ui/popup.tsx",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the reason quotes the source text
        reason: 'JSX key "props.unitKey ?? `${props.id}Unit`" on <text> resolves to "*"'
      }
    ]);
  });

  it("finds on an unchanged file in under 20 ms", async ({ annotate }) => {
    const keys = [
      "node:board/merge",
      "textStyle:ui.title",
      "jsx:settingsBoardClose",
      "jsx:card2Picture"
    ];
    const costs: string[] = [];

    for (const key of keys) {
      const started = performance.now();

      await project.find(key);

      const ms = performance.now() - started;

      costs.push(`${key} ${ms.toFixed(2)} ms`);
      expect(ms).toBeLessThan(FIND_BOUND_MS);
    }

    await annotate(`find: ${costs.join(", ")}`, "cost");
  });
});

/**
 * Runs the bin in a Bun child.
 *
 * @param bin - The copied bin.
 * @param args - Its arguments.
 * @returns The exit status and what it printed.
 */
function runBin(bin: string, args: string[]): { status: number | null; stdout: string } {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
  return spawnSync("bun", [bin, ...args], { encoding: "utf8" });
}

describe("the moku-game-index bin", () => {
  const made: string[] = [];

  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Lay out a temp package with the real bin and a `dist/project.mjs` that re-exports the source.
   *
   * @returns The copied bin.
   */
  const layout = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), "moku-index-bin-"));
    const bin = path.join(dir, "bin", "moku-game-index.mjs");

    made.push(dir);
    mkdirSync(path.join(dir, "bin"), { recursive: true });
    mkdirSync(path.join(dir, "dist"), { recursive: true });
    copyFileSync(BIN, bin);
    writeFileSync(
      path.join(dir, "dist", "project.mjs"),
      `export * from ${JSON.stringify(PROJECT_DOOR)};\n`
    );

    return bin;
  };

  it("answers where a node lives, and --check passes with the unresolved items as info", () => {
    const bin = layout();
    const where = runBin(bin, ["--root", ROOT, "where", "node:board/merge"]);
    const check = runBin(bin, ["--root", ROOT, "--check"]);

    expect(where.status).toBe(0);
    expect(where.stdout).toBe("nodes/merge.ts:17\n");
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("111 files, 316 keys: 0 broken, 0 in conflict, 16 unresolved.");
  });
});
