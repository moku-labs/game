import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, exit, type } from "../../../../index";
import { animPlugin } from "../../../anim";
import { defineAnimation, mark, sequence, spawn, tween, wait } from "../../../anim/timeline/steps";
import { assetsPlugin } from "../../../assets";
import type {
  AssetsIo,
  DecodedImage,
  Manifest,
  ManifestFile,
  Texture
} from "../../../assets/types";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import {
  type FakeContainer,
  type FakeFilter,
  FakeRectangle,
  FakeTexture,
  type FakeUniformGroup
} from "../../../renderer/__tests__/fake-pixi";
import { Sprite, Transform } from "../../../renderer/components";
import { worldPlugin } from "../../../world";
import { projection } from "../../../world/projection/define";
import { Glow } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { effectsPlugin } from "../../index";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import {
  createFakeEffectsPixi,
  FakeFxGpuProgram,
  FakeFxParticleContainer
} from "../fake-effects-pixi";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock, flow, world, renderer
// (on the fake Pixi and the fake DOM), assets (over an inline manifest and an
// in-memory io), anim and effects. Frames are driven by `app.time.step`.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

type Item = { id: string; kind: "generator" | "card" };
type Player = { items: Item[] };
type Session = { moves: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const BODY = `
@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let c = textureSample(uTexture, uSampler, uv);
  return vec4<f32>(mix(c.rgb, fu.color * c.a, fu.amount), c.a);
}`;

const starsBurst = defineEmitter("fx.starsBurst", {
  textures: ["fx.star", "fx.sparkle"],
  burst: 40,
  lifeMs: [500, 900],
  speed: [300, 700],
  gravity: 900,
  drag: 0.2,
  spin: [-3, 3],
  shape: { kind: "circle", radius: 24 },
  scale: { from: 1, to: 0.2 },
  alpha: { from: 1, to: 0 },
  maxParticles: 120
});

const steam = defineEmitter("fx.steam", {
  textures: ["fx.puff"],
  rate: 12,
  lifeMs: [900, 1400],
  speed: [40, 80],
  angle: [250, 290],
  space: "local",
  prewarmMs: 1000,
  maxParticles: 30
});

const Tint = defineFilter("fx.tint", {
  wgsl: BODY,
  uniforms: { amount: 0, color: { color: 0xff_d7_00 } }
});

const boardItems = projection({
  name: "board.items",
  layer: "items",
  from: (player: Player) => player.items,
  key: (item: Item) => item.id,
  view: (item: Item) =>
    item.kind === "generator"
      ? [
          Sprite({ texture: "fx.puff" }),
          Transform({ x: 200, y: 300 }),
          Emitter({ effect: "fx.steam" })
        ]
      : [
          Sprite({ texture: "fx.star" }),
          Transform({ x: 540, y: 900 }),
          Glow({ strength: 0 }),
          Tint({ amount: 0 })
        ]
});

const deliver = defineAnimation("orders.deliver", {
  slots: {},
  build: () =>
    sequence(
      spawn("stars", [Emitter({ effect: "fx.starsBurst" }), Transform({ x: 540, y: 900 })], {
        layer: "fx",
        order: 1000
      }),
      wait(900),
      mark("done")
    )
});

const pulse = defineAnimation("board.pulse", {
  slots: {},
  build: () => tween({ projection: "board.items", key: "card" }, Tint, { amount: 1 }, { ms: 300 })
});

const home = defineNode({ outcomes: { quit: type() }, rest: true });
const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { quit: exit("over") } }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  projections: [boardItems],
  animations: [deliver, pulse],
  emitters: [starsBurst, steam],
  filters: [Tint]
});

/**
 * One texture file of the fx bundle.
 *
 * @param key - The asset key.
 * @returns The manifest entry.
 */
function file(key: string): ManifestFile {
  return { key, path: `features/board/assets/${key}.png`, width: 32, height: 32, mb: 0.004 };
}

const manifest: Manifest = {
  version: 1,
  bundles: {
    fx: {
      feature: "board",
      tier: "boot",
      mb: 0.012,
      files: [file("fx.star"), file("fx.sparkle"), file("fx.puff")]
    }
  }
};

/**
 * The in-memory io: every texture is a 32 px frame of one 256 px atlas page.
 *
 * @returns The io and the page.
 */
function createIo(): AssetsIo {
  const page = { width: 256, height: 256, destroyed: false };

  return {
    fetch: () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        blob: () => Promise.resolve(new Blob(["png"])),
        text: () => Promise.resolve(""),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
      }),
    decode: () => Promise.resolve({ width: 32, height: 32 } as unknown as DecodedImage),
    createTexture: () =>
      new FakeTexture({
        source: page,
        frame: new FakeRectangle(0, 0, 32, 32)
      }) as unknown as Texture,
    sliceTexture: () => ({ label: "slice" }) as unknown as Texture,
    destroyTexture: () => undefined
  };
}

/** What `step` drives: an app's time. */
type Stepped = { time: { step(deltaMs: number): void } };

/** Yields the microtask queue to the flow loop. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the game on the fake DOM and the fake Pixi with the board mounted.
 *
 * @param items - The items of the player.
 * @param mounted - Whether the renderer gets a mount.
 * @returns The started app.
 */
async function startApp(items: Item[], mounted = true) {
  if (mounted) installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakeEffectsPixi();
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, assetsPlugin, animPlugin, effectsPlugin, boardFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { items }, initialSession: { moves: 0 }, seed: 1 },
      renderer: mounted
        ? { mount: "#game", loadPixi: () => Promise.resolve(pixi.module) }
        : { loadPixi: () => Promise.resolve(pixi.module) },
      assets: mounted ? { manifest, io: createIo() } : { manifest }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([
    { name: "items", sort: "order" },
    { name: "fx", sort: "order" }
  ]);
  app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });

  return app;
}

/**
 * Runs frames of 16 ms.
 *
 * @param app - The app.
 * @param count - How many frames.
 */
function step(app: Stepped, count: number): void {
  for (let index = 0; index < count; index += 1) app.time.step(16);
}

describe("effects plugin integration", () => {
  it("bursts from a timeline above the host and frees the orphan when it lands", async () => {
    const app = await startApp([{ id: "card", kind: "card" }]);

    step(app, 1);

    const handle = app.anim.play(deliver, {});

    step(app, 1);

    const burst = FakeFxParticleContainer.made.at(-1);

    expect(burst?.particleChildren).toHaveLength(40);
    expect((burst?.parent as FakeContainer | null)?.label).toBe("layer:fx");
    expect(app.effects.stats().emitters).toBe(1);
    expect(app.effects.stats().particles).toBe(40);

    step(app, 70);
    await handle.done;

    expect(handle.marks()).toEqual(["done"]);
    expect(app.effects.stats().particles).toBe(0);
    expect(app.effects.stats().emitters).toBe(0);
    expect(burst?.destroyed).toBe(true);

    await app.stop();
  });

  it("hangs Glow and Tint once and then only writes uniforms while a tween runs", async () => {
    const app = await startApp([{ id: "card", kind: "card" }]);

    step(app, 2);

    const entity = app.world.projection.entityOf("board.items", "card") ?? 0;
    const object = app.renderer.sync.displayOf(entity) as FakeContainer;
    const [glow, tint] = (object.filters ?? []) as FakeFilter[];

    expect(object.filterWrites).toBe(1);
    expect(glow?.options.gpuProgram).toBeDefined();
    expect(app.effects.stats().filters).toBe(2);
    expect(app.effects.stats().renderPasses).toBe(1 + 1 + 2);

    const handle = app.anim.play(pulse, {});
    const amounts: number[] = [];

    for (let index = 0; index < 20; index += 1) {
      app.time.step(16);
      amounts.push((tint?.resources.fu as FakeUniformGroup).uniforms.amount as number);
    }

    await handle.done;

    expect(amounts.at(-1)).toBe(1);
    expect(amounts[5]).toBeGreaterThan(0);
    expect(amounts[5]).toBeLessThan(1);
    expect(object.filterWrites).toBe(1);
    expect(FakeFxGpuProgram.made.map(program => program.options.name)).toEqual([
      "effects.glow",
      "fx.tint"
    ]);

    const buffers = [glow, tint].map(filter => (filter?.resources.fu as FakeUniformGroup).buffer);

    await app.stop();

    expect(glow?.destroyed).toBe(true);
    expect(tint?.destroyed).toBe(true);
    expect(buffers.every(buffer => buffer.destroyed)).toBe(true);
  });

  it("freezes a stream in a paused world and emits nothing in a fast one", async () => {
    const app = await startApp([{ id: "gen", kind: "generator" }]);

    step(app, 2);

    const stream = FakeFxParticleContainer.made[0];
    const positions = (): number[] => (stream?.particleChildren ?? []).map(particle => particle.y);

    expect(stream?.particleChildren.length).toBeGreaterThan(0);

    app.world.ecs.setMode("paused");

    const frozen = positions();

    step(app, 5);
    expect(positions()).toEqual(frozen);

    app.world.ecs.setMode("fast");
    app.world.ecs.spawn({ kind: "plugin", name: "test" }, [
      Emitter({ effect: "fx.starsBurst" }),
      Transform({ x: 10, y: 10 })
    ]);
    step(app, 5);

    expect(FakeFxParticleContainer.made).toHaveLength(1);
    expect(positions()).toEqual(frozen);

    await app.stop();

    expect(stream?.destroyed).toBe(true);
  });

  it("answers zeros and touches no Pixi class without a mount", async () => {
    const app = await startApp(
      [
        { id: "gen", kind: "generator" },
        { id: "card", kind: "card" }
      ],
      false
    );

    step(app, 10);

    expect(app.renderer.host.ready()).toBe(false);
    expect(app.effects.stats()).toEqual({
      particles: 0,
      emitters: 0,
      filters: 0,
      renderPasses: 0
    });
    expect(FakeFxParticleContainer.made).toHaveLength(0);
    expect(FakeFxGpuProgram.made).toHaveLength(0);
    // Stored like any component: the snapshot names a filter component by its filter id.
    const components = app.world.ecs.snapshot().entities.map(entity => entity.components);

    expect(components).toContainEqual(
      expect.objectContaining({ Emitter: { effect: "fx.steam", active: true } })
    );
    expect(components).toContainEqual(
      expect.objectContaining({
        "effects.glow": {
          strength: 0,
          distance: 10,
          color: 0xff_ff_ff,
          alpha: 1,
          enabled: true,
          order: 0
        },
        "fx.tint": { amount: 0, color: 0xff_d7_00, enabled: true, order: 0 }
      })
    );

    await app.stop();
  });
});
