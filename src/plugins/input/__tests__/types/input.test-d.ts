import { expectTypeOf } from "vitest";
import type { EcsApi, Entity, TagType } from "../../../world/types";
import type { PointerValue } from "../../components";
import { PointerOver } from "../../components";
import type { Config, InputApi, RawSample, TapListener, Target } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error.
// ---------------------------------------------------------------------------

// ─── PointerOver is a tag ─────────────────────────────────────

expectTypeOf(PointerOver).toEqualTypeOf<TagType>();
expectTypeOf(PointerOver().value).toEqualTypeOf<true>();

// @ts-expect-error — a tag carries no data, so it takes no patch
PointerOver({ x: 1 });

declare const ecs: EcsApi;
declare const button: Entity;

// A game system reads and writes it like any tag.
ecs.tag(button, PointerOver);
expectTypeOf(ecs.has(button, PointerOver)).toEqualTypeOf<boolean>();

// `ui` listens for the hover: a tag listener gets the entity only.
ecs.onAdded(PointerOver, entity => {
  expectTypeOf(entity).toEqualTypeOf<Entity>();
});

// @ts-expect-error — a tag carries no value, so its listener takes the entity alone
ecs.onAdded(PointerOver, (_entity: Entity, _value: Readonly<PointerValue>) => undefined);

// ─── the config takes a held scale ────────────────────────────

expectTypeOf<Config["heldScale"]>().toEqualTypeOf<number>();

// A merge game carries the item in the hand 8% bigger.
export const liftedHand: Partial<Config> = { heldScale: 1.08 };

// @ts-expect-error — the held scale is a factor, a number
export const wrongScale: Partial<Config> = { heldScale: "1.08" };

// ─── the cursor of the canvas ─────────────────────────────────

expectTypeOf<InputApi["cursor"]>().toEqualTypeOf<() => string>();
expectTypeOf<Config["cursor"]>().toEqualTypeOf<{ control: string; idle: string }>();

// A game with its own cursors names both: the config merges shallowly.
export const ownCursors: Partial<Config> = { cursor: { control: "grab", idle: "default" } };

// @ts-expect-error — the cursor config is an object of two CSS values, not one value
export const flatCursor: Partial<Config> = { cursor: "pointer" };

// @ts-expect-error — a shallow merge keeps no default, so `idle` is required next to `control`
export const halfCursor: Partial<Config> = { cursor: { control: "grab" } };

// ─── a raw sample names its device ────────────────────────────

expectTypeOf<RawSample["pointerType"]>().toEqualTypeOf<"mouse" | "touch" | "pen">();

export const touchDown: RawSample = {
  kind: "down",
  pointerType: "touch",
  pointerId: 1,
  clientX: 320,
  clientY: 640
};

export const stylusMove: RawSample = {
  kind: "move",
  // @ts-expect-error — only a mouse, a touch or a pen reaches the queue
  pointerType: "stylus",
  pointerId: 1,
  clientX: 320,
  clientY: 640
};

// ─── the input API keeps its types ────────────────────────────

declare const input: InputApi;

expectTypeOf(input.tap).toEqualTypeOf<(target: Target) => boolean>();
expectTypeOf<Target>().toEqualTypeOf<{ projection: string; key: string } | Entity>();

input.tap({ projection: "board.generators", key: "g1" });
input.tap(button);

// @ts-expect-error — a target is a projection key pair or an entity, not a bare key
input.tap("g1");

expectTypeOf(input.onTap).toEqualTypeOf<(fn: TapListener) => () => void>();
expectTypeOf<TapListener>().toEqualTypeOf<(entity: Entity) => void>();

const off = input.onTap(entity => {
  expectTypeOf(entity).toEqualTypeOf<Entity>();
});

expectTypeOf(off).toEqualTypeOf<() => void>();

// @ts-expect-error — a tap listener gets the entity, not a projection key
input.onTap((key: string) => key.length);
