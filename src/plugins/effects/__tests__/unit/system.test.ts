import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeRectangle } from "../../../renderer/__tests__/fake-pixi";
import { Display, Parent, Transform } from "../../../renderer/components";
import { rootPoseOf } from "../../../renderer/sync/pose";
import { Layer, Order } from "../../../world/ecs/define";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import { atlasTexture, FakeFxParticleContainer } from "../fake-effects-pixi";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the particle system over the real ecs of world, a fake renderer
// and fake assets — instances, spaces, retire, orphans, warnings, budget
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const page = { width: 256, height: 256, destroyed: false };

const stars = defineEmitter("fx.stars", {
  textures: ["fx.star", "fx.sparkle"],
  burst: 20,
  lifeMs: [500, 900],
  speed: [100, 200],
  maxParticles: 120
});

const steam = defineEmitter("fx.steam", {
  textures: ["fx.puff"],
  rate: 12,
  lifeMs: [900, 1400],
  space: "local",
  maxParticles: 30
});

const trail = defineEmitter("fx.trail", { textures: ["fx.puff"], rate: 50, lifeMs: [5000, 5000] });

/**
 * A started mock with the three emitters registered and every texture on one page.
 *
 * @param options - Passed to `createMockEffects`.
 * @returns The started mock.
 */
function started(options: Parameters<typeof createMockEffects>[0] = {}): MockEffects {
  const mock = createMockEffects(options);

  mock.features.push({ name: "board", description: { emitters: [stars, steam, trail] } });
  mock.textures.set("fx.star", atlasTexture(page));
  mock.textures.set("fx.sparkle", atlasTexture(page));
  mock.textures.set("fx.puff", atlasTexture(page));
  mock.start();

  return mock;
}

/**
 * Runs frames of 16 ms.
 *
 * @param mock - The mock.
 * @param count - How many frames.
 */
function frames(mock: MockEffects, count: number): void {
  for (let index = 0; index < count; index += 1) mock.frame(16);
}

describe("the particle system — instances", () => {
  it("draws an instance on an effects-owned entity with the host's layer and order", () => {
    const mock = started();
    const host = mock.spawn([
      Emitter({ effect: "fx.stars" }),
      Transform({ x: 100, y: 200, rotation: 1, scale: 2 }),
      Layer({ name: "fx" }),
      Order({ value: 7 })
    ]);

    mock.frame();

    const instance = mock.state.instances.get(host);
    const container = FakeFxParticleContainer.made[0];
    const ecs = mock.world.ecs;

    expect(instance?.id).toBe("fx.stars");
    expect(FakeFxParticleContainer.made).toHaveLength(1);

    const entity = instance?.entity ?? 0;

    expect(ecs.get(entity, Display)?.object).toBe(container);
    // World space: at the host's root point, never turned or scaled with it.
    expect(ecs.get(entity, Transform)).toEqual({
      x: 100,
      y: 200,
      rotation: 0,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });
    expect(ecs.get(entity, Layer)).toEqual({ name: "fx" });
    expect(ecs.get(entity, Order)).toEqual({ value: 7 });
    expect(ecs.has(entity, Parent)).toBe(false);
    expect(ecs.snapshot().entities.find(row => row.id === entity)?.owner).toEqual({
      kind: "plugin",
      name: "effects"
    });
  });

  it("builds the container with one dynamic set, the first texture and a bounds area", () => {
    const mock = started();
    const host = mock.spawn([Emitter({ effect: "fx.stars" }), Transform({ x: 0, y: 0 })]);

    mock.frame();

    const container = FakeFxParticleContainer.made[0];
    const reach = mock.state.instances.get(host)?.baked.reach ?? 0;

    expect(container?.options.dynamicProperties).toEqual({
      position: true,
      vertex: true,
      rotation: true,
      color: true,
      uvs: false
    });
    expect(container?.texture).toBe(mock.textures.get("fx.star"));
    expect(container?.blendMode).toBe("normal");
    expect(container?.boundsArea).toEqual(new FakeRectangle(-reach, -reach, 2 * reach, 2 * reach));
    expect(container?.particleChildren).toHaveLength(20);
    expect(mock.state.seedCounter).toBe(1);
  });

  it("draws in the layer and order of the top of the host's parent chain", () => {
    const mock = started();
    const screen = mock.spawn([
      Transform({ x: 0, y: 0 }),
      Layer({ name: "ui" }),
      Order({ value: 5 })
    ]);
    const slot = mock.spawn([
      Transform({ x: 40, y: 60 }),
      Parent({ entity: screen }),
      Order({ value: 2 })
    ]);
    const host = mock.spawn([
      Emitter({ effect: "fx.stars" }),
      Transform({ x: 10, y: 0 }),
      Parent({ entity: slot }),
      Layer({ name: "board" }),
      Order({ value: 9 })
    ]);

    mock.frame();

    const entity = mock.state.instances.get(host)?.entity ?? 0;

    expect(mock.world.ecs.get(entity, Layer)).toEqual({ name: "ui" });
    expect(mock.world.ecs.get(entity, Order)).toEqual({ value: 5 });
    expect(mock.world.ecs.has(entity, Parent)).toBe(false);
  });

  it("copies no layer and no order the top of the chain does not have", () => {
    const mock = started();
    const slot = mock.spawn([Transform({ x: 40, y: 60 })]);
    const host = mock.spawn([
      Emitter({ effect: "fx.steam" }),
      Parent({ entity: slot }),
      Layer({ name: "board" }),
      Order({ value: 9 })
    ]);

    mock.frame();

    const entity = mock.state.instances.get(host)?.entity ?? 0;

    expect(mock.world.ecs.has(entity, Layer)).toBe(false);
    expect(mock.world.ecs.has(entity, Order)).toBe(false);
  });

  it("copies no layer and no order the host does not have", () => {
    const mock = started();
    const host = mock.spawn([Emitter({ effect: "fx.stars" })]);

    mock.frame();

    const entity = mock.state.instances.get(host)?.entity ?? 0;

    expect(mock.world.ecs.has(entity, Layer)).toBe(false);
    expect(mock.world.ecs.has(entity, Order)).toBe(false);
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(0);
  });

  it("emits a world-space stream from where its host is now", () => {
    const mock = started();
    const host = mock.spawn([Emitter({ effect: "fx.trail" }), Transform({ x: 100, y: 0 })]);

    frames(mock, 2);
    mock.world.ecs.set(host, Transform, { x: 160 });
    frames(mock, 3);

    const container = FakeFxParticleContainer.made[0];
    const newest = container?.particleChildren.at(-1);

    // The container stays at the origin; the newest particle is born 60 units right of it.
    expect(mock.world.ecs.get(mock.state.instances.get(host)?.entity ?? 0, Transform)?.x).toBe(100);
    expect(newest?.x).toBe(60);
  });

  it("moves a local-space container with its host every frame, without a parent", () => {
    const mock = started();
    const slot = mock.spawn([Transform({ x: 40, y: 60, scale: 0.5 })]);
    const host = mock.spawn([
      Emitter({ effect: "fx.steam" }),
      Transform({ x: 100, y: 200 }),
      Parent({ entity: slot })
    ]);

    mock.frame();

    const entity = mock.state.instances.get(host)?.entity ?? 0;

    expect(mock.world.ecs.get(entity, Transform)).toEqual(rootPoseOf(mock.world.ecs, host));

    mock.world.ecs.set(host, Transform, { x: 300, rotation: 0.5 });
    mock.frame();

    expect(mock.world.ecs.get(entity, Transform)).toEqual(rootPoseOf(mock.world.ecs, host));
    expect(mock.world.ecs.get(entity, Transform)?.x).toBe(190);
    expect(mock.world.ecs.has(entity, Parent)).toBe(false);
  });

  it("uses the blend of the config", () => {
    const glow = defineEmitter("fx.glow", { textures: ["fx.puff"], burst: 1, blend: "add" });
    const mock = createMockEffects();

    mock.features.push({ name: "board", description: { emitters: [glow] } });
    mock.textures.set("fx.puff", atlasTexture(page));
    mock.start();
    mock.spawn([Emitter({ effect: "fx.glow" })]);
    mock.frame();

    expect(FakeFxParticleContainer.made[0]?.blendMode).toBe("add");
  });
});

describe("the particle system — retire and orphans", () => {
  it("retires an instance whose effect changed and starts the new one", () => {
    const mock = started();
    const host = mock.spawn([Emitter({ effect: "fx.stars" }), Transform({ x: 0, y: 0 })]);

    mock.frame();
    mock.world.ecs.set(host, Emitter, { effect: "fx.trail" });
    mock.frame();

    expect(mock.state.instances.get(host)?.id).toBe("fx.trail");
    // The burst still flies: a world-space instance with live particles becomes an orphan.
    expect(mock.state.orphans.size).toBe(1);
    expect(mock.api.stats().emitters).toBe(2);
  });

  it("emits a burst again when the same host names another burst", () => {
    const sparks = defineEmitter("fx.sparks", { textures: ["fx.star"], burst: 5 });
    const mock = createMockEffects();

    mock.features.push({ name: "board", description: { emitters: [stars, sparks] } });
    mock.textures.set("fx.star", atlasTexture(page));
    mock.textures.set("fx.sparkle", atlasTexture(page));
    mock.start();

    const host = mock.spawn([Emitter({ effect: "fx.stars" })]);

    mock.frame();
    mock.world.ecs.set(host, Emitter, { effect: "fx.sparks" });
    mock.frame();

    expect(FakeFxParticleContainer.made).toHaveLength(2);
    expect(FakeFxParticleContainer.made[1]?.particleChildren).toHaveLength(5);
  });

  it("destroys a local-space instance at once when its effect changes to nothing", () => {
    const mock = started();
    const host = mock.spawn([Emitter({ effect: "fx.steam" }), Transform({ x: 0, y: 0 })]);

    frames(mock, 10);

    const entity = mock.state.instances.get(host)?.entity ?? 0;

    mock.world.ecs.set(host, Emitter, { effect: "" });
    mock.frame();

    const container = FakeFxParticleContainer.made[0];

    expect(mock.state.instances.has(host)).toBe(false);
    expect(mock.state.orphans.size).toBe(0);
    expect(container?.destroyed).toBe(true);
    expect(container?.destroyOptions).toEqual({ children: true, texture: false });
    expect(mock.world.ecs.has(entity, Display)).toBe(false);
  });

  it("orphans a world-space burst whose host left and destroys it at 0", () => {
    const mock = started();
    const host = mock.spawn([Emitter({ effect: "fx.stars" }), Transform({ x: 0, y: 0 })]);

    mock.frame();

    const entity = mock.state.instances.get(host)?.entity ?? 0;

    mock.world.ecs.despawn(host);

    expect(mock.state.instances.size).toBe(0);
    expect(mock.state.orphans.size).toBe(1);
    expect(mock.world.ecs.has(entity, Display)).toBe(true);

    frames(mock, 60);

    expect(mock.state.orphans.size).toBe(0);
    expect(FakeFxParticleContainer.made[0]?.destroyed).toBe(true);
    expect(mock.world.ecs.has(entity, Display)).toBe(false);
    expect(mock.api.stats()).toEqual({ particles: 0, emitters: 0, filters: 0, renderPasses: 1 });
  });

  it("destroys a local-space instance with its host", () => {
    const mock = started();
    const host = mock.spawn([Emitter({ effect: "fx.steam" }), Transform({ x: 0, y: 0 })]);

    frames(mock, 10);
    mock.world.ecs.remove(host, Emitter);

    expect(mock.state.instances.size).toBe(0);
    expect(mock.state.orphans.size).toBe(0);
    expect(FakeFxParticleContainer.made[0]?.destroyed).toBe(true);
  });
});

describe("the particle system — warnings", () => {
  it("warns once per missing texture key and tries again every frame", () => {
    const mock = createMockEffects();

    mock.features.push({ name: "board", description: { emitters: [steam] } });
    mock.start();

    const host = mock.spawn([Emitter({ effect: "fx.steam" })]);

    frames(mock, 3);

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("effects:missing-texture", { key: "fx.puff" });
    expect(mock.state.instances.has(host)).toBe(false);

    mock.textures.set("fx.puff", atlasTexture(page));
    mock.frame();

    expect(mock.state.instances.get(host)?.id).toBe("fx.steam");
  });

  it("in dev, warns once per effect on textures of two sources and draws the first source", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const loose = { width: 64, height: 64, destroyed: false };
    const sparkles = defineEmitter("fx.sparkles", {
      textures: ["fx.sparkle", "fx.star", "fx.glint"],
      burst: 12
    });
    const mock = createMockEffects();

    mock.features.push({ name: "board", description: { emitters: [stars, sparkles] } });
    mock.textures.set("fx.star", atlasTexture(page));
    mock.textures.set("fx.sparkle", atlasTexture(loose));
    mock.textures.set("fx.glint", atlasTexture(loose));
    mock.start();

    const first = mock.spawn([Emitter({ effect: "fx.stars" })]);

    mock.spawn([Emitter({ effect: "fx.stars" })]);

    const other = mock.spawn([Emitter({ effect: "fx.sparkles" })]);

    frames(mock, 3);

    expect(mock.log.error).not.toHaveBeenCalled();
    expect(mock.log.warn).toHaveBeenCalledTimes(2);
    expect(mock.log.warn).toHaveBeenCalledWith("effects:atlas", {
      effect: "fx.stars",
      keys: ["fx.star", "fx.sparkle"],
      dropped: ["fx.sparkle"]
    });
    expect(mock.log.warn).toHaveBeenCalledWith("effects:atlas", {
      effect: "fx.sparkles",
      keys: ["fx.sparkle", "fx.star", "fx.glint"],
      dropped: ["fx.star"]
    });
    expect(FakeFxParticleContainer.made).toHaveLength(3);
    expect(mock.state.instances.get(first)?.baked.textures).toEqual([mock.textures.get("fx.star")]);
    expect(mock.state.instances.get(other)?.baked.textures).toEqual([
      mock.textures.get("fx.sparkle"),
      mock.textures.get("fx.glint")
    ]);

    const drawn = new Set(
      FakeFxParticleContainer.made[0]?.particleChildren.map(particle => particle.texture)
    );

    expect([...drawn]).toEqual([mock.textures.get("fx.star")]);
  });

  it("does not check the sources in a production build", () => {
    const mock = createMockEffects();

    mock.features.push({ name: "board", description: { emitters: [stars] } });
    mock.textures.set("fx.star", atlasTexture(page));
    mock.textures.set("fx.sparkle", atlasTexture({ width: 64, height: 64, destroyed: false }));
    mock.start();
    mock.spawn([Emitter({ effect: "fx.stars" })]);
    mock.frame();

    expect(mock.log.error).not.toHaveBeenCalled();
    expect(FakeFxParticleContainer.made).toHaveLength(1);
  });

  it("warns once per unknown effect and draws nothing", () => {
    const mock = started();

    mock.spawn([Emitter({ effect: "fx.nope" })]);
    mock.spawn([Emitter({ effect: "fx.nope" })]);
    frames(mock, 3);

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("effects:unknown-emitter", { effect: "fx.nope" });
    expect(FakeFxParticleContainer.made).toHaveLength(0);
  });

  it("draws nothing and warns nothing for an empty effect", () => {
    const mock = started();

    mock.spawn([Emitter()]);
    frames(mock, 3);

    expect(mock.log.warn).not.toHaveBeenCalled();
    expect(mock.state.instances.size).toBe(0);
  });

  it("warns once per crossing of the particle budget", () => {
    const mock = started({ config: { maxParticles: 30 } });

    mock.spawn([Emitter({ effect: "fx.stars" })]);
    mock.frame();
    expect(mock.log.warn).not.toHaveBeenCalled();

    mock.spawn([Emitter({ effect: "fx.stars" })]);
    frames(mock, 3);

    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("effects:particle-budget", {
      live: 40,
      budget: 30
    });

    frames(mock, 60);
    expect(mock.state.particles).toBe(0);

    mock.spawn([Emitter({ effect: "fx.stars" })]);
    mock.spawn([Emitter({ effect: "fx.stars" })]);
    mock.frame();

    expect(mock.log.warn).toHaveBeenCalledTimes(2);
  });
});

describe("the particle system — modes", () => {
  it("returns at once while the renderer is not ready", () => {
    const mock = started({ ready: false });

    mock.spawn([Emitter({ effect: "fx.stars" })]);
    frames(mock, 3);

    expect(mock.state.instances.size).toBe(0);
    expect(FakeFxParticleContainer.made).toHaveLength(0);
    expect(mock.api.stats()).toEqual({ particles: 0, emitters: 0, filters: 0, renderPasses: 1 });
  });

  it("freezes in a paused world and emits nothing in a fast one", () => {
    const mock = started();

    mock.spawn([Emitter({ effect: "fx.trail" }), Transform({ x: 0, y: 0 })]);
    frames(mock, 5);

    const container = FakeFxParticleContainer.made[0];
    const count = container?.particleChildren.length ?? 0;

    expect(count).toBeGreaterThan(0);

    mock.world.ecs.setMode("paused");
    frames(mock, 5);

    expect(container?.particleChildren).toHaveLength(count);

    mock.world.ecs.setMode("live");
    mock.flow.mode = "fast";
    mock.spawn([Emitter({ effect: "fx.stars" })]);
    frames(mock, 3);

    expect(FakeFxParticleContainer.made).toHaveLength(1);
    expect(container?.particleChildren).toHaveLength(count);
  });

  it("counts live particles and instances", () => {
    const mock = started();

    mock.spawn([Emitter({ effect: "fx.stars" })]);
    mock.spawn([Emitter({ effect: "fx.stars" })]);
    mock.frame();

    expect(mock.api.stats().particles).toBe(40);
    expect(mock.api.stats().emitters).toBe(2);
  });
});
