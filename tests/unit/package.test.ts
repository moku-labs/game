import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commands } from "../../src/plugins/flow/doors/commands";
import { sources } from "../../src/plugins/flow/doors/sources";

// ---------------------------------------------------------------------------
// Unit test: what npm ships beside `dist`. The agent guide, the body font
// with its licence and the asset scanner bin are in the package, and the
// shipped font cannot drift from the mini game's copy.
// ---------------------------------------------------------------------------

/** The fields of `package.json` this test reads. */
interface PackageJson {
  /** The paths npm packs. */
  files: string[];
  /** The files a bundler may not drop when nothing of them is used. */
  sideEffects: string[];
  /** The command names a game gets on its PATH, mapped to their scripts. */
  bin: Record<string, string>;
  /** The subpath exports. */
  exports: Record<string, string | { types: string; default: string }>;
  /** The peers a game brings. */
  peerDependencies: Record<string, string>;
  /** Which peers are optional. */
  peerDependenciesMeta: Record<string, { optional: boolean }>;
}

/** The repository root, the folder of `package.json`. */
const ROOT = new URL("../../", import.meta.url);

/** The mini game's body font and `fonts/` are byte copies; this file keeps the two equal. */
const FIXTURE_FONTS = new URL("tests/fixtures/mini-game/features/ui/assets/", ROOT);

/**
 * Read a file of the repository as bytes.
 *
 * @param path - The path from the repository root.
 * @returns The file contents.
 */
function readBytes(path: string): Buffer {
  return readFileSync(new URL(path, ROOT));
}

/**
 * Read a file of the repository as UTF-8 text.
 *
 * @param path - The path from the repository root.
 * @returns The file contents.
 */
function readText(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

/**
 * Find the one line of llms.txt that lists the keys of a door catalogue.
 *
 * @param guide - The text of llms.txt.
 * @param catalogue - `sources` or `commands`.
 * @returns The list, from after the colon up to the `;` or `.` that ends it.
 * @throws {Error} When the guide has no such list.
 */
function keysLine(guide: string, catalogue: "sources" | "commands"): string {
  const found = new RegExp(`Keys of \`${catalogue}\`: ([^;.]*)[;.]`).exec(guide);

  if (found?.[1] === undefined) throw new Error(`llms.txt has no "Keys of \`${catalogue}\`" list.`);

  return found[1];
}

/**
 * Read the keys a llms.txt list names, each one in backticks, sorted.
 *
 * @param guide - The text of llms.txt.
 * @param catalogue - `sources` or `commands`.
 * @returns The keys, sorted, duplicates kept.
 */
function listedKeys(guide: string, catalogue: "sources" | "commands"): string[] {
  return [...keysLine(guide, catalogue).matchAll(/`([^`]+)`/g)]
    .map(match => match[1] ?? "")
    .toSorted();
}

/** The parsed `package.json`. */
const pkg = JSON.parse(readText("package.json")) as PackageJson;

describe("package.json", () => {
  it("files ships dist, the bin, the fonts and llms.txt", () => {
    expect(pkg.files).toEqual(expect.arrayContaining(["dist", "bin", "fonts", "llms.txt"]));
  });

  it("the moku-game-assets bin is a bun script that exists", () => {
    const bin = pkg.bin["moku-game-assets"];

    expect(bin).toBe("./bin/moku-game-assets.mjs");
    expect(readText(bin ?? "").startsWith("#!/usr/bin/env bun\n")).toBe(true);
  });

  it("the moku-game-index bin is a bun script that runs the built project door", () => {
    const bin = pkg.bin["moku-game-index"];

    expect(bin).toBe("./bin/moku-game-index.mjs");
    expect(readText(bin ?? "").startsWith("#!/usr/bin/env bun\n")).toBe(true);
    expect(readText(bin ?? "")).toContain('from "../dist/project.mjs"');
  });

  it("exports the project index by subpath, with typescript as an optional peer", () => {
    expect(pkg.exports["./project"]).toEqual({
      types: "./dist/project.d.mts",
      default: "./dist/project.mjs"
    });
    expect(pkg.peerDependencies.typescript).toBe(">=5.5");
    expect(pkg.peerDependenciesMeta.typescript).toEqual({ optional: true });
  });

  it("the package has the moku-game bin and the ./cli export", () => {
    const bin = pkg.bin["moku-game"];

    expect(bin).toBe("./bin/moku-game.mjs");
    expect(readText(bin ?? "").startsWith("#!/usr/bin/env bun\n")).toBe(true);
    expect(readText(bin ?? "")).toContain('from "../dist/cli.mjs"');
    expect(pkg.exports["./cli"]).toEqual({ types: "./dist/cli.d.mts", default: "./dist/cli.mjs" });
  });

  it("exports the fonts folder by subpath", () => {
    expect(pkg.exports["./fonts/*"]).toBe("./fonts/*");
  });

  // Under `"sideEffects": false` Bun's barrel optimization parses the re-export-only root again in
  // every incremental bundle, so the root would be re-sent in every hot update and reload the page.
  it("sideEffects lists the root entry and no other export", () => {
    const listed = Object.entries(pkg.exports)
      .map(([subpath, target]) => ({
        subpath,
        file: typeof target === "string" ? target : target.default
      }))
      .filter(({ file }) => pkg.sideEffects.includes(file));

    expect(pkg.sideEffects).toEqual(["./dist/index.mjs"]);
    expect(listed).toEqual([{ subpath: ".", file: "./dist/index.mjs" }]);
    expect(pkg.exports["."]).toMatchObject({ default: pkg.sideEffects[0] });
  });
});

describe("the shipped body font", () => {
  it("font-body.fnt and font-body.png equal the fixture bytes", () => {
    for (const name of ["font-body.fnt", "font-body.png"]) {
      expect(readBytes(`fonts/${name}`).equals(readFileSync(new URL(name, FIXTURE_FONTS)))).toBe(
        true
      );
    }
  });

  it("font-body.fnt names font-body.png as page 0", () => {
    expect(readText("fonts/font-body.fnt")).toContain('<page id="0" file="font-body.png"/>');
  });

  it("LICENSE.txt is the SIL OFL 1.1 of Pangolin", () => {
    const licence = readText("fonts/LICENSE.txt");

    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(licence).toContain("Pangolin");
  });
});

describe("llms.txt", () => {
  it("is a real guide that names the bins and says neither 'not published' nor 'Planned, not built'", () => {
    const guide = readText("llms.txt");

    expect(guide.length).toBeGreaterThan(1000);
    expect(guide).toContain("moku-game-assets");
    expect(guide).toContain("moku-game-index");
    expect(guide).toContain("@moku-labs/game/project");
    expect(guide).not.toContain("not published");
    expect(guide).not.toContain("Planned, not built");
  });

  it("the doors section lists exactly the keys of sources and commands, and no rect", () => {
    const guide = readText("llms.txt");

    expect(listedKeys(guide, "sources")).toEqual(Object.keys(sources).toSorted());
    expect(listedKeys(guide, "commands")).toEqual(Object.keys(commands).toSorted());
    expect(keysLine(guide, "sources")).not.toContain("`rect`");
  });
});
