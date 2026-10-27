/**
 * @file The check of `bun run validate` that no chunk a browser loads imports a Node or Bun
 * built-in. It walks `dist/` from every export a game's page can reach, through every static and
 * dynamic import of a sibling chunk, and fails on an import of `node:*`, a bare built-in (`fs`) or
 * `bun:*`. A browser bundler cannot load one: Bun's dev server stopped with
 * `import_node_module is not defined` when the shared runtime chunk imported `createRequire` from
 * `node:module`. Imports come from Bun's own parser, not a pattern. A built-in reached at run time
 * (`process.getBuiltinModule`, `require`) is not an import, and node-only code uses exactly that.
 *
 * Run after `bun run build`: `bun scripts/browser-chunks.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { createBrandConsole } from "@moku-labs/common/cli";

/** The package root. */
const ROOT = path.join(import.meta.dir, "..");

/** The built package. */
const DIST = path.join(ROOT, "dist");

/**
 * The exports that run in Node or Bun only (`tsdown.config.ts`): the bin and its seams, the visual
 * tests, the asset scanner, the hot plugin of the dev server, the oxlint plugin, the project index,
 * and the headless test helpers, which run in vitest. Every other export is a browser entry, so a
 * new subpath is checked unless it is named here.
 */
const NODE_ONLY = new Set([
  "./cli",
  "./visual",
  "./assets",
  "./hot",
  "./lint",
  "./project",
  "./testing"
]);

/** Reads the imports of a chunk with Bun's parser. */
const transpiler = new Bun.Transpiler({ loader: "js" });

/**
 * The browser entries: the `.mjs` of every export of `package.json` outside `NODE_ONLY`.
 *
 * @returns The entry chunks, absolute.
 */
function browserEntries(): string[] {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    exports: Record<string, string | { default?: string }>;
  };

  return Object.entries(pkg.exports).flatMap(([subpath, target]) => {
    const file = typeof target === "string" ? target : target.default;

    if (NODE_ONLY.has(subpath) || file === undefined || !file.endsWith(".mjs")) return [];

    return [path.join(ROOT, file)];
  });
}

/**
 * Whether a specifier names a module only Node or Bun has.
 *
 * @param specifier - The specifier as written.
 * @returns True for `node:*`, a bare built-in and `bun:*`.
 */
function isRuntimeOnly(specifier: string): boolean {
  return isBuiltin(specifier) || specifier.startsWith("bun:");
}

/**
 * Walks the chunks reachable from the browser entries and lists every runtime-only import and
 * every relative import that names no file.
 *
 * @returns One line per finding; empty when the graph is clean.
 */
function findings(): string[] {
  const seen = new Set<string>();
  const queue = browserEntries();
  const found: string[] = [];

  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);

    const chunk = path.relative(DIST, file);

    if (!existsSync(file)) {
      found.push(`${chunk} is missing`);
      continue;
    }

    for (const { path: specifier } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) queue.push(path.resolve(path.dirname(file), specifier));
      else if (isRuntimeOnly(specifier)) found.push(`${chunk} imports ${specifier}`);
    }
  }

  return found;
}

const ui = createBrandConsole();

if (existsSync(DIST)) {
  const found = findings();
  const lines = found.map(line => "  " + line).join("\n");

  if (found.length > 0) {
    ui.error(
      `[game] browser chunks import Node or Bun built-ins:\n${lines}\n` +
        "  A browser bundler cannot load them. Keep node-only code out of the modules a page reaches."
    );
    process.exitCode = 1;
  }
} else {
  ui.error('[game] browser chunks: no dist/. Run "bun run build" first.');
  process.exitCode = 1;
}
