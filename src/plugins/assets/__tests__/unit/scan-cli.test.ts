import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StringsCompiler } from "../../scan/cli";
import { runCli } from "../../scan/cli";
import { makeTree, pngBytes, removeTree } from "./scan-fixtures";

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

/** A strings compiler for tests that need no strings: nothing changed, no keys. */
const noStrings: StringsCompiler = () =>
  Promise.resolve({ changed: false, locales: [], keys: [], notes: [] });

/** A compile that wrote two keys in two locales and has one note. */
const twoLocales: StringsCompiler = () =>
  Promise.resolve({
    changed: true,
    locales: ["en", "ru"],
    keys: ["board.title", "board.score"],
    notes: ['"ru" lacks "board.score"']
  });

/** A compile whose outputs differ from the disk. */
const staleStrings: StringsCompiler = () =>
  Promise.resolve({ changed: true, locales: ["en"], keys: ["board.title"], notes: [] });

/** A compile that throws. */
const brokenStrings: StringsCompiler = () => Promise.reject(new Error("[game] i18n: bad message."));

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
    const compile = vi.fn(noStrings);

    await runCli(["--root", root, "--keys", keys, "--check"], compile, fakeUi());

    expect(compile).toHaveBeenCalledWith(path.resolve(root), path.join(root, "src", "generated"), {
      check: true
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
