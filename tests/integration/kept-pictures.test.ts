/**
 * @file Root integration — kept pictures (spec 23 T3): ports of the game's `kept-pictures.test.ts` and of the still
 * blur of `still-and-warm.test.ts`, across renderer, effects, world and flow. A filtered view that stands still is
 * filtered once and drawn as one quad; one that moves keeps its picture; one whose subtree churns is drawn live. The
 * renderer draws on demand over Pixi's own objects (`stagePixi`: renders into textures are logged), and the tree
 * oracle and the picture oracle check every frame: a frame skipped over a changed picture, or a drawn frame that shows
 * a picture that is not current, fails the test.
 */
import { readFile } from "node:fs/promises";
import type { Assets, World } from "@moku-labs/game";
import {
  Blur,
  ColorMatrix,
  component,
  defineFilter,
  defineGame,
  Glow,
  Layer,
  mut,
  Parent,
  resource,
  Shape,
  Sprite,
  system,
  Transform,
  type
} from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { fakeClock } from "@moku-labs/game/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOFT_STAGES, Soft } from "../../src/plugins/effects/__tests__/filter-fixtures";
import { homeFeature } from "../fixtures/mini-game/features/home";
import { infoFeature } from "../fixtures/mini-game/features/info";
import { mainFlow as miniFlow } from "../fixtures/mini-game/flows/main";
import { startingPlayer, startingSession } from "../fixtures/mini-game/state";
import { diskIo, openPage, type Watched, watch } from "./drawn-helpers";

/** The folder of the mini game: its manifest, font and spark serve this fixture too. */
const MINI = new URL("../fixtures/mini-game/", import.meta.url);

/** The owner of every view the tests spawn. */
const OWNER = { kind: "plugin", name: "kept" } as const;

/** The typed kit of the fixture. */
const kit = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: "ui.font-body" | "ui.fx-spark";
  scenes: "main";
  strings: Record<string, never>;
  textStyles: never;
  emitters: never;
}>();
const { defineNode, defineFlow, defineFeature, defineScene } = kit;

/** A view that drifts: its x grows by `speed` in every frame while `frames` is above 0. */
const Drift = component("kept.drift", { speed: 1, frames: 1_000_000 });

/** What the tone tween of the frost writes: on, the tone grows in every frame. */
const Tween = resource("kept.tween", { on: false, tone: 0 });

/** A lens that reads where it is drawn through the engine's helper: kept with its canvas origin. */
const Lens = defineFilter("kept.lens", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { let at = canvasPixel(uv); return textureSample(uTexture, uSampler, uv) * (1.0 + 0.0 * at.x) * fu.amount; }",
  glsl: "void main() { vec2 at = canvasPixel(vTextureCoord); finalColor = texture(uTexture, vTextureCoord) * (1.0 + 0.0 * at.x) * amount; }",
  uniforms: { amount: 1 }
});

/** The frost of a root: a filter over a busy subtree. */
const Frost = defineFilter("kept.frost", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv) * fu.strength; }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord) * strength; }",
  uniforms: { strength: 1 }
});

const drift = system({
  name: "kept.drift",
  phase: "animate",
  query: [mut(Drift), mut(Transform)],
  run: rows => {
    for (const [, motion, transform] of rows) {
      if (motion.frames <= 0) continue;

      motion.frames -= 1;
      transform.x += motion.speed;
    }
  }
});

const tween = system({
  name: "kept.tween",
  phase: "sync",
  query: [mut(Soft)],
  run: (rows, context) => {
    const state = context.res(Tween);

    if (!state.on) return;

    state.tone += 0.01;

    for (const [, filter] of rows) filter.tone = state.tone;
  }
});

const rest = defineNode({ scene: "main", outcomes: { go: type() }, rest: true, checkpoint: true });

const flow = defineFlow("main", {
  nodes: { rest },
  start: "rest",
  edges: { rest: { go: "rest" } }
});

const main = defineScene("main", {
  bundle: "ui",
  layers: { main: { sort: "order" }, top: { sort: "none" } },
  projections: []
});

const keptFeature = defineFeature("kept", {
  scenes: [main],
  systems: [drift, tween],
  filters: [Lens, Frost, Soft, ...SOFT_STAGES]
});

/** A running fixture. */
type Kept = Watched & {
  app: ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];
  page: ReturnType<typeof openPage>;
  /** Spawns a view in the `main` layer. */
  spawn(...components: World.AnyComponentValue[]): World.Entity;
  /** Spawns a child of a view. */
  child(parent: World.Entity, ...components: World.AnyComponentValue[]): World.Entity;
  /** The renders into a stage of an entity's picture: `"#1"`, `"#3"`, `"#2"`. */
  renders(entity: World.Entity, stage: string): number;
  /** Whether an entity's view is drawn from its picture now. */
  isKept(entity: World.Entity): boolean;
};

/**
 * What the labels of an entity's pictures carry: `kept:<label of its top>#<stage>`, its top labelled by the entity.
 *
 * @param entity - The entity.
 * @returns The part of the label.
 */
function labelOf(entity: World.Entity): string {
  return `#${entity}`;
}

/** What a test reads of a display object: its label, whether it is drawn, the container it hangs in. */
type Node = { label: string; renderable: boolean; parent: Node | null };

/**
 * The top of a view from its object: the wrapper it hangs in when it has one, a parent's (`parent#<entity>`) or a kept
 * bare view's, which carries the view's own label (spec 23 D4); the object otherwise.
 *
 * @param object - The view's display object.
 * @returns Its top.
 */
function topOf(object: Node): Node {
  const parent = object.parent;
  const wrapped =
    parent !== null && (parent.label.startsWith("parent#") || parent.label === object.label);

  return wrapped ? parent : object;
}

/** The fixtures started by the running test, stopped by `afterEach`. */
const running: Array<{ app: Kept["app"]; watched: Watched }> = [];

afterEach(async () => {
  for (const { app, watched } of running.splice(0)) {
    watched.oracle.expectNoMissedFrame();
    watched.oracle.expectPicturesCurrent();
    await app.stop();
  }

  vi.unstubAllGlobals();
});

/**
 * Starts the fixture on a page, drawing on demand, and lets it rest.
 *
 * @param onDemand - `config.onDemand`; on by default.
 * @returns The running fixture.
 */
async function open(onDemand = true): Promise<Kept> {
  const page = openPage();
  const clock = fakeClock(1_000_000);
  const mini = JSON.parse(
    await readFile(new URL("generated/manifest.json", MINI), "utf8")
  ) as Assets.Manifest;
  const manifest: Assets.Manifest = {
    ...mini,
    bundles: { ui: mini.bundles.ui ?? { feature: "ui", tier: "boot", mb: 0, files: [] } }
  };
  const { app } = defineGameApp({
    flow,
    safeNode: "rest",
    player: { n: 0 },
    session: {},
    referenceSide: 390,
    features: [keptFeature],
    pluginConfigs: { log: { mode: "test" }, renderer: { onDemand } }
  }).screen({ manifest, io: diskIo(MINI, manifest), renderer: page.renderer, clock });

  await app.start();
  app.flow.run().catch(() => undefined);

  const ecs = app.world.ecs;
  const watched = watch(app, page, clock);
  const kept: Kept = {
    ...watched,
    app,
    page,
    spawn: (...components) => ecs.spawn(OWNER, [Layer({ name: "main" }), ...components]),
    child: (parent, ...components) => ecs.spawn(OWNER, [Parent({ entity: parent }), ...components]),
    renders: (entity, stage) =>
      page.stage.targets().filter(call => {
        const target = call.target?.source.label ?? "";
        const container = call.container.label ?? "";
        const mine = target.startsWith("kept:") && target.includes(labelOf(entity));

        // Stage 2 renders the keeper's stand-in into the output texture; stage 3 the stand-in with the filters.
        if (stage === "#2") return mine && container.endsWith("#2");

        return mine && target.endsWith(stage) && !container.endsWith("#2");
      }).length,
    isKept: entity => {
      const object = app.renderer.sync.displayOf(entity) as Node | undefined;

      return object !== undefined && !topOf(object).renderable;
    }
  };

  running.push({ app, watched });

  for (let frame = 0; frame < 200 && app.flow.state().path !== "rest"; frame += 1) {
    await kept.frames(1);
  }

  await kept.frames(30);

  return kept;
}

/**
 * A square shape.
 *
 * @param size - Its side.
 * @param fields - Other fields of the shape.
 * @returns The component value.
 */
const square = (size: number, fields: Parameters<typeof Shape>[0] = {}) =>
  Shape({ w: size, h: size, fill: 0x44_66_88, ...fields });

describe("kept pictures across the engine", () => {
  it("a blurred backdrop that stands still is filtered once", async () => {
    const kept = await open();
    const backdrop = kept.spawn(
      Transform({ x: 20, y: 20 }),
      square(300),
      Blur({ strength: 6 }),
      ColorMatrix({ saturation: 0.4 })
    );
    const sheet = kept.spawn(
      Transform({ x: 40, y: 400 }),
      square(200),
      Drift({ speed: 1, frames: 4 })
    );

    kept.child(backdrop, Transform({ x: 30, y: 30 }), square(60, { fill: 0xff_00_00 }));
    await kept.frames(6);

    expect(kept.isKept(backdrop)).toBe(true);
    expect(kept.renders(backdrop, "#1")).toBe(1);
    expect(kept.app.renderer.stats().renderPasses).toBe(1);

    // The sheet keeps moving for a while: frames are drawn, the backdrop is not filtered again.
    kept.app.world.ecs.set(sheet, Drift, { frames: 60 });
    expect(await kept.frames(60)).toBe(60);
    expect(kept.renders(backdrop, "#1")).toBe(1);
    expect(kept.renders(backdrop, "#3")).toBe(1);
  });

  it("the shadow of a flying object is one picture for its whole flight", async () => {
    const kept = await open();
    const shadow = kept.spawn(
      Transform({ x: 20, y: 600 }),
      square(48, { fill: 0x00_00_00 }),
      Blur({ strength: 4 })
    );

    await kept.frames(1);
    // 560 ms of flight at 16 ms a frame, a whole pixel a frame.
    kept.app.world.ecs.add(shadow, Drift({ speed: 2, frames: 35 }));

    expect(await kept.frames(35)).toBe(35);
    expect(kept.renders(shadow, "#1")).toBe(1);
    expect(kept.isKept(shadow)).toBe(true);
    expect(await kept.frames(10)).toBe(0);
  });

  it("a splash root under breathing rings is one picture; the rings are live", async () => {
    const kept = await open();
    const splash = kept.spawn(Transform({ x: 0, y: 0 }), square(380), Frost({ strength: 0.9 }));

    kept.child(splash, Transform({ x: 40, y: 40 }), square(80, { fill: 0xff_ee_aa }));

    const rings = [1, 2, 3].map(index =>
      kept.spawn(
        Transform({ x: 60 * index, y: 500 }),
        square(20),
        Drift({ speed: 1, frames: 1000 })
      )
    );

    expect(await kept.frames(40)).toBe(40);
    expect(kept.renders(splash, "#1")).toBe(1);
    expect(kept.isKept(splash)).toBe(true);
    expect(rings.every(ring => !kept.isKept(ring))).toBe(true);
  });

  it("a uniform tween over a still subtree redoes only the filter output", async () => {
    const kept = await open();
    const ward = kept.spawn(Transform({ x: 0, y: 0 }), square(380), Soft({ spread: 1 }));
    // A lamp keeps the first frames drawn, so the ward is taken.
    kept.spawn(Transform({ x: 20, y: 700 }), square(10), Drift({ speed: 1, frames: 3 }));

    kept.child(ward, Transform({ x: 40, y: 40 }), square(80, { fill: 0xff_ee_aa }));
    await kept.frames(5);

    expect(kept.isKept(ward)).toBe(true);
    expect(kept.renders(ward, "#2")).toBe(1);

    kept.app.world.ecs.resource(Tween).on = true;

    expect(await kept.frames(10)).toBe(10);
    expect(kept.renders(ward, "#1")).toBe(1);
    expect(kept.renders(ward, "#2")).toBe(1);
    expect(kept.renders(ward, "#3")).toBe(11);
  });

  it("a photo swapped under a blur is in the next drawn frame", async () => {
    const kept = await open();
    const frame = kept.spawn(Transform({ x: 20, y: 20 }), square(200), Blur({ strength: 2 }));
    const photo = kept.child(
      frame,
      Transform({ x: 10, y: 10 }),
      Sprite({ texture: "ui.fx-spark", width: 64, height: 64 })
    );

    await kept.frames(1);
    kept.spawn(Transform({ x: 20, y: 700 }), square(10), Drift({ speed: 1, frames: 3 }));
    await kept.frames(4);

    expect(kept.isKept(frame)).toBe(true);

    kept.app.world.ecs.set(photo, Sprite, { texture: "ui.font-body" });

    expect(await kept.frames(1)).toBe(1);
    expect(kept.renders(frame, "#1")).toBe(2);
  });

  it("the memory screen: the fog copy and the lens window stay kept at rest, the frosted root over drifting puffs goes live", async () => {
    const kept = await open();
    const root = kept.spawn(Transform({ x: 0, y: 0 }), square(380), Frost({ strength: 0.8 }));
    const puffs = [1, 2, 3].map(index =>
      kept.child(
        root,
        Transform({ x: 30 * index, y: 120 }),
        square(40),
        Drift({ speed: 0.5, frames: 1000 })
      )
    );
    const fog = kept.spawn(Transform({ x: 10, y: 400 }), square(160), Blur({ strength: 8 }));
    const lens = kept.spawn(Transform({ x: 200, y: 400 }), square(120), Lens({ amount: 1 }));

    expect(await kept.frames(120)).toBe(120);
    expect(puffs).toHaveLength(3);
    expect(kept.isKept(fog)).toBe(true);
    expect(kept.isKept(lens)).toBe(true);
    expect(kept.renders(fog, "#1")).toBe(1);
    expect(kept.renders(lens, "#1")).toBe(1);
    expect(kept.isKept(root)).toBe(false);
    expect(kept.app.renderer.stats().kept.pictures).toBe(2);
  });
});

describe("nested pictures across the engine", () => {
  it("a glowing badge inside a blurred card: both kept, the inner first", async () => {
    const kept = await open(false);
    const card = kept.spawn(
      Transform({ x: 60, y: 60 }),
      square(260),
      Blur({ strength: 2, quality: 1 })
    );
    const badge = kept.child(
      card,
      Transform({ x: 40, y: 40 }),
      square(80, { fill: 0xff_aa_00 }),
      Glow({ strength: 2, distance: 8 })
    );

    const trail: string[] = [];

    for (let frame = 0; frame < 10; frame += 1) {
      await kept.frames(1);
      trail.push(`${kept.isKept(badge)}/${kept.isKept(card)}`);
    }

    console.log(trail.join(" "));
    expect([kept.isKept(badge), kept.isKept(card)]).toEqual([true, true]);
  });
});

describe("the mini game with kept pictures", () => {
  it("keeps the honey glow of its info popup while the sparks fly, the oracles clean", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const page = openPage(1080, 1920);
    const manifest = JSON.parse(
      await readFile(new URL("generated/manifest.json", MINI), "utf8")
    ) as Assets.Manifest;
    const { app } = defineGameApp({
      flow: miniFlow,
      safeNode: "home",
      player: startingPlayer,
      session: startingSession,
      features: [homeFeature, infoFeature],
      pluginConfigs: { log: { mode: "test" }, renderer: { onDemand: true } }
    }).screen({ manifest, io: diskIo(MINI, manifest), renderer: page.renderer });

    await app.start();
    app.flow.run().catch(() => undefined);

    const watched = watch(app, page);

    running.push({ app, watched });

    for (let frame = 0; frame < 300 && app.flow.state().path !== "home"; frame += 1)
      await watched.frames(1);

    await watched.frames(60);
    expect(app.input.tap(app.ui.find("info") ?? 0)).toBe(true);

    for (let frame = 0; frame < 300 && app.flow.state().path !== "info/show"; frame += 1) {
      await watched.frames(1);
    }

    await watched.frames(30);

    expect(app.renderer.stats().kept.pictures).toBeGreaterThan(0);
  });
});
