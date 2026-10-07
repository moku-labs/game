import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, defineGame, messageArgument, type } from "../../../../index";
import { compileStrings } from "../../compile/compile";
import { i18nPlugin } from "../../index";
import { i18nFor } from "../../tr";
import type { CompiledMessages, ElementNode } from "../../types";

// ---------------------------------------------------------------------------
// Integration: strings compiled the way `moku-game keys` compiles them, the
// written module imported for real, and its messages run through the real
// plugin. The module imports `messageArgument` and `messageDuration` from the
// engine root instead of carrying a copy of them.
// ---------------------------------------------------------------------------

/** The repo: the game folder lives inside it, so `@moku-labs/game` resolves to the source. */
const REPO = path.resolve(import.meta.dirname, "../../../../..");

/** The game folder of this file, under `<repo>/.moku/tests/` (git ignores `.moku`). */
const root = path.join(REPO, ".moku", "tests");

type Strings = {
  "chest.opens": { name: string | number | readonly string[] | ElementNode; left: number };
  "lobby.ready": { names: string | number | readonly string[] | ElementNode };
  "lobby.host": { name: string | number | readonly string[] | ElementNode };
};

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: string;
  strings: Strings;
}>();

const { tr } = i18nFor<Strings>();

const home = defineNode({ rest: true, checkpoint: true, outcomes: { play: type() } });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  edges: { home: { play: "home" } }
});

const coin: ElementNode = { type: "icon", props: { name: "hud.coin" }, children: [] };

/** The game folder, made before the tests. */
const game: { folder: string; source: string; messages: CompiledMessages } = {
  folder: "",
  source: "",
  messages: {}
};

beforeAll(async () => {
  mkdirSync(root, { recursive: true });
  game.folder = mkdtempSync(path.join(root, "i18n-generated-"));

  const strings = path.join(game.folder, "features", "chest", "strings");

  mkdirSync(strings, { recursive: true });
  writeFileSync(
    path.join(strings, "en.json"),
    JSON.stringify({
      "chest.opens": "{name} opens in {left, duration, short}",
      "lobby.ready": "Ready: {names}"
    })
  );

  const out = path.join(game.folder, "generated");

  await compileStrings(game.folder, out);

  const file = path.join(out, "strings.en.ts");
  const loaded = (await import(pathToFileURL(file).href)) as { default: CompiledMessages };

  game.source = readFileSync(file, "utf8");
  game.messages = loaded.default;
}, 30_000);

afterAll(() => {
  rmSync(game.folder, { recursive: true, force: true });
});

/** A compiled module written by hand, as the root `messageArgument` documents it. */
const lobby: CompiledMessages = {
  "lobby.host": (p, intl) => [{ kind: "text", text: "Host: " }, messageArgument(p.name, intl)]
};

/**
 * Starts the logic set plus `i18n`, in English, with the compiled module as a feature's strings.
 *
 * @returns The started app.
 */
async function startApp() {
  const chestFeature = defineFeature("chest", { flows: [main], strings: { en: game.messages } });
  const lobbyFeature = defineFeature("lobby", { strings: { en: lobby } });
  const app = createApp({
    plugins: [i18nPlugin, chestFeature, lobbyFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: {}, initialSession: {}, seed: 1 }
    }
  });

  await app.start();

  return app;
}

describe("i18n plugin integration — a compiled module with the engine helpers", () => {
  it("imports both helpers from the engine root and carries no copy of them", () => {
    expect(game.source).toContain(
      'import { messageArgument as argument, messageDuration as duration } from "@moku-labs/game";'
    );
    expect(game.source).not.toMatch(/function (?:argument|duration)\(/);
  });

  it("keeps an element argument in its place and formats the duration", async () => {
    const app = await startApp();

    expect(app.i18n.format(tr("chest.opens", { name: coin, left: 95_000 }))).toEqual([
      { kind: "element", node: coin },
      { kind: "text", text: " opens in 1 min, 35 sec" }
    ]);

    await app.stop();
  });

  it("formats a list argument through Intl.ListFormat", async () => {
    const app = await startApp();

    expect(app.i18n.plain(tr("lobby.ready", { names: ["Ann", "Bob", "Cy"] }))).toBe(
      "Ready: Ann, Bob, and Cy"
    );

    await app.stop();
  });

  it("runs the root messageArgument in a module written by hand", async () => {
    const app = await startApp();

    expect(app.i18n.plain(tr("lobby.host", { name: ["Ann", "Bob", "Cy"] }))).toBe(
      "Host: Ann, Bob, and Cy"
    );
    expect(app.i18n.format(tr("lobby.host", { name: coin }))).toEqual([
      { kind: "text", text: "Host: " },
      { kind: "element", node: coin }
    ]);

    await app.stop();
  });
});
