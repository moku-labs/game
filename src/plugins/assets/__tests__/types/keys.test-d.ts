import { expectTypeOf } from "vitest";
import type { Descriptor } from "../../../flow/types";
import { defineBundles, load } from "../../bundles";
import type { BundleMap, DefineBundles, LoadBundles, Texture } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. It stands in for what `defineGame<Types>()` hands a game once
// `bun run assets:keys` wrote `generated/assets.ts`.
// ---------------------------------------------------------------------------

/** What the scanner would generate for a game with three bundles. */
type BundleKey = "board" | "board.chains" | "ui";

/** What the scanner would generate for the files of that game. */
type AssetKey = "board.cell" | "board.item-a-1" | "ui.panel";

const defineGameBundles: DefineBundles<BundleKey> = defineBundles;
const loadGameBundle: LoadBundles<BundleKey> = load;

// ─── defineBundles ────────────────────────────────────────────

const bundles = defineGameBundles({
  board: { tier: "scene" },
  "board.chains": { tier: "lazy", files: ["chains/*.png"] }
});

expectTypeOf(bundles).toEqualTypeOf<BundleMap<BundleKey>>();
expectTypeOf(bundles.kind).toEqualTypeOf<"bundles">();

// @ts-expect-error — "bord" is not a bundle key of this game.
defineGameBundles({ bord: { tier: "scene" } });

// @ts-expect-error — "huge" is not one of the five tiers.
defineGameBundles({ board: { tier: "huge" } });

// ─── the load descriptor ──────────────────────────────────────

expectTypeOf(loadGameBundle("board.chains")).toEqualTypeOf<Descriptor>();
expectTypeOf(loadGameBundle(["board", "ui"])).toEqualTypeOf<Descriptor>();

// @ts-expect-error — "bord" is not a bundle key of this game.
loadGameBundle("bord");

// @ts-expect-error — one wrong key is enough to refuse the whole list.
loadGameBundle(["board", "bord"]);

// ─── asset keys, as a game's `texture` is typed ───────────────

declare const textureOf: (key: AssetKey) => Texture | undefined;

textureOf("board.cell");

// @ts-expect-error — no file gives the key "board.cel".
textureOf("board.cel");

/** The two literal unions a template-literal key is built from. */
type Kind = "a" | "b";
type Level = "1" | "2";

declare function itemKey<K extends Kind, L extends Level>(
  kind: K,
  level: L
): `board.item-${K}-${L}`;

textureOf(itemKey("a", "1"));

// @ts-expect-error — the template resolves to "board.item-b-1", for which no file exists.
textureOf(itemKey("b", "1"));

// The untyped export stays wide, so a plugin that does not know the game still compiles.
expectTypeOf(load).parameter(0).toEqualTypeOf<string | readonly string[]>();
