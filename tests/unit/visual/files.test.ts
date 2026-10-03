import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stableJson } from "../../../src/visual/compare";
import {
  baselineFile,
  checkBaseline,
  compareBaseline,
  readScreen,
  writeScreen
} from "../../../src/visual/files";

// ---------------------------------------------------------------------------
// Unit (a temp dir): the baseline files of a checkpoint — written when
// missing, compared when present, rewritten with --update; the browser leg
// compares state.json without writing it and keeps screen.png as bytes
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

describe("compareBaseline", () => {
  it("answers nothing for a missing file, and writes none", async () => {
    const file = path.join(dir, "open", "state.json");

    expect(await compareBaseline(file, stableJson({ path: "home" }))).toBeUndefined();
    await expect(readFile(file, "utf8")).rejects.toThrow("ENOENT");
  });

  it("answers same, or different with the first path, and leaves the baseline alone", async () => {
    const file = path.join(dir, "state.json");
    const baseline = stableJson({ path: "home", player: { coins: 3 } });

    await writeFile(file, baseline);

    expect(await compareBaseline(file, stableJson({ player: { coins: 3 }, path: "home" }))).toEqual(
      {
        outcome: "same"
      }
    );
    expect(await compareBaseline(file, stableJson({ path: "home", player: { coins: 5 } }))).toEqual(
      {
        outcome: "different",
        first: "player.coins"
      }
    );
    expect(await readFile(file, "utf8")).toBe(baseline);
  });
});

describe("readScreen and writeScreen", () => {
  /** The eight bytes every PNG starts with. */
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const url = `data:image/png;base64,${signature.toString("base64")}`;

  it("write the bytes of a PNG data URL, folders included, and read them back as one", async () => {
    const file = baselineFile(dir, "reward-popup", "open", "screen.png");

    await writeScreen(file, url);

    expect(await readFile(file)).toEqual(signature);
    expect(await readScreen(file)).toBe(url);
  });

  it("answer nothing for a missing screen", async () => {
    expect(await readScreen(path.join(dir, "screen.png"))).toBeUndefined();
  });

  it("refuse a picture that is not a PNG data URL", async () => {
    await expect(
      writeScreen(path.join(dir, "screen.png"), "data:image/jpeg;base64,AAAA")
    ).rejects.toThrow(
      "[game] The page gave a picture that is not a PNG data URL.\n  Capture it with renderer.capture() of a dev build."
    );
  });

  it("place screen.actual.png and screen.diff.png beside the baseline", () => {
    const folder = path.join("tests/visual", "reward-popup", "open");

    expect(baselineFile("tests/visual", "reward-popup", "open", "screen.actual.png")).toBe(
      path.join(folder, "screen.actual.png")
    );
    expect(baselineFile("tests/visual", "reward-popup", "open", "screen.diff.png")).toBe(
      path.join(folder, "screen.diff.png")
    );
  });
});
