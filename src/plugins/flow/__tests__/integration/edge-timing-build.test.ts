import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Integration: the edge timer of src/plugins/flow/runner/timing.ts is in an agent build of the
// flow plugin, and a release build drops it (hot-path item 8).
// ---------------------------------------------------------------------------

const entry = fileURLToPath(new URL("../../index.ts", import.meta.url));

/** A column of the ring, written only in `runner/timing.ts`: a minifier keeps property names. */
const marker = "hooksMs";

/**
 * Bundles the flow plugin with Bun, minified, with the agent flag defined and the dev and control
 * flags of spec 10 defined false, as a release or a `--debug` build defines them. Vitest runs on
 * Node, so the build runs in a Bun child process.
 *
 * @param agent - The value `__MOKU_GAME_AGENT__` is defined as.
 * @returns The bundled code.
 */
function bundle(agent: "true" | "false"): string {
  const script = `
    const result = await Bun.build({
      entrypoints: [${JSON.stringify(entry)}],
      define: { __MOKU_GAME_DEV__: "false", __MOKU_GAME_AGENT__: ${JSON.stringify(agent)}, __MOKU_GAME_CONTROL__: "false" },
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

describe("the edge timer in a Bun build of src/plugins/flow/index.ts", () => {
  // Bug caught: a release bundle ships the timer, or pays for its clock reads on every edge.
  it("drops the timer when __MOKU_GAME_AGENT__ is defined false", () => {
    const code = bundle("false");

    expect(code).toContain("edgeTimes");
    expect(code).not.toContain(marker);
  });

  // Bug caught: the phone debug build (agent only) times no edge.
  it("keeps the timer when __MOKU_GAME_AGENT__ is defined true", () => {
    expect(bundle("true")).toContain(marker);
  });
});
