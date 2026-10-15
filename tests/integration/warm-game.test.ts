/**
 * @file Root integration — the pipeline warm-up of a whole game (spec 27 F4), the engine's port of A Memory Missing's
 * `warm-game.test.ts`: while the splash stands, the renderer draws an invisible probe of every content pipeline, every
 * filter kind the game and the engine register and every stage of their inputs, onto the canvas and into a texture,
 * with and without a clip, before the stage pass that clears them. Cross-plugin: effects (the hand-over once the shader
 * checks settled), renderer (the probes), flow and scenes (the splash). The renderer runs over Pixi's own display
 * objects (`drawn-helpers.ts`, a WebGPU stand-in), the warm-up as a game ships it: one probe draw a frame.
 */
import type { Assets } from "@moku-labs/game";
import { defineFilter, defineGame, exit, Shape, Transform, type } from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import type * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DrawnPage, openPage, type Watched, watch } from "./drawn-helpers";

/** The splash stands for 120 frames of 16 ms: the warm-up must be done before it ends. */
const SPLASH_FRAMES = 120;

/** The four targets of a WebGPU pipeline. */
const VARIANTS = ["canvas", "canvas+clip", "texture", "texture+clip"];

/** The bundle of the splash holds no file. */
const MANIFEST: Assets.Manifest = {
  version: 2,
  bundles: { splash: { feature: "splash", tier: "core", mb: 0, files: [] } }
};

const { defineNode, defineFlow, defineFeature, defineScene, projection } = defineGame<{
  player: { n: number };
  session: { n: number };
  assets: string;
  scenes: "splash";
  strings: Record<string, never>;
}>();

/** A body that copies its input. */
const COPY = {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv); }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord); }"
} as const;

/** The stage of the frost's blur: a copy at half the resolution. */
const Half = defineFilter("fixture.half", COPY);

/** A filter with a second texture drawn by its chain (spec 24): the body and its stage are two pipelines. */
const Frost = defineFilter("fixture.frost", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return sampleBlur(uv) * fu.amount; }",
  glsl: "void main() { finalColor = sampleBlur(vTextureCoord) * amount; }",
  uniforms: { amount: 1 },
  inputs: { blur: { stages: [Half], chain: () => [{ stage: Half, scale: 1 / 2 }] } }
});

/** A tint with a colour. */
const Tint = defineFilter("fixture.tint", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv) * vec4<f32>(fu.color, 1.0); }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord) * vec4(color, 1.0); }",
  uniforms: { color: { color: 0xff_d7_00 } }
});

/** A veil with a strength. */
const Veil = defineFilter("fixture.veil", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv) * fu.strength; }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord) * strength; }",
  uniforms: { strength: 0.5 }
});

/** The bar of the splash: nothing filtered, nothing moving. */
const bar = projection({
  name: "splash.bar",
  layer: "main",
  from: () => ({}),
  view: () => [
    Transform({ x: 40, y: 400 }),
    Shape({ kind: "rect", w: 300, h: 12, fill: 0xff_9b_83 })
  ]
});

const splash = defineNode({
  scene: "splash",
  outcomes: { done: type() },
  rest: true,
  checkpoint: true
});

const mainFlow = defineFlow("main", {
  nodes: { splash },
  start: "splash",
  outcomes: { over: type() },
  edges: { splash: { done: exit("over") } }
});

const splashScene = defineScene("splash", {
  bundle: "splash",
  layers: { main: { sort: "order" } },
  projections: [bar]
});

const splashFeature = defineFeature("splash", {
  scenes: [splashScene],
  projections: [bar],
  filters: [Frost, Tint, Veil]
});

/** Every kind and stage the warm-up draws: the engine's and the game's filters, then Pixi's core ones. */
const FILTERS = [
  "effects.glow",
  "effects.outline",
  "fixture.frost",
  "fixture.half",
  "fixture.tint",
  "fixture.veil",
  "BlurFilter",
  "ColorMatrixFilter",
  "NoiseFilter",
  "DisplacementFilter",
  "AlphaFilter"
];

/** The content subjects of the renderer. */
const CONTENT = ["sprite", "graphics", "particles-normal", "particles-add"];

/** A running splash, and the probes of every frame. */
type Splash = Watched & {
  app: { stop(): Promise<void> };
  page: DrawnPage;
  /** The probes drawn in each frame since the start, as `"subject variant"`. */
  probes: string[][];
};

const running: Splash[] = [];

afterEach(async () => {
  for (const game of running.splice(0)) {
    game.oracle.expectNoMissedFrame();
    await game.app.stop();
  }

  vi.unstubAllGlobals();
});

/**
 * Names a filter the probe draws: the definition id of one of ours, the class of a Pixi-core one.
 *
 * @param filter - The filter.
 * @returns Its name.
 */
function filterName(filter: pixi.Filter | undefined): string {
  if (filter === undefined) return "nothing";

  const name = filter.constructor.name.replace(/^_/, "");

  return name === "Filter" ? (filter.gpuProgram?.name ?? "filter") : name;
}

/**
 * What a probe root holds while it is rendered: the subject, and the target it is drawn into.
 *
 * @param root - The probe root.
 * @returns `"subject variant"`.
 */
function probeOf(root: pixi.Container): string {
  let node: pixi.Container | undefined = root.children[0];
  let target = "canvas";
  let clip = "";

  if (node?.label === "renderer.warm.texture") {
    target = "texture";
    node = node.children[0];
  }

  if (node?.label === "renderer.warm.clip") {
    clip = "+clip";
    node = node.children[0]?.children[0];
  }

  // Pixi's label is `null` until one is given.
  const label: string | null | undefined = node?.label;
  const subject =
    label === "renderer.warm.filter"
      ? filterName(node?.filters?.[0])
      : (label ?? "nothing").replace("renderer.warm.", "");

  return `${subject} ${target}${clip}`;
}

/**
 * Tells whether a container or anything under it is a piece of the warm-up.
 *
 * @param node - The container.
 * @returns True when a probe hangs in it.
 */
function holdsProbe(node: pixi.Container): boolean {
  const label: string | null = node.label;

  return (
    (label ?? "").startsWith("renderer.warm") || node.children.some(child => holdsProbe(child))
  );
}

/**
 * Starts the game on its splash with the warm-up as it ships, drawing on demand, and records the probes of every frame.
 *
 * @returns The running splash.
 */
async function openSplash(): Promise<Splash> {
  const page = openPage(390, 844);
  const { app } = defineGameApp({
    flow: mainFlow,
    safeNode: "splash",
    player: { n: 0 },
    session: { n: 0 },
    referenceSide: 390,
    features: [splashFeature],
    pluginConfigs: {
      log: { mode: "test" },
      flow: { holdMs: 0 },
      // The engine's default warm-up: one probe draw a frame.
      renderer: { ...page.renderer, onDemand: true, warm: 1 }
    }
  }).screen({ manifest: MANIFEST });
  const probes: string[][] = [[]];

  await app.start();
  app.flow.run().catch(() => undefined);

  page.stage.last().renderer.watchers.push(call => {
    if (call.target !== undefined) return;

    if (call.container === page.stage.last().stage) {
      // The stage never holds a probe.
      expect(holdsProbe(call.container)).toBe(false);

      return;
    }

    probes.at(-1)?.push(probeOf(call.container));
  });

  const watched = watch(app, page);

  await watched.frames(1);
  probes.push([]);
  // The splash stands from its first frame on.
  expect(app.flow.state().path).toBe("splash");

  const game: Splash = {
    ...watched,
    app,
    page,
    probes,
    each: async count => {
      const drawn: boolean[] = [];

      for (let frame = 0; frame < count; frame += 1) {
        drawn.push(...(await watched.each(1)));
        probes.push([]);
      }

      return drawn;
    }
  };

  running.push(game);

  return game;
}

describe("the warm-up of a game while its splash stands", () => {
  // Bug: a kind or a stage is never warmed, and the first screen that draws it creates its pipeline in its frame.
  it("every kind and every stage is drawn in four variants before the splash ends", async () => {
    const game = await openSplash();

    await game.each(SPLASH_FRAMES);

    const seen = new Set(game.probes.flat());

    for (const subject of [...CONTENT, ...FILTERS]) {
      for (const variant of VARIANTS)
        expect(seen, `${subject} ${variant}`).toContain(`${subject} ${variant}`);
    }

    // Each drawn exactly once: nothing warmed twice on one device.
    expect(game.probes.flat()).toHaveLength((CONTENT.length + FILTERS.length) * VARIANTS.length);
  });

  // Bug: the warm-up spills past the splash into the first screen, which then pays for it.
  it("the last probe is drawn while the splash still stands, one a frame", async () => {
    const game = await openSplash();

    await game.each(SPLASH_FRAMES);

    const frames = game.probes.map(drawn => drawn.length);
    const last = frames.findLastIndex(count => count > 0);

    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(SPLASH_FRAMES);
    expect(Math.max(...frames)).toBe(1);
    // The queue is empty: the still splash draws nothing more.
    expect(await game.frames(10)).toBe(0);
  });

  // Bug: a probe hangs in the stage, or stays there after its frame, and the player sees it.
  it("no probe is ever on the stage", async () => {
    const game = await openSplash();

    // The watcher asserts at every stage pass; the frames below run 60 of them with probes in flight.
    expect(await game.frames(60)).toBeGreaterThan(50);
    expect(holdsProbe(game.page.stage.last().stage)).toBe(false);
  });
});
