import { expectTypeOf } from "vitest";
import { defineGame } from "../../../../index";
import type { LayerMap } from "../../../scenes/types";
import type { Entity } from "../../../world/types";
import { componentsFor, HudPart, Overlay, type OverlayValue } from "../../components";
import type { Api, OverlayReport } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only (spec 22, LEAD-FIXES-4 item 5). `tsc --noEmit` is the runner: every `@ts-expect-error` below must
// be an error, and nothing else may be. What a game can get wrong: a `cover` that does not exist, the engine's own
// level written by hand, a HUD key the game did not declare, a HUD layer that says anything but "overlays".
// ---------------------------------------------------------------------------

Overlay({ cover: "opaque" });
Overlay({ hud: "all" });
Overlay({ hud: "none" });
Overlay({ hud: ["energy", "gems"] as readonly string[] });

// @ts-expect-error — "glass" is no cover.
Overlay({ cover: "glass" });

// @ts-expect-error — the level is the engine's state, read through debug.overlays(), never the game's field.
Overlay({ level: 1 });

// @ts-expect-error — so is the landing.
Overlay({ landed: true });

expectTypeOf<keyof OverlayValue>().toEqualTypeOf<"dim" | "dimColor" | "cover" | "hud" | "fade">();

HudPart({ key: "anything" });

// The kit types the HUD keys a game declares, as it types the asset keys.
const kit = componentsFor<"ui.coin", "energy" | "gems">();

kit.HudPart({ key: "energy" });
kit.Overlay({ dim: 0.56, hud: ["energy", "gems"] });
kit.Overlay({ hud: "none" });

// @ts-expect-error — "energi" is not a HUD key of the game.
kit.HudPart({ key: "energi" });

// @ts-expect-error — nor in an overlay's list.
kit.Overlay({ hud: ["energy", "gemz"] });

const game = defineGame<{
  player: { coins: number };
  session: { visits: number };
  assets: "ui.coin";
  strings: Record<string, never>;
  hud: "energy" | "gems";
}>();

game.HudPart({ key: "gems" });

// @ts-expect-error — defineGame binds the same keys through its `hud` slot.
game.HudPart({ key: "coins" });

// A game without a `hud` slot takes any key.
defineGame<{
  player: { n: number };
  session: { m: number };
  assets: string;
  strings: Record<string, never>;
}>().HudPart({ key: "any" });

const ward: LayerMap = { scene: {}, ui: { sort: "order" }, hud: { above: "overlays" } };

// @ts-expect-error — a HUD layer is above the overlays, nothing else.
const wrong: LayerMap = { hud: { above: "ui" } };

expectTypeOf<Api["sync"]["loopsHeld"]>().toEqualTypeOf<
  (entity: Entity, reveals?: "alpha" | "place" | "both") => boolean
>();

declare const sync: Api["sync"];

// @ts-expect-error — a loop reveals the view's alpha, its place, or both; nothing else.
sync.loopsHeld(1, "size");
expectTypeOf<Api["sync"]["debug"]["overlays"]>().returns.toEqualTypeOf<readonly OverlayReport[]>();
expectTypeOf(ward).toEqualTypeOf<LayerMap>();
expectTypeOf(wrong).toEqualTypeOf<LayerMap>();
