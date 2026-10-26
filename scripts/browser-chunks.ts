/**
 * @file The check of `bun run validate` that no chunk a browser loads imports a Node built-in. It
 * walks `dist/` from the entries a game's page reaches, through every static and dynamic import of
 * a sibling chunk, and fails on an import of `node:*` or a bare built-in (`fs`). A browser bundler
 * cannot load one: Bun's dev server stopped with `import_node_module is not defined` when the
 * shared runtime chunk imported `createRequire` from `node:module`.
 *
 * Run after `bun run build`: `bun scripts/browser-chunks.ts`.
 */
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { createBrandConsole } from "@moku-labs/common/cli";

/** The built package. */
const DIST = path.join(import.meta.dir, "..", "dist");

/**
 * The entries a browser loads: the root, the game definition and its page and shell, the editor
 * doors, and the JSX runtimes. `cli`, `visual`, `assets`, `hot`, `lint`, `project` and `testing`
 * run in Node or Bun only.
 */
const BROWSER_ENTRIES = [
  "index.mjs",
  "app.mjs",
  "app/page.mjs",
  "app/system.mjs",
  "inspect.mjs",
  "control.mjs",
  "jsx-runtime.mjs",
  "jsx-dev-runtime.mjs"
];

/**
 * A static `import`/`export … from "x"` or `import "x"` of a chunk: the bundler writes them at the
 * start of a line.
 */
const STATIC_SPECIFIER = /^(?:import|export)\b[^"']*?["']([^"']+)["']/gm;

/** A dynamic `import("x")` with a literal. */
const DYNAMIC_SPECIFIER = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/**
 * The module specifiers a chunk imports.
 *
 * @param file - The chunk, absolute.
 * @returns The specifiers as written.
 */
function specifiersOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const matches = [...text.matchAll(STATIC_SPECIFIER), ...text.matchAll(DYNAMIC_SPECIFIER)];

  return matches.map(match => match[1] ?? "");
}

/**
 * Walks the chunks reachable from the browser entries and lists every Node built-in they import.
 *
 * @returns One line per import, `<chunk> imports <built-in>`; empty when the graph is clean.
 */
function nodeImports(): string[] {
  const seen = new Set<string>();
  const queue = BROWSER_ENTRIES.map(entry => path.join(DIST, entry));
  const found: string[] = [];

  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith(".")) {
        if (specifier.endsWith(".mjs")) queue.push(path.resolve(path.dirname(file), specifier));
        continue;
      }

      if (isBuiltin(specifier)) found.push(`${path.relative(DIST, file)} imports ${specifier}`);
    }
  }

  return found;
}

const found = nodeImports();

if (found.length > 0) {
  const lines = found.map(line => "  " + line).join("\n");

  createBrandConsole().error(
    `[game] browser chunks import Node built-ins:\n${lines}\n` +
      "  A browser bundler cannot load them. Keep node-only code out of the modules a page reaches."
  );
  process.exitCode = 1;
}
