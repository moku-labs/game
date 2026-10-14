import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { FeatureOwner } from "../../src/project/features";
import { findFeatureOwners, findFeatureUnits, ownerOf } from "../../src/project/features";

// ---------------------------------------------------------------------------
// Unit test: the feature folders of a game, found on temp folder trees. Each
// test writes a tiny tree (a key ending in "/" is an empty folder) and reads
// what `findFeatureOwners` and `findFeatureUnits` answer.
// ---------------------------------------------------------------------------

/** All temp games of this file, removed after the file. */
const base = mkdtempSync(path.join(tmpdir(), "moku-features-"));

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A door that imports nothing: its text never matters to the owner rules. */
const DOOR = 'export const feature = "door";\n';

/** Tells whether the tests run as root, for whom a folder without permissions is still readable. */
const asRoot = process.getuid?.() === 0;

/**
 * Writes a game tree into a fresh temp folder.
 *
 * @param files - Root-relative paths and their text; a path ending in "/" is an empty folder.
 * @returns The game folder.
 */
function game(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(base, "game-"));
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, file);
    if (file.endsWith("/")) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return root;
}

/**
 * The folders of a result, in its order.
 *
 * @param owners - The owners or units.
 * @returns Their `dir`s.
 */
function dirs(owners: readonly FeatureOwner[]): string[] {
  return owners.map(owner => owner.dir);
}

/**
 * The door of an owner that imports a sub-feature and lists it.
 *
 * @param source - The import source of the sub-feature.
 * @returns The door's text.
 */
function listingDoor(source: string): string {
  return [
    'import { defineFeature } from "@moku-labs/game";',
    `import { kitFeature } from "${source}";`,
    "",
    'export const episodesFeature = defineFeature("episodes", {',
    "  features: [kitFeature]",
    "});",
    ""
  ].join("\n");
}

describe("findFeatureOwners", () => {
  it("finds every folder of features/ as an owner, with or without a door", () => {
    const root = game({
      "features/home/index.ts": DOOR,
      "features/board/": "",
      "features/notes.md": "# not a feature"
    });

    expect(findFeatureOwners(root)).toStrictEqual([
      {
        name: "board",
        dir: "features/board",
        depth: 0,
        resources: { assets: false, strings: false }
      },
      { name: "home", dir: "features/home", depth: 0, resources: { assets: false, strings: false } }
    ]);
  });

  it("finds a folder with a door and assets/ inside a feature as a sub-feature, with its parent and depth 1", () => {
    const root = game({
      "features/episodes/index.ts": DOOR,
      "features/episodes/ep01/index.ts": DOOR,
      "features/episodes/ep01/assets/room.png": ""
    });

    expect(findFeatureOwners(root)).toStrictEqual([
      {
        name: "episodes",
        dir: "features/episodes",
        depth: 0,
        resources: { assets: false, strings: false }
      },
      {
        name: "ep01",
        dir: "features/episodes/ep01",
        parent: "episodes",
        depth: 1,
        resources: { assets: true, strings: false }
      }
    ]);
  });

  it("also qualifies a folder by assets.ts alone and by strings/ alone, and index.tsx as the door", () => {
    const root = game({
      "features/home/byAssetsFile/index.ts": DOOR,
      "features/home/byAssetsFile/assets.ts": "export {};",
      "features/home/byStrings/index.ts": DOOR,
      "features/home/byStrings/strings/en.json": "{}",
      "features/home/byTsx/index.tsx": DOOR,
      "features/home/byTsx/assets/room.png": ""
    });

    expect(dirs(findFeatureOwners(root))).toStrictEqual([
      "features/home",
      "features/home/byAssetsFile",
      "features/home/byStrings",
      "features/home/byTsx"
    ]);
  });

  it("does not take a folder with a door but no resources, nor resources without a door", () => {
    const root = game({
      "features/home/index.ts": DOOR,
      "features/home/helpers/index.ts": DOOR,
      "features/home/art/assets/room.png": "",
      "features/home/art/strings/en.json": "{}",
      "features/home/art/assets.ts": "export {};"
    });

    expect(dirs(findFeatureOwners(root))).toStrictEqual(["features/home"]);
  });

  it("never takes a kind folder or a dot folder, even with a door and assets", () => {
    const kinds = [
      "flow",
      "views",
      "rules",
      "styles",
      "motion",
      "world",
      "effects",
      "nodes",
      "assets",
      "strings",
      "content",
      "__tests__",
      ".cache"
    ];
    const files: Record<string, string> = {
      "features/home/tools/index.ts": DOOR,
      "features/home/tools/assets/a.png": ""
    };
    for (const kind of kinds) {
      files[`features/home/${kind}/index.ts`] = DOOR;
      files[`features/home/${kind}/assets/a.png`] = "";
    }

    expect(dirs(findFeatureOwners(game(files)))).toStrictEqual([
      "features/home",
      "features/home/tools"
    ]);
  });

  it("does not descend into a folder that is not a sub-feature", () => {
    const root = game({
      "features/home/widgets/ep01/index.ts": DOOR,
      "features/home/widgets/ep01/assets/room.png": "",
      "features/home/views/ep02/index.ts": DOOR,
      "features/home/views/ep02/assets/room.png": ""
    });

    expect(dirs(findFeatureOwners(root))).toStrictEqual(["features/home"]);
  });

  it("finds sub-features of sub-features, depth first, parent before children, siblings in scanner order", () => {
    const root = game({
      "features/Zed/": "",
      "features/home/": "",
      "features/episodes/index.ts": DOOR,
      "features/episodes/ep02/index.ts": DOOR,
      "features/episodes/ep02/assets/room.png": "",
      "features/episodes/episodes-kit/index.ts": DOOR,
      "features/episodes/episodes-kit/assets.ts": "export {};",
      "features/episodes/ep01/index.ts": DOOR,
      "features/episodes/ep01/strings/en.json": "{}",
      "features/episodes/ep01/extra/index.ts": DOOR,
      "features/episodes/ep01/extra/assets/room.png": ""
    });

    expect(
      findFeatureOwners(root).map(owner => [owner.dir, owner.parent, owner.depth])
    ).toStrictEqual([
      ["features/episodes", undefined, 0],
      ["features/episodes/ep01", "episodes", 1],
      ["features/episodes/ep01/extra", "ep01", 2],
      ["features/episodes/ep02", "episodes", 1],
      ["features/episodes/episodes-kit", "episodes", 1],
      ["features/home", undefined, 0],
      ["features/Zed", undefined, 0]
    ]);
  });

  it("takes the features folder name from its second argument, and writes it into dir", () => {
    const root = game({
      "features/home/": "",
      "src/features/episodes/index.ts": DOOR,
      "src/features/episodes/ep01/index.ts": DOOR,
      "src/features/episodes/ep01/assets/room.png": ""
    });

    expect(dirs(findFeatureOwners(root, "src/features"))).toStrictEqual([
      "src/features/episodes",
      "src/features/episodes/ep01"
    ]);
  });

  it("answers [] for a missing features folder and for a file in its place", () => {
    expect(findFeatureOwners(game({ "index.ts": DOOR }))).toStrictEqual([]);
    expect(findFeatureOwners(game({ features: "not a folder" }))).toStrictEqual([]);
  });

  it.skipIf(asRoot)(
    "counts a folder it cannot read as empty: no features at the top, no sub-feature below",
    () => {
      const closedTop = game({ "features/home/": "" });
      const closedChild = game({
        "features/home/ep01/index.ts": DOOR,
        "features/home/ep01/assets/room.png": ""
      });
      chmodSync(path.join(closedTop, "features"), 0o000);
      chmodSync(path.join(closedChild, "features/home/ep01"), 0o000);
      try {
        expect(findFeatureOwners(closedTop)).toStrictEqual([]);
        expect(dirs(findFeatureOwners(closedChild))).toStrictEqual(["features/home"]);
      } finally {
        chmodSync(path.join(closedTop, "features"), 0o755);
        chmodSync(path.join(closedChild, "features/home/ep01"), 0o755);
      }
    }
  );

  it("throws for a name used by two folders, naming both and the <parent>-<name> fix", () => {
    const nested = game({
      "features/episodes/kit/index.ts": DOOR,
      "features/episodes/kit/assets/a.png": "",
      "features/minigames/kit/index.ts": DOOR,
      "features/minigames/kit/strings/en.json": "{}"
    });
    const topAndNested = game({
      "features/kit/": "",
      "features/episodes/kit/index.ts": DOOR,
      "features/episodes/kit/assets/a.png": ""
    });

    expect(() => findFeatureOwners(nested)).toThrow(
      '[game] features: the feature name "kit" is taken by two folders: features/episodes/kit and features/minigames/kit.\n' +
        "  A feature is named like its folder, once in the game. Name a shared sub-feature after its parent: minigames-kit."
    );
    expect(() => findFeatureOwners(topAndNested)).toThrow(
      '[game] features: the feature name "kit" is taken by two folders: features/episodes/kit and features/kit.\n' +
        "  A feature is named like its folder, once in the game. Name a shared sub-feature after its parent: episodes-kit."
    );
  });

  it("does not follow a symlinked folder", () => {
    const outside = game({ "ep01/index.ts": DOOR, "ep01/assets/room.png": "" });
    const root = game({ "features/home/index.ts": DOOR });
    symlinkSync(path.join(outside, "ep01"), path.join(root, "features/linked"));
    symlinkSync(path.join(outside, "ep01"), path.join(root, "features/home/ep01"));

    expect(dirs(findFeatureOwners(root))).toStrictEqual(["features/home"]);
  });

  it("records the resources of every owner, a top-level one without any included", () => {
    const root = game({
      "features/board/index.ts": DOOR,
      "features/home/assets/a.png": "",
      "features/home/strings/en.json": "{}",
      "features/home/byAssetsFile/index.ts": DOOR,
      "features/home/byAssetsFile/assets.ts": "export {};",
      "features/home/byStrings/index.tsx": DOOR,
      "features/home/byStrings/strings/en.json": "{}"
    });

    expect(findFeatureOwners(root).map(owner => [owner.name, owner.resources])).toStrictEqual([
      ["board", { assets: false, strings: false }],
      ["home", { assets: true, strings: true }],
      ["byAssetsFile", { assets: true, strings: false }],
      ["byStrings", { assets: false, strings: true }]
    ]);
  });
});

describe("findFeatureUnits", () => {
  it.each([
    "./kit",
    "./kit/index",
    "./kit/index.ts"
  ])("adds a code-only folder the owner's door imports from %s and lists in features: [...], with no resources and its parent", source => {
    const root = game({
      "features/home/": "",
      "features/episodes/index.ts": listingDoor(source),
      "features/episodes/kit/index.ts": DOOR,
      "features/episodes/ep01/index.ts": DOOR,
      "features/episodes/ep01/assets/room.png": "",
      "features/episodes/zone/index.ts": DOOR,
      "features/episodes/zone/strings/en.json": "{}"
    });
    const units = findFeatureUnits(root);

    expect(dirs(units)).toStrictEqual([
      "features/episodes",
      "features/episodes/ep01",
      "features/episodes/kit",
      "features/episodes/zone",
      "features/home"
    ]);
    expect(units.find(unit => unit.name === "kit")).toStrictEqual({
      name: "kit",
      dir: "features/episodes/kit",
      parent: "episodes",
      depth: 1,
      resources: { assets: false, strings: false }
    });
  });

  it("reads the local names of a default, a namespace and an aliased import, and an index.tsx door", () => {
    const door = [
      'import { defineFeature } from "@moku-labs/game";',
      'import aFeature from "./a";',
      'import * as b from "./b";',
      'import { cFeature as see } from "./c.js";',
      'import { dFeature as dee } from "./d";',
      'export const episodesFeature = defineFeature("episodes", {',
      '  "features": [aFeature, b.bFeature, see, dFeature]',
      "});"
    ].join("\n");
    const root = game({
      "features/episodes/index.tsx": door,
      "features/episodes/a/index.ts": DOOR,
      "features/episodes/b/index.tsx": DOOR,
      "features/episodes/c/index.ts": DOOR,
      "features/episodes/d/index.ts": DOOR
    });

    expect(dirs(findFeatureUnits(root))).toStrictEqual([
      "features/episodes",
      "features/episodes/a",
      "features/episodes/b",
      "features/episodes/c"
    ]);
  });

  it("does not add a folder that is imported but not listed, listed but imported from elsewhere, imported only as a type, or listed only inside a comment", () => {
    const door = [
      'import { defineFeature } from "@moku-labs/game";',
      'import { aFeature } from "./a";',
      'import { bFeature } from "./shared/b";',
      'import type { cFeature } from "./c";',
      'import { type eFeature } from "./e";',
      'import { dFeature } from "./d";',
      'import { fFeature } from "./f";',
      'import { kitFeature } from "./kit";',
      "",
      'export const episodesFeature = defineFeature("episodes", {',
      "  // features: [dFeature],",
      "  /* features: [fFeature], */",
      "  features: [bFeature, cFeature, eFeature, kitFeature]",
      "});",
      "export const unused = [aFeature, dFeature, fFeature];"
    ].join("\n");
    const files: Record<string, string> = {
      "features/episodes/index.ts": door,
      "features/episodes/b/index.ts": DOOR
    };
    for (const folder of ["a", "c", "d", "e", "f", "kit"])
      files[`features/episodes/${folder}/index.ts`] = DOOR;

    expect(dirs(findFeatureUnits(game(files)))).toStrictEqual([
      "features/episodes",
      "features/episodes/kit"
    ]);
  });

  it("keeps a flat game's units equal to its owners: a barrel folder features/hud/helpers/index.ts that no features: [...] lists is no unit", () => {
    const root = game({
      "features/hud/index.ts": [
        'import { defineFeature } from "@moku-labs/game";',
        'import { clamp } from "./helpers";',
        'export const hudFeature = defineFeature("hud", { logic: [clamp] });'
      ].join("\n"),
      "features/hud/helpers/index.ts": "export const clamp = 1;",
      "features/home/index.ts": DOOR
    });

    expect(dirs(findFeatureUnits(root))).toStrictEqual(["features/home", "features/hud"]);
    expect(findFeatureUnits(root)).toStrictEqual(findFeatureOwners(root));
  });

  it("does not search inside a code-only sub-feature, and throws the clash error when a code-only name is also an owner's", () => {
    const leaf = game({
      "features/episodes/index.ts": listingDoor("./kit"),
      "features/episodes/kit/index.ts": listingDoor("./inner"),
      "features/episodes/kit/inner/index.ts": DOOR,
      "features/episodes/kit/inner/assets/room.png": ""
    });
    const clash = game({
      "features/kit/": "",
      "features/episodes/index.ts": listingDoor("./kit"),
      "features/episodes/kit/index.ts": DOOR
    });

    expect(dirs(findFeatureUnits(leaf))).toStrictEqual([
      "features/episodes",
      "features/episodes/kit"
    ]);
    expect(() => findFeatureUnits(clash)).toThrow(
      '[game] features: the feature name "kit" is taken by two folders: features/episodes/kit and features/kit.\n' +
        "  A feature is named like its folder, once in the game. Name a shared sub-feature after its parent: episodes-kit."
    );
  });

  it.skipIf(asRoot)("counts a door it cannot read as listing nothing", () => {
    const root = game({
      "features/episodes/index.ts": listingDoor("./kit"),
      "features/episodes/kit/index.ts": DOOR
    });
    const door = path.join(root, "features/episodes/index.ts");
    chmodSync(door, 0o000);
    try {
      expect(dirs(findFeatureUnits(root))).toStrictEqual(["features/episodes"]);
    } finally {
      chmodSync(door, 0o644);
    }
  });
});

describe("ownerOf", () => {
  it("answers the deepest owner of a path, on a segment boundary, and undefined outside", () => {
    const owners = [
      { dir: "features/episodes" },
      { dir: "features/episodes/ep01" },
      { dir: "features/home" }
    ];

    expect(ownerOf(owners, "features/episodes/ep01/flow/story.ts")?.dir).toBe(
      "features/episodes/ep01"
    );
    expect(ownerOf(owners, "features/episodes/flow/main.ts")?.dir).toBe("features/episodes");
    expect(ownerOf(owners, "features/episodes")?.dir).toBe("features/episodes");
    expect(ownerOf(owners, "features/episodes-kit/x.ts")).toBeUndefined();
    expect(ownerOf(owners, "src/index.ts")).toBeUndefined();
  });
});
