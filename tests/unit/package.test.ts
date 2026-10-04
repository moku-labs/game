import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Unit test: what npm ships beside `dist`. The agent guide, the body font
// with its licence and the asset scanner bin are in the package, and the
// shipped font cannot drift from the fixture game's copy.
// ---------------------------------------------------------------------------

/** The fields of `package.json` this test reads. */
interface PackageJson {
  /** The paths npm packs. */
  files: string[];
  /** The command names a game gets on its PATH, mapped to their scripts. */
  bin: Record<string, string>;
  /** The subpath exports. */
  exports: Record<string, string | { types: string; default: string }>;
}

/** The repository root, the folder of `package.json`. */
const ROOT = new URL("../../", import.meta.url);

/** The fixture game's copy of the body font. */
const FIXTURE_FONTS = new URL("tests/integration/merge-game/features/ui/assets/", ROOT);

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

  it("exports the fonts folder by subpath", () => {
    expect(pkg.exports["./fonts/*"]).toBe("./fonts/*");
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
  it("says neither 'not published' nor 'Planned, not built'", () => {
    const guide = readText("llms.txt");

    expect(guide).not.toContain("not published");
    expect(guide).not.toContain("Planned, not built");
  });
});
