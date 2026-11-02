import { expectTypeOf } from "vitest";
import { createPlugin } from "../../../../config";
import { createApp, projection, screen } from "../../../../index";
import type { Json } from "../../../model/types";
import { defineScene } from "../../define";
import { scenesPlugin } from "../../index";
import type { DefineScene, Events, KernelSlice, SceneDefinition, SceneState } from "../../types";

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

// ─── leave: the loader's texture is an asset key of the game ──

defineGameScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [],
  leave: { cover: { color: 0x0b_10_20, alpha: 0.6 }, loader: { texture: "board.cell" } }
});

defineGameScene("home", { bundle: "home", layers: {}, projections: [], leave: false });

defineGameScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [],
  // @ts-expect-error — "board.cel" is not an asset key of this game.
  leave: { loader: { texture: "board.cel" } }
});

defineGameScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [],
  // @ts-expect-error — the veil's `alpha` is a number.
  leave: { cover: { alpha: "0.6" } }
});

defineGameScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [],
  // @ts-expect-error — `leave` is an object or `false`, never `true`.
  leave: true
});

// The config's `leave` takes the same shape.
createApp({
  plugins: [...screen],
  pluginConfigs: { scenes: { leave: { cover: { alpha: 0.6 }, loader: false } } }
});

createApp({
  plugins: [...screen],
  // @ts-expect-error — the veil's `alpha` is a number.
  pluginConfigs: { scenes: { leave: { cover: { alpha: "0.6" } } } }
});

// @ts-expect-error — `leave` is an object or `false`, never `true`.
createApp({ plugins: [...screen], pluginConfigs: { scenes: { leave: true } } });

// ─── enter: the veil's colour and alpha of the scene being entered ──

defineGameScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [],
  enter: { cover: { color: 0x0b_10_20, alpha: 0.7 } }
});

defineGameScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [],
  // @ts-expect-error — the times of the veil stay the left scene's: `enter.cover` takes no `inMs`.
  enter: { cover: { inMs: 80 } }
});

defineGameScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [],
  // @ts-expect-error — `enter.cover` is an object of fields; `enter` never turns a veil off.
  enter: { cover: false }
});

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

// ─── bundles of state, typed with the game's session and bundle keys ───

/** The bundle keys of a game whose location feature has two episodes. */
type EpisodeBundle = "location" | "ep01" | "ep02";

/** The session of that game. */
type EpisodeSession = { episode: "ep01" | "ep02" };

const defineEpisodeScene: DefineScene<AssetKey, EpisodeBundle, Json, EpisodeSession> = defineScene;

// T1: the kit types the session `bundles` reads and the keys it returns.
const ward = defineEpisodeScene("ward", {
  bundle: "location",
  bundles: ({ session }) => [session.episode],
  layers: { room: {} },
  projections: []
});

expectTypeOf(ward).toEqualTypeOf<SceneDefinition>();

defineEpisodeScene("ward", {
  bundle: "location",
  // @ts-expect-error — T2: "ep03" is not a bundle key of this game.
  bundles: () => ["ep03"],
  layers: { room: {} },
  projections: []
});

defineEpisodeScene("ward", {
  bundle: "location",
  // @ts-expect-error — T3: the session of this game has no field "level".
  bundles: ({ session }) => [session.level],
  layers: { room: {} },
  projections: []
});

// T4: the loose export infers the session from an annotated parameter…
defineScene("ward", {
  bundle: "location",
  bundles: ({ session }: SceneState<Json, { episode: string }>) => [session.episode],
  layers: {},
  projections: []
});

// …and reads an unannotated one as `Json`, which has no field.
defineScene("ward", {
  bundle: "location",
  // @ts-expect-error — `Json` has no field "episode".
  bundles: ({ session }) => [session.episode],
  layers: {},
  projections: []
});

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

// The own event reaches the plugin context: `emit` is the kernel's, typed with scenes' event map.
declare const scenesCtx: KernelSlice;

expectTypeOf(scenesCtx.emit).parameter(0).toEqualTypeOf<"scenes:changed">();

// @ts-expect-error — an empty object is not a `scenes:changed` payload
scenesCtx.emit("scenes:changed", {});

// @ts-expect-error — `to` is a scene id, not a number
scenesCtx.emit("scenes:changed", { from: "home", to: 7, music: undefined });
