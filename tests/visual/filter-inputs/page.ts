/**
 * @file The page of the filter-inputs browser leg (`tests/visual/filter-inputs.visual.ts`). Not a test: the leg bundles
 * it twice, once with the flags of a release page and once with those of a dev page, and opens it in Chrome on WebGPU
 * and on WebGL (`?renderer=webgl`). It runs the engine's own filter code on the real Pixi and the real GPU: the shader
 * check of every body, stage and fallback, a filter that reads a second texture through `sampleSoft`, and a kind whose
 * stage does not compile, drawn by its fallback (and the striped mark on the dev page), and two backdrop filters over a
 * fourth square: a frosted band whose chain starts from what was drawn under it, and a panel that dims what is under
 * it through `sampleBack`, read both from a texture (extract) and from the canvas itself, where WebGL copies from
 * Pixi's back buffer. It answers in `globalThis.filterInputs`.
 */
import * as PIXI from "pixi.js";
import { kindStatus, pollChecks, startChecks } from "../../../src/plugins/effects/filters/check";
import { defineFilter } from "../../../src/plugins/effects/filters/define";
import { createFilter, createStandIn } from "../../../src/plugins/effects/filters/instance";
import type { FilterKind, FilterStep } from "../../../src/plugins/effects/filters/types";
import { createEffectsState } from "../../../src/plugins/effects/state";
import type { EffectsCtx } from "../../../src/plugins/effects/types";
import type { PixiModule } from "../../../src/plugins/renderer/types";

/** What the backdrop square drew, read one way: the frosted band's edge, the edge above it, the dimmed panel's edge. */
export type BackdropRead = {
  /** The red channel across the square's edge inside the frosted band, 12 px each side. */
  inside: number[];
  /** The same edge above the band, where nothing filters the square. */
  outside: number[];
  /** The red channel across the square's edge under the dimming panel, 4 px each side. */
  dim: number[];
};

/** What the page answers: the backend that drew, the check, and what each view drew. */
export type FilterInputsResult = {
  backend: string;
  build: "release" | "dev";
  status: { soft: string; hazy: string; frost: string; dim: string };
  errors: Array<{ event: string; data: unknown }>;
  /** The red channel across the edge of the plain view and of the soft one, 12 px each side. */
  edge: { plain: number[]; soft: number[] };
  /** The stand-in of the broken kind: its pixel in the white half, and the magenta pixels of its black half. */
  hazy: { white: number[]; magenta: number; passes: number; standIn: boolean };
  /** Per frame, the share of the pixels with any alpha, of the whole stage. */
  frames: number[];
  /** Filter draws Pixi's filter system made in one frame. */
  draws: number;
  /** The backdrop square, read from a texture the stage was drawn into and from the canvas. */
  backdrop: { texture: BackdropRead; canvas: BackdropRead };
};

/** One side of a view, CSS px. */
const SIDE = 160;

/** The left edge of the fourth square, the one under the backdrop filters. */
const BACK_X = 3 * SIDE + 60;

/** The width of the stage: four squares and the gaps between them. */
const STAGE_WIDTH = 4 * SIDE + 60;

/** The frosted band over the fourth square: its top and its height. */
const BAND = { y: 40, height: 80 } as const;

/** The dimming panel over the fourth square's edge: left, top, width, height. */
const DIM = { x: BACK_X + 40, y: 130, width: 80, height: 20 } as const;

/** A stage that copies its input. */
const Small = defineFilter("visual.small", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSampleLevel(uTexture, uSampler, uv, 0.0); }",
  glsl: "void main() { finalColor = textureLod(uTexture, vTextureCoord, 0.0); }"
});

/** A box blur of nine taps along `dir`, `sigma` input pixels apart. */
const Along = defineFilter("visual.along", {
  wgsl: `@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let stride = fu.dir * gfu.uInputPixel.zw * fu.sigma;
  var sum = vec4<f32>(0.0);
  for (var i = -4; i <= 4; i++) {
    sum += textureSampleLevel(uTexture, uSampler, clamp(uv + stride * f32(i), gfu.uInputClamp.xy, gfu.uInputClamp.zw), 0.0);
  }
  return sum / 9.0;
}`,
  glsl: `void main() {
  vec2 stride = dir * uInputPixel.zw * sigma;
  vec4 sum = vec4(0.0);
  for (int i = -4; i <= 4; i++) {
    sum += textureLod(uTexture, clamp(vTextureCoord + stride * float(i), uInputClamp.xy, uInputClamp.zw), 0.0);
  }
  finalColor = sum / 9.0;
}`,
  uniforms: { dir: [1, 0], sigma: 1 }
});

/** A stage that reads a name it never declared: no device compiles it. */
const Bad = defineFilter("visual.bad", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSampleLevel(uTexture, uSampler, uv, 0.0) * missing; }",
  glsl: "void main() { finalColor = textureLod(uTexture, vTextureCoord, 0.0) * missing; }"
});

/** The fallback: the input dimmed by `spread`. */
const SoftDim = defineFilter("visual.softDim", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSampleLevel(uTexture, uSampler, uv, 0.0) * fu.spread; }",
  glsl: "void main() { finalColor = textureLod(uTexture, vTextureCoord, 0.0) * spread; }",
  uniforms: { spread: 1 }
});

/** A blurred copy at half the resolution: the copy, then the blur along x and along y. */
const softSteps = (value: { readonly spread: number }): readonly FilterStep[] => [
  { stage: Small, scale: 1 / 2 },
  { stage: Along, scale: 1 / 2, uniforms: { dir: [1, 0], sigma: value.spread } },
  { stage: Along, scale: 1 / 2, uniforms: { dir: [0, 1], sigma: value.spread } }
];

/** The filter that reads its second texture: the blurred copy, as it is. */
const Soft = defineFilter("visual.soft", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return sampleSoft(uv); }",
  glsl: "void main() { finalColor = sampleSoft(vTextureCoord); }",
  uniforms: { spread: 2 },
  inputs: { soft: { stages: [Small, Along], chain: softSteps } }
});

/** A filter whose stage does not compile, with the fallback. */
const Hazy = defineFilter("visual.hazy", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return sampleHaze(uv); }",
  glsl: "void main() { finalColor = sampleHaze(vTextureCoord); }",
  uniforms: { spread: 0.5 },
  inputs: {
    haze: {
      stages: [Small, Bad],
      chain: () => [
        { stage: Small, scale: 1 / 2 },
        { stage: Bad, scale: 1 / 2 }
      ]
    }
  },
  fallback: SoftDim
});

/** A backdrop whose input is a blurred copy of what was drawn under the view, shown where the view has content. */
const Frost = defineFilter("visual.frost", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return sampleSoft(uv) * textureSampleLevel(uTexture, uSampler, uv, 0.0).a; }",
  glsl: "void main() { finalColor = sampleSoft(vTextureCoord) * textureLod(uTexture, vTextureCoord, 0.0).a; }",
  uniforms: { spread: 2 },
  backdrop: true,
  inputs: { soft: { from: "back", stages: [Small, Along], chain: softSteps } }
});

/** A backdrop without inputs: what was drawn under the view at half its brightness, opaque, where the view has content. */
const Dim = defineFilter("visual.dim", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return vec4<f32>(sampleBack(uv).rgb * 0.5, 1.0) * textureSampleLevel(uTexture, uSampler, uv, 0.0).a; }",
  glsl: "void main() { finalColor = vec4(sampleBack(vTextureCoord).rgb * 0.5, 1.0) * textureLod(uTexture, vTextureCoord, 0.0).a; }",
  backdrop: true
});

/**
 * A view: a square, white on its left half and black on its right, at an x of the stage.
 *
 * @param x - Where it stands.
 * @returns The container.
 */
function square(x: number): PIXI.Container {
  const view = new PIXI.Container();
  const white = new PIXI.Graphics().rect(0, 0, SIDE / 2, SIDE).fill(0xff_ff_ff);
  const black = new PIXI.Graphics().rect(SIDE / 2, 0, SIDE / 2, SIDE).fill(0x00_00_00);

  view.addChild(white, black);
  view.x = x;

  return view;
}

/**
 * The red channel of a row of pixels around the middle of a view.
 *
 * @param pixels - The stage's pixels, RGBA.
 * @param width - Their row length.
 * @param x - The view's left edge.
 * @param row - The row; the middle of the view by default.
 * @param reach - The pixels read on each side of the edge.
 * @returns `2 × reach` values across its white-to-black edge.
 */
function edgeOf(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  row = SIDE / 2,
  reach = 12
): number[] {
  const from = x + SIDE / 2 - reach;

  return Array.from(
    { length: 2 * reach },
    (_unused, index) => pixels[(row * width + from + index) * 4] ?? -1
  );
}

/**
 * Reads the backdrop square from the pixels of the stage.
 *
 * @param pixels - The stage's pixels, RGBA.
 * @param width - Their row length.
 * @returns The three rows of the backdrop square.
 */
function backdropOf(pixels: Uint8ClampedArray, width: number): BackdropRead {
  return {
    inside: edgeOf(pixels, width, BACK_X, BAND.y + BAND.height / 2),
    outside: edgeOf(pixels, width, BACK_X, BAND.y / 2),
    dim: edgeOf(pixels, width, BACK_X, DIM.y + DIM.height / 2, 4)
  };
}

/**
 * Draws the stage onto the canvas itself, as the engine draws a frame, and reads the canvas back in the same task
 * through a 2D canvas: on WebGL the frame went through Pixi's back buffer.
 *
 * @param app - The running Pixi application.
 * @returns The pixels of the canvas and their row length.
 */
function canvasFrame(app: PIXI.Application): Frame {
  const copy = document.createElement("canvas");

  copy.width = STAGE_WIDTH;
  copy.height = SIDE;

  const context = copy.getContext("2d", { willReadFrequently: true });

  app.renderer.render(app.stage);
  context?.drawImage(app.canvas, 0, 0);

  return {
    pixels: context?.getImageData(0, 0, STAGE_WIDTH, SIDE).data ?? new Uint8ClampedArray(),
    width: STAGE_WIDTH
  };
}

/** The pixels of the last frame and their row length. */
type Frame = { pixels: Uint8ClampedArray; width: number };

/**
 * Builds the domain context the engine's filter code runs on: the effects state with the two kinds, a log that keeps
 * every error and warning, and the renderer's host over the running Pixi application.
 *
 * @param app - The running Pixi application.
 * @param errors - Where the log keeps its lines.
 * @returns The context and the two kinds.
 */
function contextOf(
  app: PIXI.Application,
  errors: FilterInputsResult["errors"]
): { ectx: EffectsCtx; soft: FilterKind; hazy: FilterKind; frost: FilterKind; dim: FilterKind } {
  const { renderer } = app;
  const log = (event: string, data: unknown): void => {
    errors.push({ event, data });
  };
  const state = createEffectsState();
  const soft: FilterKind = {
    id: Soft.componentName,
    component: Soft,
    source: "wgsl",
    definition: Soft.filter,
    index: 0
  };
  const hazy: FilterKind = {
    id: Hazy.componentName,
    component: Hazy,
    source: "wgsl",
    definition: Hazy.filter,
    index: 1
  };
  const frost: FilterKind = {
    id: Frost.componentName,
    component: Frost,
    source: "wgsl",
    definition: Frost.filter,
    index: 2
  };
  const dim: FilterKind = {
    id: Dim.componentName,
    component: Dim,
    source: "wgsl",
    definition: Dim.filter,
    index: 3
  };
  const gpu = (renderer as unknown as { gpu?: { device: GPUDevice } }).gpu;
  const gl = (renderer as unknown as { gl?: WebGL2RenderingContext }).gl;

  for (const kind of [soft, hazy, frost, dim]) state.kinds.set(kind.id, kind);

  const ectx = {
    state,
    config: {
      maxParticles: 3000,
      maxPasses: 24,
      phone: false,
      blur: { quality: 2, phoneResolution: 0.5 }
    },
    log: { error: log, warn: log, info: () => undefined, debug: () => undefined },
    deps: {
      renderer: {
        host: {
          ready: () => true,
          pixi: () => PIXI as unknown as PixiModule,
          kind: () => renderer.name,
          device: () => gpu?.device,
          gl: () => gl,
          resolution: () => renderer.resolution
        },
        invalidate: () => undefined
      }
    }
  } as unknown as EffectsCtx;

  return { ectx, soft, hazy, frost, dim };
}

/**
 * Runs the shader checks to the end: a parallel GLSL compile answers on a later poll, as the filter system polls
 * every frame.
 *
 * @param ectx - The context.
 */
async function checkAll(ectx: EffectsCtx): Promise<void> {
  startChecks(ectx);

  for (let poll = 0; poll < 300 && ectx.state.checks.waiting > 0; poll += 1) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    pollChecks(ectx);
  }
}

/**
 * Counts the filter draws Pixi's filter system makes, through its public `applyFilter`.
 *
 * @param renderer - The renderer.
 * @returns The counter; `reset` starts it over.
 */
function countDraws(renderer: PIXI.Renderer): { count: () => number; reset: () => void } {
  const system = renderer.filter as unknown as { applyFilter: (...args: unknown[]) => void };
  const applyFilter = system.applyFilter.bind(system);
  let draws = 0;

  system.applyFilter = (...args: unknown[]) => {
    draws += 1;
    applyFilter(...args);
  };

  return {
    count: () => draws,
    reset: () => {
      draws = 0;
    }
  };
}

/**
 * Draws ten frames of the stage into textures and reads each: the share of pixels with any alpha per frame.
 *
 * @param app - The running Pixi application.
 * @param draws - The draw counter.
 * @param draws.reset - Starts it over: called before the last frame.
 * @returns The shares and the pixels of the last frame.
 */
function drawFrames(
  app: PIXI.Application,
  draws: { reset: () => void }
): { frames: number[]; last: Frame } {
  const frames: number[] = [];
  let last: Frame = { pixels: new Uint8ClampedArray(), width: 0 };

  for (let frame = 0; frame < 10; frame += 1) {
    if (frame === 9) draws.reset();

    const extracted = app.renderer.extract.pixels({
      target: app.stage,
      frame: new PIXI.Rectangle(0, 0, STAGE_WIDTH, SIDE)
    });
    let lit = 0;

    for (let at = 3; at < extracted.pixels.length; at += 4) {
      if ((extracted.pixels[at] ?? 0) > 0) lit += 1;
    }

    frames.push(lit / (extracted.pixels.length / 4));
    last = { pixels: extracted.pixels, width: extracted.width };
  }

  return { frames, last };
}

/**
 * Counts the magenta pixels of the black half of a view: what the dev mark's stripes leave there.
 *
 * @param last - The last frame.
 * @param x - The view's left edge.
 * @returns The count.
 */
function magentaOf(last: Frame, x: number): number {
  let magenta = 0;

  for (let y = 0; y < SIDE; y += 1) {
    for (let column = x + SIDE / 2; column < x + SIDE; column += 1) {
      const at = (y * last.width + column) * 4;
      const red = last.pixels[at] ?? 0;
      const green = last.pixels[at + 1] ?? 0;
      const blue = last.pixels[at + 2] ?? 0;

      if (red > 60 && blue > 60 && green < 20) magenta += 1;
    }
  }

  return magenta;
}

/**
 * Plays the page: the checks, the three views, ten frames.
 *
 * @returns The answer.
 */
async function play(): Promise<FilterInputsResult> {
  const preference =
    new URLSearchParams(location.search).get("renderer") === "webgl" ? "webgl" : "webgpu";
  const app = new PIXI.Application();

  // As the engine's renderer asks for it when a feature brings a backdrop filter: Pixi skips one on WebGL without it.
  await app.init({
    width: STAGE_WIDTH,
    height: SIDE,
    preference,
    resolution: 1,
    antialias: false,
    backgroundAlpha: 0,
    useBackBuffer: true
  });
  document.body.append(app.canvas);

  const errors: FilterInputsResult["errors"] = [];
  const { ectx, soft, hazy, frost, dim } = contextOf(app, errors);

  await checkAll(ectx);

  const pixi = PIXI as unknown as PixiModule;
  const status = {
    soft: kindStatus(ectx, soft),
    hazy: kindStatus(ectx, hazy),
    frost: kindStatus(ectx, frost),
    dim: kindStatus(ectx, dim)
  };
  const instance = createFilter(ectx, pixi, soft, Soft().value);
  const standIn = createStandIn(ectx, pixi, hazy, Hazy().value);
  const frosted = createFilter(ectx, pixi, frost, Frost().value);
  const dimmed = createFilter(ectx, pixi, dim, Dim().value);
  const hazyX = 2 * SIDE + 40;
  const softView = square(SIDE + 20);
  const hazyView = square(hazyX);
  const band = new PIXI.Graphics().rect(BACK_X, BAND.y, SIDE, BAND.height).fill(0xff_ff_ff);
  const panel = new PIXI.Graphics().rect(DIM.x, DIM.y, DIM.width, DIM.height).fill(0xff_ff_ff);

  if (instance !== undefined) softView.filters = [instance.filter];
  if (standIn !== undefined) hazyView.filters = [standIn.filter];
  if (frosted !== undefined) band.filters = [frosted.filter];
  if (dimmed !== undefined) panel.filters = [dimmed.filter];
  app.stage.addChild(square(0), softView, hazyView, square(BACK_X), band, panel);

  const draws = countDraws(app.renderer);
  const { frames, last } = drawFrames(app, draws);
  const canvas = canvasFrame(app);
  const whiteAt = ((SIDE / 2) * last.width + hazyX + SIDE / 4) * 4;

  return {
    backend: app.renderer.name,
    build:
      typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__ === true ? "dev" : "release",
    status,
    errors,
    edge: {
      plain: edgeOf(last.pixels, last.width, 0),
      soft: edgeOf(last.pixels, last.width, SIDE + 20)
    },
    hazy: {
      white: [0, 1, 2, 3].map(channel => last.pixels[whiteAt + channel] ?? 0),
      magenta: magentaOf(last, hazyX),
      passes: standIn?.passes ?? 0,
      standIn: standIn !== undefined
    },
    frames,
    draws: draws.count(),
    backdrop: {
      texture: backdropOf(last.pixels, last.width),
      canvas: backdropOf(canvas.pixels, canvas.width)
    }
  };
}

const target = globalThis as unknown as { filterInputs?: FilterInputsResult | { error: string } };

try {
  target.filterInputs = await play();
} catch (error) {
  target.filterInputs = {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error)
  };
}
