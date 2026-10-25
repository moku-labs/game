import { expectTypeOf } from "vitest";
import type { Anim, HAPTIC_KINDS, HapticKind, World } from "../../../../index";
import { defineGame } from "../../../../index";
import { type } from "../../../flow/runner/define";
import type { NodeFx } from "../../../flow/types";
import { Sprite, Transform } from "../../../renderer/components";
import type { ResourceType } from "../../../world/ecs/types";
import { AnimPlayer, Frames } from "../../components";
import { defineMotion } from "../../motion";
import {
  defineAnimation,
  haptic,
  mark,
  play,
  sequence,
  set,
  sfx,
  tween
} from "../../timeline/steps";
import type { FxStep } from "../../timeline/types";
import type {
  AnimApi,
  AnyAnimationDefinition,
  Config,
  KernelSlice,
  MotionKeyframe,
  PlayHandle,
  Target
} from "../../types";

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

// A keyframe walk names the numeric fields of the component in each segment, as `to` does (F75).
tween(
  card,
  Transform,
  { y: 0, scale: 0 },
  {
    ms: 2400,
    additive: true,
    repeat: "forever",
    segments: [
      { at: 0.08, ease: "out", to: { y: -14, scale: 0.06 } },
      { at: 1, to: { y: 0, scale: 0 } }
    ]
  }
);
// @ts-expect-error — Transform has no `dy`: an additive walk offsets `y` itself
tween(card, Transform, { y: 0 }, { ms: 100, segments: [{ at: 1, to: { dy: 0 } }] });
// @ts-expect-error — repeat counts the extra runs, or is "forever"
tween(card, Transform, { x: 1 }, { ms: 100, repeat: "always" });

// A walk written for `ViewHandle.tween` passes to a timeline step as it is.
const walk: readonly World.TrackSegment[] = [{ at: 1, to: { y: 0 } }];

tween(card, Transform, { y: 0 }, { ms: 100, segments: walk });

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

// `when` plays enter and exit always or only for a commit; nothing else.
defineMotion({ states: { small: {} }, on: { enter: "small" }, when: "change" });
defineMotion({ states: { small: {} }, on: { enter: "small" }, when: "always" });
// @ts-expect-error — "mount" is a cause, not a when
defineMotion({ states: { small: {} }, on: { enter: "small" }, when: "mount" });

// `reduced` is "cut" or "keep" wherever a track is described.
tween(card, Transform, { x: 10 }, { ms: 100, reduced: "keep" });
// @ts-expect-error — a fade is not a reduced rule
tween(card, Transform, { x: 10 }, { ms: 100, reduced: "fade" });
defineMotion({ states: { small: {} }, transition: { reduced: "keep" }, on: { enter: "small" } });
// @ts-expect-error — the transition takes "cut" or "keep"
defineMotion({ states: { small: {} }, transition: { reduced: "fade" }, on: { enter: "small" } });
defineMotion({
  keyframes: {
    sway: [
      { at: 0, Transform: { rotation: 0 } },
      { at: 1, Transform: { rotation: 0 } }
    ]
  },
  loop: { track: "sway", reduced: "keep" },
  on: {}
});
defineMotion({
  keyframes: {
    sway: [
      { at: 0, Transform: { rotation: 0 } },
      { at: 1, Transform: { rotation: 0 } }
    ]
  },
  // @ts-expect-error — the loop takes "cut" or "keep"
  loop: { track: "sway", reduced: true },
  on: {}
});
const keptFade: World.TweenOptions = { ms: 200, reduced: "keep" };
// @ts-expect-error — TweenOptions takes "cut" or "keep"
const wrongFade: World.TweenOptions = { ms: 200, reduced: "off" };

expectTypeOf(keptFade.reduced).toEqualTypeOf<World.ReducedMotion | undefined>();
expectTypeOf(wrongFade).toEqualTypeOf<World.TweenOptions>();

// A hand-written enter may read why it plays.
const caused: World.ProjectionMotion<{ id: string }> = {
  enter: (view, _item, _hint, cause) => {
    expectTypeOf(cause).toEqualTypeOf<World.MotionCause | undefined>();

    return cause === "mount" ? undefined : view.toRest(Transform, { ms: 200 });
  }
};

expectTypeOf(caused.enter).not.toBeUndefined();
expectTypeOf<ReturnType<World.ProjectionApi["causeOf"]>>().toEqualTypeOf<
  World.MotionCause | undefined
>();

expectTypeOf(api.reducedMotion()).toEqualTypeOf<boolean>();
expectTypeOf(api.setReducedMotion(true)).toEqualTypeOf<void>();
// @ts-expect-error — the reader takes no argument
api.reducedMotion(true);
// @ts-expect-error — the switch takes a boolean
api.setReducedMotion("on");
expectTypeOf<Config["reducedMotion"]>().toEqualTypeOf<boolean>();

// The dev hot swap replaces a registered animation by its definition.
expectTypeOf(api.replace).parameter(0).toEqualTypeOf<AnyAnimationDefinition>();
// @ts-expect-error — replace takes a definition, not its id
api.replace("board.mergeBurst");

// Delta 8: the Frames component. The kit narrows its keys to the game's asset keys.
const coinKit = defineGame<{
  player: { coins: number };
  session: { open: boolean };
  assets: "items.coin-0" | "items.coin-1";
  bundles: "boot";
  strings: { "hud.coins": string };
}>();

coinKit.Frames({ keys: ["items.coin-0", "items.coin-1"], fps: 12 });
// @ts-expect-error — "nope" is not an asset key of the game
coinKit.Frames({ keys: ["nope"] });
// @ts-expect-error — fps is a number
Frames({ fps: "12" });
tween(card, Frames, { fps: 24 }, { ms: 100 });
// @ts-expect-error — keys is a list of texture keys, not a numeric field
tween(card, Frames, { keys: [] }, { ms: 100 });
expectTypeOf<Anim.FramesValue>().toEqualTypeOf<{
  keys: readonly string[];
  fps: number;
  loop: boolean;
  playing: boolean;
}>();

// A haptic step takes one of the seven kinds; the runtime list and the type are the same seven.
haptic("selection");
// @ts-expect-error — "buzz" is not a haptic kind
haptic("buzz");
expectTypeOf<(typeof HAPTIC_KINDS)[number]>().toEqualTypeOf<HapticKind>();
expectTypeOf<HapticKind>().toEqualTypeOf<
  "light" | "medium" | "heavy" | "selection" | "success" | "warning" | "error"
>();
expectTypeOf<Anim.HapticDescriptor["payload"]["kind"]>().toEqualTypeOf<HapticKind>();

// A system plays through the AnimPlayer resource: the same play as app.anim, typed by the slots.
expectTypeOf(AnimPlayer).toEqualTypeOf<ResourceType<Anim.AnimPlayerValue>>();
expectTypeOf<Anim.AnimPlayerValue["play"]>().toEqualTypeOf<AnimApi["play"]>();
const lift = defineAnimation("look.hover", {
  slots: { thing: type<Target>() },
  build: ({ thing }) => tween(thing, Transform, { scale: 1.1 }, { ms: 100 })
});
const player: Anim.AnimPlayerValue = { play: () => ({}) as PlayHandle };
player.play(lift, { thing: 1 });
// @ts-expect-error — the slot `thing` is required
player.play(lift, {});

// The descriptors anim owns resolve nothing when a node awaits them, and stay timeline steps.
declare const fx: NodeFx;

expectTypeOf(fx(sfx("board.merge"))).toEqualTypeOf<Promise<void>>();
expectTypeOf(fx(haptic("light"))).toEqualTypeOf<Promise<void>>();
expectTypeOf(fx(play(deliverOrder, { items: [card], card }))).toEqualTypeOf<Promise<void>>();
expectTypeOf(sfx("board.merge")).toExtend<FxStep>();
sequence(sfx("board.merge"), haptic("light"));
