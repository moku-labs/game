import { expectTypeOf } from "vitest";
import { type } from "../../../flow/runner/define";
import { Sprite, Transform } from "../../../renderer/components";
import { defineMotion } from "../../motion";
import { defineAnimation, mark, play, sequence, tween } from "../../timeline/steps";
import type { AnimApi, KernelSlice, PlayHandle, Target } from "../../types";

const card: Target = { projection: "hud", key: "order" };

// `to` takes the numeric fields of the component, and nothing else.
tween(card, Transform, { x: 10, scale: 2 }, { ms: 100 });
// @ts-expect-error — `texture` is a string field of Sprite, so it is not tweenable
tween(card, Sprite, { texture: 1 }, { ms: 100 });
// @ts-expect-error — a numeric field takes a number
tween(card, Transform, { x: "a" }, { ms: 100 });
// @ts-expect-error — `ms` is required
tween(card, Transform, { x: 10 }, {});

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
