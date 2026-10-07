/**
 * @file The page in a game's bundle: Bun builds a `main.ts` the way `moku-game build` does,
 * minified, for the browser, with `__MOKU_GAME_DEV__` defined. A production bundle carries no
 * control door and no agent call; a dev bundle carries both, so the check is not empty. The page
 * never reaches `@moku-labs/system`: a web-only game bundles no system code.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** A command id of `/control`: a bundle that has it carries the control door. */
const controlMarker = "game.walk";

/** The log event of a failed agent: a bundle that has it carries the agent loop. */
const agentMarker = "A page agent failed to start";

/**
 * Turns a path relative to this file into an absolute one.
 *
 * @param path - The relative path.
 * @returns The absolute path.
 */
function at(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

/**
 * Bundles a page entry as a game's build does, from a `main.ts` outside the package. Vitest may
 * run on Node, so the build runs in a Bun child process.
 *
 * @param dev - The value `__MOKU_GAME_DEV__` is defined as.
 * @returns The bundled code.
 */
function bundlePage(dev: "true" | "false"): string {
  const main = [
    `import { startPage } from ${JSON.stringify(at("../../../src/app/page.ts"))};`,
    `import game from ${JSON.stringify(at("../../fixtures/mini-game/index.ts"))};`,
    `import config from ${JSON.stringify(at("../../fixtures/mini-game/config.ts"))};`,
    "const agent = () => undefined;",
    "await startPage(game, config, { agents: [agent] });"
  ].join("\n");
  const script = `
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "moku-page-"));
    const entry = join(dir, "main.ts");
    await Bun.write(entry, ${JSON.stringify(main)});
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
  const built = spawnSync("bun", ["--eval", script], { encoding: "utf8" });

  if (built.status !== 0) throw new Error(`The Bun build failed.\n  ${built.stderr}.`);

  return built.stdout;
}

describe("the page in a game's bundle", () => {
  it("a production page bundle carries no control door and no agent call", () => {
    const production = bundlePage("false");
    const dev = bundlePage("true");

    expect(production).toContain("prefers-reduced-motion");
    expect(production).not.toContain(controlMarker);
    expect(production).not.toContain(agentMarker);
    // The read door stays: e2e and the editor read a production page too.
    expect(production).toContain("game.position");
    expect(dev).toContain(controlMarker);
    expect(dev).toContain(agentMarker);
  });

  it("a page without a system shell bundles no @moku-labs/system code", () => {
    expect(bundlePage("false")).not.toContain("@moku-labs/system");
  });
});
