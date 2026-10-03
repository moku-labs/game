import { describe, expect, it } from "vitest";
import { parseVisualArgv, resolveVisualOptions } from "../../../src/visual/run";
import type { VisualSetup } from "../../../src/visual/types";

// ---------------------------------------------------------------------------
// Unit (pure): the four flags of the command line, the defaults, and an
// explicit option winning over a flag
// ---------------------------------------------------------------------------

/** A setup whose app is never built: the options do not start a game. */
const headless: VisualSetup = {
  app: () => {
    throw new Error("not built");
  }
};

const withPage: VisualSetup = { ...headless, page: { url: "http://localhost:3000/" } };

describe("parseVisualArgv", () => {
  it("reads nothing from an empty command line", () => {
    expect(parseVisualArgv([])).toEqual({});
  });

  it("reads the four flags; --only repeats", () => {
    expect(
      parseVisualArgv([
        "--update",
        "--no-pixels",
        "--only",
        "reward-popup",
        "--only",
        "home",
        "--dir",
        "visual"
      ])
    ).toEqual({ update: true, pixels: false, only: ["reward-popup", "home"], dir: "visual" });
  });

  it("reads --webgl as the WebGL leg", () => {
    expect(parseVisualArgv(["--webgl", "--only", "home"])).toEqual({
      renderer: "webgl",
      only: ["home"]
    });
  });

  it("leaves arguments it does not know to the script that got them", () => {
    expect(parseVisualArgv(["run", "--project", "unit", "--update"])).toEqual({ update: true });
  });

  it("refuses --only and --dir without a value", () => {
    expect(() => parseVisualArgv(["--only"])).toThrow(
      "[game] The flag --only needs a value.\n  Write it as --only <name>."
    );
    expect(() => parseVisualArgv(["--dir", "--update"])).toThrow(
      "[game] The flag --dir needs a value.\n  Write it as --dir <path>."
    );
  });
});

describe("resolveVisualOptions", () => {
  it("fills the defaults", () => {
    expect(resolveVisualOptions(headless, { argv: [] })).toEqual({
      dir: "tests/visual",
      update: false,
      pixels: false,
      renderer: "webgpu",
      settleFrames: 600,
      tolerance: { ratio: 0.001, threshold: 24 }
    });
  });

  it("turns pixels on by default only with a page on a Mac", () => {
    expect(resolveVisualOptions(withPage, { argv: [] }).pixels).toBe(process.platform === "darwin");
    expect(resolveVisualOptions(headless, { argv: [] }).pixels).toBe(false);
  });

  it("keeps pixels off off a Mac, even with a page", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform") ?? { value: "darwin" };

    try {
      Object.defineProperty(process, "platform", { value: "linux" });
      expect(resolveVisualOptions(withPage, { argv: [] }).pixels).toBe(false);

      Object.defineProperty(process, "platform", { value: "darwin" });
      expect(resolveVisualOptions(withPage, { argv: [] }).pixels).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("takes the flags of argv", () => {
    const run = resolveVisualOptions(withPage, {
      argv: ["--update", "--no-pixels", "--only", "home", "--dir", "shots"]
    });

    expect(run).toMatchObject({ update: true, pixels: false, only: ["home"], dir: "shots" });
  });

  it("lets an explicit option win over a flag", () => {
    const run = resolveVisualOptions(withPage, {
      argv: ["--update", "--no-pixels", "--only", "home", "--dir", "shots", "--webgl"],
      update: false,
      pixels: true,
      only: ["reward-popup"],
      dir: "baselines",
      renderer: "webgpu",
      settleFrames: 30,
      tolerance: { ratio: 0, threshold: 0 }
    });

    expect(run).toEqual({
      update: false,
      pixels: true,
      only: ["reward-popup"],
      dir: "baselines",
      renderer: "webgpu",
      settleFrames: 30,
      tolerance: { ratio: 0, threshold: 0 }
    });
  });

  it("takes the WebGL leg from --webgl or from the renderer option", () => {
    expect(resolveVisualOptions(withPage, { argv: ["--webgl"] }).renderer).toBe("webgl");
    expect(resolveVisualOptions(withPage, { argv: [], renderer: "webgl" }).renderer).toBe("webgl");
  });

  it("reads process.argv when no argv is given", () => {
    const saved = process.argv;

    process.argv = ["bun", "tests/visual/run.ts", "--update"];

    try {
      expect(resolveVisualOptions(headless).update).toBe(true);
    } finally {
      process.argv = saved;
    }
  });
});
