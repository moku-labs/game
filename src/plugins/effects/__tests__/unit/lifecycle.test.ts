import { afterEach, describe, expect, it, vi } from "vitest";
import { Sprite, Transform } from "../../../renderer/components";
import { Blur, Glow } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { resolvePhone } from "../../lifecycle";
import { Emitter } from "../../particles/component";
import { defineEmitter } from "../../particles/define";
import { atlasTexture, FakeFxParticleContainer } from "../fake-effects-pixi";
import { createMockEffects } from "./mock-effects";

// ---------------------------------------------------------------------------
// Unit test: the start (kinds, emitters, the duplicate and built-in checks,
// the phone) and the stop that frees every container, filter and buffer
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const BODY =
  "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv); }";

const GLSL = "void main() { finalColor = texture(uTexture, vTextureCoord); }";

const page = { width: 128, height: 128, destroyed: false };

describe("startEffects", () => {
  it("registers the built-in kinds first, then the filters of every feature in order", () => {
    const mock = createMockEffects();
    const Tint = defineFilter("fx.tint", { wgsl: BODY, glsl: GLSL });
    const Wave = defineFilter("fx.wave", { wgsl: BODY, glsl: GLSL });

    mock.features.push(
      { name: "board", description: { filters: [Tint] } },
      { name: "shop", description: { filters: [Wave] } }
    );
    mock.start();

    expect([...mock.state.kinds.keys()]).toEqual([
      "effects.glow",
      "effects.outline",
      "effects.blur",
      "effects.colorMatrix",
      "effects.noise",
      "effects.displacement",
      "effects.alpha",
      "fx.tint",
      "fx.wave"
    ]);
    expect(mock.state.kinds.get("fx.wave")?.index).toBe(8);
  });

  it("reads the emitters of every feature", () => {
    const mock = createMockEffects();
    const steam = defineEmitter("fx.steam", { textures: ["fx.puff"], rate: 12 });

    mock.features.push({ name: "board", description: { emitters: [steam] } });
    mock.start();

    expect(mock.state.emitters.get("fx.steam")).toBe(steam);
  });

  it("throws on an emitter id registered twice", () => {
    const mock = createMockEffects();
    const steam = defineEmitter("fx.steam", { textures: ["fx.puff"], rate: 12 });

    mock.features.push(
      { name: "board", description: { emitters: [steam] } },
      { name: "shop", description: { emitters: [steam] } }
    );

    expect(() => mock.start()).toThrow(
      '[game] Emitter "fx.steam" is registered twice.\n  Keep one defineEmitter per id.'
    );
  });

  it("throws on a filter id registered twice and on the id of a built-in", () => {
    const twice = createMockEffects();
    const Tint = defineFilter("fx.tint", { wgsl: BODY, glsl: GLSL });

    twice.features.push({ name: "board", description: { filters: [Tint, Tint] } });

    expect(() => twice.start()).toThrow(
      '[game] Filter "fx.tint" is registered twice.\n  Keep one defineFilter per id.'
    );

    const builtIn = createMockEffects();

    builtIn.features.push({
      name: "board",
      description: { filters: [defineFilter("effects.glow", { wgsl: BODY, glsl: GLSL })] }
    });

    expect(() => builtIn.start()).toThrow(
      '[game] Filter "effects.glow" is built in.\n  Choose another id.'
    );

    const listed = createMockEffects();

    listed.features.push({ name: "board", description: { filters: [Glow] } });

    expect(() => listed.start()).toThrow('[game] Filter "effects.glow" is built in.');
  });

  it("warns once per feature entry it cannot read", () => {
    const mock = createMockEffects();

    mock.features.push({
      name: "board",
      description: {
        emitters: [{ id: "fx.loose" }],
        filters: [{ componentName: "Blurry", filter: { id: "fx.blurry" } }]
      }
    });
    mock.start();

    expect(mock.log.warn).toHaveBeenCalledTimes(2);
    expect(mock.log.warn).toHaveBeenCalledWith("effects:bad-feature-entry", { feature: "board" });
    expect(mock.state.emitters.size).toBe(0);
    expect(mock.state.kinds.has("fx.blurry")).toBe(false);
  });

  it("resolves the phone flag once", () => {
    const set = createMockEffects({ config: { phone: true } });

    set.start();
    expect(set.state.phone).toBe(true);

    const auto = createMockEffects({ config: { phone: "auto" } });

    auto.start();
    expect(auto.state.phone).toBe(false);
  });
});

describe("resolvePhone", () => {
  it("is the setting when it is a boolean", () => {
    expect(resolvePhone(true)).toBe(true);
    expect(resolvePhone(false)).toBe(false);
  });

  it("is false where there is no window", () => {
    expect(resolvePhone("auto")).toBe(false);
  });

  it("is a coarse pointer and a short side of at most 820 CSS px", () => {
    const coarse = { matches: true };

    vi.stubGlobal("window", {});
    vi.stubGlobal("matchMedia", (query: string) => (query === "(pointer: coarse)" ? coarse : {}));
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);

    expect(resolvePhone("auto")).toBe(true);

    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 1366);
    expect(resolvePhone("auto")).toBe(false);

    coarse.matches = false;
    vi.stubGlobal("innerWidth", 390);
    expect(resolvePhone("auto")).toBe(false);
  });
});

describe("stopEffects", () => {
  it("frees every container, orphan, filter and buffer, clears the views and stops the systems", () => {
    const mock = createMockEffects();
    const stars = defineEmitter("fx.stars", {
      textures: ["fx.star"],
      burst: 10,
      lifeMs: [5000, 5000]
    });
    const steam = defineEmitter("fx.steam", { textures: ["fx.star"], rate: 10, space: "local" });

    mock.features.push({ name: "board", description: { emitters: [stars, steam] } });
    mock.textures.set("fx.star", atlasTexture(page));
    mock.start();

    const orphaned = mock.spawn([Emitter({ effect: "fx.stars" })]);

    mock.spawn([Emitter({ effect: "fx.steam" })]);

    const filtered = mock.spawn([Sprite({ texture: "a" }), Transform(), Glow(), Blur()]);

    mock.renderer.displays.add(filtered);
    mock.frame();
    mock.world.ecs.despawn(orphaned);

    const views = mock.state.views.get(filtered);
    const filters = [...(views?.instances.values() ?? [])].map(instance => instance.filter);

    expect(mock.state.orphans.size).toBe(1);
    expect(filters).toHaveLength(2);

    mock.stop();

    expect(FakeFxParticleContainer.made.every(container => container.destroyed)).toBe(true);
    expect(filters.every(filter => (filter as unknown as { destroyed: boolean }).destroyed)).toBe(
      true
    );
    expect(mock.renderer.sets.at(-1)).toEqual({ entity: filtered, slots: [] });
    expect(mock.state.instances.size).toBe(0);
    expect(mock.state.orphans.size).toBe(0);
    expect(mock.state.views.size).toBe(0);
    expect(mock.state.kinds.size).toBe(0);
    expect(mock.state.emitters.size).toBe(0);
    expect(mock.state.removers).toEqual([]);
    expect(mock.api.stats()).toEqual({ particles: 0, emitters: 0, filters: 0, renderPasses: 1 });

    // The systems are gone: a frame after the stop makes nothing.
    mock.spawn([Emitter({ effect: "fx.stars" })]);
    mock.frame();
    expect(FakeFxParticleContainer.made).toHaveLength(2);
  });
});
