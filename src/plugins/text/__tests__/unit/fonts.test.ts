import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseAdvances } from "../../measure";

// ---------------------------------------------------------------------------
// Unit: the MSDF body font the package ships in `fonts/`. The measurement
// reads every glyph the font declares, `>` included, so no label of a game
// that copies the font measures a declared glyph as missing.
// ---------------------------------------------------------------------------

/** The shipped body font, `fonts/font-body.fnt` at the root of the package. */
const fontFile = new URL("../../../../../fonts/font-body.fnt", import.meta.url);

describe("the shipped body font", () => {
  it("measures every glyph the font declares", async () => {
    const fnt = await readFile(fontFile, "utf8");
    const declared = Number(/<chars count="(\d+)"/.exec(fnt)?.[1]);

    expect(declared).toBeGreaterThan(0);
    expect(parseAdvances(fnt, "ui.font-body").advances.size).toBe(declared);
  });

  it("measures `>` with its declared advance", async () => {
    const fnt = await readFile(fontFile, "utf8");
    // The tag holds char=">", so the pattern reads to the end of the line, not to the first `>`.
    const advance = Number(/<char id="62" .*xadvance="(\d+)"/.exec(fnt)?.[1]);

    expect(advance).toBeGreaterThan(0);
    expect(parseAdvances(fnt, "ui.font-body").advances.get(">")).toBe(advance);
  });
});
