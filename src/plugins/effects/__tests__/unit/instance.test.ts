import { describe, expect, it, vi } from "vitest";
import type { FakeFilter, FakeUniformGroup } from "../../../renderer/__tests__/fake-pixi";
import { CALM_AFTER } from "../../../renderer/kept/record";
import type { PixiModule } from "../../../renderer/types";
import { Alpha, Blur, ColorMatrix, Displacement, Glow, Noise } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { createFilter, destroyFilter, writeFilter } from "../../filters/instance";
import type { FilterFields, FilterInstance, FilterKind } from "../../filters/types";
import {
  atlasTexture,
  type FakeFilterManager,
  type FakeFxAlphaFilter,
  type FakeFxBlurFilter,
  type FakeFxColorMatrixFilter,
  type FakeFxDisplacementFilter,
  type FakeFxFilter,
  FakeFxGlProgram,
  FakeFxGpuProgram,
  type FakeFxNoiseFilter,
  FakeFxSprite
} from "../fake-effects-pixi";
import { createMockEffects, type MockEffects } from "./mock-effects";

/** A `before` of `writeFilter` for the cases that do not count its calls. */
const ignore = (): void => undefined;

// ---------------------------------------------------------------------------
// Unit test: the only file that builds Pixi filters — ours with a program and
// a uniform group, the five core kinds with their options, the writes and
// the destroy that frees the uniform buffers first
// ---------------------------------------------------------------------------

const BODY = `
@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, uv) * fu.amount;
}`;

const GLSL = `
void main() {
  finalColor = texture(uTexture, vTextureCoord) * amount;
}`;

const Tint = defineFilter("fx.tint", {
  wgsl: BODY,
  glsl: GLSL,
  uniforms: { amount: 0.5, color: { color: 0xff_80_00 }, offset: [2, 3] },
  padding: 6
});

/**
 * A started mock and the module its filters are built from.
 *
 * @returns The mock and the fake Pixi module.
 */
function started(): { mock: MockEffects; pixi: PixiModule } {
  const mock = createMockEffects();

  mock.start();

  return { mock, pixi: mock.pixi.module };
}

/**
 * The registered kind of a built-in or of the test's own filter.
 *
 * @param mock - The started mock.
 * @param id - The kind id.
 * @returns The kind.
 */
function kindOf(mock: MockEffects, id: string): FilterKind {
  if (id === "fx.tint") {
    return { id, component: Tint, source: "wgsl", definition: Tint.filter, index: 7 };
  }

  const kind = mock.state.kinds.get(id);

  if (kind === undefined) throw new Error(`no kind ${id}`);

  return kind;
}

/**
 * Builds one instance and fails the test when none came out.
 *
 * @param mock - The started mock.
 * @param pixi - The fake module.
 * @param id - The kind id.
 * @param value - The component value.
 * @returns The instance.
 */
function build(
  mock: MockEffects,
  pixi: PixiModule,
  id: string,
  value: FilterFields
): FilterInstance {
  const instance = createFilter(mock.ectx, pixi, kindOf(mock, id), value);

  if (instance === undefined) throw new Error(`no instance of ${id}`);

  return instance;
}

describe("createFilter — ours", () => {
  it("builds a Filter over both programs of the assembled sources and one uniform group fu", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "fx.tint", Tint().value);
    const filter = instance.filter as unknown as FakeFilter;
    const program = FakeFxGpuProgram.made.at(-1);
    const glProgram = FakeFxGlProgram.made.at(-1);

    expect(instance.kind).toBe("wgsl");
    expect(program?.options).toEqual({
      name: "fx.tint",
      vertex: { source: Tint.filter.source, entryPoint: "mainVertex" },
      fragment: { source: Tint.filter.source, entryPoint: "mainFragment" }
    });
    expect(filter.options.gpuProgram).toBe(program);
    // Pixi draws the program of the running backend; the WebGL one over its default vertex stage.
    expect(glProgram?.options).toEqual({
      name: "fx.tint",
      vertex: pixi.defaultFilterVert,
      fragment: Tint.filter.glsl
    });
    expect(filter.options.glProgram).toBe(glProgram);
    // One group serves both: Pixi binds it as `fu` on WebGPU and by bare uniform name on WebGL.
    expect(Object.keys(filter.resources)).toEqual(["fu"]);
    expect(filter.padding).toBe(6);
    expect(instance.passes).toBe(1);

    const group = filter.resources.fu as FakeUniformGroup;

    expect(group.uniforms.amount).toBe(0.5);
    expect([...(group.uniforms.color as Float32Array)]).toEqual([1, Math.fround(128 / 255), 0]);
    expect([...(group.uniforms.offset as Float32Array)]).toEqual([2, 3]);
  });

  it("builds no uniform group for a filter without uniforms", () => {
    const { mock, pixi } = started();
    const Copy = defineFilter("fx.copy", { wgsl: BODY, glsl: GLSL, passes: 3 });
    const instance = createFilter(
      mock.ectx,
      pixi,
      { id: "fx.copy", component: Copy, source: "wgsl", definition: Copy.filter, index: 8 },
      Copy().value
    );

    expect((instance?.filter as unknown as FakeFilter).resources).toEqual({});
    expect(instance?.passes).toBe(3);
  });

  it("builds ours at the resolution of the canvas, so a filtered view is sharp on DPR 2-3", () => {
    const { mock, pixi } = started();
    const tint = build(mock, pixi, "fx.tint", Tint().value);
    const glow = build(mock, pixi, "effects.glow", Glow().value);

    expect((tint.filter as unknown as FakeFxFilter).resolution).toBe("inherit");
    expect((glow.filter as unknown as FakeFxFilter).resolution).toBe("inherit");
    expect((glow.filter as unknown as FakeFilter).options.resolution).toBe("inherit");
  });

  it("pads Glow by its live distance", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "effects.glow", Glow({ distance: 14 }).value);

    expect((instance.filter as unknown as FakeFilter).padding).toBe(14);
  });
});

describe("createFilter — the Pixi-core kinds", () => {
  it("builds Blur at the config's quality, resolution 1 off a phone, edge pixels repeated", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "effects.blur", Blur().value);
    const filter = instance.filter as unknown as FakeFxBlurFilter;

    expect(filter.strength).toBe(8);
    expect(filter.quality).toBe(2);
    expect(filter.resolution).toBe(1);
    expect(filter.repeatEdgePixels).toBe(true);
    expect(instance.passes).toBe(4);
  });

  it("builds Blur at the phone resolution on a phone and keeps an explicit quality", () => {
    const { mock, pixi } = started();

    mock.state.phone = true;

    const instance = build(mock, pixi, "effects.blur", Blur({ quality: 3 }).value);
    const filter = instance.filter as unknown as FakeFxBlurFilter;

    expect(filter.resolution).toBe(0.5);
    expect(instance.passes).toBe(6);
  });

  it("builds ColorMatrix from the identity, composed in order", () => {
    const { mock, pixi } = started();
    const plain = build(mock, pixi, "effects.colorMatrix", ColorMatrix().value);
    const gray = build(mock, pixi, "effects.colorMatrix", ColorMatrix({ grayscale: 0.5 }).value);

    expect((plain.filter as unknown as FakeFxColorMatrixFilter).calls).toEqual([
      "reset",
      "brightness(1,true)",
      "saturate(0,true)",
      "contrast(0,true)",
      "hue(0,true)"
    ]);
    expect((gray.filter as unknown as FakeFxColorMatrixFilter).calls.at(-1)).toBe(
      "saturate(-0.5,true)"
    );
  });

  it("builds Noise with its seed always given", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "effects.noise", Noise({ seed: 7 }).value);

    expect((instance.filter as unknown as FakeFxNoiseFilter).built).toEqual({
      noise: 0.5,
      seed: 7,
      resolution: "inherit"
    });
  });

  it("builds Displacement over a sprite of the map texture", () => {
    const { mock, pixi } = started();
    const ripple = atlasTexture({ width: 64, height: 64, destroyed: false });

    mock.textures.set("fx.ripple", ripple);

    const instance = build(
      mock,
      pixi,
      "effects.displacement",
      Displacement({ map: "fx.ripple", scaleX: 5, scaleY: 7 }).value
    );
    const filter = instance.filter as unknown as FakeFxDisplacementFilter;

    expect(filter.sprite).toBeInstanceOf(FakeFxSprite);
    expect(filter.sprite.texture).toBe(ripple);
    expect([filter.scale.x, filter.scale.y]).toEqual([5, 7]);
  });

  it("builds no Displacement while its map is missing and warns once per key", () => {
    const { mock, pixi } = started();
    const kind = kindOf(mock, "effects.displacement");
    const value = Displacement({ map: "fx.ripple" }).value;

    expect(createFilter(mock.ectx, pixi, kind, value)).toBeUndefined();
    expect(createFilter(mock.ectx, pixi, kind, value)).toBeUndefined();
    expect(createFilter(mock.ectx, pixi, kind, Displacement().value)).toBeUndefined();
    expect(mock.log.warn).toHaveBeenCalledTimes(1);
    expect(mock.log.warn).toHaveBeenCalledWith("effects:missing-texture", { key: "fx.ripple" });
  });

  it("builds Alpha at its alpha", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "effects.alpha", Alpha({ alpha: 0.4 }).value);

    expect((instance.filter as unknown as FakeFxAlphaFilter).built).toEqual({
      alpha: 0.4,
      resolution: "inherit"
    });
  });

  it("builds every core kind but Blur at the resolution of the canvas", () => {
    const { mock, pixi } = started();

    mock.textures.set("fx.ripple", atlasTexture({ width: 64, height: 64, destroyed: false }));

    const values: Array<[string, FilterFields]> = [
      ["effects.colorMatrix", ColorMatrix().value],
      ["effects.noise", Noise().value],
      ["effects.alpha", Alpha().value],
      ["effects.displacement", Displacement({ map: "fx.ripple" }).value]
    ];
    const resolutions = values.map(
      ([id, value]) => (build(mock, pixi, id, value).filter as unknown as FakeFxFilter).resolution
    );
    const blur = build(mock, pixi, "effects.blur", Blur().value);

    expect(resolutions).toEqual(["inherit", "inherit", "inherit", "inherit"]);
    // Blur keeps its own resolution: config.blur.phoneResolution on a phone, 1 elsewhere.
    expect((blur.filter as unknown as FakeFxBlurFilter).resolution).toBe(1);
  });
});

describe("writeFilter", () => {
  it("writes the uniforms of ours that changed, with enabled and the live padding", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "fx.tint", Tint().value);
    const filter = instance.filter as unknown as FakeFilter;
    const group = filter.resources.fu as FakeUniformGroup;

    writeFilter(
      mock.ectx,
      instance,
      Tint({ amount: 0.9, color: 0x00_00_ff, offset: [4, 5], enabled: false }).value,
      false,
      ignore
    );

    expect(group.uniforms.amount).toBe(0.9);
    expect([...(group.uniforms.color as Float32Array)]).toEqual([0, 0, 1]);
    expect([...(group.uniforms.offset as Float32Array)]).toEqual([4, 5]);
    expect(filter.enabled).toBe(false);

    const glow = build(mock, pixi, "effects.glow", Glow().value);

    writeFilter(mock.ectx, glow, Glow({ distance: 20 }).value, false, ignore);
    expect((glow.filter as unknown as FakeFilter).padding).toBe(20);
  });

  it("composes ColorMatrix again from reset when it changed, and not otherwise", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "effects.colorMatrix", ColorMatrix().value);
    const filter = instance.filter as unknown as FakeFxColorMatrixFilter;

    filter.calls.length = 0;
    writeFilter(
      mock.ectx,
      instance,
      ColorMatrix({ brightness: 1.2, hue: 30 }).value,
      false,
      ignore
    );
    expect(filter.calls).toEqual([]);

    writeFilter(mock.ectx, instance, ColorMatrix({ brightness: 1.2, hue: 30 }).value, true, ignore);
    expect(filter.calls).toEqual([
      "reset",
      "brightness(1.2,true)",
      "saturate(0,true)",
      "contrast(0,true)",
      "hue(30,true)"
    ]);
  });

  it("sets Blur through its setters when it changed and follows its passes", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "effects.blur", Blur().value);
    const filter = instance.filter as unknown as FakeFxBlurFilter;

    filter.calls.length = 0;
    writeFilter(mock.ectx, instance, Blur({ strength: 4, quality: 3 }).value, true, ignore);

    expect(filter.calls).toEqual([
      "strength=4",
      "quality=3",
      "resolution=1",
      "repeatEdgePixels=true"
    ]);
    expect(instance.passes).toBe(6);

    filter.calls.length = 0;
    writeFilter(mock.ectx, instance, Blur({ strength: 4, enabled: false }).value, false, ignore);
    expect(filter.calls).toEqual([]);
    expect(filter.enabled).toBe(false);
  });

  it("sets Noise, Alpha and the Displacement scale and map when they changed", () => {
    const { mock, pixi } = started();
    const noise = build(mock, pixi, "effects.noise", Noise().value);
    const alpha = build(mock, pixi, "effects.alpha", Alpha().value);

    mock.textures.set("fx.ripple", atlasTexture({ width: 8, height: 8, destroyed: false }));
    mock.textures.set("fx.waves", atlasTexture({ width: 8, height: 8, destroyed: false }));

    const displacement = build(
      mock,
      pixi,
      "effects.displacement",
      Displacement({ map: "fx.ripple" }).value
    );

    writeFilter(mock.ectx, noise, Noise({ amount: 0.2, seed: 3 }).value, true, ignore);
    writeFilter(mock.ectx, alpha, Alpha({ alpha: 0.3 }).value, true, ignore);
    writeFilter(
      mock.ectx,
      displacement,
      Displacement({ map: "fx.waves", scaleX: 1, scaleY: 2 }).value,
      true,
      ignore
    );

    const map = displacement.filter as unknown as FakeFxDisplacementFilter;

    expect((noise.filter as unknown as FakeFxNoiseFilter).calls).toEqual(["noise=0.2", "seed=3"]);
    expect((alpha.filter as unknown as FakeFxAlphaFilter).calls).toEqual(["alpha=0.3"]);
    expect([map.scale.x, map.scale.y]).toEqual([1, 2]);
    expect(map.sprite.texture).toBe(mock.textures.get("fx.waves"));

    // A map that is not loaded keeps the old one and warns once.
    writeFilter(mock.ectx, displacement, Displacement({ map: "fx.gone" }).value, true, ignore);
    expect(map.sprite.texture).toBe(mock.textures.get("fx.waves"));
    expect(mock.log.warn).toHaveBeenCalledWith("effects:missing-texture", { key: "fx.gone" });
  });
});

describe("createFilter — the instance is the builder's object", () => {
  it("createFilter hands back the builder's object: the guard's break shows on the instance the sync holds", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "fx.tint", Tint().value);
    const manager: FakeFilterManager = {
      applyFilter: vi.fn((filter: unknown) => {
        if ((filter as FakeFilter).enabled)
          throw new Error("the resource bound as 'uMap' was destroyed");
      })
    };

    (instance.filter as unknown as FakeFxFilter).apply(manager, "input", "output", true);

    expect(instance.broken).toBe(true);
    expect(instance.filter.enabled).toBe(false);
  });
});

/**
 * The uniforms of an instance of ours.
 *
 * @param instance - The instance.
 * @returns The values of its uniform group.
 */
function uniformsOf(instance: FilterInstance): Record<string, unknown> {
  return ((instance.filter as unknown as FakeFilter).resources.fu as FakeUniformGroup).uniforms;
}

describe("writeFilter — compare on write", () => {
  it("writes nothing and asks for nothing when an own filter holds the value already, float32 rounding included", () => {
    const { mock, pixi } = started();
    const value = Tint({ amount: 0.6, color: 0x33_66_99, offset: [0.1, 0.2] }).value;
    const instance = build(mock, pixi, "fx.tint", value);
    const color = uniformsOf(instance).color;
    const before = vi.fn();

    expect(writeFilter(mock.ectx, instance, { ...value }, true, before)).toBe(false);
    expect(before).not.toHaveBeenCalled();
    expect(uniformsOf(instance).color).toBe(color);
    expect([...(uniformsOf(instance).offset as Float32Array)]).toEqual([
      Math.fround(0.1),
      Math.fround(0.2)
    ]);
  });

  it.each([
    ["number", "fx.tint", Tint().value, Tint({ amount: 0.25 }).value, "amount", 0.25],
    [
      "one vector element",
      "fx.tint",
      Tint().value,
      Tint({ offset: [2, 0.5] }).value,
      "offset",
      [2, 0.5]
    ],
    [
      "colour",
      "fx.tint",
      Tint({ color: 0xff_d7_00 }).value,
      Tint({ color: 0x00_ff_00 }).value,
      "color",
      [0, 1, 0]
    ],
    [
      "padding uniform",
      "effects.glow",
      Glow({ distance: 4 }).value,
      Glow({ distance: 9 }).value,
      "distance",
      9
    ]
  ])("a %s change asks once and lands in the group", (_name, id, start, next, uniform, written) => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, id, start);
    const before = vi.fn();

    expect(writeFilter(mock.ectx, instance, next, false, before)).toBe(true);
    expect(before).toHaveBeenCalledTimes(1);

    const held = uniformsOf(instance)[uniform];

    expect(held instanceof Float32Array ? [...held] : held).toEqual(written);
    if (id === "effects.glow") expect((instance.filter as unknown as FakeFilter).padding).toBe(9);
  });

  it("a switched-off filter is a visible change, takes new values silently and asks on its way back on", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "fx.tint", Tint().value);
    const before = vi.fn();

    expect(writeFilter(mock.ectx, instance, Tint({ enabled: false }).value, false, before)).toBe(
      true
    );
    expect(before).toHaveBeenCalledTimes(1);
    expect(instance.filter.enabled).toBe(false);

    expect(
      writeFilter(mock.ectx, instance, Tint({ enabled: false, amount: 0.9 }).value, false, before)
    ).toBe(false);
    expect(before).toHaveBeenCalledTimes(1);
    expect(uniformsOf(instance).amount).toBe(0.9);

    expect(writeFilter(mock.ectx, instance, Tint({ amount: 0.9 }).value, false, before)).toBe(true);
    expect(before).toHaveBeenCalledTimes(2);
    expect(instance.filter.enabled).toBe(true);
  });

  it("a built-in kind rewritten with an equal value calls no setter, though the ECS marked it changed", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "effects.blur", Blur().value);
    const filter = instance.filter as unknown as FakeFxBlurFilter;
    const before = vi.fn();

    filter.calls.length = 0;

    expect(writeFilter(mock.ectx, instance, Blur().value, true, before)).toBe(false);
    expect(filter.calls).toEqual([]);
    expect(before).not.toHaveBeenCalled();
  });

  it("a built-in kind with one field changed calls its setters and asks once; the same value again calls none", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "effects.blur", Blur().value);
    const filter = instance.filter as unknown as FakeFxBlurFilter;
    const before = vi.fn();

    filter.calls.length = 0;

    expect(writeFilter(mock.ectx, instance, Blur({ strength: 4 }).value, true, before)).toBe(true);
    expect(before).toHaveBeenCalledTimes(1);
    expect(filter.calls).toContain("strength=4");

    filter.calls.length = 0;

    expect(writeFilter(mock.ectx, instance, Blur({ strength: 4 }).value, true, before)).toBe(false);
    expect(filter.calls).toEqual([]);
  });

  it("a broken instance stays off whatever its component says, and asks for nothing", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "fx.tint", Tint().value);
    const before = vi.fn();

    instance.broken = true;
    instance.filter.enabled = false;

    expect(writeFilter(mock.ectx, instance, Tint({ amount: 0.2 }).value, true, before)).toBe(false);
    expect(instance.filter.enabled).toBe(false);
    expect(before).not.toHaveBeenCalled();
  });

  it("a NaN value is not a change every frame", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "fx.tint", Tint({ amount: Number.NaN }).value);
    const before = vi.fn();

    expect(
      writeFilter(mock.ectx, instance, Tint({ amount: Number.NaN }).value, false, before)
    ).toBe(false);
    expect(before).not.toHaveBeenCalled();
  });
});

describe("destroyFilter", () => {
  it("destroys every uniform buffer first, then the filter", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "fx.tint", Tint().value);
    const filter = instance.filter as unknown as FakeFilter;
    const group = filter.resources.fu as FakeUniformGroup;
    const order: string[] = [];

    group.buffer.destroy = (): void => {
      order.push("buffer");
    };
    filter.destroy = (): void => {
      order.push("filter");
    };

    destroyFilter(instance);

    expect(order).toEqual(["buffer", "filter"]);
  });

  it("frees the buffers of a core kind and the map sprite of Displacement", () => {
    const { mock, pixi } = started();

    mock.textures.set("fx.ripple", atlasTexture({ width: 8, height: 8, destroyed: false }));

    const blur = build(mock, pixi, "effects.blur", Blur().value);
    const displacement = build(
      mock,
      pixi,
      "effects.displacement",
      Displacement({ map: "fx.ripple" }).value
    );
    const blurFilter = blur.filter as unknown as FakeFilter;
    const map = displacement.filter as unknown as FakeFxDisplacementFilter;

    destroyFilter(blur);
    destroyFilter(displacement);

    expect((blurFilter.resources.blurUniforms as FakeUniformGroup).buffer.destroyed).toBe(true);
    expect(blurFilter.destroyed).toBe(true);
    expect(map.destroyed).toBe(true);
    expect((map.sprite as FakeFxSprite).destroyOptions).toEqual({ texture: false });
    expect(map.sprite.texture.destroyed).toBe(false);
  });
});

describe("Alpha: its resolution and the pass it skips at 1", () => {
  // Bug: the fog asks for half the pixels and is still drawn at the canvas resolution: the field is ignored.
  it("builds an Alpha at its own resolution, at the canvas's for 0, and follows a change both ways", () => {
    const { mock, pixi } = started();
    const instance = build(
      mock,
      pixi,
      "effects.alpha",
      Alpha({ alpha: 0.5, resolution: 0.5 }).value
    );
    const filter = instance.filter as unknown as FakeFxAlphaFilter;

    expect(filter.built).toEqual({ alpha: 0.5, resolution: 0.5 });

    writeFilter(mock.ectx, instance, Alpha({ alpha: 0.5 }).value, true, ignore);
    expect(filter.resolution).toBe("inherit");

    writeFilter(mock.ectx, instance, Alpha({ alpha: 0.5, resolution: 0.75 }).value, true, ignore);
    expect(filter.resolution).toBe(0.75);
  });

  // Bug: an Alpha at 1 renders its whole subtree into a texture and copies it back unchanged, in every frame.
  it("builds an Alpha at 1 switched off; at 0.5, or at 1 with a resolution, switched on; a disabled one off", () => {
    const { mock, pixi } = started();
    const enabledOf = (value: FilterFields): boolean =>
      build(mock, pixi, "effects.alpha", value).filter.enabled;

    expect(enabledOf(Alpha().value)).toBe(false);
    expect(enabledOf(Alpha({ alpha: 0.5 }).value)).toBe(true);
    expect(enabledOf(Alpha({ resolution: 0.5 }).value)).toBe(true);
    expect(enabledOf(Alpha({ alpha: 0.5, enabled: false }).value)).toBe(false);
  });

  // Bug: an Alpha that touches 1 on a keyframe switches its Pixi filter at every touch (a new filter list, a render
  // group rebuilt, a kept picture let go and taken again); or one that rests at 1 keeps its pass for ever; or the
  // switch asks the renderer for no frame, and a screen drawn on demand keeps the old picture.
  it("an Alpha at 1 keeps its filter for CALM_AFTER - 1 syncs, switches it off at the next and asks; a resolution switches it on at once", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "effects.alpha", Alpha({ alpha: 0.6 }).value);
    const filter = instance.filter as unknown as FakeFxAlphaFilter;
    const before = vi.fn();
    const rest = Alpha().value;
    const held: boolean[] = [];

    // A touch: CALM_AFTER - 1 syncs at 1, then away, twice.
    for (let touch = 0; touch < 2; touch += 1) {
      for (let sync = 1; sync < CALM_AFTER; sync += 1) {
        writeFilter(mock.ectx, instance, rest, sync === 1, before);
        held.push(filter.enabled);
      }

      writeFilter(mock.ectx, instance, Alpha({ alpha: 0.6 }).value, true, before);
      held.push(filter.enabled);
    }

    expect(held.every(Boolean)).toBe(true);
    // Every move of the value is drawn; the syncs at rest ask for nothing.
    expect(before).toHaveBeenCalledTimes(4);

    for (let sync = 1; sync < CALM_AFTER; sync += 1) {
      writeFilter(mock.ectx, instance, rest, sync === 1, before);
    }

    expect(filter.enabled).toBe(true);
    expect(before).toHaveBeenCalledTimes(5);

    // The CALM_AFTER-th sync at 1: off, and the frame is asked for.
    expect(writeFilter(mock.ectx, instance, rest, false, before)).toBe(true);
    expect(filter.enabled).toBe(false);
    expect(before).toHaveBeenCalledTimes(6);

    // A resolution at 1 keeps the pass: the subtree is drawn at fewer pixels through it.
    expect(writeFilter(mock.ectx, instance, Alpha({ resolution: 0.5 }).value, true, before)).toBe(
      true
    );
    expect(filter.enabled).toBe(true);
    expect(before).toHaveBeenCalledTimes(7);
  });

  // Bug: a resolution typed as 50 makes Pixi draw the subtree into a texture of 50 texels per CSS px.
  it("clamps an Alpha's resolution to 4, at build and on a change", () => {
    const { mock, pixi } = started();
    const instance = build(
      mock,
      pixi,
      "effects.alpha",
      Alpha({ alpha: 0.5, resolution: 50 }).value
    );
    const filter = instance.filter as unknown as FakeFxAlphaFilter;

    expect(filter.built.resolution).toBe(4);

    writeFilter(
      mock.ectx,
      instance,
      Alpha({ alpha: 0.5, resolution: Number.POSITIVE_INFINITY }).value,
      true,
      ignore
    );
    expect(filter.resolution).toBe(4);
  });

  // Bug: a game's filter declares a resolution and is drawn at the canvas's anyway.
  it("builds a defined filter at its resolution, at the canvas's without one", () => {
    const { mock, pixi } = started();
    const Half = defineFilter("fx.half", {
      wgsl: BODY,
      glsl: GLSL,
      uniforms: { amount: 1 },
      resolution: 0.5
    });
    const half = createFilter(
      mock.ectx,
      pixi,
      { id: "fx.half", component: Half, source: "wgsl", definition: Half.filter, index: 8 },
      Half().value
    );
    const tint = build(mock, pixi, "fx.tint", Tint().value);

    expect((half?.filter as unknown as FakeFxFilter).resolution).toBe(0.5);
    expect((tint.filter as unknown as FakeFxFilter).resolution).toBe("inherit");
  });
});
