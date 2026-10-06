import { fileURLToPath } from "node:url";
import { type IndexUi, openProject, type ProjectApi, runCli } from "@moku-labs/game/project";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Integration: the project index on a game in the v15 layout, read-only. The
// game imports across its layers through the tsconfig `paths` (`@core/kit`,
// `@features`, `@shared`, `@plugins`); every key reached that way is in the
// index, as it is when the same imports are written relative.
// ---------------------------------------------------------------------------

/** The layout game, read and never written. */
const ROOT = fileURLToPath(new URL("../fixtures/layout-game/", import.meta.url));

/**
 * The keys of the layout game: the keys the same game has with every import written relative, as
 * the index read it before it knew aliases.
 */
const KEYS = [
  "component:Panel",
  "feature:home",
  "feature:info",
  "flow:info",
  "flow:main",
  "jsx:homePanel",
  "jsx:{id}",
  "node:info/show",
  "node:main/home",
  "node:main/info",
  "projection:home.screen",
  "textStyle:ui.body"
];

let project: ProjectApi;

beforeAll(async () => {
  project = await openProject({ root: ROOT });
});

afterAll(() => {
  project.close();
});

/**
 * A recorder for the command line's console.
 *
 * @returns The ui to pass and the lines it kept, as `<kind> <text>`.
 */
function recorder(): { ui: IndexUi; lines: string[] } {
  const lines: string[] = [];

  return {
    lines,
    ui: {
      line: text => lines.push(`line ${text}`),
      info: text => lines.push(`info ${text}`),
      error: text => lines.push(`error ${text}`)
    }
  };
}

describe("project index on the layout game", () => {
  it("holds every key the aliases reach, with nothing unresolved", () => {
    expect(Object.keys(project.index.files)).toHaveLength(16);
    expect(Object.keys(project.index.symbols)).toEqual(KEYS);
    expect(project.index.unresolved).toEqual([]);
    expect(project.index.tsconfig).toBe("tsconfig.json");
  });

  it("anchors the nodes of the root flow at their declarations in the feature folders", async () => {
    expect(project.index.symbols["node:main/home"]).toEqual({
      def: [{ path: "features/home/flow/home.ts", binding: "homeNode" }],
      uses: [{ path: "game.ts", binding: "mainFlow", key: "home" }]
    });
    expect(project.index.symbols["node:main/info"]?.def).toEqual([
      { path: "features/info/index.ts", binding: "infoFlow" }
    ]);
    const [found] = await project.find("node:main/home");

    expect(found).toMatchObject({
      path: "features/home/flow/home.ts",
      line: 3
    });
  });

  it("answers an agent through the bin: where finds the node, --check names the aliases", async () => {
    const where = recorder();
    const check = recorder();

    expect(await runCli(["--root", ROOT, "where", "node:main/home"], where.ui)).toBe(0);
    expect(where.lines).toEqual(["line features/home/flow/home.ts:3"]);
    expect(await runCli(["--root", ROOT, "--check"], check.ui)).toBe(0);
    expect(check.lines).toEqual([
      "info 16 files, 12 keys: 0 broken, 0 in conflict, 0 unresolved.",
      "info aliases: tsconfig.json, 8 patterns"
    ]);
  });
});
