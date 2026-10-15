/**
 * @file The page of the kept-pictures browser leg (`tests/visual/kept-pictures.visual.ts`, spec 23 T4). Not a test:
 * the leg bundles it with the flags of a dev page and opens it in Chrome on WebGPU and on WebGL (`?renderer=webgl`). A
 * small game runs on the real engine, the real Pixi and the real GPU, with `debug.verifyFrames` on: the kept oracle
 * reads every drawn frame with a picture twice, as drawn and drawn live, and logs `renderer:stale-picture` on a
 * difference. Each scene is captured with its pictures kept and again with `debug.kept(false)`, so the two Pixi facts
 * no Node test can pin are pinned here: a top hidden by `renderable = false` still draws itself in its own render
 * call, and a render group with filters draws what the container did. It answers in `globalThis.keptPictures`.
 */

import { defineGameApp } from "../../../src/app";
import type { Assets, World } from "../../../src/index";
import {
  Blur,
  component,
  defineFilter,
  defineGame,
  Glow,
  Layer,
  mut,
  Noise,
  Parent,
  Shape,
  system,
  Transform,
  type
} from "../../../src/index";
import manifestJson from "../../fixtures/mini-game/generated/manifest.json";

/** What one scene answered. */
export type SceneResult = {
  name: string;
  /** Quads drawn in the last drawn frame, with the pictures kept. */
  pictures: number;
  /** Pixels of the kept capture that differ from the live capture by more than 24 in a channel. */
  differing: number;
  /** Pixels of a capture. */
  total: number;
  /** Pixels of the kept capture with any colour: a blank scene proves nothing. */
  lit: number;
};

/** What the page answers. */
export type KeptPicturesResult = {
  backend: string;
  scenes: SceneResult[];
  /** The warnings of the run that fail it: stale pictures, missed frames and marks. */
  warnings: Array<{ event: string; data: unknown }>;
};

/** The owner of every view the page spawns. */
const OWNER = { kind: "plugin", name: "visual" } as const;

/** The kit of the page's game. */
const kit = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: never;
  scenes: "main";
  strings: Record<string, never>;
  textStyles: never;
  emitters: never;
}>();

/** A view that drifts by `speed` CSS px in every frame while `frames` is above 0. */
const Drift = component("visual.drift", { speed: 0, frames: 0 });

/** A lamp whose glow follows where it is drawn on the canvas, through the engine's helper: kept with its origin. */
const Lamp = defineFilter("visual.lamp", {
  wgsl: `@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let at = canvasPixel(uv);
  let c = textureSample(uTexture, uSampler, uv);
  let band = 0.5 + 0.5 * sin(at.x * 0.15);
  return vec4<f32>(c.rgb * band, c.a);
}`,
  glsl: `void main() {
  vec2 at = canvasPixel(vTextureCoord);
  vec4 c = texture(uTexture, vTextureCoord);
  float band = 0.5 + 0.5 * sin(at.x * 0.15);
  finalColor = vec4(c.rgb * band, c.a);
}`
});

const drift = system({
  name: "visual.drift",
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

const rest = kit.defineNode({
  scene: "main",
  outcomes: { go: type() },
  rest: true,
  checkpoint: true
});
const flow = kit.defineFlow("main", {
  nodes: { rest },
  start: "rest",
  edges: { rest: { go: "rest" } }
});
const main = kit.defineScene("main", {
  bundle: "ui",
  layers: { main: { sort: "order" } },
  projections: []
});
const feature = kit.defineFeature("visual", { scenes: [main], systems: [drift], filters: [Lamp] });

/** The manifest of the page: the mini game's `ui` bundle without its files, so the scene loads nothing. */
const manifest: Assets.Manifest = {
  ...(manifestJson as unknown as Assets.Manifest),
  bundles: { ui: { feature: "ui", tier: "boot", mb: 0, files: [] } }
};

/**
 * Waits for frames of the page.
 *
 * @param count - How many.
 */
async function frames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}

/**
 * The RGBA pixels of a PNG data URL.
 *
 * @param png - The data URL.
 * @returns The pixels.
 */
async function pixelsOf(png: string): Promise<ImageData> {
  const response = await fetch(png);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("no 2d context");

  context.drawImage(bitmap, 0, 0);

  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Compares two pictures of the same size: the pixels that differ by more than 24 in a channel, and the lit ones.
 *
 * @param kept - The capture with the pictures kept.
 * @param live - The capture drawn live.
 * @returns The counts.
 */
function compare(
  kept: ImageData,
  live: ImageData
): Pick<SceneResult, "differing" | "total" | "lit"> {
  let differing = 0;
  let lit = 0;

  for (let at = 0; at < kept.data.length; at += 4) {
    let differs = false;

    for (let channel = 0; channel < 4; channel += 1) {
      if (Math.abs((kept.data[at + channel] ?? 0) - (live.data[at + channel] ?? 0)) > 24)
        differs = true;
    }

    if (differs) differing += 1;
    if ((kept.data[at] ?? 0) + (kept.data[at + 1] ?? 0) + (kept.data[at + 2] ?? 0) > 30) lit += 1;
  }

  return { differing, total: kept.data.length / 4, lit };
}

/** The app of the page. */
type App = ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];

/**
 * Captures a scene with its pictures kept and drawn live, and despawns it.
 *
 * @param app - The app.
 * @param name - The scene's name.
 * @param entities - The entities of the scene.
 * @returns What it answered.
 */
async function measure(
  app: App,
  name: string,
  entities: readonly World.Entity[]
): Promise<SceneResult> {
  await frames(8);

  const pictures = app.renderer.stats().kept.pictures;
  const kept = await app.renderer.capture();

  app.renderer.sync.debug.kept(false);
  await frames(3);

  const live = await app.renderer.capture();

  app.renderer.sync.debug.kept(true);

  for (const entity of entities) app.world.ecs.despawn(entity);
  await frames(3);

  if (kept === undefined || live === undefined) throw new Error(`no capture of ${name}`);

  return { name, pictures, ...compare(await pixelsOf(kept.png), await pixelsOf(live.png)) };
}

/**
 * Plays the scenes of the page.
 *
 * @returns The answer.
 */
async function play(): Promise<KeptPicturesResult> {
  const preference =
    new URLSearchParams(location.search).get("renderer") === "webgl" ? "webgl" : "webgpu";
  const mount = document.createElement("div");

  mount.id = "game";
  mount.style.width = "480px";
  mount.style.height = "480px";
  document.body.append(mount);

  const { app } = defineGameApp({
    flow,
    safeNode: "rest",
    player: {},
    session: {},
    referenceSide: 480,
    features: [feature],
    pluginConfigs: {
      renderer: { preference, maxResolution: 1, debug: { verifyFrames: true } }
    }
  }).screen({ manifest, renderer: { mount: "#game" } });

  await app.start();
  app.flow.run().catch(() => undefined);

  for (let frame = 0; frame < 300 && app.flow.state().path !== "rest"; frame += 1) await frames(1);

  // The scene of the rest node mounts its layers in the frames after the flow got there.
  await frames(30);

  const ecs = app.world.ecs;
  const spawn = (...components: World.AnyComponentValue[]): World.Entity =>
    ecs.spawn(OWNER, [Layer({ name: "main" }), ...components]);
  const child = (parent: World.Entity, ...components: World.AnyComponentValue[]): World.Entity =>
    ecs.spawn(OWNER, [Parent({ entity: parent }), ...components]);
  const scenes: SceneResult[] = [];

  // A kept glow at rest.
  const button = spawn(
    Transform({ x: 100, y: 100 }),
    Shape({ w: 120, h: 60, fill: 0x33_88_ff, radius: 12 }),
    Glow({ strength: 3, distance: 12 })
  );

  scenes.push(await measure(app, "glow at rest", [button]));

  // The same glow after a move of a fraction of a pixel: off its grid while it moves, settled at rest.
  const moved = spawn(
    Transform({ x: 100, y: 100 }),
    Shape({ w: 120, h: 60, fill: 0x33_88_ff, radius: 12 }),
    Glow({ strength: 3, distance: 12 }),
    Drift({ speed: 0.37, frames: 20 })
  );

  scenes.push(await measure(app, "glow after a move", [moved]));

  // A kept blur at Blur resolution 0.5, a stripe of colours under it.
  const panel = spawn(
    Transform({ x: 60, y: 60 }),
    Shape({ w: 300, h: 200, fill: 0x22_22_22 }),
    Blur({ strength: 6, quality: 2, resolution: 0.5 })
  );

  child(panel, Transform({ x: 20, y: 20 }), Shape({ w: 60, h: 160, fill: 0xff_40_40 }));
  child(panel, Transform({ x: 120, y: 20 }), Shape({ w: 60, h: 160, fill: 0x40_ff_40 }));
  scenes.push(await measure(app, "blur at 0.5", [panel]));

  // The same blur with the renderer at 2.8125: r / rs is 5.625, the quad off the device grid at rest.
  app.renderer.monitor.setResolution(2.8125);
  await frames(3);

  const fine = spawn(
    Transform({ x: 60, y: 60 }),
    Shape({ w: 300, h: 200, fill: 0x22_22_22 }),
    Blur({ strength: 6, quality: 2, resolution: 0.5 })
  );

  child(fine, Transform({ x: 20, y: 20 }), Shape({ w: 60, h: 160, fill: 0xff_40_40 }));
  scenes.push(await measure(app, "blur at 0.5, resolution 2.8125", [fine]));
  app.renderer.monitor.setResolution(undefined);
  await frames(3);

  // A placed filter that reads its canvas position through canvasPixel, moved by whole pixels.
  const lamp = spawn(
    Transform({ x: 80, y: 200 }),
    Shape({ w: 240, h: 80, fill: 0xff_ee_aa }),
    Lamp(),
    Drift({ speed: 2, frames: 10 })
  );

  scenes.push(await measure(app, "placed filter", [lamp]));

  // A nested kept view: a glowing badge inside a blurred card.
  const card = spawn(
    Transform({ x: 60, y: 60 }),
    Shape({ w: 260, h: 180, fill: 0x44_44_66 }),
    Blur({ strength: 2, quality: 1 })
  );
  const badge = child(
    card,
    Transform({ x: 40, y: 40 }),
    Shape({ w: 80, h: 40, fill: 0xff_aa_00 }),
    Glow({ strength: 2, distance: 8 })
  );
  scenes.push(await measure(app, "nested", [badge, card]));

  // The badge kept alone inside a card drawn live (its noise is never kept): drawn live again, the badge must not stay
  // the render group its picture made of it, which draws other pixels inside the card's filter pass.
  const noisy = spawn(
    Transform({ x: 60, y: 60 }),
    Shape({ w: 260, h: 180, fill: 0x44_44_66 }),
    Blur({ strength: 2, quality: 1 }),
    Noise({ amount: 0.0001 })
  );

  child(
    noisy,
    Transform({ x: 40, y: 40 }),
    Shape({ w: 80, h: 40, fill: 0xff_aa_00 }),
    Glow({ strength: 2, distance: 8 })
  );
  scenes.push(await measure(app, "kept inside a live card", [noisy]));

  const warnings = app.log
    .trace()
    .filter(entry =>
      ["renderer:stale-picture", "renderer:missed-frame", "renderer:missed-mark"].includes(
        entry.event
      )
    )
    .map(entry => ({ event: entry.event, data: entry.data }));

  return { backend: app.renderer.host.kind(), scenes, warnings };
}

const target = globalThis as unknown as { keptPictures?: KeptPicturesResult | { error: string } };

try {
  target.keptPictures = await play();
} catch (error) {
  target.keptPictures = {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error)
  };
}
