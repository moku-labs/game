import { describe, expect, it } from "vitest";
import { Sprite, Transform } from "../../../renderer/components";
import { Displacement, Glow } from "../../filters/builtins";
import { createHandlers } from "../../handlers";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import type { BundleUnloaded } from "../../types";
import { atlasTexture, FakeFxParticleContainer } from "../fake-effects-pixi";
import { createMockEffects, type MockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the one hook — a bundle that left retires the particle instances
// and the Displacement filters drawn with its textures, whatever their space
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
    mock.state.broken.add("fx.stars");

    expect(mock.state.orphans.size).toBe(1);

    createHandlers(mock.ctx)["assets:bundle-unloaded"](unloaded(["fx.star"]));

    expect(mock.state.instances.has(hosts[0] ?? 0)).toBe(false);
    expect(mock.state.instances.has(hosts[1] ?? 0)).toBe(true);
    expect(mock.state.orphans.size).toBe(0);
    expect(mock.state.baked.has("fx.stars")).toBe(false);
    expect(mock.state.baked.has("fx.steam")).toBe(true);
    expect(mock.state.warned.has("texture:fx.star")).toBe(false);
    expect(mock.state.warned.has("texture:fx.puff")).toBe(true);
    expect(mock.state.broken.has("fx.stars")).toBe(false);

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
