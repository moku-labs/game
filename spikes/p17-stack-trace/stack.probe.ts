/**
 * P17 probe, stack half. A full headless app (real world, projection, input, inert renderer).
 * Carries card c2 of a fanned pile with c3 and c4 on top of it, two ways, and checks where every
 * card ends after a cancel (settle). Uses only public world and pose calls, the ones drag.ts uses.
 * Spike code, not engine code.
 */
import { describe, expect, it } from "vitest";
import { createApp, defineGame, Order, Parent, screen, Transform, type } from "../../src/index";
import { localPoseOf, rootPoseOf } from "../../src/plugins/renderer/sync/pose";
import { projection } from "../../src/plugins/world/projection/define";
import { Draggable, DropTarget } from "../../src/plugins/input/components";

type Card = { id: string; pile: number; index: number };
type Player = { cards: Card[] };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, unknown>;
}>();

const cards = projection({
  name: "pile.cards",
  layer: "cards",
  lift: "lifted",
  from: (player: Player) => player.cards,
  key: (card: Card) => card.id,
  view: (card: Card) => [
    Transform({ x: 100 + card.pile * 200, y: 100 + card.index * 30 }),
    Order({ value: card.index }),
    Draggable({ payload: { from: card.id } }),
    DropTarget({ intent: "place", payload: { to: card.pile } })
  ]
});

const home = defineNode({ outcomes: { place: type<{ from: string; to: number }>() }, rest: true });
const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: { place: "home" } }
});
const feature = defineFeature("pile", { flows: [main], projections: [cards] });

const tick = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
};

async function startApp() {
  const app = createApp({
    plugins: [...screen, feature],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: {
        initialPlayer: {
          cards: [
            { id: "c1", pile: 0, index: 0 },
            { id: "c2", pile: 0, index: 1 },
            { id: "c3", pile: 0, index: 2 },
            { id: "c4", pile: 0, index: 3 }
          ]
        },
        initialSession: {},
        seed: 1
      }
    }
  });
  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([
    { name: "cards", sort: "order" },
    { name: "lifted", sort: "order" }
  ]);
  app.world.projection.mount(["pile.cards"], { kind: "plugin", name: "p17" });
  app.time.step(16);
  return app;
}

type App = Awaited<ReturnType<typeof startApp>>;
const ids = (app: App, keys: string[]): number[] =>
  keys.map(key => app.world.projection.entityOf("pile.cards", key) ?? 0);
const xy = (app: App, e: number): string => {
  const pose = rootPoseOf(app.world.ecs, e);
  return `${Math.round(pose.x)},${Math.round(pose.y)}`;
};

/** Lets every settle motion end (default settleMs is well under 1 s). */
function runOut(app: App): void {
  for (let i = 0; i < 90; i += 1) app.time.step(16);
}

describe("P17 stack carry", () => {
  it("A: followers hang under the held card (Parent), held card is carried as today", async () => {
    const app = await startApp();
    const [held, f3, f4] = ids(app, ["c2", "c3", "c4"]) as [number, number, number];
    const { ecs, projection: pj } = app.world;
    const rest = [held, f3, f4].map(e => xy(app, e));

    // grab: held as drag.ts does; followers: mute the root-pose fields, then Parent + local pose.
    const unmutes = [pj.mute(held, Transform, ["x", "y"])];
    pj.lift(held, true);
    for (const f of [f3, f4]) {
      unmutes.push(pj.mute(f, Transform, ["x", "y", "rotation", "scale"]));
      const local = localPoseOf(ecs, held, rootPoseOf(ecs, f));
      ecs.add(f, Parent({ entity: held }));
      ecs.set(f, Transform, local);
    }

    // move: one write per frame, on the held card only.
    ecs.set(held, Transform, { x: 400, y: 300 });
    app.time.step(16);
    const carried = [held, f3, f4].map(e => xy(app, e));
    console.log(`[p17] A rest ${JSON.stringify(rest)} carried ${JSON.stringify(carried)}`);
    expect(carried).toEqual(["400,300", "400,330", "400,360"]);

    // A commit while carrying: reconcile must not fight the followers' Parent.
    app.time.step(16);
    expect(ecs.get(f3, Parent)?.entity).toBe(held);

    // cancel, WRONG order: settle while still parented.
    for (const u of unmutes) u();
    for (const e of [held, f3, f4]) pj.settle(e);
    pj.lift(held, false);
    runOut(app);
    const wrong = [held, f3, f4].map(e => xy(app, e));
    console.log(`[p17] A settle while parented -> ${JSON.stringify(wrong)} (rest ${JSON.stringify(rest)})`);

    await app.stop();
  });

  it("A': same, but followers leave the Parent (root pose written) before settle", async () => {
    const app = await startApp();
    const [held, f3, f4] = ids(app, ["c2", "c3", "c4"]) as [number, number, number];
    const { ecs, projection: pj } = app.world;
    const rest = [held, f3, f4].map(e => xy(app, e));

    const unmutes = [pj.mute(held, Transform, ["x", "y"])];
    pj.lift(held, true);
    for (const f of [f3, f4]) {
      unmutes.push(pj.mute(f, Transform, ["x", "y", "rotation", "scale"]));
      const local = localPoseOf(ecs, held, rootPoseOf(ecs, f));
      ecs.add(f, Parent({ entity: held }));
      ecs.set(f, Transform, local);
    }
    ecs.set(held, Transform, { x: 400, y: 300 });
    app.time.step(16);

    // cancel, RIGHT order: unparent (root pose), lift followers so they stay above, unmute, settle.
    for (const f of [f3, f4]) {
      const root = rootPoseOf(ecs, f);
      ecs.remove(f, Parent);
      ecs.set(f, Transform, root);
      pj.lift(f, true);
    }
    for (const u of unmutes) u();
    for (const e of [held, f3, f4]) {
      pj.settle(e);
      pj.lift(e, false);
    }
    app.time.step(16);
    const midway = [held, f3, f4].map(e => xy(app, e));
    runOut(app);
    const home = [held, f3, f4].map(e => xy(app, e));
    console.log(`[p17] A' midway ${JSON.stringify(midway)} home ${JSON.stringify(home)}`);
    expect(home).toEqual(rest);

    await app.stop();
  });

  it("B: every card muted, lifted and written each frame (no Parent)", async () => {
    const app = await startApp();
    const group = ids(app, ["c2", "c3", "c4"]);
    const { ecs, projection: pj } = app.world;
    const rest = group.map(e => xy(app, e));
    const finger = { x: 100, y: 130 };
    const offsets = group.map(e => {
      const t = ecs.get(e, Transform);
      return { x: (t?.x ?? 0) - finger.x, y: (t?.y ?? 0) - finger.y };
    });
    const unmutes = group.map(e => pj.mute(e, Transform, ["x", "y"]));
    for (const e of group) pj.lift(e, true); // bottom first

    const moveTo = (x: number, y: number): void =>
      group.forEach((e, i) => ecs.set(e, Transform, { x: x + (offsets[i]?.x ?? 0), y: y + (offsets[i]?.y ?? 0) }));
    moveTo(400, 300);
    app.time.step(16);
    const carried = group.map(e => xy(app, e));
    const orders = group.map(e => ecs.get(e, Order)?.value);
    console.log(`[p17] B carried ${JSON.stringify(carried)} orders ${JSON.stringify(orders)}`);
    expect(carried).toEqual(["400,300", "400,330", "400,360"]);

    for (const u of unmutes) u();
    for (const e of group) {
      pj.settle(e);
      pj.lift(e, false);
    }
    runOut(app);
    const home = group.map(e => xy(app, e));
    console.log(`[p17] B home ${JSON.stringify(home)}`);
    expect(home).toEqual(rest);

    await app.stop();
  });

  it("scripted door: app.input.drag carries one card today, the followers never move", async () => {
    const app = await startApp();
    const [c2, c3, c4] = ids(app, ["c2", "c3", "c4"]) as [number, number, number];
    const before = [c3, c4].map(e => xy(app, e));
    // Drop c2 on the pile 0 (its own pile): the answer names only from: c2.
    const accepted = app.input.drag(c2, c4);
    console.log(`[p17] app.input.drag(c2 -> c4) accepted=${accepted}, followers ${JSON.stringify([c3, c4].map(e => xy(app, e)))}`);
    expect([c3, c4].map(e => xy(app, e))).toEqual(before);
    await app.stop();
  });
});

// Renderer side, mock renderer over the fake Pixi: where a parented follower is drawn and hit.
import { FakeTexture } from "../../src/plugins/renderer/__tests__/fake-pixi";
import { createMockRenderer } from "../../src/plugins/renderer/__tests__/mock-renderer";
import { Sprite } from "../../src/plugins/renderer/components";
import { Layer } from "../../src/plugins/world/ecs/define";

describe("P17 stack carry, renderer", () => {
  it("a follower under Parent hangs in the held card's wrapper and is hit before it", async () => {
    const mock = createMockRenderer();
    await mock.start();
    mock.api.sync.textures.provide(() => new FakeTexture({}) as never);
    mock.world.projection.setLayers([
      { name: "cards", sort: "order" },
      { name: "lifted", sort: "order" }
    ]);
    mock.modules.sync.pass();
    const owner = { kind: "plugin", name: "p17" } as const;
    const spawn = (y: number, order: number, layer = "cards"): number =>
      mock.world.ecs.spawn(owner, [Layer({ name: layer }), Transform({ x: 100, y }), Sprite({ texture: "card" }), Order({ value: order })]);
    const held = spawn(130, 1, "lifted");
    const follower = spawn(160, 2);
    mock.modules.sync.pass();
    mock.world.ecs.add(follower, Parent({ entity: held }));
    mock.world.ecs.set(follower, Transform, { x: 0, y: 30 });
    mock.modules.sync.pass();

    const views = (mock.ctx.state as unknown as { sync: { views: Map<number, { object: { parent: { label: string; parent: { label: string } | null } | null } ; layer: string }> } }).sync.views;
    const fv = views.get(follower);
    const hv = views.get(held);
    console.log(`[p17] follower drawn in: ${fv?.object.parent?.label ?? "?"} > ${fv?.object.parent?.parent?.label ?? "?"}, view.layer="${fv?.layer}"; held in ${hv?.object.parent?.label ?? "?"}`);

    // Drop lookup as hit.ts does it today: everything but the held card.
    const notHeld = (e: number): boolean => e !== held;
    console.log(`[p17] hitTest at the follower (100,175), excluding only held -> ${mock.api.sync.hitTest(100, 175, notHeld) === follower ? "follower" : "other"}`);
    console.log(`[p17] hitTest at the overlap (100,150), any -> ${mock.api.sync.hitTest(100, 150, () => true) === follower ? "follower" : "held"}`);
    expect(mock.api.sync.hitTest(100, 175, notHeld)).toBe(follower);
  });
});
