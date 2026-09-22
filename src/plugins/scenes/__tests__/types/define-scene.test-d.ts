import { expectTypeOf } from "vitest";
import { createPlugin } from "../../../../config";
import { projection } from "../../../../index";
import { defineScene } from "../../define";
import { scenesPlugin } from "../../index";
import type { DefineScene, Events, SceneDefinition } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. It stands in for what `defineGame<Types>()` hands a game.
// ---------------------------------------------------------------------------

/** What the scanner would generate for a game with two bundles. */
type BundleKey = "board" | "home";

/** What the scanner would generate for the files of that game. */
type AssetKey = "board.cell" | "home.theme";

const defineGameScene: DefineScene<AssetKey, BundleKey> = defineScene;

type Item = { id: string };

const boardCells = projection({
  name: "board.cells",
  layer: "cells",
  from: (player: { cells: Item[] }) => player.cells,
  key: (item: Item) => item.id,
  view: () => []
});

const boardItems = projection({
  name: "board.items",
  layer: "items",
  lift: "lifted",
  from: (player: { items: Item[] }) => player.items,
  key: (item: Item) => item.id,
  view: () => []
});

// ─── the layer names come from the keys of `layers` ───────────

const board = defineGameScene("board", {
  bundle: "board",
  layers: { cells: {}, items: { sort: "y" }, lifted: {} },
  projections: [boardCells, boardItems]
});

expectTypeOf(board).toEqualTypeOf<SceneDefinition>();
expectTypeOf(board.layers[0]?.sort).toEqualTypeOf<"none" | "y" | "order" | undefined>();

defineGameScene("home", {
  bundle: "home",
  layers: { ui: {} },
  projections: [],
  music: "home.theme"
});

// @ts-expect-error — the layer "items" of "board.items" is not declared by this scene.
defineGameScene("board", { bundle: "board", layers: { cells: {} }, projections: [boardItems] });

defineGameScene("board", {
  bundle: "board",
  // @ts-expect-error — the lift layer "lifted" of "board.items" is not declared by this scene.
  projections: [boardItems],
  layers: { cells: {}, items: {} }
});

// The projection whose layers fit is accepted next to one that does not, so the error is local.
defineGameScene("board", {
  bundle: "board",
  layers: { cells: {}, items: {} },
  // @ts-expect-error — only "board.items" is wrong; "board.cells" fits.
  projections: [boardCells, boardItems]
});

// ─── the game's bundle and asset keys ─────────────────────────

// @ts-expect-error — "bord" is not a bundle key of this game.
defineGameScene("board", { bundle: "bord", layers: { cells: {} }, projections: [] });

defineGameScene("home", {
  bundle: "home",
  layers: { ui: {} },
  projections: [],
  // @ts-expect-error — "home.them" is not an asset key of this game.
  music: "home.them"
});

// The loose export stays wide, so a plugin that does not know the game still compiles.
defineScene("board", { bundle: "anything", layers: { cells: {} }, projections: [], music: "any" });

// ─── music is narrowed to the audio keys of the game ──────────

/** What the scanner generates for the `.mp3` files of that game; the textures stay out. */
type AudioKey = "home.theme";

const defineAudioScene: DefineScene<AudioKey, BundleKey> = defineScene;

defineAudioScene("home", { bundle: "home", layers: {}, projections: [], music: "home.theme" });

// @ts-expect-error — "board.cell" is a texture key, and music takes an audio key.
defineAudioScene("home", { bundle: "home", layers: {}, projections: [], music: "board.cell" });

// ─── the appended ui layer ────────────────────────────────────

const hudPanel = projection({
  name: "hud.panel",
  layer: "ui",
  from: (player: { items: Item[] }) => player.items,
  key: (item: Item) => item.id,
  view: () => []
});

// "ui" is appended to every scene, so a projection may name it without declaring it.
defineGameScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [boardCells, hudPanel]
});

// @ts-expect-error — "items" is neither declared nor the appended ui layer.
defineGameScene("board", { bundle: "board", layers: { cells: {} }, projections: [boardItems] });

// ─── the event a plugin above hooks ───────────────────────────

createPlugin("sceneMusic", {
  depends: [scenesPlugin],
  hooks: () => ({
    "scenes:changed": payload => {
      expectTypeOf(payload).toEqualTypeOf<Events["scenes:changed"]>();
      expectTypeOf(payload.from).toEqualTypeOf<string | undefined>();
      expectTypeOf(payload.to).toEqualTypeOf<string>();
      expectTypeOf(payload.music).toEqualTypeOf<string | undefined>();
    }
  })
});
