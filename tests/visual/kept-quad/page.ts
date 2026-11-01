/**
 * @file The page of the shaded-view browser leg (`tests/visual/kept-quad.visual.ts`, F126 stage 2). Not a test: the leg
 * bundles it with the flags of a dev page and opens it in Chrome on WebGPU at resolution 1 and 2. A small game runs on
 * the real engine, the real Pixi and the real GPU, with `debug.verifyFrames` on. Each row writes a filter's number until
 * `why()` says the view runs on its own shader, holds a value, and is captured so and again with `debug.kept(false)`:
 * the mesh against the live filter. This is where the quad text first meets a GPU: a shader that does not compile, a
 * group that does not fit its pipeline and a double fade all show here and nowhere else. It answers in
 * `globalThis.keptQuad`.
 *
 * The clock is paused and every frame is a `time.step`, as in `kept-pictures/page.ts`. The fractional row compares the
 * mode with stage 3, not with zero: off the padding grid a body's frame is up to one device pixel wider than live.
 */

import { defineGameApp } from "../../../src/app";
import type { Assets, World } from "../../../src/index";
import {
  defineFilter,
  defineGame,
  Layer,
  Parent,
  Shape,
  Transform,
  type
} from "../../../src/index";
import manifestJson from "../../fixtures/mini-game/generated/manifest.json";

/** What one row answered. */
export type RowResult = {
  name: string;
  /** Views drawn through their own shader when the row was captured. */
  shaded: number;
  /** Pixels of the mode's capture that differ from the live capture by more than 24 in a channel. */
  differing: number;
  /** Pixels of a capture. */
  total: number;
  /** Pixels of the mode's capture with any colour: a blank row proves nothing. */
  lit: number;
  /** For the fractional row, the same count for stage 3 against live. */
  stage3?: number;
};

/** What the page answers. */
export type KeptQuadResult = {
  backend: string;
  resolution: number;
  rows: RowResult[];
  /** The error scopes the run opened: one per probe of a quad, so 0 means the warm-up drew none. */
  scopes: number;
  /** The warnings of the run that fail it: stale pictures, compile and pipeline errors. */
  warnings: Array<{ event: string; data: unknown }>;
};

/** One game frame of the paused clock. */
const FRAME_MS = 1000 / 60;

/** The frames a kept view needs to be taken: two still ones, and the take. */
const TAKE_FRAMES = 6;

/** Writes of a number that bring a kept view on its shader, past `QUAD_AFTER`. */
const WRITES = 5;

/** A frame count past `QUAD_CALM`: a record at rest is back on its sprite. */
const CALM_FRAMES = 40;

/** A change of a channel the frame oracle does not count. */
const CHANNEL = 24;

/** The log lines that fail a run. */
const FAILS = new Set([
  "renderer:stale-picture",
  "renderer:missed-frame",
  "renderer:missed-mark",
  "renderer:warm-invalid",
  "renderer:warm-failed",
  "effects:wgsl"
]);

/** The owner of every view the page spawns. */
const OWNER = { kind: "plugin", name: "visual" } as const;

/** The GLSL twin the filter API asks for; this page draws on WebGPU. */
const GLSL_PASS = "void main() { finalColor = texture(uTexture, vTextureCoord); }";

/** The opening of a body, as a game writes one, its signature on two lines: `at` is the CSS px in the frame. */
const OPEN = `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let at = uv * gfu.uInputSize.xy;
  let c = textureSample(uTexture, uSampler, uv);`;

/** A kept filter with a number and stripes across its frame, so a frame off by a pixel shows. */
const Tone = defineFilter("visual.tone", {
  wgsl: `${OPEN}
  let band = 0.6 + 0.4 * sin(at.x * 0.3 + fu.amount);
  return vec4<f32>(c.rgb * band, c.a);
}`,
  glsl: GLSL_PASS,
  uniforms: { amount: 0.5 },
  cache: "local"
});

/** A shadow that reaches into its padding, a read of the input off the view's own pixels. */
const Reach = defineFilter("visual.reach", {
  wgsl: `${OPEN}
  let far = textureSample(uTexture, uSampler, uv - vec2<f32>(fu.amount) * gfu.uInputSize.zw);
  return c + vec4<f32>(0.0, 0.0, 0.0, 0.5) * far.a * (1.0 - c.a);
}`,
  glsl: GLSL_PASS,
  uniforms: { amount: 6 },
  padding: 12,
  cache: "local"
});

/** The same, with an off-grid padding at the fractional resolution of its row. */
const Wide = defineFilter("visual.wide", {
  wgsl: `${OPEN}
  let far = textureSample(uTexture, uSampler, uv - vec2<f32>(fu.amount) * gfu.uInputSize.zw);
  return c + vec4<f32>(0.0, 0.0, 0.0, 0.5) * far.a * (1.0 - c.a);
}`,
  glsl: GLSL_PASS,
  uniforms: { amount: 6 },
  padding: 10,
  cache: "local"
});

/** A window that draws only its 120 × 120 area. */
const Pane = defineFilter("visual.pane", {
  wgsl: `${OPEN}
  return vec4<f32>(c.rgb * fu.amount, c.a);
}`,
  glsl: GLSL_PASS,
  uniforms: { amount: 0.8 },
  cache: "local",
  area: () => [100, 60, 120, 120]
});

/** One number over a whole picture, the outer picture of its row: a body that reads no place. */
const Dim = defineFilter("visual.dim", {
  wgsl: `${OPEN}
  return vec4<f32>(c.rgb * fu.amount, c.a);
}`,
  glsl: GLSL_PASS,
  uniforms: { amount: 0.8 },
  cache: "local"
});

/** A lamp whose band follows where it is drawn on the canvas, through the engine's helper. */
const Lamp = defineFilter("visual.lamp", {
  wgsl: `${OPEN}
  let spot = canvasPixel(uv);
  let band = 0.5 + 0.5 * sin(spot.x * 0.15 + fu.amount);
  return vec4<f32>(c.rgb * band, c.a);
}`,
  glsl: `void main() {
  vec2 spot = canvasPixel(vTextureCoord);
  vec4 c = texture(uTexture, vTextureCoord);
  finalColor = vec4(c.rgb * (0.5 + 0.5 * sin(spot.x * 0.15 + amount)), c.a);
}`,
  uniforms: { amount: 0.5 }
});

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
const feature = kit.defineFeature("visual", {
  scenes: [main],
  filters: [Tone, Reach, Wide, Pane, Dim, Lamp]
});

/** The manifest of the page: the mini game's `ui` bundle without its files, so the scene loads nothing. */
const manifest: Assets.Manifest = {
  ...(manifestJson as unknown as Assets.Manifest),
  bundles: { ui: { feature: "ui", tier: "boot", mb: 0, files: [] } }
};

/** The app of the page. */
type App = ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];

/** What a row writes in one frame: the number, and whatever else moves with it. */
type Write = (turn: number) => void;

/**
 * Waits for frames of the page, while the clock still runs on them.
 *
 * @param count - How many.
 */
async function frames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}

/**
 * Runs game frames on the paused clock, each followed by a task.
 *
 * @param app - The app.
 * @param count - How many.
 */
async function step(app: App, count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    app.time.step(FRAME_MS);
    await new Promise(resolve => setTimeout(resolve, 0));
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
 * Compares two pictures of the same size with the thresholds of the frame oracle.
 *
 * @param one - A capture.
 * @param other - The capture it is held against.
 * @returns The pixels that differ, and those of `one` with any colour.
 */
function compare(one: ImageData, other: ImageData): { differing: number; lit: number } {
  let differing = 0;
  let lit = 0;

  for (let at = 0; at < one.data.length; at += 4) {
    let differs = false;

    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs((one.data[at + channel] ?? 0) - (other.data[at + channel] ?? 0));

      if (delta > CHANNEL) differs = true;
    }

    if (differs) differing += 1;
    if ((one.data[at] ?? 0) + (one.data[at + 1] ?? 0) + (one.data[at + 2] ?? 0) > 0) lit += 1;
  }

  return { differing, lit };
}

/**
 * Takes the capture of a frame.
 *
 * @param app - The app.
 * @param name - The row, for the error.
 * @returns The pixels.
 */
async function captured(app: App, name: string): Promise<ImageData> {
  const shot = await app.renderer.capture();

  if (shot === undefined) throw new Error(`no capture of ${name}`);

  return pixelsOf(shot.png);
}

/**
 * Writes a row's numbers until its view runs on its shader, and holds the value of the last turn.
 *
 * @param app - The app.
 * @param write - One frame's writes.
 */
async function shade(app: App, write: Write): Promise<void> {
  await step(app, TAKE_FRAMES);

  for (let turn = 0; turn < WRITES; turn += 1) {
    write(turn);
    await step(app, 1);
  }

  // A settle or a kept picture above comes to rest; the view stays on its shader for `QUAD_CALM` frames.
  await step(app, 12);
}

/**
 * How many views run on their own shader now.
 *
 * @param app - The app.
 * @returns The count.
 */
function shadedNow(app: App): number {
  return app.renderer.sync.debug.why().filter(entry => entry.quad === true).length;
}

/**
 * Plays one row: the mode against live, then the row goes.
 *
 * @param app - The app.
 * @param name - The row.
 * @param entities - Its entities.
 * @param write - One frame's writes.
 * @returns What it answered.
 */
async function measure(
  app: App,
  name: string,
  entities: readonly World.Entity[],
  write: Write
): Promise<RowResult> {
  await shade(app, write);

  const shaded = shadedNow(app);
  const mode = await captured(app, name);

  app.renderer.sync.debug.kept(false);
  await step(app, 3);

  const live = await captured(app, name);

  app.renderer.sync.debug.kept(true);

  for (const entity of entities) app.world.ecs.despawn(entity);
  await step(app, 3);

  return { name, shaded, total: mode.width * mode.height, ...compare(mode, live) };
}

/**
 * Plays the fractional row: padding off its grid at 1.37, the mode, then stage 3 once the view rested, then live.
 *
 * @param app - The app.
 * @param spawn - Spawns a view.
 * @returns What it answered.
 */
async function fractional(
  app: App,
  spawn: (...components: World.AnyComponentValue[]) => World.Entity
): Promise<RowResult> {
  const name = "fractional, padding off its grid";

  app.renderer.monitor.setResolution(1.37);
  await step(app, 3);

  const view = spawn(
    Transform({ x: 100.5, y: 100.25 }),
    Shape({ w: 160, h: 80, fill: 0x33_88_ff, radius: 12 }),
    Wide()
  );

  await shade(app, turn => app.world.ecs.set(view, Wide, { amount: 3 + turn }));

  const shaded = shadedNow(app);
  const mode = await captured(app, name);

  await step(app, CALM_FRAMES);

  const stage3 = await captured(app, name);

  app.renderer.sync.debug.kept(false);
  await step(app, 3);

  const live = await captured(app, name);

  app.renderer.sync.debug.kept(true);
  app.world.ecs.despawn(view);
  app.renderer.monitor.setResolution(undefined);
  await step(app, 3);

  return {
    name,
    shaded,
    total: mode.width * mode.height,
    ...compare(mode, live),
    stage3: compare(stage3, live).differing
  };
}

/**
 * Plays the rows of the page.
 *
 * @returns The answer.
 */
async function play(): Promise<KeptQuadResult> {
  const resolution = Number(new URLSearchParams(location.search).get("resolution") ?? 1);
  const scope = GPUDevice.prototype.pushErrorScope;
  let scopes = 0;

  GPUDevice.prototype.pushErrorScope = function count(filter) {
    scopes += 1;

    return scope.call(this, filter);
  };

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
      renderer: { preference: "webgpu", maxResolution: resolution, debug: { verifyFrames: true } }
    }
  }).screen({ manifest, renderer: { mount: "#game" } });

  await app.start();
  app.flow.run().catch(() => undefined);

  for (let frame = 0; frame < 300 && app.flow.state().path !== "rest"; frame += 1) await frames(1);

  await frames(30);
  app.time.pause();

  const gpuErrors: string[] = [];

  app.renderer.host.device()?.addEventListener("uncapturederror", event => {
    gpuErrors.push((event as GPUUncapturedErrorEvent).error.message);
  });

  const { ecs } = app.world;
  const spawn = (...components: World.AnyComponentValue[]): World.Entity =>
    ecs.spawn(OWNER, [Layer({ name: "main" }), ...components]);
  const child = (parent: World.Entity, ...components: World.AnyComponentValue[]): World.Entity =>
    ecs.spawn(OWNER, [Parent({ entity: parent }), ...components]);
  const rows: RowResult[] = [];

  const local = spawn(
    Transform({ x: 80, y: 80 }),
    Shape({ w: 240, h: 120, fill: 0x33_88_ff, radius: 12 }),
    Tone()
  );

  child(local, Transform({ x: 20, y: 20 }), Shape({ w: 60, h: 60, fill: 0xff_cc_00 }));
  rows.push(
    await measure(app, "local", [local], turn => ecs.set(local, Tone, { amount: 1 + turn }))
  );

  const placed = spawn(
    Transform({ x: 80, y: 200 }),
    Shape({ w: 240, h: 80, fill: 0xff_ee_aa }),
    Lamp()
  );

  rows.push(
    await measure(app, "placed", [placed], turn => ecs.set(placed, Lamp, { amount: turn }))
  );

  const movedLamp = spawn(
    Transform({ x: 80, y: 200 }),
    Shape({ w: 240, h: 80, fill: 0xff_ee_aa }),
    Lamp()
  );

  rows.push(
    await measure(app, "placed, moved", [movedLamp], turn => {
      ecs.set(movedLamp, Lamp, { amount: turn });
      ecs.set(movedLamp, Transform, { x: 80 + 2 * turn });
    })
  );

  const padded = spawn(
    Transform({ x: 100, y: 100 }),
    Shape({ w: 160, h: 80, fill: 0x88_ff_33, radius: 12 }),
    Reach()
  );

  rows.push(
    await measure(app, "padded", [padded], turn => ecs.set(padded, Reach, { amount: 3 + turn }))
  );

  const framed = spawn(
    Transform({ x: 40, y: 40 }),
    Shape({ w: 360, h: 260, fill: 0x22_44_66 }),
    Pane()
  );

  child(framed, Transform({ x: 120, y: 40 }), Shape({ w: 40, h: 200, fill: 0xff_40_40 }));
  rows.push(
    await measure(app, "area", [framed], turn => ecs.set(framed, Pane, { amount: 0.5 + turn / 10 }))
  );

  // Stop rule of the slice: a double fade darkens these two rows.
  const faded = spawn(
    Transform({ x: 80, y: 80 }),
    Shape({ w: 240, h: 120, fill: 0x33_88_ff, alpha: 0.5 }),
    Tone()
  );

  rows.push(
    await measure(app, "view alpha", [faded], turn => ecs.set(faded, Tone, { amount: 1 + turn }))
  );

  const veil = spawn(Transform({ x: 40, y: 40 }), Shape({ w: 380, h: 300, fill: 0, alpha: 0.5 }));
  const underVeil = child(
    veil,
    Transform({ x: 40, y: 40 }),
    Shape({ w: 240, h: 120, fill: 0x33_88_ff }),
    Tone()
  );

  rows.push(
    await measure(app, "ancestor alpha", [underVeil, veil], turn =>
      ecs.set(underVeil, Tone, { amount: 1 + turn })
    )
  );

  const moved = spawn(
    Transform({ x: 80, y: 80 }),
    Shape({ w: 240, h: 120, fill: 0x33_88_ff }),
    Tone()
  );

  rows.push(
    await measure(app, "moved", [moved], turn => {
      ecs.set(moved, Tone, { amount: 1 + turn });
      ecs.set(moved, Transform, { x: 80 + 3 * turn });
    })
  );

  const scaled = spawn(
    Transform({ x: 80, y: 80, scale: 1.5 }),
    Shape({ w: 160, h: 80, fill: 0x33_88_ff }),
    Tone()
  );

  rows.push(
    await measure(app, "scaled", [scaled], turn => ecs.set(scaled, Tone, { amount: 1 + turn }))
  );

  const clipper = spawn(
    Transform({ x: 60, y: 60 }),
    Shape({ w: 200, h: 100, fill: 0x22_22_44, clip: true })
  );
  const clipped = child(
    clipper,
    Transform({ x: 20, y: 20 }),
    Shape({ w: 260, h: 140, fill: 0xff_cc_00 }),
    Tone()
  );

  rows.push(
    await measure(app, "under a clip mask", [clipped, clipper], turn =>
      ecs.set(clipped, Tone, { amount: 1 + turn })
    )
  );

  const outer = spawn(
    Transform({ x: 60, y: 60 }),
    Shape({ w: 300, h: 200, fill: 0x44_44_66 }),
    Dim()
  );
  const inner = child(
    outer,
    Transform({ x: 40, y: 40 }),
    Shape({ w: 120, h: 60, fill: 0xff_aa_00 }),
    Reach()
  );

  rows.push(
    await measure(app, "inside an outer picture", [inner, outer], turn =>
      ecs.set(inner, Reach, { amount: 3 + turn })
    )
  );

  // Two sizes through the one copy sprite in one flush: its texture changes between two renders.
  const wide = spawn(
    Transform({ x: 40, y: 40 }),
    Shape({ w: 300, h: 60, fill: 0x33_88_ff }),
    Tone()
  );
  const tall = spawn(
    Transform({ x: 40, y: 140 }),
    Shape({ w: 80, h: 200, fill: 0xff_cc_00 }),
    Tone()
  );

  rows.push(
    await measure(app, "two sizes in one flush", [wide, tall], turn => {
      ecs.set(wide, Tone, { amount: 1 + turn });
      ecs.set(tall, Tone, { amount: 2 + turn });
    })
  );

  const offGrid = await fractional(app, spawn);
  const warnings = app.log
    .trace()
    .filter(entry => FAILS.has(entry.event))
    .map(entry => ({ event: entry.event, data: entry.data }));

  return {
    backend: app.renderer.host.kind(),
    resolution,
    rows: [...rows, offGrid],
    scopes,
    warnings: [...warnings, ...gpuErrors.map(data => ({ event: "gpu-error", data }))]
  };
}

const target = globalThis as unknown as { keptQuad?: KeptQuadResult | { error: string } };

try {
  target.keptQuad = await play();
} catch (error) {
  target.keptQuad = {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error)
  };
}
