import { describe, expect, it } from "vitest";
import {
  atlasProblem,
  emptyManifest,
  fileUrl,
  indexKeys,
  nineOf,
  parseManifest,
  resolveBaseUrl
} from "../../manifest";
import type { ManifestFile } from "../../types";

const raw = {
  version: 1,
  bundles: {
    ui: {
      feature: "ui",
      tier: "core",
      mb: 0.188,
      files: [
        {
          key: "ui.button.primary",
          path: "features/ui/assets/button/primary.png",
          width: 128,
          height: 128,
          mb: 0.063
        },
        {
          key: "ui.panel",
          path: "features/ui/assets/panel{nine=48}.png",
          width: 256,
          height: 128,
          mb: 0.125,
          nine: { left: 48, top: 48, right: 48, bottom: 48 }
        }
      ]
    }
  }
};

describe("emptyManifest", () => {
  it("is version 1 with no bundles", () => {
    expect(emptyManifest()).toEqual({ version: 1, bundles: {} });
  });
});

describe("parseManifest", () => {
  it("reads a manifest and keeps the nine-slice metadata", () => {
    const manifest = parseManifest(raw);

    expect(Object.keys(manifest.bundles)).toEqual(["ui"]);
    expect(manifest.bundles.ui?.files[1]?.nine).toEqual({
      left: 48,
      top: 48,
      right: 48,
      bottom: 48
    });
  });

  it("ignores unknown fields", () => {
    const manifest = parseManifest({
      version: 1,
      extra: true,
      bundles: { ui: { feature: "ui", tier: "core", mb: 0, files: [], sprites: 4 } }
    });

    expect(manifest.bundles.ui).toEqual({ feature: "ui", tier: "core", mb: 0, files: [] });
  });

  it("refuses another version", () => {
    expect(() => parseManifest({ version: 2, bundles: {} })).toThrow(
      "[game] assets: manifest version 2 is not supported (expected 1)."
    );
  });

  it("refuses a value that is not a manifest", () => {
    expect(() => parseManifest("nope")).toThrow("[game] assets: the manifest is not an object.");
  });

  it("refuses an unknown tier", () => {
    expect(() =>
      parseManifest({
        version: 1,
        bundles: { ui: { feature: "ui", tier: "huge", mb: 0, files: [] } }
      })
    ).toThrow('[game] assets: bundle "ui" has the unknown tier "huge".');
  });

  it("sorts bundles by name and files by key", () => {
    const manifest = parseManifest({
      version: 1,
      bundles: {
        ui: {
          feature: "ui",
          tier: "core",
          mb: 0,
          files: [
            { key: "ui.b", path: "b.png", width: 1, height: 1, mb: 0 },
            { key: "ui.a", path: "a.png", width: 1, height: 1, mb: 0 }
          ]
        },
        board: { feature: "board", tier: "scene", mb: 0, files: [] }
      }
    });

    expect(Object.keys(manifest.bundles)).toEqual(["board", "ui"]);
    expect(manifest.bundles.ui?.files.map(file => file.key)).toEqual(["ui.a", "ui.b"]);
  });
});

describe("indexKeys", () => {
  it("maps every asset key to its bundle", () => {
    const index = indexKeys(parseManifest(raw));

    expect(index.get("ui.panel")).toBe("ui");
    expect(index.get("ui.button.primary")).toBe("ui");
    expect(index.get("board.cell")).toBeUndefined();
  });
});

describe("resolveBaseUrl", () => {
  it("uses the configured prefix as it is", () => {
    expect(resolveBaseUrl("https://cdn.example/v3/", "/assets/manifest.json")).toBe(
      "https://cdn.example/v3/"
    );
  });

  it("adds the missing slash to the configured prefix", () => {
    expect(resolveBaseUrl("https://cdn.example/v3", undefined)).toBe("https://cdn.example/v3/");
  });

  it("falls back to the folder of the manifest URL", () => {
    expect(resolveBaseUrl(undefined, "/assets/manifest.json")).toBe("/assets/");
  });

  it("falls back to the root for an inline manifest", () => {
    expect(resolveBaseUrl(undefined, emptyManifest())).toBe("/");
  });
});

describe("fileUrl", () => {
  it("joins the base and the path", () => {
    expect(fileUrl("/assets/", "features/ui/assets/panel.png")).toBe(
      "/assets/features/ui/assets/panel.png"
    );
  });

  it("does not double the slash", () => {
    expect(fileUrl("/assets/", "/features/ui/panel.png")).toBe("/assets/features/ui/panel.png");
  });
});

describe("nineOf", () => {
  it("turns the four numbers into the tuple the renderer takes", () => {
    const file = parseManifest(raw).bundles.ui?.files[1] as ManifestFile;

    expect(nineOf(file)).toEqual({ nine: [48, 48, 48, 48] });
  });

  it("is undefined for a plain file", () => {
    const file = parseManifest(raw).bundles.ui?.files[0] as ManifestFile;

    expect(nineOf(file)).toBeUndefined();
  });
});

describe("atlasProblem", () => {
  it("refuses a file packed in an atlas and names it", () => {
    const files: ManifestFile[] = [
      {
        key: "ui.panel",
        path: "features/ui/assets/panel.png",
        width: 1,
        height: 1,
        mb: 0,
        atlas: { page: "ui-0.png", x: 0, y: 0, width: 1, height: 1 }
      }
    ];

    expect(atlasProblem("ui", files)).toBe(
      '[game] assets: file "features/ui/assets/panel.png" of bundle "ui" is packed in an atlas, which this version cannot load.\n  Rebuild the manifest with "bun run assets:keys".'
    );
  });

  it("is undefined for loose files", () => {
    expect(atlasProblem("ui", parseManifest(raw).bundles.ui?.files ?? [])).toBeUndefined();
  });
});
