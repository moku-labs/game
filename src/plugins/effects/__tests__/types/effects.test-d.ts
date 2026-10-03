import { expectTypeOf } from "vitest";
import { defineGame } from "../../../../index";
import { tween } from "../../../anim/timeline/steps";
import type { Target } from "../../../anim/types";
import type { EmitterIdOf } from "../../../flow/types";
import { Blur, Displacement, Glow } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import type {
  Config,
  EffectsApi,
  EffectsStats,
  EmitterDefinition,
  FilterComponent
} from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. It stands in for what `defineGame<Types>()` hands a game.
// ---------------------------------------------------------------------------

const kit = defineGame<{
  player: { coins: number };
  session: { open: boolean };
  assets: "fx.star" | "fx.sparkle" | "fx.ripple";
  strings: Record<string, unknown>;
  emitters: "fx.starsBurst" | "fx.steam";
}>();

// The emitter ids of the game type `Emitter.effect` and the id of `defineEmitter`.
kit.Emitter({ effect: "fx.starsBurst" });
kit.Emitter({ effect: "fx.steam", active: false });
// @ts-expect-error — "fx.nope" is not one of the game's emitter ids
kit.Emitter({ effect: "fx.nope" });

expectTypeOf(
  kit.defineEmitter("fx.starsBurst", { textures: ["fx.star", "fx.sparkle"], burst: 40 })
).toEqualTypeOf<EmitterDefinition>();
// @ts-expect-error — "board.png" is not one of the game's asset keys
kit.defineEmitter("fx.starsBurst", { textures: ["board.png"], burst: 40 });
// @ts-expect-error — the id is one of the game's emitter ids
kit.defineEmitter("fx.other", { textures: ["fx.star"], burst: 40 });

// The map of a Displacement is an asset key.
kit.Displacement({ map: "fx.ripple", scaleX: 10 });
// @ts-expect-error — "nope" is not one of the game's asset keys
kit.Displacement({ map: "nope" });

// The loose root exports take any string.
Emitter({ effect: "anything" });
defineEmitter("any.id", { textures: ["any.key"], rate: 1 });
Displacement({ map: "any.key" });

// A game without emitter ids gets string.
expectTypeOf<
  EmitterIdOf<{
    player: { coins: number };
    session: { open: boolean };
    assets: string;
    strings: Record<string, unknown>;
  }>
>().toEqualTypeOf<string>();

// Every numeric field of a filter is tweenable; a colour is a number; switches and vectors are not.
const card: Target = { projection: "board.items", key: "card" };
const Tint = defineFilter("fx.tint", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return vec4<f32>(fu.amount); }",
  uniforms: { amount: 0, color: { color: 0xff_d7_00 }, offset: [1, 2] }
});

tween(card, Glow, { strength: 4, color: 0xff_00_00 }, { ms: 300 });
tween(card, Tint, { amount: 1, color: 0x00_ff_00 }, { ms: 300 });
tween(card, Blur, { strength: 2 }, { ms: 300 });
// @ts-expect-error — the glow colour is a 0xrrggbb number, not a name
tween(card, Glow, { color: "red" }, { ms: 300 });
// @ts-expect-error — `enabled` is a switch, not a tweenable number
tween(card, Tint, { enabled: false }, { ms: 300 });
// @ts-expect-error — a vector uniform is an array field, not tweenable
tween(card, Tint, { offset: [3, 4] }, { ms: 300 });

expectTypeOf(Tint().value.amount).toEqualTypeOf<number>();
expectTypeOf(Tint().value.color).toEqualTypeOf<number>();
expectTypeOf(Tint().value.offset).toEqualTypeOf<readonly number[]>();
expectTypeOf(Tint().value.enabled).toEqualTypeOf<boolean>();
expectTypeOf(Tint.filter.passes).toEqualTypeOf<number>();
expectTypeOf(Glow).toMatchTypeOf<FilterComponent<{ strength: number }>>();

// A reserved uniform name passes the type and is refused at run time (define-filter.test.ts).
expectTypeOf(defineFilter).toBeCallableWith("fx.x", { wgsl: "", uniforms: { order: 1 } });

const api = {} as EffectsApi;

expectTypeOf(api.stats()).toEqualTypeOf<EffectsStats>();
expectTypeOf<EffectsStats["renderPasses"]>().toEqualTypeOf<number>();
expectTypeOf<Config["phone"]>().toEqualTypeOf<boolean | "auto">();
expectTypeOf<Config["blur"]>().toEqualTypeOf<{ quality: number; phoneResolution: number }>();
