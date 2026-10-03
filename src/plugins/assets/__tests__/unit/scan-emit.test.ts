import { describe, expect, it } from "vitest";
import { parseManifest } from "../../manifest";
import { emitKeys, emitManifest } from "../../scan/emit";
import type { Manifest, ManifestBundle } from "../../types";

const manifest: Manifest = {
  version: 1,
  bundles: {
    ui: {
      feature: "ui",
      tier: "core",
      mb: 0.188,
      files: [
        {
          key: "ui.panel",
          path: "features/ui/assets/panel{nine=48}.png",
          width: 256,
          height: 128,
          mb: 0.125,
          nine: { left: 48, top: 48, right: 48, bottom: 48 }
        },
        {
          key: "ui.button.primary",
          path: "features/ui/assets/button/primary.png",
          width: 128,
          height: 128,
          mb: 0.063
        }
      ]
    },
    board: { feature: "board", tier: "scene", mb: 0, files: [] }
  }
};

const empty: Manifest = { version: 1, bundles: {} };

describe("emitManifest", () => {
  it("writes the version, sorted bundles and sorted files with a trailing newline", () => {
    const text = emitManifest(manifest);

    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toBe(`{
  "version": 1,
  "bundles": {
    "board": {
      "feature": "board",
      "tier": "scene",
      "mb": 0,
      "files": []
    },
    "ui": {
      "feature": "ui",
      "tier": "core",
      "mb": 0.188,
      "files": [
        {
          "key": "ui.button.primary",
          "path": "features/ui/assets/button/primary.png",
          "width": 128,
          "height": 128,
          "mb": 0.063
        },
        {
          "key": "ui.panel",
          "path": "features/ui/assets/panel{nine=48}.png",
          "width": 256,
          "height": 128,
          "mb": 0.125,
          "nine": {
            "left": 48,
            "top": 48,
            "right": 48,
            "bottom": 48
          }
        }
      ]
    }
  }
}
`);
  });

  it("is read back by the runtime parser", () => {
    const parsed = parseManifest(JSON.parse(emitManifest(manifest)) as unknown);

    expect(parsed.bundles.ui?.files[1]?.nine).toEqual({
      left: 48,
      top: 48,
      right: 48,
      bottom: 48
    });
  });

  it("writes the atlas frame of a file that carries one, after its nine", () => {
    const withAtlas: Manifest = {
      version: 1,
      bundles: {
        ui: {
          feature: "ui",
          tier: "core",
          mb: 0,
          files: [
            {
              key: "ui.panel",
              path: "p.png",
              width: 8,
              height: 8,
              mb: 0,
              nine: { left: 1, top: 1, right: 1, bottom: 1 },
              atlas: { page: "ui/main-0", x: 0, y: 0, width: 8, height: 8 }
            }
          ]
        }
      }
    };
    const text = emitManifest(withAtlas);

    expect(text.indexOf('"nine"')).toBeLessThan(text.indexOf('"atlas"'));
    expect(text).toContain('"page": "ui/main-0"');
  });

  it("writes an empty game as version 1 with no bundles", () => {
    expect(emitManifest(empty)).toBe('{\n  "version": 1,\n  "bundles": {}\n}\n');
  });
});

/** The packed manifest example of the spec (09-assets Delta 8), fields in the order it lists. */
const packedExample = {
  version: 2,
  bundles: {
    ui: {
      feature: "ui",
      tier: "core",
      mb: 8.865,
      pages: [
        { id: "ui/fx-0", path: "ui/fx-0-2a7f9c04e1.webp", width: 595, height: 516, mb: 1.171 },
        { id: "ui/main-0", path: "ui/main-0-3b1d55a0c9.webp", width: 966, height: 1365, mb: 5.03 }
      ],
      files: [
        {
          key: "ui.bg-splash",
          path: "ui/ui.bg-splash-5e0a71bd42.webp",
          width: 1024,
          height: 1536,
          mb: 6
        },
        { key: "ui.click", path: "ui/ui.click-9c4e2b7a10.mp3", kind: "audio", mb: 0.012 },
        {
          key: "ui.font-body",
          path: "ui/ui.font-body-7d2c90f1ab.fnt",
          kind: "font",
          mb: 1,
          pages: [{ path: "ui/ui.font-body-0-c81f3e2d55.png", width: 512, height: 512, mb: 1 }]
        },
        {
          key: "ui.fx-sparkle",
          width: 85,
          height: 96,
          mb: 0,
          atlas: { page: "ui/fx-0", x: 2, y: 2, width: 85, height: 96 }
        },
        {
          key: "ui.panel",
          width: 256,
          height: 128,
          mb: 0,
          nine: { left: 48, top: 48, right: 48, bottom: 48 },
          atlas: { page: "ui/main-0", x: 583, y: 595, width: 256, height: 128 }
        }
      ]
    }
  }
};

describe("emitManifest of a packed manifest", () => {
  it("round-trips the v2 example byte for byte", () => {
    const text = `${JSON.stringify(packedExample, undefined, 2)}\n`;

    expect(emitManifest(parseManifest(JSON.parse(text) as unknown))).toBe(text);
  });

  it("writes no path for a packed texture and keeps the version", () => {
    const text = emitManifest(parseManifest(packedExample));
    const sparkle = text.slice(text.indexOf('"ui.fx-sparkle"'), text.indexOf('"ui.panel"'));

    expect(text.startsWith('{\n  "version": 2,')).toBe(true);
    expect(sparkle).not.toContain('"path"');
  });

  it("writes the pages sorted by id, between the bundle cost and its files", () => {
    const parsed = parseManifest(packedExample);
    const ui = parsed.bundles.ui as ManifestBundle;
    const reversed: Manifest = {
      ...parsed,
      bundles: { ui: { ...ui, pages: (ui.pages ?? []).toReversed() } }
    };
    const text = emitManifest(reversed);

    expect(text.indexOf('"ui/fx-0-')).toBeLessThan(text.indexOf('"ui/main-0-'));
    expect(text.indexOf('"mb": 8.865')).toBeLessThan(text.indexOf('"pages"'));
    expect(text.indexOf('"pages"')).toBeLessThan(text.indexOf('"files"'));
  });
});

describe("emitKeys", () => {
  it("writes the header, both unions and the nine-slice table", () => {
    expect(emitKeys(manifest)).toBe(`// generated by @moku-labs/game/assets, do not edit

export type AssetKey =
  | "ui.button.primary"
  | "ui.panel";

export type FontKey = never;

export type AudioKey = never;

export type BundleKey =
  | "board"
  | "ui";

export const nineSlice = {
  "ui.panel": { left: 48, top: 48, right: 48, bottom: 48 }
} as const;
`);
  });

  it("sorts the nine-slice table across bundles", () => {
    const borders = { left: 1, top: 2, right: 3, bottom: 4 };
    const two: Manifest = {
      version: 1,
      bundles: {
        ui: {
          feature: "ui",
          tier: "core",
          mb: 0,
          files: [{ key: "ui.panel", path: "p.png", width: 8, height: 8, mb: 0, nine: borders }]
        },
        board: {
          feature: "board",
          tier: "scene",
          mb: 0,
          files: [{ key: "board.slot", path: "s.png", width: 8, height: 8, mb: 0, nine: borders }]
        }
      }
    };

    expect(emitKeys(two)).toContain(
      '  "board.slot": { left: 1, top: 2, right: 3, bottom: 4 },\n' +
        '  "ui.panel": { left: 1, top: 2, right: 3, bottom: 4 }\n'
    );
  });

  it("writes the same keys for a packed manifest as for the dev one", () => {
    const packedKeys = emitKeys(parseManifest(packedExample));

    expect(packedKeys).toContain('  | "ui.fx-sparkle"');
    expect(packedKeys).toContain('export type FontKey =\n  | "ui.font-body";');
    expect(packedKeys).toContain('"ui.panel": { left: 48, top: 48, right: 48, bottom: 48 }');
  });

  it("writes never for an empty game", () => {
    expect(emitKeys(empty)).toBe(`// generated by @moku-labs/game/assets, do not edit

export type AssetKey = never;

export type FontKey = never;

export type AudioKey = never;

export type BundleKey = never;

export const nineSlice = {} as const;
`);
  });
});
