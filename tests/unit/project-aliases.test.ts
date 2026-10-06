import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { type AliasMap, aliasTargets, readAliases, sameAliases } from "../../src/project/aliases";
import { loadTypeScript, type TypeScript } from "../../src/project/typescript";

// ---------------------------------------------------------------------------
// Unit test: the tsconfig `paths` of a game. `readAliases` reads a temp root
// with the real TypeScript; `aliasTargets` and `sameAliases` are pure and run
// on alias maps written by hand.
// ---------------------------------------------------------------------------

/** The `paths` of the v15 layout, as `tests/fixtures/layout-game/tsconfig.json` declares them. */
const V15_PATHS = {
  "@core/*": ["./core/*"],
  "@shared": ["./shared/index.ts"],
  "@shared/rules": ["./shared/rules/index.ts"],
  "@features": ["./features/index.ts"],
  "@features/*": ["./features/*/index.ts"],
  "@plugins": ["./plugins/index.ts"],
  "@generated/*": ["./generated/*"],
  "@tests/*": ["./tests/*"]
};

/** The patterns `readAliases` makes of the v15 paths. */
const V15_PATTERNS = [
  { prefix: "@core/", suffix: "", targets: ["core/*"] },
  { prefix: "@shared", targets: ["shared/index.ts"] },
  { prefix: "@shared/rules", targets: ["shared/rules/index.ts"] },
  { prefix: "@features", targets: ["features/index.ts"] },
  { prefix: "@features/", suffix: "", targets: ["features/*/index.ts"] },
  { prefix: "@plugins", targets: ["plugins/index.ts"] },
  { prefix: "@generated/", suffix: "", targets: ["generated/*"] },
  { prefix: "@tests/", suffix: "", targets: ["tests/*"] }
];

/** The v15 alias map, as `readAliases` reads it from a root tsconfig.json. */
const V15: AliasMap = { file: "tsconfig.json", sources: ["tsconfig.json"], patterns: V15_PATTERNS };

let ts: TypeScript;

beforeAll(async () => {
  ts = await loadTypeScript();
});

/** The temp folders of this file, removed after each test. */
const made: string[] = [];

/**
 * Write a game root into a fresh temp folder.
 *
 * @param files - Root-relative path to text.
 * @returns The real path of the root.
 */
function writeRoot(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "moku-project-aliases-")));

  made.push(root);

  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }

  return root;
}

/**
 * A tsconfig with `paths` and nothing else.
 *
 * @param paths - The `paths` block.
 * @returns The JSON text.
 */
function tsconfigOf(paths: object): string {
  return JSON.stringify({ compilerOptions: { paths } });
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readAliases", () => {
  it("reads the paths of a tsconfig as root-relative patterns, `*` kept", async () => {
    const root = writeRoot({ "tsconfig.json": tsconfigOf(V15_PATHS) });

    expect(await readAliases(ts, root, "tsconfig.json")).toEqual(V15);
  });

  it("merges a relative extends written as JSONC, comments and trailing commas", async () => {
    const root = writeRoot({
      "tsconfig.json": `{
  // The game config: aliases come from the base.
  "extends": "./configs/base.json",
  "compilerOptions": { "jsx": "react-jsx", },
}
`,
      "configs/base.json": `{
  /* Shared by every game of the folder. */
  "compilerOptions": { "paths": { "@core/*": ["./core/*"], }, },
}
`
    });

    expect(await readAliases(ts, root, "tsconfig.json")).toEqual({
      file: "tsconfig.json",
      sources: ["tsconfig.json", "configs/base.json"],
      patterns: [{ prefix: "@core/", suffix: "", targets: ["core/*"] }]
    });
  });

  it("resolves the targets against baseUrl when one is set", async () => {
    const root = writeRoot({
      "tsconfig.game.json": JSON.stringify({
        compilerOptions: { baseUrl: "./src", paths: { "@core/*": ["core/*"] } }
      })
    });

    const aliases = await readAliases(ts, root, "tsconfig.game.json");

    expect(aliases?.patterns).toEqual([{ prefix: "@core/", suffix: "", targets: ["src/core/*"] }]);
  });

  it("answers undefined for a missing file, a file without paths and an empty paths block", async () => {
    const root = writeRoot({
      "plain.json": JSON.stringify({ compilerOptions: { strict: true } }),
      "empty.json": tsconfigOf({}),
      "blank.json": ""
    });

    expect(await readAliases(ts, root, "tsconfig.json")).toBeUndefined();
    expect(await readAliases(ts, root, "plain.json")).toBeUndefined();
    expect(await readAliases(ts, root, "empty.json")).toBeUndefined();
    expect(await readAliases(ts, root, "blank.json")).toBeUndefined();
  });

  it("lists an extended file that is not there among the sources, so its arrival is seen", async () => {
    const root = writeRoot({
      "tsconfig.json": JSON.stringify({
        extends: "./base.json",
        compilerOptions: { paths: { "@kit": ["./kit.ts"] } }
      })
    });

    const aliases = await readAliases(ts, root, "tsconfig.json");

    expect(aliases?.sources).toEqual(["tsconfig.json", "base.json"]);
  });

  it("keeps a target outside the root as written: no indexed file ever matches it", async () => {
    const root = writeRoot({ "tsconfig.json": tsconfigOf({ "@lib/*": ["../lib/*"] }) });

    const aliases = await readAliases(ts, root, "tsconfig.json");

    expect(aliases?.patterns).toEqual([{ prefix: "@lib/", suffix: "", targets: ["../lib/*"] }]);
  });

  it("drops a key or a target with two `*`, and a target that is not a string, as TypeScript does", async () => {
    const root = writeRoot({
      "tsconfig.json": tsconfigOf({
        "@two/*/*": ["two/*"],
        "@text": "text.ts",
        "@mixed/*": [1, "mixed/*", "mixed/*/*"],
        "@none": [2]
      })
    });

    const aliases = await readAliases(ts, root, "tsconfig.json");

    expect(aliases?.patterns).toEqual([{ prefix: "@mixed/", suffix: "", targets: ["mixed/*"] }]);
  });

  it("throws on a tsconfig that does not parse, naming the file and the place", async () => {
    const root = writeRoot({ "tsconfig.json": '{ "compilerOptions": { "paths": {} }\n' });

    await expect(readAliases(ts, root, "tsconfig.json")).rejects.toThrow(
      "[game] The tsconfig \"tsconfig.json\" does not parse: tsconfig.json:2:1 '}' expected.\n" +
        "  Fix the file, or name another one with the tsconfig option or --tsconfig."
    );
  });

  it("throws on an extended file that does not parse, naming that file", async () => {
    const root = writeRoot({
      "tsconfig.json": JSON.stringify({ extends: "./base.json" }),
      "base.json": '{ "compilerOptions": { "paths": {} }\n'
    });

    await expect(readAliases(ts, root, "tsconfig.json")).rejects.toThrow(
      "[game] The tsconfig \"tsconfig.json\" does not parse: base.json:2:1 '}' expected."
    );
  });

  it("takes no notice of what TypeScript reports beyond the syntax: an unknown option, no inputs", async () => {
    const root = writeRoot({
      "tsconfig.json": JSON.stringify({
        files: [],
        compilerOptions: { bogus: 1, paths: { "@kit": ["./kit.ts"] } }
      })
    });

    const aliases = await readAliases(ts, root, "tsconfig.json");

    expect(aliases?.patterns).toEqual([{ prefix: "@kit", targets: ["kit.ts"] }]);
  });
});

describe("aliasTargets", () => {
  it("maps the v15 specifiers to their targets, `*` filled", () => {
    const table: [string, string[]][] = [
      ["@core/kit", ["core/kit"]],
      ["@core/types", ["core/types"]],
      ["@shared", ["shared/index.ts"]],
      ["@shared/rules", ["shared/rules/index.ts"]],
      ["@features", ["features/index.ts"]],
      ["@features/orders", ["features/orders/index.ts"]],
      ["@features/home/flow/home", ["features/home/flow/home/index.ts"]],
      ["@plugins", ["plugins/index.ts"]],
      ["@generated/assets", ["generated/assets"]],
      ["@tests/helpers/board", ["tests/helpers/board"]]
    ];

    for (const [specifier, targets] of table) {
      expect(aliasTargets(V15, specifier), specifier).toEqual(targets);
    }
  });

  it("matches nothing for a package, a relative path, an unmapped spelling or no map", () => {
    for (const specifier of ["pixi.js", "./kit", "../kit", "/abs/kit", "@shared/views", "@plug"]) {
      expect(aliasTargets(V15, specifier), specifier).toEqual([]);
    }

    expect(aliasTargets(undefined, "@core/kit")).toEqual([]);
  });

  it("never matches the engine, even when the paths map it", () => {
    const map: AliasMap = {
      file: "tsconfig.json",
      sources: ["tsconfig.json"],
      patterns: [
        { prefix: "@moku-labs/game", targets: ["engine/index.ts"] },
        { prefix: "@moku-labs/game/", suffix: "", targets: ["engine/*.ts"] },
        { prefix: "", suffix: "", targets: ["vendor/*"] }
      ]
    };

    expect(aliasTargets(map, "@moku-labs/game")).toEqual([]);
    expect(aliasTargets(map, "@moku-labs/game/testing")).toEqual([]);
    expect(aliasTargets(map, "@moku-labs/gamekit")).toEqual(["vendor/@moku-labs/gamekit"]);
  });

  it("prefers an exact key over a `*` key, then the longest prefix", () => {
    const map: AliasMap = {
      file: "tsconfig.json",
      sources: ["tsconfig.json"],
      patterns: [
        { prefix: "@s", suffix: "", targets: ["s/*.ts"] },
        { prefix: "@shared/", suffix: "", targets: ["shared/*/index.ts"] },
        { prefix: "@shared/rules", targets: ["shared/rules/main.ts"] }
      ]
    };

    expect(aliasTargets(map, "@shared/rules")).toEqual(["shared/rules/main.ts"]);
    expect(aliasTargets(map, "@shared/views")).toEqual(["shared/views/index.ts"]);
    expect(aliasTargets(map, "@sx")).toEqual(["s/x.ts"]);
  });

  it("answers every target in order, keeps a target without `*`, and reads a suffix", () => {
    const map: AliasMap = {
      file: "tsconfig.json",
      sources: ["tsconfig.json"],
      patterns: [
        { prefix: "@icons/", suffix: ".svg", targets: ["assets/*.svg", "fallback.svg"] },
        { prefix: "@kit/", suffix: "", targets: ["core/*", "legacy/*"] }
      ]
    };

    expect(aliasTargets(map, "@icons/star.svg")).toEqual(["assets/star.svg", "fallback.svg"]);
    expect(aliasTargets(map, "@icons/star.png")).toEqual([]);
    expect(aliasTargets(map, "@kit/$&")).toEqual(["core/$&", "legacy/$&"]);
  });
});

describe("sameAliases", () => {
  it("compares the file and the patterns; the sources only feed the stamps", () => {
    const moved: AliasMap = { ...V15, sources: ["tsconfig.json", "base.json"] };
    const retargeted: AliasMap = {
      ...V15,
      patterns: [
        { prefix: "@core/", suffix: "", targets: ["src/core/*"] },
        ...V15_PATTERNS.slice(1)
      ]
    };

    expect(sameAliases(V15, { ...V15, patterns: V15_PATTERNS.map(item => ({ ...item })) })).toBe(
      true
    );
    expect(sameAliases(V15, moved)).toBe(true);
    expect(sameAliases(undefined, undefined)).toBe(true);
    expect(sameAliases(V15, retargeted)).toBe(false);
    expect(sameAliases(V15, { ...V15, file: "tsconfig.game.json" })).toBe(false);
    expect(sameAliases(V15, { ...V15, patterns: V15_PATTERNS.slice(1) })).toBe(false);
    expect(sameAliases(V15, undefined)).toBe(false);
    expect(sameAliases(undefined, V15)).toBe(false);
  });

  it("tells a key with `*` from the same key without it", () => {
    const exact: AliasMap = {
      file: "tsconfig.json",
      sources: [],
      patterns: [{ prefix: "@kit", targets: ["kit.ts"] }]
    };
    const star: AliasMap = {
      file: "tsconfig.json",
      sources: [],
      patterns: [{ prefix: "@kit", suffix: "", targets: ["kit.ts"] }]
    };

    expect(sameAliases(exact, star)).toBe(false);
  });
});
