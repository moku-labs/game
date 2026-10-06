import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Integration: what a minified Bun build of a game carries. A game that
// composes `...screen` without `effectsPlugin` carries no effects code (design
// decision 7 of V5), and a production build carries no draw-call counter of
// the renderer, which a dev build does (07-renderer Delta 8 §2). And what the
// package build carries: `dist/index.mjs` never names the two packages of the
// production packer, which only `dist/assets.mjs` imports (09-assets Delta 8),
// and `dist/testing.mjs` imports no `node:` module, which `dist/visual.mjs` does. `isolate` in
// `/testing` reaches the root for `createApp`: the root is tree-shaken to the logic set, so the
// entry still imports no `node:` module and names no Pixi.
// ---------------------------------------------------------------------------

/** The root module of the package, as a game imports it. */
const rootModule = fileURLToPath(new URL("../../src/index.ts", import.meta.url));

/** The folder of the effects plugin, read for the names of its log events. */
const effectsFolder = fileURLToPath(new URL("../../src/plugins/effects/", import.meta.url));

/** The names Pixi's three WebGPU draw classes go by: only the counting subclasses name them. */
const drawClasses = ["GpuBatchAdaptor", "GpuGraphicsAdaptor", "GpuEncoderSystem"];

/** The command the dev install of the draw-call counter logs under `moku:dev`. */
const drawCallsMarker = "renderer.drawCalls";

/** The two packages of the production packer: only the node door `./assets` may name them. */
const packerPackages = ["sharp", "maxrects-packer"];

/** What the game composes: the screen set, or the screen set and `effectsPlugin`. */
type Composition = "screen" | "screen+effects";

/**
 * Every source file of the effects plugin, its tests left out.
 *
 * @param folder - The folder to walk.
 * @returns The absolute paths of the `.ts` files.
 */
function sourcesOf(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(folder, entry.name);

    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourcesOf(file);

    return entry.name.endsWith(".ts") ? [file] : [];
  });
}

/**
 * The events the effects plugin logs, read from its source: `effects:wgsl`, `effects:atlas` and
 * the rest. Each is a string only the plugin's systems and start carry, so a bundle that has one
 * kept effects code. A new event of the plugin joins the list by itself.
 *
 * @returns The event names, sorted, without repeats.
 */
function effectsMarkers(): string[] {
  const names = sourcesOf(effectsFolder).flatMap(file =>
    [...readFileSync(file, "utf8").matchAll(/"(effects:[a-z-]+)"/g)].map(match => match[1] ?? "")
  );

  return [...new Set(names)].toSorted();
}

/** The bundles built so far, by composition and dev flag: each build takes a second. */
const built = new Map<string, string>();

/**
 * Bundles a game entry the way a game ships it: minified, for the browser, with the dev flag
 * defined. The entry lives outside the package and imports the root module by path; it builds the
 * game's kit with `defineGame` and composes the app inside an exported function, so nothing runs.
 * Vitest runs on Node, so the build runs in a Bun child process.
 *
 * @param composition - The plugins the entry composes.
 * @param dev - The value `__MOKU_GAME_DEV__` is defined as.
 * @returns The bundled code.
 */
function bundle(composition: Composition, dev: "true" | "false"): string {
  const key = `${composition}:${dev}`;
  const known = built.get(key);

  if (known !== undefined) return known;

  const effects = composition === "screen+effects";
  const game = [
    `import { createApp, defineGame, ${effects ? "effectsPlugin, " : ""}screen } from ${JSON.stringify(rootModule)};`,
    "export const kit = defineGame();",
    `export function start() { return createApp({ plugins: [...screen${effects ? ", effectsPlugin" : ""}] }); }`
  ].join("\n");
  const script = `
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "moku-game-"));
    const entry = join(dir, "game.ts");
    await Bun.write(entry, ${JSON.stringify(game)});
    const result = await Bun.build({
      entrypoints: [entry],
      define: { __MOKU_GAME_DEV__: ${JSON.stringify(dev)} },
      minify: true,
      target: "browser",
      external: ["pixi.js", "yoga-layout", "@moku-labs/*"]
    });
    rmSync(dir, { recursive: true, force: true });
    if (!result.success) {
      console.error(result.logs.map(String).join(" "));
      process.exit(1);
    }
    process.stdout.write(await result.outputs[0].text());
  `;
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
  const run = spawnSync("bun", ["--eval", script], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });

  if (run.status !== 0) throw new Error(`The Bun build failed.\n  ${run.stderr}.`);

  built.set(key, run.stdout);

  return run.stdout;
}

describe("a game build with and without effectsPlugin", () => {
  it("reads the log events of the effects plugin as its markers", () => {
    expect(effectsMarkers()).toEqual(
      expect.arrayContaining(["effects:pass-budget", "effects:particles", "effects:wgsl"])
    );
  });

  it("carries none of the effects markers when the game composes ...screen only", () => {
    const code = bundle("screen", "false");

    expect(code).toContain("createApp");
    expect(effectsMarkers().filter(marker => code.includes(marker))).toEqual([]);
    // Nor the WGSL of the built-in filters.
    expect(code).not.toContain("mainFragment");
  }, 60_000);

  it("carries every effects marker when the game composes effectsPlugin", () => {
    const code = bundle("screen+effects", "false");

    expect(effectsMarkers().filter(marker => !code.includes(marker))).toEqual([]);
    expect(code).toContain("mainFragment");
  }, 60_000);
});

describe("the draw-call counter of the renderer in a game build", () => {
  it("leaves the bundle when __MOKU_GAME_DEV__ is defined false", () => {
    const code = bundle("screen", "false");

    expect(code).not.toContain(drawCallsMarker);
    expect(drawClasses.filter(name => code.includes(name))).toEqual([]);
  }, 60_000);

  it("stays in the bundle, with the three counting classes, when __MOKU_GAME_DEV__ is true", () => {
    const code = bundle("screen", "true");

    expect(code).toContain(drawCallsMarker);
    expect(drawClasses.filter(name => !code.includes(name))).toEqual([]);
  }, 60_000);
});

/**
 * Builds one entry of the package the way `tsdown` builds `dist/`: ESM for node, every package
 * left as an import, so a package the entry reaches shows up by its name. The entry lives outside
 * the package and re-exports the source file, for the `"sideEffects": false` reason of
 * `doors-build.test.ts`. Vitest runs on Node, so the build runs in a Bun child process.
 *
 * @param source - The entry file under `src/`, or a module of one.
 * @returns The built code.
 */
function packageBuild(
  source: "index.ts" | "assets.ts" | "testing.ts" | "testing/isolate.ts" | "visual.ts"
): string {
  const file = fileURLToPath(new URL(`../../src/${source}`, import.meta.url));
  const script = `
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "moku-package-"));
    const entry = join(dir, "entry.ts");
    await Bun.write(entry, ${JSON.stringify(`export * from ${JSON.stringify(file)};`)});
    const result = await Bun.build({ entrypoints: [entry], target: "node", format: "esm", packages: "external" });
    rmSync(dir, { recursive: true, force: true });
    if (!result.success) {
      console.error(result.logs.map(String).join(" "));
      process.exit(1);
    }
    process.stdout.write(await result.outputs[0].text());
  `;
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- the Bun on PATH is the one the project scripts run.
  const run = spawnSync("bun", ["--eval", script], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });

  if (run.status !== 0) throw new Error(`The Bun build failed.\n  ${run.stderr}.`);

  return run.stdout;
}

describe("the packages of the production packer in the package build", () => {
  it("are named nowhere in dist/index.mjs", () => {
    const code = packageBuild("index.ts");

    expect(code).toContain("createApp");
    expect(packerPackages.filter(name => code.includes(name))).toEqual([]);
  }, 60_000);

  it("are imported, not bundled, by dist/assets.mjs: the check above would see them", () => {
    const code = packageBuild("assets.ts");

    expect(code).toContain('from "maxrects-packer"');
    expect(code).toContain('import("sharp")');
  }, 60_000);
});

/**
 * The `node:` modules a built entry imports, statically or with `import()`.
 *
 * @param code - The built code.
 * @returns The module specifiers, such as `node:path`.
 */
function nodeImports(code: string): string[] {
  return [...code.matchAll(/(?:from|import\(?)\s*"(node:[^"]+)"/g)].map(match => match[1] ?? "");
}

/**
 * The names a built entry exports, read from its `export { … }` clauses.
 *
 * @param code - The built code.
 * @returns The exported names, sorted: `isolate`, `stub` and the rest.
 */
function exportedNames(code: string): string[] {
  return [...code.matchAll(/export\s*\{([^}]*)\}/g)]
    .flatMap(match => (match[1] ?? "").split(","))
    .map(item => item.trim().split(" as ").at(-1) ?? "")
    .filter(name => name !== "")
    .toSorted();
}

describe("the node modules of the testing and visual entries in the package build", () => {
  it("are imported nowhere by dist/testing.mjs: a browser test can import it", () => {
    const code = packageBuild("testing.ts");

    expect(exportedNames(code)).toEqual(
      expect.arrayContaining(["createHeadless", "fakeClock", "isolate", "stub"])
    );
    expect(nodeImports(code)).toEqual([]);
    // `isolate` reaches the root for `createApp` only: the screen set, and Pixi with it, stays out.
    expect(code).not.toContain("pixi.js");
  }, 60_000);

  it("are imported nowhere by the isolate module of the testing entry", () => {
    const code = packageBuild("testing/isolate.ts");

    expect(exportedNames(code)).toEqual(expect.arrayContaining(["isolate", "stub"]));
    expect(code).toContain("createApp");
    expect(nodeImports(code)).toEqual([]);
  }, 60_000);

  it("are imported by dist/visual.mjs: the check above would see them", () => {
    const code = packageBuild("visual.ts");

    expect(code).toContain("runVisualTests");
    expect(nodeImports(code)).toContain("node:path");
  }, 60_000);
});
