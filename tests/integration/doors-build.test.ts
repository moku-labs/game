import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commands } from "../../src/plugins/flow/doors/commands";

// ---------------------------------------------------------------------------
// Integration: a production bundle of the doors carries none of the /control
// command bodies (D1, D7), an /inspect bundle no command at all, and a
// production bundle of the engine no frame history recorder
// ---------------------------------------------------------------------------

/** Every dev branch of a command logs this marker, so a bundle that has it kept a body. */
const marker = "moku:dev";

/** The frame history logs this once when it starts, so a bundle that has it kept the recorder. */
const historyMarker = "world:history-on";

/**
 * Bundles one door, or the root of the engine, the way a game does, minified, with the dev flag
 * defined: from an entry outside the package that re-exports the whole file. An entry inside the package would not do:
 * `sideEffects` lists `./dist/index.mjs` and no `src` file, so Bun 1.3.14 still drops the modules a
 * re-export-only entry of the package itself names. Vitest runs on Node, so the build runs in a Bun
 * child process.
 *
 * @param door - The door file under `src/`, or `index.ts` for the root.
 * @param dev - The value `__MOKU_GAME_DEV__` is defined as.
 * @returns The bundled code.
 */
function bundle(door: "control.ts" | "inspect.ts" | "index.ts", dev: "true" | "false"): string {
  const path = fileURLToPath(new URL(`../../src/${door}`, import.meta.url));
  const script = `
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "moku-doors-"));
    const entry = join(dir, "game.ts");
    await Bun.write(entry, ${JSON.stringify(`export * from ${JSON.stringify(path)};`)});
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

describe("the dev flag in a Bun build of src/control.ts", () => {
  it("drops every command body when __MOKU_GAME_DEV__ is defined false", () => {
    const code = bundle("control.ts", "false");

    expect(code).toContain("game.reducedMotion");
    expect(code).not.toContain(marker);
  });

  it("keeps one body per command when __MOKU_GAME_DEV__ is defined true", () => {
    const code = bundle("control.ts", "true");

    expect(code.split(marker).length - 1).toBe(Object.keys(commands).length);
  });
});

describe("the dev flag in a Bun build of src/inspect.ts", () => {
  it("carries no command body when __MOKU_GAME_DEV__ is defined false", () => {
    const code = bundle("inspect.ts", "false");

    expect(code).toContain("game.position");
    expect(code).not.toContain(marker);
  });

  it("carries no command descriptor, whether __MOKU_GAME_DEV__ is defined false or true", () => {
    for (const dev of ["false", "true"] as const) {
      const code = bundle("inspect.ts", dev);

      expect(code).toContain("game.assets");
      for (const command of Object.values(commands)) expect(code).not.toContain(command.id);
    }
  });
});

describe("the dev flag in a Bun build of src/index.ts", () => {
  it("drops the frame history recorder when __MOKU_GAME_DEV__ is defined false", () => {
    const code = bundle("index.ts", "false");

    expect(code).toContain("Draggable");
    expect(code).not.toContain(historyMarker);
  });

  it("keeps the frame history recorder when __MOKU_GAME_DEV__ is defined true", () => {
    expect(bundle("index.ts", "true")).toContain(historyMarker);
  });
});
