import { expectTypeOf } from "vitest";
import type { Anim } from "../../../../index";
import { defineGame } from "../../../../index";
import { type } from "../../../flow/runner/define";
import { Sprite, Transform } from "../../../renderer/components";
import { defineMotion } from "../../motion";
import { defineAnimation, mark, play, sequence, set, tween } from "../../timeline/steps";
import type { AnimApi, Config, KernelSlice, MotionKeyframe, PlayHandle, Target } from "../../types";

const card: Target = { projection: "hud", key: "order" };

// `to` takes the numeric fields of the component, and nothing else.
tween(card, Transform, { x: 10, scale: 2 }, { ms: 100 });
// @ts-expect-error — `texture` is a string field of Sprite, so it is not tweenable
tween(card, Sprite, { texture: 1 }, { ms: 100 });
// @ts-expect-error — a numeric field takes a number
tween(card, Transform, { x: "a" }, { ms: 100 });
// @ts-expect-error — `ms` is required
tween(card, Transform, { x: 10 }, {});

// A tween names the space of its target: local by default, root to aim a hosted view.
tween(card, Transform, { x: 540, y: 300 }, { ms: 100, space: "root" });
tween(card, Transform, { x: 540, y: 300 }, { ms: 100, space: "local" });
// @ts-expect-error — the space is local or root, nothing else
tween(card, Transform, { x: 540 }, { ms: 100, space: "world" });

// The components a game gets from `defineGame` pass unchanged, as `world.ecs` takes them.
const kit = defineGame<{
  player: { coins: number };
  session: { open: boolean };
  assets: "ui.icon-coin" | "ui.button-berry";
  bundles: "boot";
  strings: { "hud.coins": string };
}>();

tween(card, kit.Sprite, { alpha: 0 }, { ms: 100 });
set(card, kit.NineSlice, { alpha: 1 });
set(card, kit.Sprite, { texture: "ui.icon-coin" });
// @ts-expect-error — a numeric field of the kit's Sprite still takes a number
tween(card, kit.Sprite, { alpha: "a" }, { ms: 100 });

const deliverOrder = defineAnimation("orders.deliver", {
  slots: { items: type<Target[]>(), card: type<Target>() },
  build: ({ items, card: target }) => {
    expectTypeOf(items).toEqualTypeOf<Target[]>();
    expectTypeOf(target).toEqualTypeOf<Target>();

    return sequence(mark("done"));
  }
});

// Every slot has to be filled, with the shape the tag declares.
play(deliverOrder, { items: [card], card });
// @ts-expect-error — the slot `card` is missing
play(deliverOrder, { items: [card] });
// @ts-expect-error — `items` is a list of targets, not one target
play(deliverOrder, { items: card, card });

// A slot carries targets, never another payload.
defineAnimation("bad.slot", {
  // @ts-expect-error — slots are targets, so `type<number>()` is refused
  slots: { amount: type<number>() },
  build: () => mark("x")
});

// A motion state names numeric fields of a component anim knows.
defineMotion({
  states: { hidden: { Transform: { scale: 0.8 }, Shape: { alpha: 0 } } },
  on: { enter: "hidden" }
});
defineMotion({
  // @ts-expect-error — `texture` is a string field of Sprite
  states: { hidden: { Sprite: { texture: 1 } } },
  on: { enter: "hidden" }
});
defineMotion({
  // @ts-expect-error — `Nope` is not a component anim can resolve without a context
  states: { hidden: { Nope: { alpha: 0 } } },
  on: { enter: "hidden" }
});

// A keyframe track names offsets on Transform and alpha on the three visuals; states are optional.
const settle: MotionKeyframe = { at: 0.42, ease: "out", Transform: { dy: 14, rotation: 0.087 } };

defineMotion({
  keyframes: {
    dropIn: [{ at: 0, Transform: { dy: -780, scale: 0.8 }, Shape: { alpha: 0 } }, settle]
  },
  transition: { ms: 1000 },
  on: { enter: "dropIn" }
});
defineMotion({
  // @ts-expect-error — a key moves the Transform by dx and dy, never by an absolute x
  keyframes: { dropIn: [{ at: 0, Transform: { x: 10 } }] },
  on: { enter: "dropIn" }
});
defineMotion({
  // @ts-expect-error — a key gives the Shape its alpha only
  keyframes: { dropIn: [{ at: 0, Shape: { fill: 0 } }] },
  on: { enter: "dropIn" }
});
// @ts-expect-error — every key sits somewhere on the track
const noAt: MotionKeyframe = { Transform: { dy: 1 } };

expectTypeOf(noAt).toEqualTypeOf<MotionKeyframe>();
expectTypeOf<Anim.MotionKeyframe>().toEqualTypeOf<MotionKeyframe>();

// The own events reach the plugin context: `emit` is the kernel's, typed with anim's event map.
declare const animCtx: KernelSlice;

expectTypeOf(animCtx.emit).parameter(0).toEqualTypeOf<"anim:mark" | "anim:finished">();

animCtx.emit("anim:mark", { animation: "orders.deliver", mark: "done" });
animCtx.emit("anim:finished", { animation: "orders.deliver" });
// @ts-expect-error — the mark payload needs both fields
animCtx.emit("anim:mark", {});
// @ts-expect-error — the plugin owns no other event
animCtx.emit("anim:other", { animation: "orders.deliver" });

// The API answers with the handle contract of `world`, plus `done` and `marks`.
declare const api: AnimApi;

expectTypeOf(api.play(deliverOrder, { items: [card], card })).toEqualTypeOf<PlayHandle>();
expectTypeOf(api.active()).toEqualTypeOf<number>();
expectTypeOf(api.onMark(() => undefined)).toEqualTypeOf<() => void>();

// Delta 6: a loop names one keyframe track; reduced motion is a config start value and a switch.
defineMotion({
  keyframes: {
    sway: [
      { at: 0, Transform: { rotation: 0 } },
      { at: 1, Transform: { rotation: 0 } }
    ]
  },
  loop: { track: "sway" },
  on: {}
});
defineMotion({
  keyframes: {
    sway: [
      { at: 0, Transform: { rotation: 0 } },
      { at: 1, Transform: { rotation: 0 } }
    ]
  },
  transition: { ms: 250 },
  loop: { track: "sway", ms: 2400 },
  on: {}
});
defineMotion({
  // @ts-expect-error — a loop is { track, ms? }, not the bare track name
  loop: "sway",
  on: {}
});
defineMotion({
  // @ts-expect-error — one cycle is a number of milliseconds
  loop: { track: "sway", ms: "2400" },
  on: {}
});

expectTypeOf(api.reducedMotion()).toEqualTypeOf<boolean>();
expectTypeOf(api.reducedMotion(true)).toEqualTypeOf<boolean>();
// @ts-expect-error — the switch takes a boolean
api.reducedMotion("on");
expectTypeOf<Config["reducedMotion"]>().toEqualTypeOf<boolean>();
