/**
 * @file The text of the files `moku-game` generates for a game: the page HTML, the dev, debug and
 * build `main.ts`, the dev flag module, the agent flag module of a debug page, the startup mark
 * module, the assets stamp module and the dev bunfig. Pure text builders: no IO, no Bun. The dev
 * writes them into `<game>/.moku/`, the build hands them to `Bun.build` in memory. Every relative
 * import they write carries its `.ts` extension: an import between two in-memory files of
 * `Bun.build` resolves only with it.
 */
import type { ResolvedGameConfig, SystemName } from "./types";

/** The first line of a generated file a person may open. */
const WRITTEN = "// Written by moku-game dev. Do not edit.";

/** The startup mark every generated main writes first after its imports: they all evaluated. */
const MAIN_MARK = 'performance.mark("moku:main");';

/** The one agent a debug page carries: the editor's page agent, resolved from the game. */
export const DEBUG_AGENT = "@moku-labs/editor/agent/page";

/**
 * The stamp module of a game, a file of `<game>/.moku/`. One per game: the dev page and the page
 * of `moku-game visual` import the same one.
 */
export const ASSETS_STAMP = "assets-stamp.ts";

/** A colour or a language tag: it lands in a `<style>` and in attributes, so nothing else passes. */
const SAFE_VALUE = /^[#\w(),.%\s-]+$/;

/** The files of `tests/scenarios/` that are not scenarios. */
const NOT_SCENARIO = /\.(?:test|spec|d)\.ts$|^index\.ts$/;

/**
 * The entry of `@moku-labs/system` each system plugin loads from, in the order the shell composes
 * them.
 */
const SYSTEM_ENTRIES: readonly (readonly [SystemName, string])[] = [
  ["lifecycle", "lifecycle"],
  ["back", "back"],
  ["haptics", "haptics"],
  ["keepAwake", "keep-awake"],
  ["store", "store"]
];

/** The page of a resolved `config.ts`. */
type Page = ResolvedGameConfig["page"];

/** The two icons a page may link. */
type IconName = keyof Page["icons"];

/** Where the page reaches the game folder and its script from. */
export type PageLinks = {
  /** The path from the page to the game folder: `"../"` for `.moku/`, `"../../"` for `.moku/build/` and `.moku/visual/`. */
  toRoot: string;
  /** The script of the page, relative to it. */
  script: string;
};

/** What the dev `main.ts` imports besides the game and its config. */
export type MainSources = {
  /** The file names of `tests/scenarios/`, files only, in any order. */
  scenarios: readonly string[];
  /** The `.dev.ts` modules of the game, relative to the game folder, `/` separated. */
  devModules: readonly string[];
  /** The agent module specifiers, in order. Left out: no agent and no `.dev` module. */
  agents?: readonly string[];
};

/** What the in-memory `agent.ts` of a debug page sets. */
type AgentFlags = {
  /** The build id: `debug-<stamp>` or `debug-full-<stamp>`. */
  build: string;
  /** True for `--debug=full`: every command runs. */
  control: boolean;
  /** The id of the engine fingerprint. */
  engine: string;
  /** The `host:port` the page agent dials. */
  editor: string;
};

/** The absolute paths the dev bunfig names. */
export type BunfigPaths = {
  /** The hot plugin of the engine the game resolves. */
  hotPlugin: string;
  /** The extra bundler plugins of the dev page, after the hot plugin. */
  servePlugins: readonly string[];
  /** The files Bun preloads in the serving process. */
  preload: readonly string[];
};

/**
 * Escapes the five characters HTML reads as markup.
 *
 * @param text - The text.
 * @returns The text, safe in an element and in a quoted attribute.
 * @example
 * ```ts
 * escapeHtml(`Tom & "Jerry"`); // "Tom &amp; &quot;Jerry&quot;"
 * ```
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Checks a value of the page that lands in the style and in attributes.
 *
 * @param value - The background or the lang.
 * @param problem - The error when the value has another character.
 * @returns The value.
 * @throws {Error} The problem, when the value is not a plain colour or tag.
 * @example
 * ```ts
 * safeValue("#10161d", "not a colour"); // "#10161d"
 * ```
 */
function safeValue(value: string, problem: string): string {
  if (!SAFE_VALUE.test(value)) throw new Error(problem);

  return value;
}

/**
 * The link of one icon: a path inside the game folder, never above it.
 *
 * @param name - The icon field.
 * @param file - The path the config gives, relative to the game folder.
 * @returns The path with `/` separators.
 * @throws {Error} When the path is absolute or climbs out of the game folder.
 * @example
 * ```ts
 * iconPath("favicon", "assets/icon.png"); // "assets/icon.png"
 * ```
 */
function iconPath(name: IconName, file: string): string {
  const slashed = file.replaceAll("\\", "/");
  const absolute = slashed.startsWith("/") || /^[a-z]:/i.test(slashed);
  const escapesGame = absolute || slashed.split("/").includes("..") || slashed === "";

  if (escapesGame) {
    throw new Error(`[game] moku-game: page.icons.${name} "${file}" is not a file in the game.`);
  }

  return slashed;
}

/**
 * The `<link>` tags of the icons the page sets, in a fixed order.
 *
 * @param icons - The icons of the page.
 * @param toRoot - The path from the page to the game folder.
 * @returns One line per icon set.
 * @example
 * ```ts
 * iconLinks({ favicon: "icon.png" }, "../"); // ['    <link rel="icon" href="../icon.png" />']
 * ```
 */
function iconLinks(icons: Page["icons"], toRoot: string): string[] {
  const relations: [IconName, string][] = [
    ["favicon", "icon"],
    ["appleTouch", "apple-touch-icon"]
  ];

  return relations.flatMap(([name, relation]) => {
    const file = icons[name];

    if (file === undefined) return [];

    return [`    <link rel="${relation}" href="${escapeHtml(toRoot + iconPath(name, file))}" />`];
  });
}

/**
 * The page a game runs in: the title, the language, the background (also the theme colour), the
 * icons as links (never `url()` in the style: `Bun.build` does not rewrite it), the `head` tags
 * verbatim after the style, `<div id="game">` and the module script.
 *
 * @param page - The page of the resolved `config.ts`.
 * @param links - The path to the game folder and the script.
 * @returns The HTML.
 * @throws {Error} When the background is not a CSS colour, the lang not a language tag, or an
 *   icon path leaves the game folder.
 * @example
 * ```ts
 * pageHtml(resolveConfig({ page: { title: "mini-game" } }).page, { toRoot: "../", script: "./main.ts" }).includes("<title>mini-game</title>"); // true
 * ```
 */
export function pageHtml(page: Page, links: PageLinks): string {
  const background = safeValue(
    page.background,
    `[game] moku-game: page.background "${page.background}" is not a CSS color.`
  );
  const lang = safeValue(
    page.lang,
    `[game] moku-game: page.lang "${page.lang}" is not a language tag.`
  );
  const style =
    `html, body { margin: 0; height: 100%; background: ${background}; } ` +
    "#game { width: 100%; height: 100%; touch-action: none; }";

  return [
    "<!doctype html>",
    `<html lang="${lang}">`,
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    `    <meta name="theme-color" content="${background}" />`,
    `    <title>${escapeHtml(page.title)}</title>`,
    ...iconLinks(page.icons, links.toRoot),
    `    <style>${style}</style>`,
    ...page.head.map(tag => `    ${tag}`),
    "  </head>",
    "  <body>",
    '    <div id="game"></div>',
    `    <script type="module" src="${escapeHtml(links.script)}"></script>`,
    "  </body>",
    "</html>",
    ""
  ].join("\n");
}

/**
 * The scenario files of `tests/scenarios/`, sorted: every `.ts` file but tests, declarations and
 * `index.ts`.
 *
 * @param files - The file names of the folder.
 * @returns The scenario file names, sorted.
 * @example
 * ```ts
 * scenarioFiles(["ready.ts", "ready.test.ts", "index.ts", "empty.ts"]); // ["empty.ts", "ready.ts"]
 * ```
 */
export function scenarioFiles(files: readonly string[]): string[] {
  return files.filter(file => file.endsWith(".ts") && !NOT_SCENARIO.test(file)).toSorted();
}

/**
 * Whether the page needs the system shell: a system plugin is named, or the save is the store.
 *
 * @param settings - The resolved `config.ts`.
 * @returns True when `main.ts` imports `systemShellOf`.
 * @example
 * ```ts
 * needsShell(resolveConfig({ page: { title: "T" }, save: "store" })); // true
 * ```
 */
function needsShell(settings: ResolvedGameConfig): boolean {
  return settings.system.length > 0 || settings.save === "store";
}

/**
 * The `system` option of `startPage`: `systemShellOf` over the loader of the package and one
 * loader per plugin the shell composes, in the fixed order. The store is one when `config.system`
 * names it or the save is the store. Only these `import()`s are written, so the page bundles no
 * other plugin and never needs its native package.
 *
 * @param settings - The resolved `config.ts`.
 * @returns The option, indented two spaces, with no comma after it.
 * @example
 * ```ts
 * shellOption(resolveConfig({ page: { title: "T" }, system: ["haptics"] })).split("\n")[2]; // '    haptics: () => import("@moku-labs/system/haptics")'
 * ```
 */
function shellOption(settings: ResolvedGameConfig): string {
  const named = SYSTEM_ENTRIES.filter(
    ([name]) => settings.system.includes(name) || (name === "store" && settings.save === "store")
  );
  const loaders = [
    '    system: () => import("@moku-labs/system")',
    ...named.map(([name, entry]) => `    ${name}: () => import("@moku-labs/system/${entry}")`)
  ];

  return ["  system: systemShellOf({", loaders.join(",\n"), "  })"].join("\n");
}

/**
 * The imports of `main.ts` every page has: the page entry, the shell when needed, the game and its
 * config.
 *
 * @param settings - The resolved `config.ts`.
 * @param toRoot - The path from `main.ts` to the game folder.
 * @returns The import lines.
 * @example
 * ```ts
 * pageImports(resolveConfig({ page: { title: "T" } }), "../")[1]; // 'import game from "../index.ts";'
 * ```
 */
function pageImports(settings: ResolvedGameConfig, toRoot: string): string[] {
  return [
    'import { startPage } from "@moku-labs/game/app/page";',
    ...(needsShell(settings)
      ? ['import { systemShellOf } from "@moku-labs/game/app/system";']
      : []),
    `import game from "${toRoot}index.ts";`,
    `import config from "${toRoot}config.ts";`
  ];
}

/**
 * The names of numbered bindings, as a list.
 *
 * @param prefix - The name before the number.
 * @param count - How many.
 * @returns The names, comma separated.
 * @example
 * ```ts
 * numbered("agent", 2); // "agent0, agent1"
 * ```
 */
function numbered(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => prefix + String(index)).join(", ");
}

/**
 * One import line of a generated file. The specifier is written by `JSON.stringify`: a file name
 * may hold a quote or a backslash.
 *
 * @param binding - What the line imports, such as `scenario0` or `* as devModule0`.
 * @param specifier - The module.
 * @returns The line.
 * @example
 * ```ts
 * importLine("* as devModule0", "../features/board/board.dev.ts"); // 'import * as devModule0 from "../features/board/board.dev.ts";'
 * ```
 */
function importLine(binding: string, specifier: string): string {
  return `import ${binding} from ${JSON.stringify(specifier)};`;
}

/**
 * Orders two texts by their code units, as `toSorted()` does without a comparer.
 *
 * @param first - One text.
 * @param second - The other text.
 * @returns A negative number, zero or a positive number.
 * @example
 * ```ts
 * compareText("a/b.png", "a/c.png"); // -1
 * ```
 */
function compareText(first: string, second: string): number {
  if (first === second) return 0;

  return first < second ? -1 : 1;
}

/**
 * The path from a page under `.moku/` to `.moku/` itself, where the one stamp of a game lives.
 *
 * @param toRoot - The path from the page to the game folder.
 * @returns `"./"` for the dev page in `.moku/`, `"../"` for the page in `.moku/visual/`.
 * @example
 * ```ts
 * toStampFolder("../../"); // "../"
 * ```
 */
function toStampFolder(toRoot: string): string {
  return toRoot.slice("../".length) || "./";
}

/**
 * The `main.ts` of the dev page: the startup mark module first, the dev flag second, then the
 * assets stamp, the page entry, the game, its config, one import per scenario, and, with agents,
 * one per `.dev` module and one per agent. Its first statement marks `moku:main`, then it calls
 * `startPage` with the scenarios by file stem, the shell with the loaders of the named plugins
 * when the game needs it, the agents and the `.dev` modules. The stamp import puts the stamp
 * module on the page: when the keys watch writes a new stamp, the hot plugin hands it to the
 * running game.
 *
 * @param settings - The resolved `config.ts`.
 * @param sources - The scenario files, the `.dev` modules and the agents.
 * @param toRoot - The path from `main.ts` to the game folder: `"../"` for `.moku/`, `"../../"`
 *   for the page of `moku-game visual` in `.moku/visual/`.
 * @returns The text of `.moku/main.ts`.
 * @example
 * ```ts
 * devMain(resolveConfig({ page: { title: "T" } }), { scenarios: ["ready.ts"], devModules: [] }).includes('scenarios: { "ready": scenario0 }'); // true
 * ```
 */
export function devMain(
  settings: ResolvedGameConfig,
  sources: MainSources,
  toRoot = "../"
): string {
  const scenarios = scenarioFiles(sources.scenarios);
  const agents = sources.agents ?? [];
  const devModules = agents.length === 0 ? [] : sources.devModules.toSorted();
  // The options of startPage: the scenarios by file stem, then the shell, the agents and the
  // `.dev` modules, each only when the page has it.
  const keys = scenarios.map(
    (file, index) => `${JSON.stringify(file.slice(0, -".ts".length))}: scenario${index}`
  );
  const scenarioMap = keys.length === 0 ? "{}" : `{ ${keys.join(", ")} }`;
  const options = [
    `  scenarios: ${scenarioMap}`,
    ...(needsShell(settings) ? [shellOption(settings)] : []),
    ...(agents.length === 0 ? [] : [`  agents: [${numbered("agent", agents.length)}]`]),
    ...(devModules.length === 0
      ? []
      : [`  devModules: [${numbered("devModule", devModules.length)}]`])
  ];

  // The mark first, so it runs before every module; the dev flag next, so the globals are set
  // before the game's modules run.
  return [
    WRITTEN,
    'import "./script.ts";',
    'import "./dev.ts";',
    `import "${toStampFolder(toRoot)}${ASSETS_STAMP}";`,
    ...pageImports(settings, toRoot),
    ...scenarios.map((file, index) =>
      importLine(`scenario${index}`, `${toRoot}tests/scenarios/${file}`)
    ),
    ...devModules.map((file, index) => importLine(`* as devModule${index}`, `${toRoot}${file}`)),
    ...agents.map((agent, index) => importLine(`agent${index}`, agent)),
    "",
    MAIN_MARK,
    "await startPage(game, config, {",
    options.join(",\n"),
    "});",
    ""
  ].join("\n");
}

/**
 * The `main.ts` of the production page: the startup mark module, the page entry, the game and its
 * config, and the shell with the loaders of the named plugins when the game needs it; its first
 * statement marks `moku:main`. No dev flag, no scenario, no agent, no `.dev` module, no door: none
 * of them ships. The release page: `moku-game build --debug` uses `debugMain`.
 *
 * @param settings - The resolved `config.ts`.
 * @returns The text of the in-memory `.moku/build/main.ts`.
 * @example
 * ```ts
 * buildMain(resolveConfig({ page: { title: "T" } })).endsWith("await startPage(game, config);\n"); // true
 * ```
 */
export function buildMain(settings: ResolvedGameConfig): string {
  const call = needsShell(settings)
    ? ["await startPage(game, config, {", shellOption(settings), "});"]
    : ["await startPage(game, config);"];

  return [
    'import "./script.ts";',
    ...pageImports(settings, "../../"),
    "",
    MAIN_MARK,
    ...call,
    ""
  ].join("\n");
}

/**
 * The `main.ts` of a debug page, `moku-game build --debug`: the startup mark module first, the
 * agent flag module second, then the page entry, the game, its config, one import per `.dev`
 * module, sorted, and the editor's page agent. Its first statement marks `moku:main`, then it
 * calls `startPage` with the shell when the game needs it, the agent and the `.dev` modules. No
 * scenario (`?player=` stays a dev feature), no assets stamp, no dev flag.
 *
 * @param settings - The resolved `config.ts`.
 * @param devModules - The `.dev.ts` modules of the game, relative to the game folder, `/` separated.
 * @returns The text of the in-memory `.moku/build/main.ts`.
 * @example
 * ```ts
 * debugMain(resolveConfig({ page: { title: "T" } }), []).includes("agents: [agent0]"); // true
 * ```
 */
export function debugMain(settings: ResolvedGameConfig, devModules: readonly string[]): string {
  const sorted = devModules.toSorted();
  const options = [
    ...(needsShell(settings) ? [shellOption(settings)] : []),
    "  agents: [agent0]",
    ...(sorted.length === 0 ? [] : [`  devModules: [${numbered("devModule", sorted.length)}]`])
  ];

  // The mark first, so it runs before every module; the flags next, so module-level code of the
  // engine and the game reads them set.
  return [
    'import "./script.ts";',
    'import "./agent.ts";',
    ...pageImports(settings, "../../"),
    ...sorted.map((file, index) => importLine(`* as devModule${index}`, `../../${file}`)),
    importLine("agent0", DEBUG_AGENT),
    "",
    MAIN_MARK,
    "await startPage(game, config, {",
    options.join(",\n"),
    "});",
    ""
  ].join("\n");
}

/**
 * The `script.ts` module every generated main imports first: it marks `moku:script` with the URL
 * of the chunk it lands in, the first statement the bundle runs. Two marks cost nothing, so no
 * flag guards them.
 *
 * @returns The text of `.moku/script.ts` and of the in-memory `script.ts` of a build.
 * @example
 * ```ts
 * scriptMark().startsWith('performance.mark("moku:script"'); // true
 * ```
 */
export function scriptMark(): string {
  return 'performance.mark("moku:script", { detail: import.meta.url });\n';
}

/**
 * The `dev.ts` module the dev `main.ts` imports after the startup mark: it sets on `globalThis`,
 * for code that reads the globals, the build id `"dev"`, the engine id, the control flag, the
 * agent flag and, last, the dev flag. The bunfig `define` already makes the three bare flags true
 * in the bundle.
 *
 * @param engine - The id of the engine fingerprint the page was written for.
 * @returns The text of `.moku/dev.ts`.
 * @example
 * ```ts
 * devFlag("0.0.0+src").endsWith("globalThis.__MOKU_GAME_DEV__ = true;\n"); // true
 * ```
 */
export function devFlag(engine: string): string {
  return [
    WRITTEN,
    'globalThis.__MOKU_GAME_BUILD__ = "dev";',
    `globalThis.__MOKU_GAME_ENGINE__ = ${JSON.stringify(engine)};`,
    "globalThis.__MOKU_GAME_CONTROL__ = true;",
    "globalThis.__MOKU_GAME_AGENT__ = true;",
    "globalThis.__MOKU_GAME_DEV__ = true;",
    ""
  ].join("\n");
}

/**
 * The in-memory `agent.ts` module of a debug page, imported after the startup mark: six lines
 * that set the build id, the engine id and the editor address, each through `JSON.stringify`, the
 * control flag of the profile, the agent flag, and the dev flag `false`. No header: nobody opens
 * it.
 *
 * @param page - What the page is built with.
 * @returns The text.
 * @example
 * ```ts
 * agentFlag({ build: "debug-20261014T153012Z", control: false, engine: "0.14.12+9c41e0", editor: "127.0.0.1:47600" }).split("\n")[0]; // 'globalThis.__MOKU_GAME_BUILD__ = "debug-20261014T153012Z";'
 * ```
 */
export function agentFlag(page: AgentFlags): string {
  return [
    `globalThis.__MOKU_GAME_BUILD__ = ${JSON.stringify(page.build)};`,
    `globalThis.__MOKU_GAME_ENGINE__ = ${JSON.stringify(page.engine)};`,
    `globalThis.__MOKU_GAME_EDITOR__ = ${JSON.stringify(page.editor)};`,
    `globalThis.__MOKU_GAME_CONTROL__ = ${String(page.control)};`,
    "globalThis.__MOKU_GAME_AGENT__ = true;",
    "globalThis.__MOKU_GAME_DEV__ = false;",
    ""
  ].join("\n");
}

/**
 * The `assets-stamp.ts` module the dev `main.ts` imports: the asset files of the game with their
 * stamps, and the ones the last save changed. The hot plugin takes it for a module that swaps, so
 * a new stamp reaches the running game, which reads the changed files again. The page starts with
 * the empty stamp; the keys watch writes the files. Both lists are sorted here, and every path
 * and stamp is written by `JSON.stringify`: a file name may hold a quote or a backslash.
 *
 * @param files - Every watched asset file: its path relative to the game with `/`, and its stamp
 *   `<size>:<mtimeMs>`. None before the first watch.
 * @param changed - The paths whose stamp differs from the batch before, the new ones too. None in
 *   the first stamp of a run.
 * @returns The text of `.moku/assets-stamp.ts`.
 * @example
 * ```ts
 * assetsStamp([], []); // '// Written by moku-game dev. Do not edit.\nexport default {\n  files: {},\n  changed: []\n};\n'
 * ```
 */
export function assetsStamp(
  files: readonly (readonly [file: string, stamp: string])[],
  changed: readonly string[]
): string {
  const entries = files
    .toSorted(([first], [second]) => compareText(first, second))
    .map(([file, stamp]) => `    ${JSON.stringify(file)}: ${JSON.stringify(stamp)}`);
  const map = entries.length === 0 ? "{}" : `{\n${entries.join(",\n")}\n  }`;
  const list = changed
    .toSorted(compareText)
    .map(file => JSON.stringify(file))
    .join(", ");

  return [WRITTEN, "export default {", `  files: ${map},`, `  changed: [${list}]`, "};", ""].join(
    "\n"
  );
}

/**
 * A TOML array of strings. `JSON.stringify` of a path is a valid TOML basic string, also for a
 * Windows path.
 *
 * @param paths - The paths.
 * @returns The array text.
 * @example
 * ```ts
 * tomlList(["/a.ts", "C:\\b.ts"]); // '["/a.ts", "C:\\\\b.ts"]'
 * ```
 */
function tomlList(paths: readonly string[]): string {
  return `[${paths.map(file => JSON.stringify(file)).join(", ")}]`;
}

/**
 * The bunfig of the dev server: the preloads when given, the hot plugin first among the bundler
 * plugins of the page, and the dev, agent and control flags defined true.
 *
 * @param paths - The absolute paths of the hot plugin, the extra plugins and the preloads.
 * @returns The text of `.moku/bunfig.toml`.
 * @example
 * ```ts
 * bunfigText({ hotPlugin: "/g/node_modules/@moku-labs/game/dist/hot.mjs", servePlugins: [], preload: [] }).includes('plugins = ["/g/node_modules/@moku-labs/game/dist/hot.mjs"]'); // true
 * ```
 */
export function bunfigText(paths: BunfigPaths): string {
  return [
    `# ${WRITTEN.slice("// ".length)}`,
    ...(paths.preload.length === 0 ? [] : [`preload = ${tomlList(paths.preload)}`]),
    "",
    "[serve.static]",
    `plugins = ${tomlList([paths.hotPlugin, ...paths.servePlugins])}`,
    'define = { "__MOKU_GAME_DEV__" = "true", "__MOKU_GAME_AGENT__" = "true", "__MOKU_GAME_CONTROL__" = "true" }',
    ""
  ].join("\n");
}
