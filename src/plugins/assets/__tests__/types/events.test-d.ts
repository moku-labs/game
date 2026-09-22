import { expectTypeOf } from "vitest";
import type { Events, KernelSlice } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. It guards what delta 3 changed: `index.ts` annotates the
// `register` parameter (core spec `14-EVENT-REGISTRATION.md` row 8), so the two
// own events reach the context the kernel hands the factories and `ctx.emit`
// needs no narrowing.
// ---------------------------------------------------------------------------

declare const assetsCtx: KernelSlice;

expectTypeOf(assetsCtx.emit)
  .parameter(0)
  .toEqualTypeOf<"assets:bundle-loaded" | "assets:bundle-unloaded">();

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

// @ts-expect-error — the plugin declares no such event
assetsCtx.emit("assets:bundle-evicted", { bundle: "board" });

expectTypeOf<Events["assets:bundle-unloaded"]["reason"]>().toEqualTypeOf<"budget" | "request">();
