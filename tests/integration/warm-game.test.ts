/**
 * @file Root integration — the pipeline warm-up of a whole game (spec 27 F4), the engine's port of A Memory Missing's
 * `warm-game.test.ts`: while the splash stands, the renderer draws an invisible probe of every content pipeline, every
 * filter kind the game and the engine register and every stage of their inputs, onto the canvas and into a texture,
 * with and without a clip, before the stage pass that clears them. Cross-plugin: effects (the hand-over once the shader
 * checks settled), renderer (the probes), flow and scenes (the splash). The renderer runs over Pixi's own display
 * objects (`drawn-helpers.ts`, a WebGPU stand-in), the warm-up as a game ships it: one probe draw a frame.
 */
import type { Assets } from "@moku-labs/game";
import { defineFilter, defineGame, exit, Glow, Shape, Transform, type } from "@moku-labs/game";
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

/** The primary button of the splash: it glows from its first frame, as the merge game's Play does at home. */
const play = projection({
  name: "splash.play",
  layer: "main",
  from: () => ({}),
  view: () => [
    Transform({ x: 95, y: 600 }),
    Shape({ kind: "rect", w: 200, h: 60, fill: 0x4c_9a_2a }),
    Glow({ strength: 1.8, distance: 18, color: 0xf2_b4_3d })
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

/** The same splash with its glowing button. */
const glowingScene = defineScene("splash", {
  bundle: "splash",
  layers: { main: { sort: "order" } },
  projections: [bar, play]
});

const glowingFeature = defineFeature("splash", {
  scenes: [glowingScene],
  projections: [bar, play],
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

/** The bodies a kept view can run on its quad: the kinds of a checked plain body, drawn after their filter. */
const QUADS = [
  "effects.glow.quad",
  "effects.outline.quad",
  "fixture.tint.quad",
  "fixture.veil.quad"
];

/** The content subjects of the renderer. */
const CONTENT = [
  "sprite",
  "sprite-add",
  "sprite-screen",
  "graphics",
  "particles-normal",
  "particles-add"
];

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
 * @param into - The texture of the render; `undefined` for the canvas.
 * @returns `"subject variant"`.
 */
function probeOf(root: pixi.Container, into: pixi.Texture | undefined): string {
  let node: pixi.Container | undefined = root.children[0];
  const target = into === undefined ? "canvas" : "texture";
  let clip = "";

  if (node?.label === "renderer.warm.clip") {
    clip = "+clip";
    node = node.children[0]?.children[0];
  }

  // Pixi's label is `null` until one is given.
  const label: string | null | undefined = node?.label;

  if (label === "renderer.warm.quad") {
    return `${(node as pixi.Mesh).shader?.gpuProgram?.name} ${target}${clip}`;
  }

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
 * The most filtered containers on one path of a tree: 1 for a filter alone, 2 for a filter inside a filter.
 *
 * @param node - The root of the tree.
 * @returns The depth of filters; 0 for a tree with none.
 */
function filterDepth(node: pixi.Container): number {
  const own = (node.filters?.length ?? 0) > 0 ? 1 : 0;
  let deepest = 0;

  for (const child of node.children) deepest = Math.max(deepest, filterDepth(child));

  return own + deepest;
}

/**
 * The enabled `Glow` filters a tree draws with.
 *
 * @param node - The root of the tree.
 * @returns How many containers carry one.
 */
function glowsIn(node: pixi.Container): number {
  const own = node.filters?.some(
    filter => filter.enabled && filter.gpuProgram?.name === "effects.glow"
  )
    ? 1
    : 0;

  return own + node.children.reduce((sum, child) => sum + glowsIn(child), 0);
}

/**
 * Starts the game on its splash with the warm-up as it ships, drawing on demand, and records the probes of every frame.
 *
 * @param options - What differs from the splash of the other tests.
 * @param options.feature - The splash feature; the one without a filtered view when left out.
 * @param options.onStage - Told the stage at every stage pass.
 * @param options.onProbe - Told the root and the target of every probe render.
 * @returns The running splash.
 */
async function openSplash(
  options: {
    feature?: typeof splashFeature;
    onStage?: (stage: pixi.Container) => void;
    onProbe?: (root: pixi.Container, target: pixi.Texture | undefined) => void;
  } = {}
): Promise<Splash> {
  const page = openPage(390, 844);
  const { app } = defineGameApp({
    flow: mainFlow,
    safeNode: "splash",
    player: { n: 0 },
    session: { n: 0 },
    referenceSide: 390,
    features: [options.feature ?? splashFeature],
    pluginConfigs: {
      log: { mode: "test" },
      flow: { holdMs: 0 },
      // The engine's default warm-up: one probe draw a frame. No kept picture: every frame draws the views live.
      renderer: { ...page.renderer, onDemand: true, warm: 1, keptMb: 0 }
    }
  }).screen({ manifest: MANIFEST });
  const probes: string[][] = [[]];

  await app.start();
  app.flow.run().catch(() => undefined);

  page.stage.last().renderer.watchers.push(call => {
    if (call.container.label === "renderer.warm") {
      options.onProbe?.(call.container, call.target);
      probes.at(-1)?.push(probeOf(call.container, call.target));

      return;
    }

    if (call.target !== undefined) return;

    if (call.container === page.stage.last().stage) {
      // The stage never holds a probe.
      expect(holdsProbe(call.container)).toBe(false);
      options.onStage?.(call.container);
    }
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

    // A quad once: its four variants make one pipeline.
    for (const quad of QUADS) expect(seen).toContain(`${quad} ${VARIANTS[0]}`);

    // Each drawn exactly once: nothing warmed twice on one device.
    expect(game.probes.flat()).toHaveLength(
      (CONTENT.length + FILTERS.length) * VARIANTS.length + QUADS.length
    );
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

  // Bug: a probe draws a filter inside another filter. On Pixi 8.21 a pool trim between two such draws destroys the
  // texture the inner level of Pixi's filter stack last held, and the next one makes Pixi throw inside its render; the
  // stack it leaves unbalanced makes the Glow on screen throw in the stage pass, and effects breaks the kind for the
  // session: the merge game's primary buttons lost their glow.
  it("a view that glows from the first frame keeps its glow while every probe draws one filter level", async () => {
    const depths = new Set<number>();
    const glows: number[] = [];
    const game = await openSplash({
      feature: glowingFeature,
      onStage: stage => glows.push(glowsIn(stage)),
      onProbe: root => depths.add(filterDepth(root))
    });

    await game.each(SPLASH_FRAMES);

    // Probes of every filter kind were drawn, none of them through a second filter.
    expect(depths).toEqual(new Set([0, 1]));
    // The glow is drawn once its shader check answered, in the first frames, and in every stage pass after.
    const first = glows.indexOf(1);

    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(3);
    expect(glows.slice(first).every(count => count === 1)).toBe(true);
    expect(glows.length - first).toBeGreaterThan(50);
  });

  // Bug: a probe hangs in the stage, or stays there after its frame, and the player sees it.
  it("no probe is ever on the stage", async () => {
    const game = await openSplash();

    // The watcher asserts at every stage pass; the frames below run 60 of them with probes in flight.
    expect(await game.frames(60)).toBeGreaterThan(50);
    expect(holdsProbe(game.page.stage.last().stage)).toBe(false);
  });
});
