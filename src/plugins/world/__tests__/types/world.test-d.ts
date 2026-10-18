import { expectTypeOf } from "vitest";
import type { World } from "../../../../index";
import { defineFeature, defineGame, Now } from "../../../../index";
import { component, mut, resource, system, tag } from "../../ecs/define";
import type {
  AnySystem,
  ComponentSchema,
  EcsApi,
  Entity,
  EntityDiff,
  FrameDiff,
  Owner,
  QueryTuple,
  ResourceType
} from "../../ecs/types";
import { projection } from "../../projection/define";
import type {
  DescriptionNode,
  Ease,
  ProjectionApi,
  TrackOptions,
  TweenOptions
} from "../../projection/types";
import type { Events, Explained, KernelSlice } from "../../types";

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

// `scenes` is a list of scene ids, and a system with it is still a system the world takes.
const shade = system({
  name: "board.shade",
  phase: "sync",
  query: [Sprite],
  scenes: ["board"],
  run: () => undefined
});

expectTypeOf(shade).toMatchTypeOf<AnySystem>();

system({
  name: "board.glow",
  phase: "sync",
  query: [Sprite],
  // @ts-expect-error — one scene is still a list: scenes: ["board"]
  scenes: "board",
  run: () => undefined
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

// The structural hooks watch a tag as well as a component: a tag listener gets the entity only.
ecs.onAdded(Held, entity => {
  expectTypeOf(entity).toEqualTypeOf<Entity>();
});
ecs.onRemoved(Held, entity => {
  expectTypeOf(entity).toEqualTypeOf<Entity>();
});

// A component listener still gets the stored value, typed from the defaults.
ecs.onAdded(Sprite, (entity, sprite) => {
  expectTypeOf(entity).toEqualTypeOf<Entity>();
  expectTypeOf(sprite).toEqualTypeOf<Readonly<Sprite>>();
});

// @ts-expect-error — a tag carries no value, so its listener takes the entity alone
ecs.onAdded(Held, (_entity: Entity, _value: Readonly<Sprite>) => undefined);

// A tween and a track repeat a number of extra runs or forever, nothing else.
expectTypeOf<TweenOptions["repeat"]>().toEqualTypeOf<number | "forever" | undefined>();
expectTypeOf<TrackOptions["repeat"]>().toEqualTypeOf<number | "forever" | undefined>();
// @ts-expect-error — repeat is a count or "forever", not a flag.
const looping: TweenOptions = { ms: 100, repeat: true };

expectTypeOf(looping).toEqualTypeOf<TweenOptions>();

// The three members the doors read: two on ecs, one on projection.
expectTypeOf(ecs.diff).toEqualTypeOf<(from: number, to: number) => FrameDiff>();
expectTypeOf(ecs.schema).toEqualTypeOf<() => readonly ComponentSchema[]>();
expectTypeOf(projectionApi.motionsOf).toEqualTypeOf<(entity: Entity) => readonly string[]>();
// The seam the owner of elements listens on after a restore: a listener in, its remover out.
expectTypeOf(projectionApi.onConverged).toEqualTypeOf<(listener: () => void) => () => void>();
expectTypeOf<EntityDiff["change"]>().toEqualTypeOf<"spawned" | "despawned" | "changed">();

// @ts-expect-error — diff takes two frame numbers, not frame labels
ecs.diff("120", "180");

// The four new types reach a game through the World namespace of the package root.
expectTypeOf<World.ComponentSchema>().toEqualTypeOf<ComponentSchema>();
expectTypeOf<World.FrameDiff>().toEqualTypeOf<FrameDiff>();
expectTypeOf<World.EntityDiff>().toEqualTypeOf<EntityDiff>();
expectTypeOf<World.Explained>().toEqualTypeOf<Explained>();

// A resource is typed by its defaults, or by what its factory returns: the factory is the default.
expectTypeOf(resource("Pointer", { x: 0, down: false })).toEqualTypeOf<
  ResourceType<{ x: number; down: boolean }>
>();
expectTypeOf(resource("boardLooks", () => ({ shown: new Map<Entity, string>() }))).toEqualTypeOf<
  ResourceType<{ shown: Map<Entity, string> }>
>();

// ─── the kit's system reads the snapshot typed by the game ────

type BoardPlayer = { board: { cells: number[] } };

const { system: gameSystem } = defineGame<{
  player: BoardPlayer;
  session: { turn: number };
  assets: string;
  strings: Record<string, never>;
}>();

const looks = gameSystem({
  name: "board.looks",
  phase: "animate",
  query: [mut(Position), Held],
  run: (rows, { snapshot, time }) => {
    expectTypeOf(snapshot.player.board.cells).toEqualTypeOf<number[]>();
    expectTypeOf(snapshot.session.turn).toEqualTypeOf<number>();
    expectTypeOf(time.delta).toEqualTypeOf<number>();

    for (const [, position] of rows) position.x = snapshot.player.board.cells.length;
  }
});

gameSystem({
  name: "board.coins",
  phase: "animate",
  query: [],
  run: (_rows, { snapshot }) => {
    // @ts-expect-error — the player of this game has no `coins`.
    expectTypeOf(snapshot.player.coins).toBeNumber();
  }
});

// The result goes where the world takes a system: a feature's systems list, or `ecs.system`.
expectTypeOf(looks).toExtend<AnySystem>();
ecs.system(looks);
defineFeature("board", { systems: [looks] });

// ─── Now, the frame's moment, reaches a game from the package root ────

expectTypeOf(Now).toEqualTypeOf<ResourceType<{ now: number }>>();
system({
  name: "test.clock",
  phase: "animate",
  query: [],
  run: (_rows, { res }) => {
    expectTypeOf(res(Now).now).toEqualTypeOf<number>();
  }
});
