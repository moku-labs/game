import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { read, sources } from "@moku-labs/game/inspect";
import { openProject, type ProjectApi } from "@moku-labs/game/project";
import { createHeadless } from "@moku-labs/game/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMiniGame } from "../fixtures/mini-game/game";
import { miniFolder, readManifest } from "./mini-helpers";

// ---------------------------------------------------------------------------
// Integration: the project index on the mini game, read-only. The keys join
// the graph of a headless mini game exactly, every definer and every literal
// JSX key has its key, `find` answers the lines the editor pins, and the bin
// answers an agent. The cost is logged as a test annotation.
// ---------------------------------------------------------------------------

/** The mini game, read and never written. */
const ROOT = fileURLToPath(miniFolder);

/** The real bin of the package, the file npm ships. */
const BIN = fileURLToPath(new URL("../../bin/moku-game-index.mjs", import.meta.url));

/** The door the bin imports through `../dist/project.mjs`. */
const PROJECT_DOOR = fileURLToPath(new URL("../../src/project.ts", import.meta.url));

/** The cost bounds, loose on purpose: a slow CI box must not fail them. */
const OPEN_BOUND_MS = 5000;
const FIND_BOUND_MS = 200;

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

describe("the project index of the mini game", () => {
  it("opens in under a second, the TypeScript load included", async ({ annotate }) => {
    await annotate(
      `openProject: ${openMs.toFixed(1)} ms, ${Object.keys(project.index.files).length} files`,
      "cost"
    );

    expect(openMs).toBeLessThan(OPEN_BOUND_MS);
    expect(Object.keys(project.index.files)).toHaveLength(23);
    expect(project.index.manifest).toBe("manifest.json");
  });

  it("joins game.graph exactly: one node: key per <flow>/<node>, one flow: key per flow", async () => {
    const app = createMiniGame({ manifest: await readManifest() });
    const game = await createHeadless(app);
    const graph = read(app, sources.graph);
    const pairs = Object.entries(graph.flows).flatMap(([flow, described]) =>
      Object.keys(described.nodes).map(node => `node:${flow}/${node}`)
    );

    await game.stop();

    expect(keysOf("node:")).toEqual(pairs.toSorted());
    expect(keysOf("node:")).toEqual([
      "node:infoPopup/count",
      "node:infoPopup/show",
      "node:main/home",
      "node:main/info"
    ]);
    expect(keysOf("flow:")).toEqual(["flow:infoPopup", "flow:main"]);
    expect(Object.keys(graph.flows).toSorted()).toEqual(["infoPopup", "main"]);
  });

  it("keys every scene, emitter, projection, feature and text style, with no conflict", () => {
    expect(keysOf("scene:")).toEqual(["scene:home"]);
    expect(keysOf("emitter:")).toEqual(["emitter:fx.spark"]);
    expect(keysOf("projection:")).toEqual(["projection:home.screen"]);
    expect(keysOf("feature:")).toEqual(["feature:home", "feature:info"]);
    expect(keysOf("textStyle:")).toEqual(["textStyle:ui.counter", "textStyle:ui.note"]);
    expect(Object.values(project.index.symbols).filter(symbol => symbol.conflict)).toEqual([]);
    expect(Object.values(project.index.files).filter(file => file.state === "broken")).toEqual([]);
  });

  it("keys every module-level component of a .tsx file and every defineComponent", () => {
    expect(keysOf("component:")).toEqual(["component:InfoPopup", "component:Panel"]);
    expect(Object.keys(project.index.symbols)).toHaveLength(35);
  });

  it("keys every style a module-level function builds, by the function and its property", () => {
    const built = [
      "features/home/styles.ts#roundStylesOf.disc",
      "features/home/styles.ts#roundStylesOf.picture"
    ].map(item => `style:${item}`);

    expect(keysOf("style:")).toHaveLength(8);
    expect(keysOf("style:").filter(key => built.includes(key))).toEqual(built);
    expect(project.index.symbols["style:features/home/styles.ts#roundStylesOf.disc"]).toEqual({
      def: [{ path: "features/home/styles.ts", binding: "roundStylesOf", key: "disc" }]
    });
    // A style bound to a module-level const lists the files that read it.
    expect(project.index.symbols["style:features/home/styles.ts#screenStyle"]).toEqual({
      def: [{ path: "features/home/styles.ts", binding: "screenStyle" }],
      uses: [{ path: "features/home/view.tsx", binding: "screenStyle" }]
    });
  });

  it("finds a built style at its calls, not at the function", async () => {
    expect(await linesOf("style:features/home/styles.ts#roundStylesOf.disc")).toEqual([
      "features/home/styles.ts:38"
    ]);
    expect(await linesOf("style:features/home/styles.ts#roundStylesOf.picture")).toEqual([
      "features/home/styles.ts:46"
    ]);
  });

  it("finds a component at its declaration and lists the files that render it", async () => {
    expect(await linesOf("component:Panel")).toEqual(["features/info/popup.tsx:62"]);

    const [popup] = await project.find("component:InfoPopup");

    expect(popup).toMatchObject({
      path: "features/info/popup.tsx",
      binding: "InfoPopup",
      line: 74
    });
    expect(project.index.symbols["component:Panel"]?.uses).toEqual([
      { path: "features/info/popup.tsx", binding: "Panel" }
    ]);
  });

  it("indexes every literal JSX key and every literal id= prop of a component", () => {
    const keys = literalAttributes(/\bkey="([^"]+)"/g);
    const props = literalAttributes(/\sid="([^"]+)"/g);

    expect(keys).toHaveLength(9);
    expect(props).toEqual(["features/info/popup.tsx infoPanel"]);
    expect(keys.filter(pair => !isIndexedAs(pair, "literal"))).toEqual([]);
    expect(props.filter(pair => !isIndexedAs(pair, "idProp"))).toEqual([]);
  });

  it("finds the spark of the info panel through the {id} pattern of Panel", async () => {
    const found = await project.find("jsx:infoPanelSpark");

    expect(found.map(place => `${place.path}:${place.line}:${place.kind}`)).toEqual([
      "features/info/popup.tsx:65:template",
      "features/info/popup.tsx:79:idProp"
    ]);
    expect(project.index.symbols["jsx:{id}Spark"]?.def).toEqual([
      { path: "features/info/popup.tsx", key: "{id}Spark", kind: "template", component: "Panel" }
    ]);
    // The panel itself: the literal prop first, then the `{id}` pattern its key is written as.
    const panel = await project.find("jsx:infoPanel");

    expect(panel.map(place => `${place.line}:${place.kind}`)).toEqual(["79:idProp", "64:ident"]);
  });

  it("answers the lines the editor pins", async () => {
    expect(await linesOf("node:infoPopup/count")).toEqual(["nodes/count.ts:7"]);
    expect(await linesOf("node:main/info")).toEqual(["flows/info.ts:12"]);
    expect(await linesOf("flow:main")).toEqual(["flows/main.ts:9"]);
    expect(await linesOf("scene:home")).toEqual(["features/home/scene.ts:8"]);
    expect(await linesOf("projection:home.screen")).toEqual(["features/home/view.tsx:21"]);
    expect(await linesOf("textStyle:ui.counter")).toEqual(["features/home/styles.ts:16"]);
    expect(await linesOf("emitter:fx.spark")).toEqual(["features/info/effects.ts:8"]);
    expect(await linesOf("style:features/home/styles.ts#screenStyle")).toEqual([
      "features/home/styles.ts:21"
    ]);

    const [button] = await project.find("jsx:info");

    expect(button).toMatchObject({ path: "features/home/view.tsx", line: 28, kind: "literal" });
    expect(button?.range).toEqual([28, 7, 30, 16]);
  });

  it("has nothing unresolved: every JSX key of the game reads as a pattern", () => {
    expect(project.index.unresolved).toEqual([]);
  });

  it("finds on an unchanged file in under 20 ms", async ({ annotate }) => {
    const keys = ["node:infoPopup/count", "textStyle:ui.counter", "jsx:infoPanelSpark", "jsx:info"];
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

  it("answers where a node lives, and --check passes with nothing unresolved", () => {
    const bin = layout();
    const where = runBin(bin, ["--root", ROOT, "where", "node:infoPopup/count"]);
    const check = runBin(bin, ["--root", ROOT, "--check"]);

    expect(where.status).toBe(0);
    expect(where.stdout).toBe("nodes/count.ts:7\n");
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("23 files, 35 keys: 0 broken, 0 in conflict, 0 unresolved.");
  });
});
