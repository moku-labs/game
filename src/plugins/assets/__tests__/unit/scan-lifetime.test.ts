import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ScanResult, scanAssets } from "../../scan/scan";
import { audioBytes, bmfontText, makeTree, pngBytes, removeTree } from "./scan-fixtures";

// ---------------------------------------------------------------------------
// The scanner reads `release` and `mipmaps` of a declared bundle, checks them
// and writes them: `release: "leave"` on the bundle, `mips: true` and the
// chain megabytes on every texture a bundle's mipmaps select.
// ---------------------------------------------------------------------------

/** The door of a sub-feature. */
const DOOR = "export {};\n";

const roots: string[] = [];

/**
 * Writes the episode tree with one `assets.ts` of `features/episodes/ep01`.
 *
 * @param map - The source of the bundle map the description exports.
 * @param extra - More files of the tree.
 * @returns The root of the tree.
 */
async function episode(
  map: string,
  extra: Record<string, string | Uint8Array> = {}
): Promise<string> {
  const root = await makeTree({
    "features/episodes/index.ts": DOOR,
    "features/episodes/ep01/index.ts": DOOR,
    "features/episodes/ep01/assets.ts": `export const a = { kind: "bundles", map: ${map} };\n`,
    "features/episodes/ep01/assets/items/cup.png": pngBytes(336, 288),
    "features/episodes/ep01/assets/ward/room.png": pngBytes(256, 128),
    ...extra
  });

  roots.push(root);

  return root;
}

/**
 * Scans a tree without writing.
 *
 * @param root - The game root.
 * @returns What the scan produced.
 */
async function scan(root: string): Promise<ScanResult> {
  return await scanAssets({
    root,
    manifest: path.join(root, "out", "manifest.json"),
    keys: path.join(root, "out", "assets.ts"),
    write: false
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => removeTree(root)));
});

describe("release", () => {
  it('writes release "leave" on the bundle and leaves "budget" out', async () => {
    const leave = await scan(await episode('{ ep01: { tier: "lazy", release: "leave" } }'));
    const budget = await scan(await episode('{ ep01: { tier: "lazy", release: "budget" } }'));

    expect(leave.manifest.bundles.ep01?.release).toBe("leave");
    expect(budget.manifest.bundles.ep01).not.toHaveProperty("release");
  });

  it("refuses an unknown release", async () => {
    await expect(
      scan(await episode('{ ep01: { tier: "lazy", release: "later" } }'))
    ).rejects.toThrow('the bundle "ep01" has the unknown release "later". Use budget or leave.');
  });

  it('refuses release "leave" on a tier that stays for the whole session', async () => {
    await expect(
      scan(await episode('{ ep01: { tier: "core", release: "leave" } }'))
    ).rejects.toThrow(
      'the bundle "ep01" is tier "core", which stays for the whole session: release "leave" needs scene, feature or lazy.'
    );
  });
});

describe("mipmaps", () => {
  it("refuses a mipmaps value that is neither true nor a list of globs", async () => {
    await expect(
      scan(await episode('{ ep01: { tier: "lazy", mipmaps: "items/**" } }'))
    ).rejects.toThrow(
      'the bundle "ep01" has mipmaps "items/**": use true or a list of globs relative to assets/.'
    );
  });

  it("marks the textures a glob matches with mips and the chain megabytes, and no other", async () => {
    const { manifest, notes } = await scan(
      await episode('{ ep01: { tier: "lazy", mipmaps: ["items/**"] } }')
    );

    expect(manifest.bundles.ep01?.files).toEqual([
      {
        key: "ep01.items.cup",
        path: "features/episodes/ep01/assets/items/cup.png",
        width: 336,
        height: 288,
        mb: 0.492,
        mips: true
      },
      {
        key: "ep01.ward.room",
        path: "features/episodes/ep01/assets/ward/room.png",
        width: 256,
        height: 128,
        mb: 0.125
      }
    ]);
    expect(manifest.bundles.ep01?.mb).toBe(0.617);
    expect(notes).toEqual([]);
  });

  it("marks every texture with mipmaps: true, and no font or sound", async () => {
    const { manifest } = await scan(
      await episode('{ ep01: { tier: "lazy", mipmaps: true } }', {
        "features/episodes/ep01/assets/body.fnt": bmfontText("body_0.png"),
        "features/episodes/ep01/assets/body_0.png": pngBytes(64, 64),
        "features/episodes/ep01/assets/step.mp3": audioBytes(2048)
      })
    );
    const marked = manifest.bundles.ep01?.files
      .filter(file => file.mips === true)
      .map(file => file.key);

    expect(marked).toEqual(["ep01.items.cup", "ep01.ward.room"]);
  });

  it("applies a glob of one bundle to the files of that bundle only, and notes it when it matches none", async () => {
    // `ep01.extra` takes the ward; its glob names the items, which stay in `ep01`.
    const { manifest, notes } = await scan(
      await episode(
        '{ ep01: { tier: "lazy" }, "ep01.extra": { tier: "lazy", files: ["ward/*.png"], mipmaps: ["items/**"] } }'
      )
    );

    expect(manifest.bundles.ep01?.files[0]).not.toHaveProperty("mips");
    expect(manifest.bundles["ep01.extra"]?.files[0]).not.toHaveProperty("mips");
    expect(notes).toEqual([
      'the mipmaps glob "items/**" of the bundle "ep01.extra" matches no texture of it.'
    ]);
  });
});
