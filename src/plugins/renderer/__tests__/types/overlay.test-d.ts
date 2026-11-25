import { expectTypeOf } from "vitest";
import {
  defineGame,
  type HudReturn as RootHudReturn,
  type HudReturnReport as RootHudReturnReport
} from "../../../../index";
import type { LayerMap } from "../../../scenes/types";
import type { Entity } from "../../../world/types";
import {
  componentsFor,
  HudPart,
  type HudReturn,
  Overlay,
  type OverlayValue
} from "../../components";
import type { Api, HudReturnReport, OverlayReport } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only (spec 22, LEAD-FIXES-4 item 5). `tsc --noEmit` is the runner: every `@ts-expect-error` below must
// be an error, and nothing else may be. What a game can get wrong: a `cover` that does not exist, a `hold` that is no
// boolean, the engine's own level written by hand, a HUD key the game did not declare, a HUD layer that says anything
// but "overlays".
// ---------------------------------------------------------------------------

Overlay({ cover: "opaque" });
Overlay({ hud: "all" });
Overlay({ hud: "none" });
Overlay({ hud: ["energy", "gems"] as readonly string[] });
Overlay({ dim: 0.82, dimColor: 0x1e_16_1a, hud: "under" });

// @ts-expect-error — "below" is no hud: "all", "none", "under" or a list of keys.
Overlay({ hud: "below" });

// @ts-expect-error — "glass" is no cover.
Overlay({ cover: "glass" });

// @ts-expect-error — the level is the engine's state, read through debug.overlays(), never the game's field.
Overlay({ level: 1 });

// @ts-expect-error — so is the landing.
Overlay({ landed: true });

expectTypeOf<keyof OverlayValue>().toEqualTypeOf<
  "dim" | "dimColor" | "cover" | "hud" | "hudInert" | "fade" | "hold" | "hudReturn"
>();

// F240: `hudReturn` is optional, so a full value written before it still compiles. Unannotated, so a required
// `hudReturn` fails the check at the end of the file instead of the declaration.
const splashBefore = {
  dim: 0,
  dimColor: 0,
  cover: "opaque",
  hud: "none",
  hudInert: false,
  fade: 800,
  hold: false
} as const;

Overlay({ hud: "none", hudReturn: { delayMs: 1100, fadeMs: 700 } });

// @ts-expect-error — a return needs its fade, 0 for at once.
Overlay({ hud: "none", hudReturn: { delayMs: 1100 } });

// @ts-expect-error — "gems" is not a key of HudReturn<"energy">.
const onlyEnergy: HudReturn<"energy"> = { delayMs: 1, fadeMs: 1, parts: { gems: {} } };

// @ts-expect-error — hold is a switch, true or false.
Overlay({ hold: "yes" });

Overlay({ dim: 0.7, hud: ["energy", "gems"], hudInert: true });

// @ts-expect-error — hudInert is a switch, true or false.
Overlay({ hudInert: "yes" });

HudPart({ key: "anything" });

// The kit types the HUD keys a game declares, as it types the asset keys.
const kit = componentsFor<"ui.coin", "energy" | "gems">();

kit.HudPart({ key: "energy" });
kit.Overlay({ dim: 0.56, hud: ["energy", "gems"] });
kit.Overlay({ dim: 0.56, hold: true, hud: ["energy", "gems"] });
kit.Overlay({ hud: "none" });
kit.Overlay({ dim: 0.82, dimColor: 0x1e_16_1a, hud: "under" });

kit.Overlay({ dim: 0.7, hud: ["energy"], hudInert: true });

// @ts-expect-error — the kit's hudInert is a switch too.
kit.Overlay({ hudInert: "yes" });

// @ts-expect-error — "energi" is not a HUD key of the game.
kit.HudPart({ key: "energi" });

// @ts-expect-error — nor in an overlay's list.
kit.Overlay({ hud: ["energy", "gemz"] });

kit.Overlay({
  hud: "none",
  hudReturn: { delayMs: 1100, fadeMs: 400, parts: { gems: { delayMs: 1250 } } }
});

// @ts-expect-error — nor in the parts of its return.
kit.Overlay({ hudReturn: { delayMs: 1, fadeMs: 1, parts: { nope: {} } } });

const game = defineGame<{
  player: { coins: number };
  session: { visits: number };
  assets: "ui.coin";
  strings: Record<string, never>;
  hud: "energy" | "gems";
}>();

game.HudPart({ key: "gems" });
game.Overlay({ dim: 0.82, hud: "under" });

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
expectTypeOf(splashBefore).toExtend<OverlayValue>();
// The parts of a typed return take the game's keys alone, each with its two optional times.
expectTypeOf(onlyEnergy.parts).toEqualTypeOf<
  Partial<Record<"energy", { delayMs?: number; fadeMs?: number }>> | undefined
>();

// A report is whole without `hudReturn` (an overlay with no run), and its `hudReturn` carries all three numbers.
const shopReport = {
  entity: 1_048_601,
  label: "shop",
  phase: "shown",
  mode: "freeze",
  level: 1,
  range: 2,
  kept: true
} as const;

expectTypeOf(shopReport).toExtend<OverlayReport>();
expectTypeOf({
  ...shopReport,
  hudReturn: { delayMs: 1100, fadeMs: 700, elapsed: 480 }
}).toExtend<OverlayReport>();
expectTypeOf({
  ...shopReport,
  hudReturn: { delayMs: 1100, fadeMs: 700 }
}).not.toExtend<OverlayReport>();
// A run's report carries all five fields, and `hudReturns()` answers a read-only list of them.
expectTypeOf({
  owner: 1_048_590,
  label: "Shape#1048590 splash",
  delayMs: 1100,
  fadeMs: 700,
  elapsed: 1450
}).toExtend<HudReturnReport>();
expectTypeOf({
  owner: 1_048_590,
  label: "Shape#1048590 splash",
  delayMs: 1100,
  fadeMs: 700
}).not.toExtend<HudReturnReport>();
expectTypeOf<Api["sync"]["debug"]["hudReturns"]>().returns.toEqualTypeOf<
  readonly HudReturnReport[]
>();
expectTypeOf<RootHudReturnReport>().toEqualTypeOf<HudReturnReport>();
// The root exports the type a game names its shared constant with.
expectTypeOf<RootHudReturn<"energy">>().toEqualTypeOf<HudReturn<"energy">>();
