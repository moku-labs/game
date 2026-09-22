import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

    const code = await runCli(["--root", root], ui);

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

    expect(await runCli(["--root", root, "--manifest", manifest, "--keys", keys], ui)).toBe(0);
    expect(await readText(manifest)).toContain('"ui.panel"');
    expect(await readText(keys)).toContain('| "board.cell"');
    expect(ui.lines.join("\n")).toContain("2 bundles, 2 files");
  });

  it("writes the same bytes twice and reports the second run as up to date", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });
    const manifest = path.join(root, "manifest.json");
    const keys = path.join(root, "generated", "assets.ts");

    await runCli(["--root", root], fakeUi());
    const first = [await readText(manifest), await readText(keys)];
    const ui = fakeUi();

    expect(await runCli(["--root", root], ui)).toBe(0);
    expect([await readText(manifest), await readText(keys)]).toEqual(first);
    expect(ui.lines.join("\n")).toContain("up to date");
    expect(ui.lines.join("\n")).not.toContain("wrote");
  });

  it("passes --check on an up-to-date tree", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });

    await runCli(["--root", root], fakeUi());
    const ui = fakeUi();

    expect(await runCli(["--root", root, "--check"], ui)).toBe(0);
    expect(ui.lines.join("\n")).toContain("up to date");
  });

  it("fails --check and writes nothing when the output would change", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });
    const ui = fakeUi();

    const code = await runCli(["--root", root, "--check"], ui);

    expect(code).toBe(1);
    expect(ui.lines.join("\n")).toContain("are out of date");
    await expect(readText(path.join(root, "manifest.json"))).rejects.toThrow();
  });

  it("fails --check after an asset was added", async () => {
    const root = await tree({ "features/board/assets/cell.png": pngBytes(64, 64) });

    await runCli(["--root", root], fakeUi());
    await writeFile(path.join(root, "features", "board", "assets", "gem.png"), pngBytes(16, 16));

    const ui = fakeUi();

    expect(await runCli(["--root", root, "--check"], ui)).toBe(1);
    expect(ui.lines.join("\n")).toContain("assets.ts");
  });

  it("warns about an ignored file", async () => {
    const root = await tree({
      "features/ui/assets/panel.png": pngBytes(16, 16),
      "features/ui/assets/notes.md": "text"
    });
    const ui = fakeUi();

    await runCli(["--root", root], ui);

    expect(ui.lines.join("\n")).toContain('warn ignored "features/ui/assets/notes.md"');
  });

  it("reports a scan problem and writes nothing", async () => {
    const root = await tree({ "features/ui/assets/panel.v2.png": pngBytes(16, 16) });
    const ui = fakeUi();

    const code = await runCli(["--root", root], ui);

    expect(code).toBe(1);
    expect(ui.lines.join("\n")).toContain("error [game] assets: the scan found 1 problem.");
    await expect(readText(path.join(root, "manifest.json"))).rejects.toThrow();
  });

  it("refuses an unknown flag", async () => {
    const ui = fakeUi();

    expect(await runCli(["--sizes"], ui)).toBe(1);
    expect(ui.lines.join("\n")).toContain('error [game] assets: unknown option "--sizes".');
  });

  it("refuses an option without its value", async () => {
    const ui = fakeUi();

    expect(await runCli(["--root", "--check"], ui)).toBe(1);
    expect(ui.lines.join("\n")).toContain('"--root" needs a path');
  });

  it("refuses a trailing option without its value", async () => {
    const ui = fakeUi();

    expect(await runCli(["--keys"], ui)).toBe(1);
    expect(ui.lines.join("\n")).toContain('"--keys" needs a path');
  });

  it("prints through the branded console when no console is passed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await runCli(["--sizes"])).toBe(1);
    expect(error).toHaveBeenCalled();
  });
});
