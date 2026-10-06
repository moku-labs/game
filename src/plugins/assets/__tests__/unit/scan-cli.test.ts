import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StringsCompiler, StringsExporter, StringsImporter } from "../../scan/cli";
import { runCli } from "../../scan/cli";
import { makeTree, pngBytes, removeTree, stringsTools } from "./scan-fixtures";

const roots: string[] = [];

async function tree(files: Record<string, string | Uint8Array>): Promise<string> {
  const root = await makeTree(files);

  roots.push(root);

  return root;
}

function fakeUi(): { lines: string[]; info(m: string): void; warn(m: string): void } & {
  error(m: string, cause?: unknown): void;
} {
  const lines: string[] = [];

  return {
    lines,
    info: (message: string) => {
      lines.push(`info ${message}`);
    },
    warn: (message: string) => {
      lines.push(`warn ${message}`);
    },
    error: (message: string) => {
      lines.push(`error ${message}`);
    }
  };
}

/** The tools of a game that needs no strings: nothing changed, no keys. */
const noStrings = stringsTools();

/** A compile that wrote two keys in two locales and has one note. */
const twoLocales = stringsTools({
  compile: () =>
    Promise.resolve({
      changed: true,
      locales: ["en", "ru"],
      keys: ["board.title", "board.score"],
      notes: ['"ru" lacks "board.score"']
    })
});

/** A compile whose outputs differ from the disk. */
const staleStrings = stringsTools({
  compile: () =>
    Promise.resolve({ changed: true, locales: ["en"], keys: ["board.title"], notes: [] })
});

/** A compile that throws. */
const brokenStrings = stringsTools({
  compile: () => Promise.reject(new Error("[game] i18n: bad message."))
});

/** A compile that writes the pseudo-locale when it is asked to. */
const pseudoAware: StringsCompiler = (_root, _out, options) =>
  Promise.resolve({
    changed: true,
    locales: options.pseudo ? ["en", "en-XA", "ru"] : ["en", "ru"],
    keys: ["board.title", "board.score"],
    notes: []
  });

/** An export of two locales, the second one three keys short. */
const exportTwo: StringsExporter = () =>
  Promise.resolve({ locales: ["en", "ru"], missing: { en: 0, ru: 3 } });

/** An import of one locale that wrote three keys into two feature files. */
const importRu: StringsImporter = () =>
  Promise.resolve({
    locales: ["ru"],
    keys: 3,
    files: ["features/hud/strings/ru.json", "features/shop/strings/ru.json"]
  });

/** An export whose source locale no feature brings. */
const exportWithoutSource: StringsExporter = () =>
  Promise.reject(new Error('[game] i18n: the source locale "en" has no string file.'));

/** An import of one key of one locale into one file. */
const importOne: StringsImporter = () =>
  Promise.resolve({ locales: ["de"], keys: 1, files: ["features/hud/strings/de.json"] });

/** An import of an empty folder. */
const importNone: StringsImporter = () => Promise.resolve({ locales: [], keys: 0, files: [] });

/** The one refusal of every flag that may not join `--export` or `--import`. */
const RUN_ALONE = 'error [game] assets: "--export" and "--import" run alone; drop the other flags.';

async function readText(file: string): Promise<string> {
  return await readFile(file, "utf8");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => removeTree(root)));
});

describe("runCli", () => {
  it("writes the manifest and the key module under the root", async () => {
    const root = await tree({ "features/ui/assets/panel{nine=48}.png": pngBytes(256, 128) });
    const ui = fakeUi();

    const code = await runCli(["--root", root], noStrings, ui);

    expect(code).toBe(0);
    expect(await readText(path.join(root, "manifest.json"))).toContain('"ui.panel"');
    expect(await readText(path.join(root, "generated", "assets.ts"))).toContain(
      'export type AssetKey =\n  | "ui.panel";'
    );
    expect(ui.lines.join("\n")).toContain("wrote");
  });

  it("writes each output where its flag names it and counts both bundles", async () => {
    const root = await tree({
      "features/ui/assets/panel.png": pngBytes(16, 16),
      "features/board/assets/cell.png": pngBytes(16, 16)
    });
    const manifest = path.join(root, "public", "assets", "manifest.json");
    const keys = path.join(root, "src", "generated", "assets.ts");
    const ui = fakeUi();

    expect(
      await runCli(["--root", root, "--manifest", manifest, "--keys", keys], noStrings, ui)
    ).toBe(0);
    expect(await readText(manifest)).toContain('"ui.panel"');
    expect(await readText(keys)).toContain('| "board.cell"');
    expect(ui.lines.join("\n")).toContain("2 bundles, 2 files");
  });

  it("writes the same bytes twice and reports the second run as up to date", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });
    const manifest = path.join(root, "manifest.json");
    const keys = path.join(root, "generated", "assets.ts");

    await runCli(["--root", root], noStrings, fakeUi());
    const first = [await readText(manifest), await readText(keys)];
    const ui = fakeUi();

    expect(await runCli(["--root", root], noStrings, ui)).toBe(0);
    expect([await readText(manifest), await readText(keys)]).toEqual(first);
    expect(ui.lines.join("\n")).toContain("up to date");
    expect(ui.lines.join("\n")).not.toContain("wrote");
  });

  it("passes --check on an up-to-date tree", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });

    await runCli(["--root", root], noStrings, fakeUi());
    const ui = fakeUi();

    expect(await runCli(["--root", root, "--check"], noStrings, ui)).toBe(0);
    expect(ui.lines.join("\n")).toContain("up to date");
  });

  it("fails --check and writes nothing when the output would change", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });
    const ui = fakeUi();

    const code = await runCli(["--root", root, "--check"], noStrings, ui);

    expect(code).toBe(1);
    expect(ui.lines.join("\n")).toContain("are out of date");
    await expect(readText(path.join(root, "manifest.json"))).rejects.toThrow();
  });

  it("fails --check after an asset was added", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });

    await runCli(["--root", root], noStrings, fakeUi());
    await writeFile(path.join(root, "features", "board", "assets", "gem.png"), pngBytes(16, 16));

    const ui = fakeUi();

    expect(await runCli(["--root", root, "--check"], noStrings, ui)).toBe(1);
    expect(ui.lines.join("\n")).toContain("assets.ts");
  });

  it("warns about an ignored file", async () => {
    const root = await tree({
      "features/ui/assets/panel.png": pngBytes(16, 16),
      "features/ui/assets/notes.md": "text"
    });
    const ui = fakeUi();

    await runCli(["--root", root], noStrings, ui);

    expect(ui.lines.join("\n")).toContain('warn ignored "features/ui/assets/notes.md"');
  });

  it("reports a scan problem and writes nothing", async () => {
    const root = await tree({ "features/ui/assets/panel.v2.png": pngBytes(16, 16) });
    const ui = fakeUi();

    const code = await runCli(["--root", root], noStrings, ui);

    expect(code).toBe(1);
    expect(ui.lines.join("\n")).toContain("error [game] assets: the scan found 1 problem.");
    await expect(readText(path.join(root, "manifest.json"))).rejects.toThrow();
  });

  it("refuses an unknown flag", async () => {
    const ui = fakeUi();

    expect(await runCli(["--sizes"], noStrings, ui)).toBe(1);
    expect(ui.lines.join("\n")).toContain('error [game] assets: unknown option "--sizes".');
  });

  it("refuses an option without its value", async () => {
    const ui = fakeUi();

    expect(await runCli(["--root", "--check"], noStrings, ui)).toBe(1);
    expect(ui.lines.join("\n")).toContain('"--root" needs a path');
  });

  it("refuses a trailing option without its value", async () => {
    const ui = fakeUi();

    expect(await runCli(["--keys"], noStrings, ui)).toBe(1);
    expect(ui.lines.join("\n")).toContain('"--keys" needs a path');
  });

  it("compiles the strings next to the key module and passes the check flag", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });
    const keys = path.join(root, "src", "generated", "assets.ts");
    const compile = vi.fn(noStrings.compile);

    await runCli(["--root", root, "--keys", keys, "--check"], stringsTools({ compile }), fakeUi());

    expect(compile).toHaveBeenCalledWith(path.resolve(root), path.join(root, "src", "generated"), {
      check: true,
      pseudo: false
    });
  });

  it("warns with the notes of the compile and counts its strings", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });
    const ui = fakeUi();

    expect(await runCli(["--root", root], twoLocales, ui)).toBe(0);
    expect(ui.lines).toContain('warn "ru" lacks "board.score"');
    expect(ui.lines).toContain("info 2 strings in 2 locales (en, ru).");
  });

  it("fails --check when only the generated strings are out of date", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });

    await runCli(["--root", root], noStrings, fakeUi());

    const ui = fakeUi();

    expect(await runCli(["--root", root, "--check"], staleStrings, ui)).toBe(1);
    expect(ui.lines.join("\n")).toContain("error the generated strings are out of date.");
  });

  it("reports a failed compile as a failed run", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });
    const ui = fakeUi();

    expect(await runCli(["--root", root], brokenStrings, ui)).toBe(1);
    expect(ui.lines).toContain("error [game] i18n: bad message.");
  });

  it("prints through the branded console when no console is passed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await runCli(["--sizes"], noStrings)).toBe(1);
    expect(error).toHaveBeenCalled();
  });
});

describe("runCli --pseudo", () => {
  it("compiles with pseudo and counts the pseudo-locale in the summary", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });
    const compile = vi.fn(pseudoAware);
    const ui = fakeUi();

    expect(await runCli(["--root", root, "--pseudo"], stringsTools({ compile }), ui)).toBe(0);
    expect(compile).toHaveBeenCalledWith(path.resolve(root), path.join(root, "generated"), {
      check: false,
      pseudo: true
    });
    expect(ui.lines).toContain("info 2 strings in 3 locales (en, en-XA, ru).");
  });

  it("checks the pseudo-locale too with --check --pseudo", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });
    const compile = vi.fn(pseudoAware);

    await runCli(["--root", root, "--check", "--pseudo"], stringsTools({ compile }), fakeUi());

    expect(compile).toHaveBeenCalledWith(path.resolve(root), path.join(root, "generated"), {
      check: true,
      pseudo: true
    });
  });

  it("refuses --pseudo with --pack and compiles nothing", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });
    const compile = vi.fn(pseudoAware);
    const ui = fakeUi();
    const argv = ["--root", root, "--pack", path.join(root, "dist"), "--pseudo"];

    expect(await runCli(argv, stringsTools({ compile }), ui)).toBe(1);
    expect(ui.lines).toEqual([
      'error [game] assets: "--pseudo" is for a dev run; drop it from "--pack".'
    ]);
    expect(compile).not.toHaveBeenCalled();
  });
});

describe("runCli --export", () => {
  it("runs the exporter alone and writes one line per locale", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });
    const dir = path.join(root, "translations");
    const compile = vi.fn(noStrings.compile);
    const exportStrings = vi.fn(exportTwo);
    const ui = fakeUi();

    expect(
      await runCli(["--root", root, "--export", dir], stringsTools({ compile, exportStrings }), ui)
    ).toBe(0);
    expect(exportStrings).toHaveBeenCalledWith(path.resolve(root), dir, { source: "en" });
    expect(compile).not.toHaveBeenCalled();
    await expect(readText(path.join(root, "manifest.json"))).rejects.toThrow();
    expect(ui.lines).toEqual([
      `info exported "${path.join(dir, "en.json")}": 0 missing.`,
      `info exported "${path.join(dir, "ru.json")}": 3 missing.`
    ]);
  });

  it("resolves the folder against the working directory and hands over --source", async () => {
    const root = await tree({});
    const exportStrings = vi.fn(exportTwo);
    const argv = ["--root", root, "--export", "translations", "--source", "ru"];

    expect(await runCli(argv, stringsTools({ exportStrings }), fakeUi())).toBe(0);
    expect(exportStrings).toHaveBeenCalledWith(path.resolve(root), path.resolve("translations"), {
      source: "ru"
    });
  });

  it("reports a failed export as one error line and exit 1", async () => {
    const root = await tree({});
    const ui = fakeUi();
    const argv = ["--root", root, "--export", path.join(root, "out")];

    expect(await runCli(argv, stringsTools({ exportStrings: exportWithoutSource }), ui)).toBe(1);
    expect(ui.lines).toEqual(['error [game] i18n: the source locale "en" has no string file.']);
  });
});

describe("runCli --import", () => {
  it("imports into the folder of the key module and sums it up in one line", async () => {
    const root = await tree({});
    const dir = path.join(root, "translations");
    const keys = path.join(root, "src", "generated", "assets.ts");
    const compile = vi.fn(noStrings.compile);
    const importStrings = vi.fn(importRu);
    const ui = fakeUi();
    const argv = ["--root", root, "--keys", keys, "--import", dir];

    expect(await runCli(argv, stringsTools({ compile, importStrings }), ui)).toBe(0);
    expect(importStrings).toHaveBeenCalledWith(path.resolve(root), dir, {
      source: "en",
      pseudo: false,
      out: path.join(root, "src", "generated")
    });
    expect(compile).not.toHaveBeenCalled();
    await expect(readText(keys)).rejects.toThrow();
    expect(ui.lines).toEqual([`info imported "${dir}" (ru): 3 keys into 2 files.`]);
  });

  it("compiles into <root>/generated by default, with --pseudo and --source", async () => {
    const root = await tree({});
    const dir = path.join(root, "translations");
    const importStrings = vi.fn(importRu);
    const argv = ["--root", root, "--import", dir, "--pseudo", "--source", "ru"];

    expect(await runCli(argv, stringsTools({ importStrings }), fakeUi())).toBe(0);
    expect(importStrings).toHaveBeenCalledWith(path.resolve(root), dir, {
      source: "ru",
      pseudo: true,
      out: path.join(root, "generated")
    });
  });

  it("counts one key into one file in the singular, and leaves out an empty locale list", async () => {
    const root = await tree({});
    const dir = path.join(root, "translations");
    const ui = fakeUi();
    const argv = ["--root", root, "--import", dir];

    await runCli(argv, stringsTools({ importStrings: importOne }), ui);
    await runCli(argv, stringsTools({ importStrings: importNone }), ui);

    expect(ui.lines).toEqual([
      `info imported "${dir}" (de): 1 key into 1 file.`,
      `info imported "${dir}": 0 keys into 0 files.`
    ]);
  });

  it("reports a failed import as one error line and exit 1", async () => {
    const root = await tree({});
    const ui = fakeUi();
    const message =
      '[game] i18n: "hud.delivr" in translations/ru.json is not a key of this game.\n' +
      "  Fix the file and import again.";
    const importStrings: StringsImporter = () => Promise.reject(new Error(message));

    expect(
      await runCli(
        ["--root", root, "--import", path.join(root, "translations")],
        stringsTools({ importStrings }),
        ui
      )
    ).toBe(1);
    expect(ui.lines).toEqual([`error ${message}`]);
  });
});

describe("runCli refusals of the string flags", () => {
  it.each([
    ["--export with --import", ["--export", "a", "--import", "b"]],
    ["--export with --check", ["--export", "a", "--check"]],
    ["--import with --check", ["--import", "a", "--check"]],
    ["--export with --pack", ["--export", "a", "--pack", "b"]],
    ["--import with --pack", ["--import", "a", "--pack", "b"]],
    ["--export with --pseudo", ["--export", "a", "--pseudo"]]
  ])("refuses %s word for word and runs nothing", async (_name, flags) => {
    const root = await tree({});
    const tools = {
      compile: vi.fn(noStrings.compile),
      exportStrings: vi.fn(exportTwo),
      importStrings: vi.fn(importRu)
    };
    const ui = fakeUi();
    // Every path of the refused run lies inside the temp root.
    const argv = flags.map(flag => (flag.startsWith("--") ? flag : path.join(root, flag)));

    expect(await runCli(["--root", root, ...argv], tools, ui)).toBe(1);
    expect(ui.lines).toEqual([RUN_ALONE]);
    expect(tools.compile).not.toHaveBeenCalled();
    expect(tools.exportStrings).not.toHaveBeenCalled();
    expect(tools.importStrings).not.toHaveBeenCalled();
  });

  it("refuses --source without --export or --import", async () => {
    const root = await tree({});
    const ui = fakeUi();

    expect(await runCli(["--root", root, "--source", "ru"], noStrings, ui)).toBe(1);
    expect(ui.lines).toEqual([
      'error [game] assets: "--source" goes with "--export" or "--import".'
    ]);
  });

  it("names the value a string flag misses", async () => {
    const ui = fakeUi();

    expect(await runCli(["--export"], noStrings, ui)).toBe(1);
    expect(await runCli(["--import", "--pseudo"], noStrings, ui)).toBe(1);
    expect(await runCli(["--source"], noStrings, ui)).toBe(1);
    expect(ui.lines).toEqual([
      'error [game] assets: "--export" needs a path.',
      'error [game] assets: "--import" needs a path.',
      'error [game] assets: "--source" needs a locale.'
    ]);
  });
});

/** A game with one feature and a `shared/` layer, one image each. */
async function layered(): Promise<string> {
  return await tree({
    "features/board/assets/a.png": pngBytes(16, 16),
    "shared/assets/b.png": pngBytes(16, 16)
  });
}

describe("runCli --layer", () => {
  it("reads --layer folder=name and hands the layers to the scan and the compile", async () => {
    const root = await layered();
    const compile = vi.fn(noStrings.compile);

    expect(
      await runCli(["--root", root, "--layer", "shared=ui"], stringsTools({ compile }), fakeUi())
    ).toBe(0);

    const manifest = JSON.parse(await readText(path.join(root, "manifest.json"))) as {
      bundles: Record<string, { feature: string; files: { key: string; path: string }[] }>;
    };

    expect(manifest.bundles.ui).toMatchObject({
      feature: "ui",
      files: [{ key: "ui.b", path: "shared/assets/b.png" }]
    });
    expect(compile).toHaveBeenCalledWith(path.resolve(root), path.join(root, "generated"), {
      check: false,
      pseudo: false,
      layers: { shared: "ui" }
    });
  });

  it("takes --layer folder as folder=folder", async () => {
    const root = await layered();

    expect(await runCli(["--root", root, "--layer", "shared"], noStrings, fakeUi())).toBe(0);
    expect(await readText(path.join(root, "generated", "assets.ts"))).toContain('| "shared.b"');
  });

  it("collects several --layer flags in order", async () => {
    const root = await layered();
    const compile = vi.fn(noStrings.compile);
    const argv = ["--root", root, "--layer", "shared=ui", "--layer", "common"];

    expect(await runCli(argv, stringsTools({ compile }), fakeUi())).toBe(0);
    expect(compile.mock.calls[0]?.[2].layers).toEqual({ shared: "ui", common: "common" });
  });

  it("warns about a layer that has no folder and still writes the rest", async () => {
    const root = await tree({ "features/board/assets/a.png": pngBytes(16, 16) });
    const ui = fakeUi();

    expect(await runCli(["--root", root, "--layer", "shared=ui"], noStrings, ui)).toBe(0);
    expect(ui.lines).toContain(
      'warn the layer "shared" has no folder "shared/" under the root; nothing was read for it.'
    );
    expect(await readText(path.join(root, "generated", "assets.ts"))).toContain('"board.a"');
  });

  it("passes the pseudo flag and the layers together", async () => {
    const root = await layered();
    const compile = vi.fn(pseudoAware);
    const argv = ["--root", root, "--pseudo", "--layer", "shared=ui"];

    expect(await runCli(argv, stringsTools({ compile }), fakeUi())).toBe(0);
    expect(compile).toHaveBeenCalledWith(path.resolve(root), path.join(root, "generated"), {
      check: false,
      pseudo: true,
      layers: { shared: "ui" }
    });
  });

  it("hands the layers to --export and to --import", async () => {
    const root = await tree({});
    const dir = path.join(root, "translations");
    const exportStrings = vi.fn(exportTwo);
    const importStrings = vi.fn(importRu);
    const tools = stringsTools({ exportStrings, importStrings });

    expect(
      await runCli(["--root", root, "--export", dir, "--layer", "shared=ui"], tools, fakeUi())
    ).toBe(0);
    expect(
      await runCli(["--root", root, "--import", dir, "--layer", "shared=ui"], tools, fakeUi())
    ).toBe(0);
    expect(exportStrings).toHaveBeenCalledWith(path.resolve(root), dir, {
      source: "en",
      layers: { shared: "ui" }
    });
    expect(importStrings).toHaveBeenCalledWith(path.resolve(root), dir, {
      source: "en",
      pseudo: false,
      out: path.join(root, "generated"),
      layers: { shared: "ui" }
    });
  });

  it("fails --check after an asset of a layer was added", async () => {
    const root = await layered();
    const argv = ["--root", root, "--layer", "shared=ui"];

    expect(await runCli(argv, noStrings, fakeUi())).toBe(0);
    await writeFile(path.join(root, "shared", "assets", "c.png"), pngBytes(16, 16));

    const ui = fakeUi();

    expect(await runCli([...argv, "--check"], noStrings, ui)).toBe(1);
    expect(ui.lines.join("\n")).toContain("are out of date");
  });

  it("passes --check with the layer on an up-to-date tree", async () => {
    const root = await layered();
    const argv = ["--root", root, "--layer", "shared=ui"];

    await runCli(argv, noStrings, fakeUi());

    expect(await runCli([...argv, "--check"], noStrings, fakeUi())).toBe(0);
  });

  it("refuses --layer without a value", async () => {
    const ui = fakeUi();

    expect(await runCli(["--layer"], noStrings, ui)).toBe(1);
    expect(await runCli(["--layer", "--check"], noStrings, ui)).toBe(1);
    expect(ui.lines).toEqual([
      'error [game] assets: "--layer" needs "<folder>[=<name>]".',
      'error [game] assets: "--layer" needs "<folder>[=<name>]".'
    ]);
  });

  it.each([
    "shared=",
    "=ui",
    "a=b=c"
  ])("refuses the --layer value %s with an empty side or two names", async value => {
    const ui = fakeUi();

    expect(await runCli(["--layer", value], noStrings, ui)).toBe(1);
    expect(ui.lines).toEqual([
      `error [game] assets: "--layer ${value}" needs a folder and a name: "<folder>[=<name>]".`
    ]);
  });

  it("refuses the same folder twice", async () => {
    const ui = fakeUi();

    expect(await runCli(["--layer", "shared=ui", "--layer", "shared=x"], noStrings, ui)).toBe(1);
    expect(ui.lines).toEqual(['error [game] assets: "--layer" names the folder "shared" twice.']);
  });

  it("reports a layer problem of the scan as a failed run and compiles nothing", async () => {
    const root = await layered();
    const compile = vi.fn(noStrings.compile);
    const ui = fakeUi();

    expect(
      await runCli(["--root", root, "--layer", "features=x"], stringsTools({ compile }), ui)
    ).toBe(1);
    expect(ui.lines.join("\n")).toContain(
      "error [game] assets: the scan found 1 problem.\n" +
        '  the layer "features" is the features folder "features"; the features are scanned already.'
    );
    expect(compile).not.toHaveBeenCalled();
  });
});
