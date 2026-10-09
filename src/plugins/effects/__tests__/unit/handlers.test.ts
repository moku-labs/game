import { describe, expect, it } from "vitest";
import { Sprite, Transform } from "../../../renderer/components";
import { Displacement, Glow } from "../../filters/builtins";
import { createHandlers } from "../../handlers";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import type { AssetsReplaced, BundleUnloaded } from "../../types";
import { atlasTexture, FakeFxParticleContainer } from "../fake-effects-pixi";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the two asset hooks — a bundle that left, and a dev hot swap that
// replaced files of a loaded one, retire the particle instances and the
// Displacement filters drawn with their textures, whatever their space
// ---------------------------------------------------------------------------

const page = { width: 128, height: 128, destroyed: false };

const stars = defineEmitter("fx.stars", { textures: ["fx.star"], burst: 5, lifeMs: [5000, 5000] });
const steam = defineEmitter("fx.steam", { textures: ["fx.puff"], rate: 10 });

/**
 * A started mock with two emitters on two bundles of textures.
 *
 * @returns The mock.
 */
function started(): MockEffects {
  const mock = createMockEffects();

  mock.features.push({ name: "board", description: { emitters: [stars, steam] } });
  mock.textures.set("fx.star", atlasTexture(page));
  mock.textures.set("fx.puff", atlasTexture(page));
  mock.textures.set("fx.ripple", atlasTexture(page));
  mock.start();

  return mock;
}

/**
 * The payload of a bundle that left.
 *
 * @param keys - Its keys.
 * @returns The payload.
 */
function unloaded(keys: readonly string[]): BundleUnloaded {
  return { bundle: "fx", tier: "scene", mb: 1, reason: "budget", keys };
}

/**
 * The payload of a dev hot swap that replaced files of the `fx` bundle.
 *
 * @param keys - The keys with new bytes.
 * @returns The payload.
 */
function replaced(keys: readonly string[]): AssetsReplaced {
  return { bundle: "fx", keys };
}

/**
 * The textures the live particles of a host's instance draw with. Untyped: the instance holds
 * Pixi's type, the mock hands out fakes.
 *
 * @param mock - The mock.
 * @param host - The entity with the `Emitter`.
 * @returns One texture per live particle; none when the host runs no instance.
 */
function drawnWith(mock: MockEffects, host: number): unknown[] {
  const particles = mock.state.instances.get(host)?.container.particleChildren ?? [];

  return particles.map(particle => particle.texture);
}

describe("assets:bundle-unloaded", () => {
  it("retires the instances and orphans drawn with its keys and drops their bake", () => {
    const mock = started();
    const hosts = [
      mock.spawn([Emitter({ effect: "fx.stars" })]),
      mock.spawn([Emitter({ effect: "fx.steam" })]),
      mock.spawn([Emitter({ effect: "fx.stars" })])
    ];

    mock.frame();
    mock.world.ecs.despawn(hosts[2] ?? 0);
    mock.state.warned.add("texture:fx.star");
    mock.state.warned.add("texture:fx.puff");

    expect(mock.state.orphans.size).toBe(1);

    createHandlers(mock.ctx)["assets:bundle-unloaded"](unloaded(["fx.star"]));

    expect(mock.state.instances.has(hosts[0] ?? 0)).toBe(false);
    expect(mock.state.instances.has(hosts[1] ?? 0)).toBe(true);
    expect(mock.state.orphans.size).toBe(0);
    expect(mock.state.baked.has("fx.stars")).toBe(false);
    expect(mock.state.baked.has("fx.steam")).toBe(true);
    expect(mock.state.warned.has("texture:fx.star")).toBe(false);
    expect(mock.state.warned.has("texture:fx.puff")).toBe(true);

    const destroyed = FakeFxParticleContainer.made.filter(container => container.destroyed);

    expect(destroyed).toHaveLength(2);
  });

  it("bakes the effect again once the bundle is back", () => {
    const mock = started();
    const host = mock.spawn([Emitter({ effect: "fx.stars" })]);

    mock.frame();
    mock.textures.delete("fx.star");
    createHandlers(mock.ctx)["assets:bundle-unloaded"](unloaded(["fx.star"]));
    mock.frame();

    expect(mock.state.instances.has(host)).toBe(false);

    mock.textures.set("fx.star", atlasTexture(page));
    mock.frame();

    expect(mock.state.instances.get(host)?.id).toBe("fx.stars");
  });

  it("retires a Displacement whose map left and builds it again when it is back", () => {
    const mock = started();
    const entity = mock.spawn([
      Sprite({ texture: "a" }),
      Transform(),
      Glow(),
      Displacement({ map: "fx.ripple" })
    ]);

    mock.renderer.displays.add(entity);
    mock.frame();

    const instances = mock.state.views.get(entity)?.instances;
    const map = instances?.get("effects.displacement")?.filter;

    mock.textures.delete("fx.ripple");
    createHandlers(mock.ctx)["assets:bundle-unloaded"](unloaded(["fx.ripple"]));
    mock.frame();

    expect((map as unknown as { destroyed: boolean }).destroyed).toBe(true);
    expect(instances?.has("effects.displacement")).toBe(false);
    expect(mock.renderer.sets.at(-1)?.slots).toHaveLength(1);

    mock.textures.set("fx.ripple", atlasTexture(page));
    mock.frame();

    expect(instances?.has("effects.displacement")).toBe(true);
    expect(mock.renderer.sets.at(-1)?.slots).toHaveLength(2);
  });
});

describe("assets:replaced", () => {
  it("retires what was drawn with its keys and nothing else", () => {
    const mock = started();

    mock.textures.set("fx.wave", atlasTexture(page));

    const hosts = [
      mock.spawn([Emitter({ effect: "fx.stars" })]),
      mock.spawn([Emitter({ effect: "fx.steam" })]),
      mock.spawn([Emitter({ effect: "fx.stars" })])
    ];
    const rippled = mock.spawn([
      Sprite({ texture: "a" }),
      Transform(),
      Displacement({ map: "fx.ripple" })
    ]);
    const waved = mock.spawn([
      Sprite({ texture: "a" }),
      Transform(),
      Displacement({ map: "fx.wave" })
    ]);

    mock.renderer.displays.add(rippled);
    mock.renderer.displays.add(waved);
    mock.frame();
    mock.world.ecs.despawn(hosts[2] ?? 0);
    mock.state.warned.add("texture:fx.star");
    mock.state.warned.add("texture:fx.puff");
    mock.state.warned.add("emitter:fx.star");

    const stream = mock.state.instances.get(hosts[1] ?? 0);
    const burst = mock.state.instances.get(hosts[0] ?? 0);
    const [orphan] = mock.state.orphans;
    const wave = mock.state.views.get(waved)?.instances.get("effects.displacement");

    expect(mock.state.orphans.size).toBe(1);
    expect(wave).toBeDefined();

    createHandlers(mock.ctx)["assets:replaced"](replaced(["fx.star", "fx.ripple"]));

    // The particles of the replaced key: both instances and their bake.
    expect(mock.state.instances.has(hosts[0] ?? 0)).toBe(false);
    expect(mock.state.orphans.size).toBe(0);
    expect(burst?.container.destroyed).toBe(true);
    expect(orphan?.container.destroyed).toBe(true);
    expect(mock.state.baked.has("fx.stars")).toBe(false);
    expect(mock.state.warned.has("texture:fx.star")).toBe(false);

    // The map of the replaced key.
    expect(mock.state.views.get(rippled)?.instances.has("effects.displacement")).toBe(false);

    // Everything of the other keys stands as it was.
    expect(mock.state.instances.get(hosts[1] ?? 0)).toBe(stream);
    expect(stream?.container.destroyed).toBe(false);
    expect(mock.state.baked.has("fx.steam")).toBe(true);
    expect(mock.state.warned.has("texture:fx.puff")).toBe(true);
    expect(mock.state.warned.has("emitter:fx.star")).toBe(true);
    expect(mock.state.views.get(waved)?.instances.get("effects.displacement")).toBe(wave);
    expect(mock.state.emitters.get("fx.stars")).toBe(stars);
  });

  it("starts a running emitter again on the new texture", () => {
    const mock = started();
    const host = mock.spawn([Emitter({ effect: "fx.steam" })]);

    mock.frame(200);

    const old = mock.state.instances.get(host);
    const before = mock.textures.get("fx.puff");
    const next = atlasTexture({ width: 256, height: 256, destroyed: false }, 48);

    expect(old?.container.particleChildren.length).toBeGreaterThan(0);

    // What `assets` did before it emitted: the new texture under the key, the old one destroyed.
    mock.textures.set("fx.puff", next);
    before?.destroy();
    createHandlers(mock.ctx)["assets:replaced"](replaced(["fx.puff"]));
    mock.frame(200);

    const instance = mock.state.instances.get(host);
    const drawn = drawnWith(mock, host);

    expect(instance).not.toBe(old);
    expect(old?.container.destroyed).toBe(true);
    expect(instance?.baked.textures).toEqual([next]);
    expect(instance?.baked.maxSide).toBe(48);
    expect(FakeFxParticleContainer.made.at(-1)?.texture).toBe(next);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every(texture => texture === next)).toBe(true);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("plays the burst of a host that still names the effect again, on the new texture", () => {
    const mock = started();
    const host = mock.spawn([Emitter({ effect: "fx.stars" })]);

    mock.frame();

    const next = atlasTexture({ width: 256, height: 256, destroyed: false }, 48);

    mock.textures.set("fx.star", next);
    createHandlers(mock.ctx)["assets:replaced"](replaced(["fx.star"]));

    expect(mock.state.instances.has(host)).toBe(false);

    mock.frame();

    const drawn = drawnWith(mock, host);

    expect(drawn).toHaveLength(5);
    expect(drawn.every(texture => texture === next)).toBe(true);
  });

  it("drops the bake nobody runs, so an emitter spawned after it draws with the new texture", () => {
    const mock = started();
    const first = mock.spawn([Emitter({ effect: "fx.steam" })]);

    // A stream that never got to emit leaves no orphan, only its bake.
    mock.frame();
    mock.world.ecs.despawn(first);

    expect(mock.state.instances.size).toBe(0);
    expect(mock.state.orphans.size).toBe(0);
    expect(mock.state.baked.has("fx.steam")).toBe(true);

    const next = atlasTexture({ width: 256, height: 256, destroyed: false }, 48);

    mock.textures.set("fx.puff", next);
    createHandlers(mock.ctx)["assets:replaced"](replaced(["fx.puff"]));

    expect(mock.state.baked.has("fx.steam")).toBe(false);

    const second = mock.spawn([Emitter({ effect: "fx.steam" })]);

    mock.frame(200);

    const drawn = drawnWith(mock, second);

    expect(mock.state.instances.get(second)?.baked.textures).toEqual([next]);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every(texture => texture === next)).toBe(true);
  });

  it("builds a Displacement again over the new map", () => {
    const mock = started();
    const entity = mock.spawn([
      Sprite({ texture: "a" }),
      Transform(),
      Displacement({ map: "fx.ripple" })
    ]);

    mock.renderer.displays.add(entity);
    mock.frame();

    const instances = mock.state.views.get(entity)?.instances;
    const old = instances?.get("effects.displacement");
    const next = atlasTexture({ width: 256, height: 256, destroyed: false }, 48);

    mock.textures.set("fx.ripple", next);
    createHandlers(mock.ctx)["assets:replaced"](replaced(["fx.ripple"]));
    mock.frame();

    const rebuilt = instances?.get("effects.displacement");

    expect(rebuilt).toBeDefined();
    expect(rebuilt).not.toBe(old);
    expect((old?.filter as unknown as { destroyed: boolean }).destroyed).toBe(true);
    expect(rebuilt?.kind === "displacement" ? rebuilt.sprite.texture : undefined).toBe(next);
    expect(mock.renderer.sets.at(-1)?.slots).toHaveLength(1);
  });

  it("does nothing for a key no effect draws with", () => {
    const mock = started();
    const host = mock.spawn([Emitter({ effect: "fx.stars" })]);

    mock.frame();

    const instance = mock.state.instances.get(host);

    createHandlers(mock.ctx)["assets:replaced"](replaced(["ui.body", "board.cell"]));

    expect(mock.state.instances.get(host)).toBe(instance);
    expect(instance?.container.destroyed).toBe(false);
    expect(mock.state.baked.has("fx.stars")).toBe(true);
  });
});
