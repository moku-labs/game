/**
 * @file effects plugin — the fixtures of the perf tests and benches. Not a test file. Each fixture is built here,
 * outside any measured window, over the mock effects world of the unit tests (the real `ecs` of `world`, a fake
 * renderer and fake Pixi), and hands back one frame step of the code under measure: the world's `sync` phase, which
 * runs the filter sync, or its `animate` phase, which runs the particle system over the world's own walk. The phases
 * run on world modules whose `model` and `flow` answer with one kept object, as in the world's own perf fixtures, and
 * the fake renderer's spy `invalidate` and fresh `viewport.size()` give way to a plain function and a kept object, as
 * the real renderer has: a window counts the bytes of `effects` alone.
 */
import { alloc } from "../../../../../tests/perf/alloc";
import type { Api as FlowApi } from "../../../flow/types";
import type { Api as ModelApi, Snapshot } from "../../../model/types";
import { FakeRectangle, FakeTexture } from "../../../renderer/__tests__/fake-pixi";
import { Parent, Sprite, Transform } from "../../../renderer/components";
import { CALM_AFTER } from "../../../renderer/kept/record";
import type { PixiFilter, PixiTexture, ViewportSize } from "../../../renderer/types";
import type { Time } from "../../../time/types";
import { createModules } from "../../../world/api";
import { withDeps } from "../../../world/lifecycle";
import type { AnyComponentValue, Entity, WorldPhase } from "../../../world/types";
import { Alpha, Blur, Glow } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import type { FilterInstance } from "../../filters/types";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import { atlasTexture, FakeFxFilter } from "../fake-effects-pixi";
import { Frosted, Under } from "../filter-fixtures";
import { createMockEffects, type MockEffects } from "../unit/mock-effects";

/** Calls before a window: the code under measure reaches its optimized tier first, as on a phone after a few seconds. */
const WARM_CALLS = 30_000;

/**
 * Calls of a window, ten times `alloc`'s default: a stray compile of a few kilobytes inside it weighs a tenth of a byte
 * a call, so the two halves of `alloc`'s cross-check still agree on a step that keeps 0 B.
 */
const CALLS = 100_000;

/** How many filtered views the filter fixtures hold, as on the ward of A Memory Missing. */
export const FILTERED_VIEWS = 12;

/** A frame of a phone, ms: fractional, as every clock on a device. */
const FRAME_MS = 16.6;

/** The model snapshot every phase of a fixture reads: one kept object. */
const SNAPSHOT: Snapshot = Object.freeze({
  player: {},
  session: {},
  rng: { seed: 1, streams: {} }
});

/** The flow state every phase of a fixture reads: live, one kept object. */
const LIVE = Object.freeze({ mode: "live" });

/** A game's own filter, ours like `Glow`, with a number and a colour uniform. */
const Tint = defineFilter("perf.tint", {
  wgsl: `
@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, uv) * fu.amount;
}`,
  glsl: `
void main() {
  finalColor = texture(uTexture, vTextureCoord) * amount;
}`,
  uniforms: { amount: 0.5, color: { color: 0xff_d7_00 } }
});

/** A local-space stream that follows its host, as a torch on a moving piece. */
const torch = defineEmitter("perf.torch", {
  textures: ["perf.puff"],
  rate: 12,
  lifeMs: [900, 1400],
  speed: [20, 40],
  space: "local",
  maxParticles: 30
});

/** The viewport the fixtures' renderer hands out: one kept object, as the real `viewport.size()`. */
const VIEWPORT: Readonly<ViewportSize> = Object.freeze({
  width: 1080,
  height: 1920,
  scale: 1,
  orientation: "portrait",
  safeArea: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })
});

/**
 * Pixi's `AlphaFilter` as a fixture draws it: its setter writes the alpha into its uniform in place, as Pixi's does.
 * The fake of the unit tests records every write as a string: those would be the fake's bytes, not the sync's.
 */
class QuietAlphaFilter extends FakeFxFilter {
  /** The uniform the alpha lives in, as Pixi's `alphaUniforms.uniforms`. */
  private readonly uniforms: { uAlpha: number };

  public constructor(options: { alpha?: number; resolution?: number | "inherit" } = {}) {
    super(options);
    this.uniforms = { uAlpha: options.alpha ?? 1 };
  }

  /** @returns The alpha. */
  public get alpha(): number {
    return this.uniforms.uAlpha;
  }

  public set alpha(value: number) {
    this.uniforms.uAlpha = value;
  }
}

/** The two renderer calls a fixture makes allocation-free, as they are on the real renderer. */
type PlainRenderer = {
  invalidate: (entity: Entity) => void;
  viewport: { size: () => Readonly<ViewportSize> };
};

/**
 * The heap bytes one call of a step keeps: the step run until V8 optimized what it calls, outside the window, then
 * `alloc` over a window of `calls`.
 *
 * @param fn - The step.
 * @param calls - Calls of the window.
 * @returns Bytes per call.
 */
export function bytesPerCall(fn: () => void, calls = CALLS): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, calls);
}

/**
 * Gives the fake renderer of a mock a plain `invalidate` that counts, and a kept viewport size: the spy and the fresh
 * size object of the fake would be counted as the bytes of `effects`.
 *
 * @param mock - The mock.
 * @returns The counter of `invalidate` calls.
 */
function plainRenderer(mock: MockEffects): { invalidated: number } {
  const counter = { invalidated: 0 };
  const renderer = mock.ectx.deps.renderer as unknown as PlainRenderer;

  renderer.invalidate = (): void => {
    counter.invalidated += 1;
  };
  renderer.viewport.size = (): Readonly<ViewportSize> => VIEWPORT;

  return counter;
}

/**
 * A runner of one world phase over the mock's world, as the frame runs it: the world modules over the mock's world
 * state with a `model` and a `flow` that allocate nothing per read, and a frame time moved by one each call.
 *
 * @param mock - The started mock.
 * @param phase - The phase.
 * @returns One run of the phase.
 */
export function phaseRunner(mock: MockEffects, phase: WorldPhase, delta = FRAME_MS): () => void {
  const deps = withDeps(mock.worldCtx).deps;
  const model = { store: { snapshot: () => SNAPSHOT } } as unknown as ModelApi;
  const flow = { state: () => LIVE } as unknown as FlowApi;
  const { ecs } = createModules({ ...mock.worldCtx, deps: { ...deps, model, flow } });
  const time: Time = { delta, elapsed: 0, scale: 1, frame: mock.time.frame, idle: false };

  return (): void => {
    time.frame += 1;
    ecs.runPhase(phase, time);
  };
}

/** A started mock with filtered views, the step of its `sync` phase and the stored `Glow` of one view. */
export type FiltersFixture = {
  mock: MockEffects;
  /** One run of the `sync` phase: the filter sync (and the renderer's sync, absent from the mock). */
  run: () => void;
  /** The view whose `Glow` a tween moves. */
  tweened: Entity;
  /** The value the world holds for its `Glow`, writable: a tween case moves it in place. */
  glow: { strength: number };
  /** The views whose `Alpha` a fade case moves, by name: `canvas` at the canvas's resolution, `half` at 0.5. */
  fades: Readonly<Record<FadeView, { entity: Entity; value: { alpha: number } }>>;
  /** How often the sync called `renderer.invalidate`. */
  counter: { invalidated: number };
};

/**
 * The components of the filtered view `index` of the fixture: `Glow`, the game's `Tint`, `Blur` and `Alpha` in turn,
 * each on a sprite with its own place.
 *
 * @param index - The view.
 * @returns Its components.
 */
function viewComponents(index: number): AnyComponentValue[] {
  const sprite = Sprite({ texture: "board.cell", width: 64, height: 64 });
  const place = Transform({ x: index * 70, y: 100 });

  switch (index % 4) {
    case 0: {
      return [sprite, place, Glow({ strength: 0.6 })];
    }
    case 1: {
      return [sprite, place, Tint({ amount: 0.4 })];
    }
    case 2: {
      return [sprite, place, Blur({ strength: 4 })];
    }
    default: {
      // The second Alpha draws at half a texel per CSS px, as the fog of A Memory Missing.
      return [sprite, place, Alpha({ alpha: 0.8, resolution: index === 7 ? 0.5 : 0 })];
    }
  }
}

/**
 * Starts a mock with `FILTERED_VIEWS` filtered views, runs the frames that build and hand over their instances, and
 * clears every change set. The first view carries `Glow`, the view a tween case moves.
 *
 * @returns The fixture.
 */
export function filtersFixture(): FiltersFixture {
  const mock = createMockEffects();

  mock.features.push({ name: "perf", description: { filters: [Tint] } });

  const counter = plainRenderer(mock);

  Reflect.set(mock.pixi.module, "AlphaFilter", QuietAlphaFilter);
  mock.start();

  const views: Entity[] = [];

  for (let index = 0; index < FILTERED_VIEWS; index += 1) {
    const entity = mock.spawn(viewComponents(index));

    mock.renderer.displays.add(entity);
    views.push(entity);
  }

  // Build every instance and hand every list over; the last frame clears the change sets at `signals`.
  for (let frame = 0; frame < 3; frame += 1) mock.frame(FRAME_MS);

  const tweened = views[0] ?? 0;
  const glow = mock.world.ecs.get(tweened, Glow) as { strength: number } | undefined;
  const fades = { canvas: fadeOf(mock, views[3] ?? 0), half: fadeOf(mock, views[7] ?? 0) };

  if (glow === undefined) throw new Error("perf fixture: the first view has no Glow");

  return { mock, run: phaseRunner(mock, "sync"), tweened, glow, fades, counter };
}

/**
 * The `Alpha` of one view of the fixture: the entity and the value the world holds for it.
 *
 * @param mock - The started mock.
 * @param entity - The view.
 * @returns The entity and its writable value.
 */
function fadeOf(mock: MockEffects, entity: Entity): { entity: Entity; value: { alpha: number } } {
  const value = mock.world.ecs.get(entity, Alpha) as { alpha: number } | undefined;

  if (value === undefined) throw new Error("perf fixture: a fade's view has no Alpha");

  return { entity, value };
}

/** The two strengths a tween case moves between. */
const STRENGTHS: readonly [number, number] = [0.55, 0.75];

/**
 * The write of a tween on the `Glow` of one view, alone: its strength moves to the other fraction in place, the way a
 * tween's write lands in the stored value. V8 boxes the fraction it stores (16 B): a tween's cost, which a perf case
 * measures with this step and subtracts. The change mark is made once, by `ecs.set`, and stays: no `signals` runs in
 * a window to clear it, so the world's own `set` stays out of the bytes.
 *
 * @param fixture - A fixture of `filtersFixture`.
 * @returns The write.
 */
export function tweenWrite(fixture: FiltersFixture): () => void {
  const { mock, tweened, glow } = fixture;
  let frame = 0;

  mock.world.ecs.set(tweened, Glow, { strength: STRENGTHS[0] });

  return (): void => {
    frame += 1;
    // per call: never the value of the call before, so every sync writes the uniform.
    glow.strength = (frame & 1) === 0 ? STRENGTHS[0] : STRENGTHS[1];
  };
}

/**
 * The step of a tween on the `Glow` of one view: the write of `tweenWrite`, then the `sync` phase.
 *
 * @param fixture - A fixture of `filtersFixture`.
 * @returns The step.
 */
export function tweenStep(fixture: FiltersFixture): () => void {
  const write = tweenWrite(fixture);
  const { run } = fixture;

  return (): void => {
    write();
    run();
  };
}

/** The views a fade case may move: the `Alpha` at the canvas's resolution, and the one at 0.5. */
export type FadeView = "canvas" | "half";

/** A fade case: the view it moves and the alphas it writes, one a step, in turn. */
export type Fade = { readonly view: FadeView; readonly alphas: readonly number[] };

/** Keyframes that touch 1 in every other step: the filter stays switched on. */
export const CROSSING: Fade = { view: "canvas", alphas: [1, 0.8] };

/** A rest at 1 long enough to switch the filter off (`CALM_AFTER` steps), then a fraction that switches it on. */
export const RESTING: Fade = {
  view: "canvas",
  alphas: [...Array.from({ length: CALM_AFTER }, () => 1), 0.8]
};

/** A fade of the `Alpha` at resolution 0.5: its resolution is never written again. */
export const HALF: Fade = { view: "half", alphas: [0.9, 0.8] };

/**
 * The write of a fade on the `Alpha` of one view, alone: its alpha moves in place to the next of the fade's alphas in
 * every call, the way a tween's write lands in the stored value. The change mark is made once, by `ecs.set`, and
 * stays, as in `tweenWrite`.
 *
 * @param fixture - A fixture of `filtersFixture`.
 * @param fade - The fade.
 * @returns The write.
 */
export function fadeWrite(fixture: FiltersFixture, fade: Fade): () => void {
  const { entity, value } = fixture.fades[fade.view];
  const { alphas } = fade;
  let step = 0;

  fixture.mock.world.ecs.set(entity, Alpha, { alpha: alphas.at(-1) ?? 1 });

  return (): void => {
    value.alpha = alphas[step] ?? 1;
    step = step + 1 === alphas.length ? 0 : step + 1;
  };
}

/**
 * The step of a fade on the `Alpha` of one view: the write of `fadeWrite`, then the `sync` phase.
 *
 * @param fixture - A fixture of `filtersFixture`.
 * @param fade - The fade.
 * @returns The step.
 */
export function fadeStep(fixture: FiltersFixture, fade: Fade): () => void {
  const write = fadeWrite(fixture, fade);
  const { run } = fixture;

  return (): void => {
    write();
    run();
  };
}

/** A started mock with emitters and the step of its `animate` phase. */
export type ParticlesFixture = {
  mock: MockEffects;
  /** One run of the `animate` phase: the particle system over the world's walk of its hosts. */
  run: () => void;
  /** The hosts. */
  hosts: Entity[];
};

/**
 * Starts a mock with three hosts of a local-space stream, one at the root, one under a scaled slot and one under a
 * turned one, runs the frames that start their instances, and hands back the step of the `animate` phase.
 * `emitting: false` holds every stream (`active: false`): only the follow of the host runs, the case of a still host.
 * `emitting: true` lets the streams emit and their particles live and die, from the instance's pool.
 *
 * @param emitting - Whether the streams emit.
 * @returns The fixture.
 */
export function particlesFixture(emitting: boolean): ParticlesFixture {
  const mock = createMockEffects();

  mock.features.push({ name: "perf", description: { emitters: [torch] } });
  mock.textures.set("perf.puff", atlasTexture({ width: 256, height: 256, destroyed: false }));
  plainRenderer(mock);
  mock.start();

  const scaled = mock.spawn([Transform({ x: 40, y: 60, scale: 0.5 })]);
  const turned = mock.spawn([Transform({ x: 300, y: 500, rotation: 0.3 })]);
  const hosts = [
    mock.spawn([
      Emitter({ effect: "perf.torch", active: emitting }),
      Transform({ x: 100, y: 200 })
    ]),
    mock.spawn([
      Emitter({ effect: "perf.torch", active: emitting }),
      Transform({ x: 100, y: 200 }),
      Parent({ entity: scaled })
    ]),
    mock.spawn([
      Emitter({ effect: "perf.torch", active: emitting }),
      Transform({ x: 20, y: 10, scale: 1.5 }),
      Parent({ entity: turned })
    ])
  ];

  // Start every instance and let the streams fill: the pools hold what a steady stream recycles.
  for (let frame = 0; frame < 200; frame += 1) mock.frame(FRAME_MS);

  return { mock, run: phaseRunner(mock, "animate"), hosts };
}

/** A Pixi filter system as an apply sees it. */
type Manager = Parameters<PixiFilter["apply"]>[0];

/**
 * A pooled texture of the fake module: a 390 × 844 frame on a 1024 × 2048 backing at two pixels per CSS px, as Pixi's
 * pool hands one out for the box of the panels.
 *
 * @returns The texture.
 */
function pooledTexture(): PixiTexture {
  return new FakeTexture({
    source: {
      width: 512,
      height: 1024,
      destroyed: false,
      resolution: 2,
      pixelWidth: 1024,
      pixelHeight: 2048
    },
    frame: new FakeRectangle(0, 0, 390, 844)
  }) as unknown as PixiTexture;
}

/**
 * Pixi's `TexturePool` as a fixture draws through it: every request answered with one kept texture, every return
 * taken back silently. The fake of the unit tests records every request: those would be the fake's bytes.
 *
 * @returns The pool.
 */
function quietPool(): { getOptimalTexture: () => PixiTexture; returnTexture: () => void } {
  const texture = pooledTexture();

  return { getOptimalTexture: () => texture, returnTexture: () => undefined };
}

/** A started mock with the two backdrop views of the frosted panels, and what each perf case runs. */
export type BackdropFixture = {
  /** One drawn frame of the backdrop without inputs: Pixi's pop calls its apply once. */
  applyUnder: () => void;
  /** One drawn frame of the backdrop whose chain starts from back: its apply draws the chain, then its body. */
  applyFrosted: () => void;
  /** One run of the `sync` phase: the filter sync. */
  run: () => void;
  /** The view whose `Under` a tween moves. */
  tweened: Entity;
  /** The value the world holds for its `Under`, writable: a tween case moves it in place. */
  under: { spread: number };
};

/**
 * The instance of a kind on a view of the mock.
 *
 * @param mock - The started mock.
 * @param entity - The view.
 * @param id - The kind id.
 * @returns The instance.
 */
function instanceOn(mock: MockEffects, entity: Entity, id: string): FilterInstance {
  const instance = mock.state.views.get(entity)?.instances.get(id);

  if (instance === undefined) throw new Error(`perf fixture: no ${id} on the view`);

  return instance;
}

/**
 * Starts a mock with the two backdrop filters on two views of panels, as the frosted panels of a memory screen, over
 * a quiet pool, and hands back the apply of each as Pixi's pop calls it inside a drawn frame (the back it copied at
 * the canvas's resolution, the view's input and the canvas as the output), and the `sync` phase.
 *
 * @returns The fixture.
 */
export function backdropFixture(): BackdropFixture {
  const mock = createMockEffects();

  mock.renderer.resolution = 2;
  mock.features.push({ name: "perf", description: { filters: [Under, Frosted] } });
  plainRenderer(mock);
  Reflect.set(mock.pixi.module, "TexturePool", quietPool());
  mock.start();

  const under = mock.spawn([
    Sprite({ texture: "board.cell", width: 350, height: 200 }),
    Transform(),
    Under()
  ]);
  const frosted = mock.spawn([
    Sprite({ texture: "board.cell", width: 350, height: 200 }),
    Transform(),
    Frosted()
  ]);

  mock.renderer.displays.add(under);
  mock.renderer.displays.add(frosted);

  for (let frame = 0; frame < 3; frame += 1) mock.frame(FRAME_MS);

  const back = pooledTexture();
  const input = pooledTexture();
  const output = pooledTexture();
  const manager = {
    activeBackTexture: back,
    applyFilter: (): void => undefined
  } as unknown as Manager;
  const underFilter = instanceOn(mock, under, "fixture.under").filter;
  const frostedFilter = instanceOn(mock, frosted, "fixture.frosted").filter;
  const value = mock.world.ecs.get(under, Under) as { spread: number } | undefined;

  if (value === undefined) throw new Error("perf fixture: the first view has no Under");

  mock.world.ecs.set(under, Under, { spread: STRENGTHS[0] });

  return {
    applyUnder: (): void => underFilter.apply(manager, input, output, false),
    applyFrosted: (): void => frostedFilter.apply(manager, input, output, false),
    run: phaseRunner(mock, "sync"),
    tweened: under,
    under: value
  };
}

/**
 * The write of a tween on the `spread` of the backdrop without inputs, alone: the fraction moves in place, as in
 * `tweenWrite`.
 *
 * @param fixture - A fixture of `backdropFixture`.
 * @returns The write.
 */
export function backdropWrite(fixture: BackdropFixture): () => void {
  const { under } = fixture;
  let frame = 0;

  return (): void => {
    frame += 1;
    under.spread = (frame & 1) === 0 ? STRENGTHS[0] : STRENGTHS[1];
  };
}

/**
 * The step of a tween on the `spread` of the backdrop without inputs: the write, then the `sync` phase.
 *
 * @param fixture - A fixture of `backdropFixture`.
 * @returns The step.
 */
export function backdropStep(fixture: BackdropFixture): () => void {
  const write = backdropWrite(fixture);
  const { run } = fixture;

  return (): void => {
    write();
    run();
  };
}
