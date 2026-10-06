/**
 * @file `moku-game build` end to end, the test bin on a copy of the mini game with an icon and a
 * marked scenario: the assets packed, the page bundled with every link `./`, the packed manifest
 * beside it, and no dev code in the output. Plus the refusal of an output folder at the game root
 * and the Bun log of a page that does not bundle.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyMiniGame, removeCopies, runBin } from "./app-helpers";

/** A string only the marked scenario holds: a build that ships scenarios carries it. */
const SCENARIO_MARKER = "scenario-marker-7f3a2c";

/** The copies and output folders of this file, removed after it. */
const made: string[] = [];

/**
 * Lists every file under a folder, `/` separated.
 *
 * @param folder - The folder.
 * @returns The relative paths.
 */
function filesUnder(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry =>
      path.relative(folder, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/")
    );
}

/**
 * Copies the mini game with a favicon and a marked scenario.
 *
 * @param prefix - The start of the folder name.
 * @returns The copy.
 */
function iconGame(prefix: string): string {
  const root = copyMiniGame(prefix);

  made.push(root);
  writeFileSync(
    path.join(root, "config.ts"),
    'export default { page: { title: "mini-game", icons: { favicon: "features/ui/assets/fx-spark.webp" } } };\n'
  );
  writeFileSync(
    path.join(root, "tests", "scenarios", "marked.ts"),
    `export default () => ({ player: { count: 0 }, session: { marker: "${SCENARIO_MARKER}" } });\n`
  );

  return root;
}

/** The build of this file, made once. */
const built = { root: "", out: "", code: -1 as number | null, stderr: "" };

beforeAll(async () => {
  built.root = iconGame("build");
  built.out = path.join(mkdtempSync(path.join(tmpdir(), "moku-game-build-")), "web");
  made.push(path.dirname(built.out));

  const ran = await runBin(["build", "--root", built.root, "--out", built.out]);

  built.code = ran.code;
  built.stderr = ran.stderr;
}, 180_000);

afterAll(() => {
  removeCopies(made);
});

describe("moku-game build", () => {
  it("writes index.html with a ./ script and the packed manifest beside it", () => {
    expect(built.stderr).toBe("");
    expect(built.code).toBe(0);

    const html = readFileSync(path.join(built.out, "index.html"), "utf8");
    const script = /<script type="module" crossorigin src="([^"]+)"/.exec(html)?.[1] ?? "";
    const manifest = readFileSync(path.join(built.out, "manifest.json"), "utf8");
    const packed = readFileSync(path.join(built.root, "dist", "assets", "manifest.json"), "utf8");

    expect(script).toMatch(/^\.\/.+\.js$/);
    expect(existsSync(path.join(built.out, script))).toBe(true);
    expect(manifest).toBe(packed);
    expect((JSON.parse(manifest) as { version: number }).version).toBe(2);
  });

  it("the output carries no dev code", () => {
    const code = filesUnder(built.out)
      .filter(file => file.endsWith(".js") || file.endsWith(".html"))
      .map(file => readFileSync(path.join(built.out, file), "utf8"))
      .join("\n");

    expect(code).toContain("prefers-reduced-motion");
    expect(code).not.toContain("__moku_hot");
    expect(code).not.toContain("import.meta.hot");
    expect(code).not.toContain("Control commands run in dev builds only");
    expect(code).not.toContain("renderer.drawCalls");
    expect(code).not.toContain(SCENARIO_MARKER);
  });

  it("the icon link starts with ./", () => {
    const html = readFileSync(path.join(built.out, "index.html"), "utf8");
    const icon = /<link rel="icon" href="([^"]+)"/.exec(html)?.[1] ?? "";

    expect(icon).toMatch(/^\.\//);
    expect(existsSync(path.join(built.out, icon))).toBe(true);
    expect(html).not.toContain("../");
  });

  it("build writes nothing under .moku", () => {
    expect(existsSync(path.join(built.root, ".moku"))).toBe(false);
  });

  it("refuses --out at the game root", async () => {
    const ran = await runBin(["build", "--root", built.root, "--out", built.root]);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain(
      `[game] build: --out "${built.root}" would replace the game or its packed assets. Name another folder.`
    );
    expect(existsSync(path.join(built.root, "index.ts"))).toBe(true);
  }, 60_000);

  it("a failed bundle exits 1 with the Bun log", async () => {
    const root = iconGame("build-broken");
    const out = path.join(root, "dist", "web");

    writeFileSync(
      path.join(root, "index.ts"),
      'import "./missing-module.ts";\nexport default {};\n'
    );

    const ran = await runBin(["build", "--root", root]);

    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain("[game] build: the page did not bundle.");
    expect(ran.stderr).toContain("missing-module");
    rmSync(out, { recursive: true, force: true });
  }, 180_000);
});
