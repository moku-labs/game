import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Integration: the lost-tap log of src/plugins/input/lost.ts (F122) is in a dev and in an agent
// debug build, and a production build drops it.
// ---------------------------------------------------------------------------

const entry = fileURLToPath(new URL("../../lost.ts", import.meta.url));

/**
 * Bundles src/plugins/input/lost.ts with Bun, minified, with the dev and agent flags defined and the control flag
 * of spec 10 defined false. Vitest runs on Node, so the build runs in a Bun child process.
 *
 * @param dev - The value `__MOKU_GAME_DEV__` is defined as.
 * @param agent - The value `__MOKU_GAME_AGENT__` is defined as.
 * @returns The bundled code.
 */
function bundle(dev: "true" | "false", agent: "true" | "false"): string {
  const script = `
    const result = await Bun.build({
      entrypoints: [${JSON.stringify(entry)}],
      define: { __MOKU_GAME_DEV__: ${JSON.stringify(dev)}, __MOKU_GAME_AGENT__: ${JSON.stringify(agent)}, __MOKU_GAME_CONTROL__: "false" },
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

describe("the lost-tap log in a Bun build of src/plugins/input/lost.ts", () => {
  // Bug caught: a production build ships the log lines, or pays for their checks.
  it("drops the lines when both flags are defined false", () => {
    const code = bundle("false", "false");

    expect(code).toContain("lostPress");
    expect(code).not.toContain("input: pressed, but the tap was not counted");
    expect(code).not.toContain("input: counted, but the gate took nothing");
  });

  // Bug caught: the phone debug build (agent only) is silent exactly where taps are lost.
  it("keeps the lines in an agent debug build, __MOKU_GAME_AGENT__ alone", () => {
    const code = bundle("false", "true");

    expect(code).toContain("input: pressed, but the tap was not counted");
    expect(code).toContain("input: counted, but the gate took nothing");
  });

  // Bug caught: a dev build loses the log.
  it("keeps the lines in a dev build", () => {
    expect(bundle("true", "false")).toContain("input: pressed, but the tap was not counted");
  });
});
