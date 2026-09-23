import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Integration: a production bundle carries none of the /control command bodies (D1)
// ---------------------------------------------------------------------------

const entry = fileURLToPath(new URL("../../control.ts", import.meta.url));

/** Every dev branch of a command logs this marker, so a bundle that has it kept a body. */
const marker = "moku:dev";

/**
 * Bundles the flow commands with Bun, minified, with the dev flag defined. Vitest runs on Node,
 * so the build runs in a Bun child process.
 *
 * @param dev - The value `__MOKU_GAME_DEV__` is defined as.
 * @returns The bundled code.
 */
function bundle(dev: "true" | "false"): string {
  const script = `
    const result = await Bun.build({
      entrypoints: [${JSON.stringify(entry)}],
      define: { __MOKU_GAME_DEV__: ${JSON.stringify(dev)} },
      minify: true,
      target: "browser",
      external: ["pixi.js", "yoga-layout", "@moku-labs/*"]
    });
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

describe("the dev flag in a Bun build of src/plugins/flow/control.ts", () => {
  it("drops every command body when __MOKU_GAME_DEV__ is defined false", () => {
    const code = bundle("false");

    expect(code).toContain("game.answer");
    expect(code).not.toContain(marker);
  });

  it("keeps the command bodies when __MOKU_GAME_DEV__ is defined true", () => {
    const code = bundle("true");

    expect(code.split(marker).length - 1).toBe(4);
  });
});
