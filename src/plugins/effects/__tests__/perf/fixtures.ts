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
import { Parent, Sprite, Transform } from "../../../renderer/components";
import type { ViewportSize } from "../../../renderer/types";
import type { Time } from "../../../time/types";
import { createModules } from "../../../world/api";
import { withDeps } from "../../../world/lifecycle";
import type { AnyComponentValue, Entity, WorldPhase } from "../../../world/types";
import { Alpha, Blur, Glow } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import { atlasTexture } from "../fake-effects-pixi";
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
      return [sprite, place, Alpha({ alpha: 0.8 })];
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

  if (glow === undefined) throw new Error("perf fixture: the first view has no Glow");

  return { mock, run: phaseRunner(mock, "sync"), tweened, glow, counter };
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
