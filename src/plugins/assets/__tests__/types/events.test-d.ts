import { expectTypeOf } from "vitest";
import type { AssetStamps, Events, HotSwap, KernelSlice, State } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. It guards what delta 3 changed: `index.ts` annotates the
// `register` parameter (core spec `14-EVENT-REGISTRATION.md` row 8), so the
// own events reach the context the kernel hands the factories and `ctx.emit`
// needs no narrowing. Delta 4 adds the third one, `assets:bundle-progress`; the
// asset hot swap adds the fourth, `assets:replaced`.
// ---------------------------------------------------------------------------

declare const assetsCtx: KernelSlice;

expectTypeOf(assetsCtx.emit)
  .parameter(0)
  .toEqualTypeOf<
    "assets:bundle-loaded" | "assets:bundle-progress" | "assets:bundle-unloaded" | "assets:replaced"
  >();

assetsCtx.emit("assets:bundle-loaded", {
  bundle: "board",
  tier: "scene",
  mb: 3.5,
  reason: "enter"
});

// @ts-expect-error — an empty object is not a bundle-loaded payload
assetsCtx.emit("assets:bundle-loaded", {});

// @ts-expect-error — `keys` belongs to the unload payload, not to the load one
assetsCtx.emit("assets:bundle-loaded", {
  bundle: "board",
  tier: "scene",
  mb: 3.5,
  reason: "enter",
  keys: ["board.cell"]
});

assetsCtx.emit("assets:bundle-progress", { bundle: "ui", loaded: 1, total: 3 });

// @ts-expect-error — a progress payload counts files, it carries no megabytes
assetsCtx.emit("assets:bundle-progress", { bundle: "ui", loaded: 1, mb: 0.25 });

expectTypeOf<Events["assets:bundle-progress"]>().toEqualTypeOf<{
  bundle: string;
  loaded: number;
  total: number;
}>();

// @ts-expect-error — the plugin declares no such event
assetsCtx.emit("assets:bundle-evicted", { bundle: "board" });

expectTypeOf<Events["assets:bundle-unloaded"]["reason"]>().toEqualTypeOf<"budget" | "request">();

assetsCtx.emit("assets:replaced", { bundle: "ui", keys: ["ui.body"] });

// @ts-expect-error — a replaced payload names the bundle and its keys, not what they cost
assetsCtx.emit("assets:replaced", { bundle: "ui", keys: ["ui.body"], mb: 0.25 });

// @ts-expect-error — `keys` is a list of asset keys, not one key
assetsCtx.emit("assets:replaced", { bundle: "ui", keys: "ui.body" });

expectTypeOf<Events["assets:replaced"]>().toEqualTypeOf<{
  bundle: string;
  keys: readonly string[];
}>();

// The stamp of the keys watch, as `.moku/assets-stamp.ts` exports it by default.
expectTypeOf<AssetStamps>().toEqualTypeOf<{
  files: Readonly<Record<string, string>>;
  changed: readonly string[];
}>();

// The hook payload is the one of the global event: the stamp sits untyped in `module.default`.
expectTypeOf<HotSwap>().toEqualTypeOf<{
  file: string;
  module: Readonly<Record<string, unknown>>;
}>();

expectTypeOf<State["stamps"]>().toEqualTypeOf<AssetStamps["files"] | undefined>();
expectTypeOf<State["swapping"]>().toEqualTypeOf<Promise<void> | undefined>();
