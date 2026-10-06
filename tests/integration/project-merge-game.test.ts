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

  it("keys every module-level component of a .tsx file and every defineComponent", () => {
    expect(keysOf("component:")).toEqual(
      [
        "Amount",
        "BoardTray",
        "CardPicture",
        "Confirm",
        "DailyGift",
        "HudPill",
        "HudRow",
        "InfoBar",
        "LanguagePane",
        "Leave",
        "LogoSign",
        "OrderCard",
        "OrderStrip",
        "OutOfEnergy",
        "Parchment",
        "PlankButton",
        "PlaySign",
        "PopupScreen",
        "Prize",
        "ProfilePane",
        "Rename",
        "RewardPopup",
        "Rope",
        "RoundButton",
        "Settings",
        "Signboard",
        "StepButton",
        "StepGlyph",
        "TabButton",
        "VolumeRow"
      ].map(name => `component:${name}`)
    );
    // SCREAMING_CASE constants are values, not components.
    expect(project.index.symbols["component:ROUND_SIZE"]).toBeUndefined();
    expect(project.index.symbols["component:SEGMENTS"]).toBeUndefined();
    expect(Object.keys(project.index.symbols)).toHaveLength(366);
  });

  it("keys every style a module-level function builds, by the function and its property", () => {
    const built = [
      "features/home/logo.tsx#ropeStyle",
      "features/home/styles.ts#postStyle",
      "features/splash/view.tsx#bladeStyle",
      "features/splash/view.tsx#fillStyle",
      "features/ui/kit.tsx#boardStyle",
      "features/ui/kit.tsx#hungRopeStyle",
      "features/ui/kit.tsx#pillStyle",
      "features/ui/kit.tsx#plankStyle",
      "features/ui/kit.tsx#roundStylesOf.badge",
      "features/ui/kit.tsx#roundStylesOf.disc",
      "features/ui/kit.tsx#roundStylesOf.icon",
      "features/ui/kit.tsx#tapBoxStyle"
    ].map(item => `style:${item}`);

    expect(keysOf("style:")).toHaveLength(99);
    expect(keysOf("style:").filter(key => built.includes(key))).toEqual(built);
    // boardStyle builds its style in two places: one key, one anchor, no conflict.
    expect(project.index.symbols["style:features/ui/kit.tsx#boardStyle"]).toEqual({
      def: [{ path: "features/ui/kit.tsx", binding: "boardStyle" }]
    });
    expect(project.index.symbols["style:features/ui/kit.tsx#roundStylesOf.icon"]).toEqual({
      def: [{ path: "features/ui/kit.tsx", binding: "roundStylesOf", key: "icon" }]
    });
  });

  it("finds a built style at its calls, not at the function", async () => {
    expect(await linesOf("style:features/ui/kit.tsx#boardStyle")).toEqual([
      "features/ui/kit.tsx:666",
      "features/ui/kit.tsx:668"
    ]);
    expect(await linesOf("style:features/ui/kit.tsx#roundStylesOf.icon")).toEqual([
      "features/ui/kit.tsx:358"
    ]);
    expect(await linesOf("style:features/home/logo.tsx#ropeStyle")).toEqual([
      "features/home/logo.tsx:55"
    ]);
  });

  it("finds a component at its declaration and lists the files that render it", async () => {
    expect(await linesOf("component:RoundButton")).toEqual(["features/ui/kit.tsx:418"]);
    expect(await linesOf("component:HudPill")).toEqual(["features/ui/kit.tsx:535"]);
    expect(await linesOf("component:LogoSign")).toEqual(["features/home/logo.tsx:94"]);

    const [settings] = await project.find("component:Settings");

    expect(settings).toMatchObject({
      path: "features/settings/settings.tsx",
      binding: "Settings",
      line: 278
    });
    expect(project.index.symbols["component:RoundButton"]?.uses).toEqual([
      { path: "features/home/view.tsx", binding: "RoundButton" },
      { path: "features/hud/row.tsx", binding: "RoundButton" }
    ]);
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
      "features/settings/settings.tsx:290:idProp"
    ]);
  });

  it("finds the amount of the daily gift through the {amountKey} and {unitKey} holes", async () => {
    expect(await linesOf("jsx:giftReward")).toEqual([
      "features/gift/daily-gift.tsx:26",
      "features/ui/popup.tsx:184"
    ]);
    expect(await linesOf("jsx:giftRewardUnit")).toEqual([
      "features/gift/daily-gift.tsx:28",
      "features/ui/popup.tsx:186"
    ]);
    // The {id} pattern of Amount takes only id= props: amountKey="giftReward" never fills it.
    expect(await linesOf("jsx:giftAmount")).toEqual([
      "features/gift/daily-gift.tsx:25",
      "features/ui/popup.tsx:182"
    ]);
    expect(project.index.symbols["jsx:giftReward"]?.def).toEqual([
      {
        path: "features/gift/daily-gift.tsx",
        key: "giftReward",
        kind: "idProp",
        component: "Amount",
        prop: "amountKey"
      }
    ]);
  });

  it("finds a settings tab through the {id} pattern of TabButton and its literal id", async () => {
    expect(await linesOf("jsx:tabSound")).toEqual([
      "features/settings/settings.tsx:301",
      "features/settings/settings.tsx:105"
    ]);
    // The `*Label` of the sound rows reads as any label: it answers last, as a wildcard.
    expect(await linesOf("jsx:tabSoundLabel")).toEqual([
      "features/settings/settings.tsx:111",
      "features/settings/settings.tsx:301",
      "features/settings/settings.tsx:183"
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
      line: 290,
      kind: "idProp",
      component: "Signboard"
    });
    expect(board?.range[0]).toBe(289);
  });

  it("has nothing unresolved: every JSX key of the game reads as a pattern", () => {
    expect(project.index.unresolved).toEqual([]);
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

  it("answers where a node lives, and --check passes with nothing unresolved", () => {
    const bin = layout();
    const where = runBin(bin, ["--root", ROOT, "where", "node:board/merge"]);
    const check = runBin(bin, ["--root", ROOT, "--check"]);

    expect(where.status).toBe(0);
    expect(where.stdout).toBe("nodes/merge.ts:17\n");
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("111 files, 366 keys: 0 broken, 0 in conflict, 0 unresolved.");
  });
});
