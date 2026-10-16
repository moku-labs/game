import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commands } from "../../src/plugins/flow/doors/commands";

// ---------------------------------------------------------------------------
// Integration: a production bundle of the doors carries none of the /control
// command bodies (D1, D7), a debug bundle exactly the bodies of its control
// profile, an /inspect bundle no command at all, and a production bundle of
// the engine no frame history recorder
// ---------------------------------------------------------------------------

/** Every dev branch of a command logs this marker, so a bundle that has it kept a body. */
const marker = "moku:dev";

/** The frame history logs this once when it starts, so a bundle that has it kept the recorder. */
const historyMarker = "world:history-on";

/**
 * Strings only the telemetry of a debug build carries (0.15, U3 to U6): the reasons of the problem rules (the rule
 * names are the root export `PROBLEM_RULES`, which a bundle of the whole root keeps), the count registry and input's
 * count, the overdraw switch's log and its blend mode.
 */
const telemetryMarkers = [
  "not-eligible",
  "after-trim",
  "Monitor count table is full",
  "inputListeners",
  "renderer:overdraw",
  "add-npm"
];

/** The three flags as each page defines them. */
const PROFILES = {
  /** `moku-game build`. */
  release: {
    __MOKU_GAME_DEV__: "false",
    __MOKU_GAME_AGENT__: "false",
    __MOKU_GAME_CONTROL__: "false"
  },
  /** `moku-game build --debug=read`. */
  read: { __MOKU_GAME_DEV__: "false", __MOKU_GAME_AGENT__: "true", __MOKU_GAME_CONTROL__: "false" },
  /** `moku-game build --debug` (and its alias `--debug=full`). */
  full: { __MOKU_GAME_DEV__: "false", __MOKU_GAME_AGENT__: "true", __MOKU_GAME_CONTROL__: "true" },
  /** The bunfig of `moku-game dev`. */
  dev: { __MOKU_GAME_DEV__: "true", __MOKU_GAME_AGENT__: "true", __MOKU_GAME_CONTROL__: "true" }
} as const;

/** A page profile: which defines the bundle gets. */
type Profile = keyof typeof PROFILES;

/**
 * Bundles one door, or the root of the engine, the way a game does, minified, with the flags
 * defined: from an entry outside the package that re-exports the whole file. An entry inside the package would not do:
 * `sideEffects` lists `./dist/index.mjs` and no `src` file, so Bun 1.3.14 still drops the modules a
 * re-export-only entry of the package itself names. Vitest runs on Node, so the build runs in a Bun
 * child process.
 *
 * @param door - The door file under `src/`, or `index.ts` for the root.
 * @param profile - The page whose defines the bundle gets.
 * @returns The bundled code.
 */
function bundle(door: "control.ts" | "inspect.ts" | "index.ts", profile: Profile): string {
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
      define: ${JSON.stringify(PROFILES[profile])},
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

/**
 * Counts the command bodies a bundle kept: each logs the marker once.
 *
 * @param code - The bundled code.
 * @returns The number of markers.
 */
function bodiesIn(code: string): number {
  return code.split(marker).length - 1;
}

describe("the flags in a Bun build of src/control.ts", () => {
  it("drops every command body when the three flags are defined false", () => {
    const code = bundle("control.ts", "release");

    expect(code).toContain("game.reducedMotion");
    expect(code).not.toContain(marker);
  });

  it("keeps one body per command when the dev page defines the three flags true", () => {
    expect(bodiesIn(bundle("control.ts", "dev"))).toBe(Object.keys(commands).length);
  });

  it("keeps exactly the read and cosmetic bodies with AGENT true, CONTROL false and DEV false", () => {
    const readProfile = Object.values(commands).filter(
      command => command.effect === "read" || command.effect === "cosmetic"
    );

    expect(bodiesIn(bundle("control.ts", "read"))).toBe(readProfile.length);
  });

  it("keeps every body with AGENT and CONTROL true and DEV false", () => {
    expect(bodiesIn(bundle("control.ts", "full"))).toBe(Object.keys(commands).length);
  });
});

describe("the dev flag in a Bun build of src/inspect.ts", () => {
  it("carries no command body when the three flags are defined false", () => {
    const code = bundle("inspect.ts", "release");

    expect(code).toContain("game.position");
    expect(code).not.toContain(marker);
  });

  it("carries no command descriptor, whether the flags are defined false or true", () => {
    for (const profile of ["release", "dev"] as const) {
      const code = bundle("inspect.ts", profile);

      expect(code).toContain("game.assets");
      // Quoted: the id of the command game.filter is a prefix of the source game.filters.
      for (const command of Object.values(commands)) {
        expect(code).not.toContain(JSON.stringify(command.id));
      }
    }
  });
});

describe("the dev flag in a Bun build of src/index.ts", () => {
  it("drops the frame history recorder when the three flags are defined false", () => {
    const code = bundle("index.ts", "release");

    expect(code).toContain("Draggable");
    expect(code).not.toContain(historyMarker);
  });

  it("keeps the frame history recorder when the dev page defines the flags true", () => {
    expect(bundle("index.ts", "dev")).toContain(historyMarker);
  });

  it("drops the telemetry of a debug build when the three flags are defined false, and a read-only debug page keeps it", () => {
    const release = bundle("index.ts", "release");
    const read = bundle("index.ts", "read");

    expect(telemetryMarkers.filter(marker => release.includes(marker))).toEqual([]);
    expect(telemetryMarkers.filter(marker => !read.includes(marker))).toEqual([]);
  });
});
