/**
 * @file The text builders of `moku-game dev` and `build`: the page HTML, the dev and build
 * `main.ts`, the dev flag module and the bunfig. Pure text in, text out.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/app/config";
import {
  buildMain,
  bunfigText,
  devFlag,
  devMain,
  pageHtml,
  scenarioFiles
} from "../../src/app/generate";
import type { GameConfig, ResolvedGameConfig } from "../../src/app/types";

/** The page of a game with a title only, every other field a default. */
const plain = resolveConfig({ page: { title: "mini-game" } });

/** The dev links of `.moku/index.html`. */
const devLinks = { toRoot: "../", script: "./main.ts" };

/**
 * Resolves a config with a page and the given extra fields.
 *
 * @param extra - The fields besides the page.
 * @returns The resolved config.
 */
function settingsWith(extra: Omit<GameConfig, "page">): ResolvedGameConfig {
  return resolveConfig({ page: { title: "T" }, ...extra });
}

/**
 * The page of a resolved config with some fields replaced.
 *
 * @param page - The page fields to set.
 * @returns The page.
 */
function pageWith(page: Partial<ResolvedGameConfig["page"]>): ResolvedGameConfig["page"] {
  return { ...plain.page, ...page };
}

/**
 * The relative import specifiers of a module text.
 *
 * @param text - The module.
 * @returns Every `from "./…"`, `from "../…"` and `import "./…"` specifier.
 */
function relativeImports(text: string): string[] {
  return [...text.matchAll(/(?:from|import) "(\.{1,2}\/[^"]+)"/g)].map(match => match[1] ?? "");
}

describe("pageHtml", () => {
  it("pageHtml escapes the title", () => {
    const html = pageHtml(pageWith({ title: `Tom & "Jerry" <'s>` }), devLinks);

    expect(html).toContain("<title>Tom &amp; &quot;Jerry&quot; &lt;&#39;s&gt;</title>");
  });

  it("pageHtml sets lang and theme-color from the resolved page", () => {
    const html = pageHtml(pageWith({ lang: "ru", background: "#10161d" }), devLinks);

    expect(html).toContain('<html lang="ru">');
    expect(html).toContain('<meta name="theme-color" content="#10161d" />');
    expect(html).toContain("background: #10161d;");
    expect(pageHtml(plain.page, devLinks)).toContain('<html lang="en">');
    expect(pageHtml(plain.page, devLinks)).toContain('content="#000000"');
  });

  it("pageHtml writes the page of the spec line for line", () => {
    const page = pageWith({
      title: "Лесной городок",
      lang: "ru",
      background: "#10161d",
      icons: { favicon: "assets/icon.png", appleTouch: "assets/icon-180.png" }
    });

    expect(pageHtml(page, devLinks)).toBe(
      [
        "<!doctype html>",
        '<html lang="ru">',
        "  <head>",
        '    <meta charset="utf-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
        '    <meta name="theme-color" content="#10161d" />',
        "    <title>Лесной городок</title>",
        '    <link rel="icon" href="../assets/icon.png" />',
        '    <link rel="apple-touch-icon" href="../assets/icon-180.png" />',
        "    <style>html, body { margin: 0; height: 100%; background: #10161d; } #game { width: 100%; height: 100%; touch-action: none; }</style>",
        "  </head>",
        "  <body>",
        '    <div id="game"></div>',
        '    <script type="module" src="./main.ts"></script>',
        "  </body>",
        "</html>",
        ""
      ].join("\n")
    );
  });

  it("pageHtml writes an icon link only when the icon is set", () => {
    expect(pageHtml(plain.page, devLinks)).not.toContain("<link");

    const favicon = pageHtml(pageWith({ icons: { favicon: "art/icon.png" } }), {
      toRoot: "../../",
      script: "./main.ts"
    });

    expect(favicon).toContain('<link rel="icon" href="../../art/icon.png" />');
    expect(favicon).not.toContain("apple-touch-icon");
  });

  it("pageHtml refuses an icon outside the game", () => {
    for (const icon of ["../icon.png", "/abs/icon.png", "art/../../icon.png", "C:/icon.png"]) {
      expect(() => pageHtml(pageWith({ icons: { appleTouch: icon } }), devLinks)).toThrow(
        new Error(`[game] moku-game: page.icons.appleTouch "${icon}" is not a file in the game.`)
      );
    }
  });

  it("pageHtml puts head strings in verbatim after the style", () => {
    const head = ['<meta name="robots" content="noindex" />', "<script>window.x = 1 < 2;</script>"];
    const html = pageHtml(pageWith({ head }), devLinks);
    const style = html.indexOf("<style>");

    expect(html.indexOf(`    ${head[0]}\n`)).toBeGreaterThan(style);
    expect(html.indexOf(`    ${head[1]}\n`)).toBeGreaterThan(html.indexOf(head[0] ?? ""));
    expect(html.indexOf(head[1] ?? "")).toBeLessThan(html.indexOf("</head>"));
  });

  it("pageHtml refuses a background that is not a CSS color", () => {
    const background = "red; } body { display: none";

    expect(() => pageHtml(pageWith({ background }), devLinks)).toThrow(
      new Error(`[game] moku-game: page.background "${background}" is not a CSS color.`)
    );
    expect(pageHtml(pageWith({ background: "rgb(16, 22, 29)" }), devLinks)).toContain(
      "background: rgb(16, 22, 29);"
    );
  });

  it("pageHtml refuses a lang that is not a language tag", () => {
    expect(() => pageHtml(pageWith({ lang: 'en" onload="x' }), devLinks)).toThrow(
      new Error(`[game] moku-game: page.lang "en" onload="x" is not a language tag.`)
    );
  });

  it("pageHtml uses no url() in the inline style", () => {
    const html = pageHtml(
      pageWith({ icons: { favicon: "icon.png", appleTouch: "icon-180.png" } }),
      devLinks
    );
    const style = /<style>(.*)<\/style>/.exec(html)?.[1] ?? "";

    expect(style).not.toBe("");
    expect(style).not.toContain("url(");
  });
});

describe("devMain", () => {
  it("devMain imports ./dev.ts first", () => {
    const text = devMain(plain, { scenarios: ["ready.ts"], devModules: [] });
    const first = text.split("\n").find(line => line.startsWith("import"));

    expect(first).toBe('import "./dev.ts";');
  });

  it("devMain writes .ts on every relative import", () => {
    const text = devMain(settingsWith({ system: ["back"] }), {
      scenarios: ["empty.ts", "full.ts"],
      devModules: ["features/board/board.dev.ts"],
      agents: ["@moku-labs/editor/agent/page", "/abs/agent.ts"]
    });
    const relative = relativeImports(text);

    expect(relative).toEqual([
      "./dev.ts",
      "../index.ts",
      "../config.ts",
      "../tests/scenarios/empty.ts",
      "../tests/scenarios/full.ts",
      "../features/board/board.dev.ts"
    ]);
  });

  it("devMain maps scenario files to keys by stem, sorted, and skips test files", () => {
    const text = devMain(plain, {
      scenarios: ["ready.ts", "full.test.ts", "index.ts", "a.spec.ts", "types.d.ts", "empty.ts"],
      devModules: []
    });

    expect(text).toContain('import scenario0 from "../tests/scenarios/empty.ts";');
    expect(text).toContain('import scenario1 from "../tests/scenarios/ready.ts";');
    expect(text).toContain('  scenarios: { "empty": scenario0, "ready": scenario1 }');
    expect(text).not.toContain("full.test");
    expect(text).not.toContain("scenarios/index.ts");
    expect(text).not.toContain("spec");
    expect(text).not.toContain("types.d");
  });

  it("devMain passes scenarios: {} without scenario files", () => {
    expect(devMain(plain, { scenarios: [], devModules: [] })).toBe(
      [
        "// Written by moku-game dev. Do not edit.",
        'import "./dev.ts";',
        'import { startPage } from "@moku-labs/game/app/page";',
        'import game from "../index.ts";',
        'import config from "../config.ts";',
        "",
        "await startPage(game, config, {",
        "  scenarios: {}",
        "});",
        ""
      ].join("\n")
    );
  });

  it("devMain imports systemShell only for a system list or a store save", () => {
    const shell = 'import { systemShell } from "@moku-labs/game/app/system";';
    const sources = { scenarios: [], devModules: [] };

    expect(devMain(plain, sources)).not.toContain(shell);
    expect(devMain(settingsWith({ save: "local" }), sources)).not.toContain("systemShell");
    expect(devMain(settingsWith({ system: ["haptics"] }), sources)).toContain(shell);
    expect(devMain(settingsWith({ system: ["haptics"] }), sources)).toContain(
      "  system: systemShell"
    );
    expect(devMain(settingsWith({ save: "store" }), sources)).toContain(shell);
  });

  it("devMain imports agents and .dev modules only when agents are passed", () => {
    const devModules = ["features/board/board.dev.ts", "features/a/a.dev.ts"];
    const without = devMain(plain, { scenarios: [], devModules });
    const withAgents = devMain(plain, {
      scenarios: [],
      devModules,
      agents: ["@moku-labs/editor/agent/page"]
    });

    expect(without).not.toContain("agents");
    expect(without).not.toContain("devModule");
    expect(withAgents).toContain('import agent0 from "@moku-labs/editor/agent/page";');
    expect(withAgents).toContain('import * as devModule0 from "../features/a/a.dev.ts";');
    expect(withAgents).toContain('import * as devModule1 from "../features/board/board.dev.ts";');
    expect(withAgents).toContain("  agents: [agent0],\n  devModules: [devModule0, devModule1]\n");
  });

  it("devMain writes the main.ts of the startPage example line for line", () => {
    const page = readFileSync(new URL("../../src/app/page.ts", import.meta.url), "utf8");
    const block = /\* ```ts\n((?: \*.*\n)+?) \* ```\n \*\/\nexport async function startPage/.exec(
      page
    );
    const example = (block?.[1] ?? "")
      .split("\n")
      .map(line => line.replace(/^ \* ?/, ""))
      .join("\n");
    const text = devMain(settingsWith({ system: ["lifecycle"] }), {
      scenarios: ["full.ts", "empty.ts"],
      devModules: ["features/board/board.dev.ts"],
      agents: ["@moku-labs/editor/agent/page"]
    });

    expect(example).not.toBe("");
    expect(text).toBe(example);
  });
});

describe("buildMain", () => {
  it("buildMain has no dev flag, no scenarios, no agents and no /control or /inspect import", () => {
    const text = buildMain(settingsWith({ system: ["back"] }));

    expect(text).toBe(
      [
        'import { startPage } from "@moku-labs/game/app/page";',
        'import { systemShell } from "@moku-labs/game/app/system";',
        'import game from "../../index.ts";',
        'import config from "../../config.ts";',
        "",
        "await startPage(game, config, { system: systemShell });",
        ""
      ].join("\n")
    );
    expect(text).not.toContain("dev.ts");
    expect(text).not.toContain("scenario");
    expect(text).not.toContain("agent");
    expect(text).not.toMatch(/\/control|\/inspect/);
  });

  it("buildMain of a web-only game passes no shell", () => {
    const text = buildMain(plain);

    expect(text).not.toContain("systemShell");
    expect(text).toContain("await startPage(game, config);\n");
  });
});

describe("devFlag", () => {
  it("devFlag sets the global and imports nothing", () => {
    expect(devFlag()).toBe(
      "// Written by moku-game dev. Do not edit.\nglobalThis.__MOKU_GAME_DEV__ = true;\n"
    );
  });
});

describe("bunfigText", () => {
  it("bunfigText writes absolute paths as TOML strings, also Windows paths", () => {
    const text = bunfigText({
      hotPlugin: String.raw`C:\games\timber\node_modules\@moku-labs\game\dist\hot.mjs`,
      servePlugins: ['/abs/with "quote"/bundle.ts'],
      preload: []
    });

    expect(text).toContain(
      String.raw`plugins = ["C:\\games\\timber\\node_modules\\@moku-labs\\game\\dist\\hot.mjs", "/abs/with \"quote\"/bundle.ts"]`
    );
  });

  it("bunfigText puts the hot plugin first and adds the dev define", () => {
    expect(
      bunfigText({
        hotPlugin: "/abs/game/node_modules/@moku-labs/game/dist/hot.mjs",
        servePlugins: ["/abs/engine/scripts/tree/bundle.ts"],
        preload: ["/abs/engine/scripts/tree/preload.ts"]
      })
    ).toBe(
      [
        "# Written by moku-game dev. Do not edit.",
        'preload = ["/abs/engine/scripts/tree/preload.ts"]',
        "",
        "[serve.static]",
        'plugins = ["/abs/game/node_modules/@moku-labs/game/dist/hot.mjs", "/abs/engine/scripts/tree/bundle.ts"]',
        'define = { "__MOKU_GAME_DEV__" = "true" }',
        ""
      ].join("\n")
    );
  });

  it("bunfigText writes preload only when given", () => {
    const text = bunfigText({ hotPlugin: "/hot.ts", servePlugins: [], preload: [] });

    expect(text).not.toContain("preload");
    expect(text).toContain('plugins = ["/hot.ts"]\n');
  });
});

describe("scenarioFiles", () => {
  it("keeps the .ts files of the folder, sorted, without tests, types and index", () => {
    expect(scenarioFiles(["b.ts", "a.tsx", "index.ts", "x.test.ts", "c.d.ts", "a.ts"])).toEqual([
      "a.ts",
      "b.ts"
    ]);
  });
});
