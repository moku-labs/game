import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stableJson } from "../../../src/visual/compare";
import { baselineFile, checkBaseline } from "../../../src/visual/files";

// ---------------------------------------------------------------------------
// Unit (a temp dir): the baseline files of a checkpoint — written when
// missing, compared when present, rewritten with --update
// ---------------------------------------------------------------------------

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "moku-visual-files-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("baselineFile", () => {
  it("places a file under <dir>/<test>/<checkpoint>/", () => {
    expect(baselineFile("tests/visual", "reward-popup", "open", "state.json")).toBe(
      path.join("tests/visual", "reward-popup", "open", "state.json")
    );
  });
});

describe("checkBaseline", () => {
  it("writes a missing file, folders included, and answers written", async () => {
    const file = baselineFile(dir, "reward-popup", "open", "state.json");
    const text = stableJson({ path: "home", player: { coins: 3 } });

    expect(await checkBaseline(file, text, false)).toEqual({ outcome: "written" });
    expect(await readFile(file, "utf8")).toBe(text);
  });

  it("answers same for a file with the same JSON, whatever its layout", async () => {
    const file = path.join(dir, "state.json");

    await writeFile(file, '{"player":{"coins":3},"path":"home"}');

    expect(
      await checkBaseline(file, stableJson({ path: "home", player: { coins: 3 } }), false)
    ).toEqual({ outcome: "same" });
  });

  it("answers different with the first path, and leaves the baseline alone", async () => {
    const file = path.join(dir, "state.json");
    const baseline = stableJson({ path: "home", player: { coins: 3 } });

    await writeFile(file, baseline);

    expect(
      await checkBaseline(file, stableJson({ path: "home", player: { coins: 4 } }), false)
    ).toEqual({ outcome: "different", first: "player.coins" });
    expect(await readFile(file, "utf8")).toBe(baseline);
  });

  it("rewrites the file with --update and answers written", async () => {
    const file = path.join(dir, "state.json");
    const text = stableJson({ path: "home", player: { coins: 4 } });

    await writeFile(file, stableJson({ path: "home", player: { coins: 3 } }));

    expect(await checkBaseline(file, text, true)).toEqual({ outcome: "written" });
    expect(await readFile(file, "utf8")).toBe(text);
  });

  it("refuses a baseline that is not JSON", async () => {
    const file = path.join(dir, "state.json");

    await writeFile(file, "<<<<<<< HEAD");

    await expect(checkBaseline(file, stableJson({}), false)).rejects.toThrow(
      `[game] The baseline "${file}" is not JSON.`
    );
  });

  it("passes on a read error other than a missing file", async () => {
    await expect(checkBaseline(dir, stableJson({}), false)).rejects.toThrow();
  });
});
