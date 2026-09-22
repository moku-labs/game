import { expectTypeOf } from "vitest";
import { component, mut, system, tag } from "../../ecs/define";
import type { EcsApi, Entity, Owner, QueryTuple } from "../../ecs/types";
import { projection } from "../../projection/define";
import type { DescriptionNode, Ease, ProjectionApi } from "../../projection/types";
import type { Events, KernelSlice } from "../../types";

type Position = { x: number; y: number };
type Sprite = { texture: string };
type Item = { id: string; level: number };

const Position = component("Position", { x: 0, y: 0 });
const Sprite = component("Sprite", { texture: "" });
const Held = tag("Held");

// A query tuple is the entity, then a writable value per `mut` term, a read-only value per plain
// component and `true` per tag.
expectTypeOf<QueryTuple<[typeof Position, typeof Sprite, typeof Held]>>().toEqualTypeOf<
  [Entity, Readonly<Position>, Readonly<Sprite>, true]
>();
expectTypeOf<QueryTuple<[ReturnType<typeof mut<Position>>]>>().toEqualTypeOf<[Entity, Position]>();

system({
  name: "writes",
  phase: "animate",
  query: [mut(Position), Sprite, Held],
  run: entities => {
    for (const [entity, position, sprite, held] of entities) {
      expectTypeOf(entity).toEqualTypeOf<Entity>();
      expectTypeOf(held).toEqualTypeOf<true>();
      expectTypeOf(sprite).toEqualTypeOf<Readonly<Sprite>>();
      position.x += 1;
      // @ts-expect-error — a term without mut() is read-only
      sprite.texture = "other";
    }
  }
});

// The item type comes from `from` and reaches `key`, `view` and every motion hook.
const boardItems = projection({
  name: "board.items",
  layer: "items",
  lift: "lifted",
  from: (player: { items: Item[] }) => player.items,
  key: item => {
    expectTypeOf(item).toEqualTypeOf<Item>();

    return item.id;
  },
  view: item => [Position({ x: item.level })],
  motion: {
    change: {
      Position: (view, previous, next) => {
        expectTypeOf(previous).toEqualTypeOf<Item>();
        expectTypeOf(next).toEqualTypeOf<Item>();
        expectTypeOf(view.peer("a")).toEqualTypeOf<Item | undefined>();

        return view.toRest(Position);
      }
    }
  }
});

// `layer` and `lift` keep their literal types, so a scene can check them against its layer keys.
expectTypeOf(boardItems.layer).toEqualTypeOf<"items">();
expectTypeOf(boardItems.lift).toEqualTypeOf<"lifted" | undefined>();

// The V3 eases sit next to the four short names and the function form.
expectTypeOf<Ease>().toEqualTypeOf<
  | "linear"
  | "in"
  | "out"
  | "inOut"
  | "inCubic"
  | "outCubic"
  | "inOutCubic"
  | "inBack"
  | "outBack"
  | ((t: number) => number)
>();

// A screen: `from` returns one plain object, `key` is omitted and `view` returns one node.
const hud = projection({
  name: "hud",
  layer: "ui",
  from: (player: { hud: { coins: number } }) => player.hud,
  view: item => {
    expectTypeOf(item).toEqualTypeOf<{ coins: number }>();

    const node: DescriptionNode = { type: "box", props: { coins: item.coins }, children: [] };

    return node;
  }
});

expectTypeOf(hud.layer).toEqualTypeOf<"ui">();

// The event payload carries every count of one reconcile.
expectTypeOf<Events["world:reconciled"]["mode"]>().toEqualTypeOf<"play" | "direct">();

// @ts-expect-error — an empty object is not a reconcile payload
export const wrongPayload: Events["world:reconciled"] = {};

// The own event reaches the plugin context: `emit` is the kernel's, typed with world's event map.
declare const worldCtx: KernelSlice;

expectTypeOf(worldCtx.emit).parameter(0).toEqualTypeOf<"world:reconciled">();

// @ts-expect-error — an empty object is not a reconcile payload
worldCtx.emit("world:reconciled", {});

declare const ecs: EcsApi;

// @ts-expect-error — spawn needs an owner; the components alone are not a call
ecs.spawn([Position()]);

// @ts-expect-error — a projection cannot be mounted without an owner
ecs.despawnOwnedBy();

expectTypeOf(ecs.spawn).parameter(0).toEqualTypeOf<Owner>();

declare const projectionApi: ProjectionApi;

// The hosted list is read-only entities; the name is the only argument.
expectTypeOf(projectionApi.entitiesOf).toEqualTypeOf<(name: string) => readonly Entity[]>();

// @ts-expect-error — entitiesOf takes the projection name, not a key list
projectionApi.entitiesOf(["board.items"]);
