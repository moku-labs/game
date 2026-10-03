import { describe, expect, it } from "vitest";
import type { FakeFilter, FakeUniformGroup } from "../../../renderer/__tests__/fake-pixi";
import type { PixiModule } from "../../../renderer/types";
import { Alpha, Blur, ColorMatrix, Displacement, Glow, Noise } from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { createFilter, destroyFilter, writeFilter } from "../../filters/instance";
import type { FilterFields, FilterInstance, FilterKind } from "../../filters/types";
import {
  atlasTexture,
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
  it("writes every uniform of ours on every call, with enabled and the live padding", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "fx.tint", Tint().value);
    const filter = instance.filter as unknown as FakeFilter;
    const group = filter.resources.fu as FakeUniformGroup;

    writeFilter(
      mock.ectx,
      instance,
      Tint({ amount: 0.9, color: 0x00_00_ff, offset: [4, 5], enabled: false }).value,
      false
    );

    expect(group.uniforms.amount).toBe(0.9);
    expect([...(group.uniforms.color as Float32Array)]).toEqual([0, 0, 1]);
    expect([...(group.uniforms.offset as Float32Array)]).toEqual([4, 5]);
    expect(filter.enabled).toBe(false);

    const glow = build(mock, pixi, "effects.glow", Glow().value);

    writeFilter(mock.ectx, glow, Glow({ distance: 20 }).value, false);
    expect((glow.filter as unknown as FakeFilter).padding).toBe(20);
  });

  it("composes ColorMatrix again from reset when it changed, and not otherwise", () => {
    const { mock, pixi } = started();
    const instance = build(mock, pixi, "effects.colorMatrix", ColorMatrix().value);
    const filter = instance.filter as unknown as FakeFxColorMatrixFilter;

    filter.calls.length = 0;
    writeFilter(mock.ectx, instance, ColorMatrix({ brightness: 1.2, hue: 30 }).value, false);
    expect(filter.calls).toEqual([]);

    writeFilter(mock.ectx, instance, ColorMatrix({ brightness: 1.2, hue: 30 }).value, true);
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
    writeFilter(mock.ectx, instance, Blur({ strength: 4, quality: 3 }).value, true);

    expect(filter.calls).toEqual([
      "strength=4",
      "quality=3",
      "resolution=1",
      "repeatEdgePixels=true"
    ]);
    expect(instance.passes).toBe(6);

    filter.calls.length = 0;
    writeFilter(mock.ectx, instance, Blur({ strength: 4, enabled: false }).value, false);
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

    writeFilter(mock.ectx, noise, Noise({ amount: 0.2, seed: 3 }).value, true);
    writeFilter(mock.ectx, alpha, Alpha({ alpha: 0.3 }).value, true);
    writeFilter(
      mock.ectx,
      displacement,
      Displacement({ map: "fx.waves", scaleX: 1, scaleY: 2 }).value,
      true
    );

    const map = displacement.filter as unknown as FakeFxDisplacementFilter;

    expect((noise.filter as unknown as FakeFxNoiseFilter).calls).toEqual(["noise=0.2", "seed=3"]);
    expect((alpha.filter as unknown as FakeFxAlphaFilter).calls).toEqual(["alpha=0.3"]);
    expect([map.scale.x, map.scale.y]).toEqual([1, 2]);
    expect(map.sprite.texture).toBe(mock.textures.get("fx.waves"));

    // A map that is not loaded keeps the old one and warns once.
    writeFilter(mock.ectx, displacement, Displacement({ map: "fx.gone" }).value, true);
    expect(map.sprite.texture).toBe(mock.textures.get("fx.waves"));
    expect(mock.log.warn).toHaveBeenCalledWith("effects:missing-texture", { key: "fx.gone" });
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
