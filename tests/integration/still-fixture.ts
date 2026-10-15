/**
 * @file Root integration — the fixture of the still-screen and fuzz tests of render on demand.
 * Not a test. One scene with two layers, `main` (sorted by `Order`) and `top`; views are spawned
 * straight into a layer by the test; loops are world systems that write every frame; the mini
 * game's font and spark serve the labels and the particles. The renderer draws on demand over
 * Pixi's own objects and the tree oracle checks every frame (`drawn-helpers.ts`).
 */
import { readFile } from "node:fs/promises";
import type { Assets, World } from "@moku-labs/game";
import {
  component,
  defineFilter,
  defineGame,
  Layer,
  mut,
  Parent,
  resource,
  Shape,
  system,
  Transform,
  type
} from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { fakeClock } from "@moku-labs/game/testing";
import { diskIo, openPage, type Watched, watch } from "./drawn-helpers";

/** The folder of the mini game: its font and its spark serve this fixture too. */
export const MINI = new URL("../fixtures/mini-game/", import.meta.url);

/** Two seconds of the loop at 62.5 frames a second. */
export const TWO_SECONDS = 125;

/** The owner of every view the tests spawn. */
export const OWNER = { kind: "plugin", name: "still" } as const;

/** The typed kit of the fixture. */
const kit = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: "ui.font-body" | "ui.fx-spark";
  scenes: "main";
  strings: Record<string, never>;
  textStyles: "digits";
  emitters: "fx.spark" | "fx.stream";
}>();
const { defineNode, defineFlow, defineFeature, defineScene, defineTextStyles, defineEmitter } = kit;

/** The component that names an effect of the fixture on a view. */
export const Emitter = kit.Emitter;

/** An endless loop: the entity turns a little in every frame. */
export const Spin = component("still.spin", { speed: 0.05 });

/** A light that flickers: its fill changes in every frame. */
export const Flicker = component("still.flicker", { on: true });

/** A camera that has landed: it writes its pose again in every frame, with the same numbers. */
export const Hold = component("still.hold", { x: 0, y: 0 });

/** Where the frame of the screen stands, a value the filter of the veil reads every frame. */
export const Env = resource("still.env", { x: 0 });

/** A filter whose vector follows the resource. */
export const Veil = defineFilter("still.veil", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv + fu.shift); }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord + shift); }",
  uniforms: { shift: [0, 0] }
});

const spin = system({
  name: "still.spin",
  phase: "animate",
  query: [Spin, mut(Transform)],
  run: rows => {
    for (const [, turn, transform] of rows) transform.rotation += turn.speed;
  }
});

const flicker = system({
  name: "still.flicker",
  phase: "animate",
  query: [mut(Flicker), mut(Shape)],
  run: rows => {
    for (const [, light, shape] of rows) {
      light.on = !light.on;
      shape.fill = light.on ? 0xff_ee_aa : 0xaa_88_44;
    }
  }
});

const hold = system({
  name: "still.hold",
  phase: "animate",
  query: [Hold, mut(Transform)],
  run: rows => {
    for (const [, pose, transform] of rows) {
      transform.x = pose.x;
      transform.y = pose.y;
    }
  }
});

const veil = system({
  name: "still.veil",
  phase: "sync",
  query: [mut(Veil)],
  run: (rows, context) => {
    const env = context.res(Env);

    for (const [, filter] of rows) filter.shift = [env.x / 1000, 0];
  }
});

export const spark = defineEmitter("fx.spark", {
  textures: ["ui.fx-spark"],
  burst: 12,
  lifeMs: [350, 650],
  speed: [120, 420],
  maxParticles: 16
});

/** A stream that never ends: a particle container that changes in every frame while it runs. */
export const stream = defineEmitter("fx.stream", {
  textures: ["ui.fx-spark"],
  rate: 20,
  lifeMs: [400, 600],
  speed: [40, 80],
  maxParticles: 16
});

const rest = defineNode({ scene: "main", outcomes: { go: type() }, rest: true, checkpoint: true });

const mainFlow = defineFlow("main", {
  nodes: { rest },
  start: "rest",
  edges: { rest: { go: "rest" } }
});

const main = defineScene("main", {
  bundle: "ui",
  layers: { main: { sort: "order" }, top: { sort: "none" } },
  projections: []
});

const stillFeature = defineFeature("still", {
  scenes: [main],
  systems: [spin, flicker, hold, veil],
  filters: [Veil],
  emitters: [spark, stream],
  textStyles: defineTextStyles({ digits: { font: "ui.font-body", size: 40, fill: 0xff_ff_ff } })
});

/** A running fixture. */
export type Still = Watched & {
  app: ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];
  page: ReturnType<typeof openPage>;
  clock: ReturnType<typeof fakeClock>;
  /** Spawns a view in the `main` layer. */
  spawn(...components: World.AnyComponentValue[]): World.Entity;
  /** Spawns a child of a view. */
  child(parent: World.Entity, ...components: World.AnyComponentValue[]): World.Entity;
};

/** The fixtures started by the running test file, stopped by its `afterEach`. */
export const running: Still[] = [];

/**
 * Starts the fixture on a page and lets it rest.
 *
 * @returns The running fixture.
 */
export async function open(): Promise<Still> {
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
    flow: mainFlow,
    safeNode: "rest",
    player: { n: 0 },
    session: {},
    referenceSide: 390,
    features: [stillFeature],
    pluginConfigs: { log: { mode: "test" }, renderer: { onDemand: true } }
  }).screen({ manifest, io: diskIo(MINI, manifest), renderer: page.renderer, clock });

  await app.start();
  app.flow.run().catch(() => undefined);

  const ecs = app.world.ecs;
  const still: Still = {
    ...watch(app, page, clock),
    app,
    page,
    clock,
    spawn: (...components) => ecs.spawn(OWNER, [Layer({ name: "main" }), ...components]),
    child: (parent, ...components) => ecs.spawn(OWNER, [Parent({ entity: parent }), ...components])
  };

  running.push(still);

  for (let frame = 0; frame < 200 && app.flow.state().path !== "rest"; frame += 1) {
    await still.frames(1);
  }

  await still.frames(30);

  return still;
}

/**
 * A square shape.
 *
 * @param size - Its side.
 * @param fields - Other fields of the shape.
 * @returns The component value.
 */
export const square = (size: number, fields: Parameters<typeof Shape>[0] = {}) =>
  Shape({ w: size, h: size, fill: 0x44_66_88, ...fields });
