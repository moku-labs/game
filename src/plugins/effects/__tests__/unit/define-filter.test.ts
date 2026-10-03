import { describe, expect, it } from "vitest";
import {
  Alpha,
  Blur,
  builtInKinds,
  ColorMatrix,
  Displacement,
  Glow,
  Noise,
  Outline
} from "../../filters/builtins";
import { defineFilter } from "../../filters/define";
import { GLOW_GLSL } from "../../filters/glow-glsl";
import { assembleGlsl, GLSL_HEADER, glslUniforms } from "../../filters/glsl";
import { OUTLINE_GLSL } from "../../filters/outline-glsl";
import { assemble, HEADER, uniformStruct } from "../../filters/wgsl";

// ---------------------------------------------------------------------------
// Unit test: defineFilter validates its definition, assembles the WGSL and the
// GLSL and returns a flat component; the seven built-ins
// ---------------------------------------------------------------------------

const BODY = `
@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let c = textureSample(uTexture, uSampler, uv);
  return vec4<f32>(mix(c.rgb, fu.color * c.a, fu.amount), c.a);
}`;

const GLSL = `
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  finalColor = vec4(mix(c.rgb, color * c.a, amount), c.a);
}`;

describe("defineFilter", () => {
  it("returns a component named by its id with the filter attached", () => {
    const Tint = defineFilter("fx.tint", {
      wgsl: BODY,
      glsl: GLSL,
      uniforms: { amount: 0.5, color: { color: 0xff_d7_00 }, offset: [2, 3] }
    });

    expect(Tint.componentName).toBe("fx.tint");
    expect(Tint.defaults).toEqual({
      amount: 0.5,
      color: 0xff_d7_00,
      offset: [2, 3],
      enabled: true,
      order: 0
    });
    expect(Tint({ amount: 1 }).value.amount).toBe(1);
    expect(Tint.filter.id).toBe("fx.tint");
    expect(Tint.filter.passes).toBe(1);
    expect(Tint.filter.padding).toBe(0);
    expect(Tint.filter.uniforms).toEqual([
      { name: "amount", type: "f32", form: "number", size: 1 },
      { name: "color", type: "vec3<f32>", form: "color", size: 3 },
      { name: "offset", type: "vec2<f32>", form: "vector", size: 2 }
    ]);
    expect(Object.isFrozen(Tint.filter)).toBe(true);
    expect(Object.isFrozen(Tint.filter.uniforms)).toBe(true);
    expect(Object.isFrozen(Tint.defaults.offset)).toBe(true);
  });

  it("assembles the header, the struct in declaration order, the binding and the body", () => {
    const Tint = defineFilter("fx.tint", {
      wgsl: BODY,
      glsl: GLSL,
      uniforms: { amount: 0.5, color: { color: 0xff_d7_00 } },
      passes: 2,
      padding: 4
    });
    const source = Tint.filter.source;

    expect(source.startsWith(HEADER)).toBe(true);
    expect(source.endsWith(BODY)).toBe(true);
    expect(source).toContain("struct FilterUniforms {");
    expect(source.indexOf("amount: f32")).toBeLessThan(source.indexOf("color: vec3<f32>"));
    expect(source).toContain("@group(1) @binding(0) var<uniform> fu: FilterUniforms;");
    expect(source.indexOf("var<uniform> fu")).toBeLessThan(source.indexOf("fn mainFragment"));
    expect(Tint.filter.passes).toBe(2);
    expect(Tint.filter.padding).toBe(4);
  });

  it("writes no uniform struct and no binding without uniforms", () => {
    const Copy = defineFilter("fx.copy", { wgsl: BODY, glsl: GLSL });

    expect(Copy.filter.source).toBe(`${HEADER}${BODY}`);
    expect(Copy.filter.source).not.toContain("var<uniform> fu");
    expect(Copy.filter.uniforms).toEqual([]);
    expect(Copy.defaults).toEqual({ enabled: true, order: 0 });
  });

  it("takes the name of a number uniform as its padding", () => {
    const Halo = defineFilter("fx.halo", {
      wgsl: BODY,
      glsl: GLSL,
      uniforms: { reach: 8 },
      padding: "reach"
    });

    expect(Halo.filter.padding).toBe("reach");
  });

  it("refuses a body without mainFragment", () => {
    expect(() => defineFilter("fx.x", { wgsl: "fn helper() {}", glsl: GLSL })).toThrow(
      '[game] Filter "fx.x" has no mainFragment.\n  Write fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32>.'
    );
  });

  it("assembles the GLSL: the header, one uniform per declaration under its bare name, the body", () => {
    const Tint = defineFilter("fx.tint", {
      wgsl: BODY,
      glsl: GLSL,
      uniforms: { amount: 0.5, color: { color: 0xff_d7_00 }, offset: [2, 3], box: [0, 0, 1, 1] }
    });

    expect(Tint.filter.glsl).toBe(
      `${GLSL_HEADER}uniform float amount;\nuniform vec3 color;\nuniform vec2 offset;\nuniform vec4 box;\n\n${GLSL}`
    );
    // The WGSL beside it is the same as before: no public field was renamed.
    expect(Tint.filter.source).toBe(assemble(Tint.filter.uniforms, BODY));
  });

  it("writes no uniform line into the GLSL without uniforms", () => {
    const Copy = defineFilter("fx.copy", { wgsl: BODY, glsl: GLSL });

    expect(Copy.filter.glsl).toBe(`${GLSL_HEADER}${GLSL}`);
  });

  it("refuses a spec without glsl and a glsl without void main", () => {
    const message =
      '[game] Filter "fx.x" has no main in its glsl.\n  Write void main() in GLSL ES 3.0 and set finalColor.';

    // @ts-expect-error — both bodies are required: a filter draws on WebGPU and on WebGL
    expect(() => defineFilter("fx.x", { wgsl: BODY })).toThrow(message);
    expect(() =>
      defineFilter("fx.x", { wgsl: BODY, glsl: "float helper() { return 1.0; }" })
    ).toThrow(message);
  });

  it("refuses the names the shader headers declare", () => {
    const names = [
      "uInputSize",
      "uInputPixel",
      "uInputClamp",
      "uOutputFrame",
      "uGlobalFrame",
      "uOutputTexture",
      "uTexture",
      "uSampler"
    ];

    for (const name of names) {
      expect(() =>
        defineFilter("fx.x", { wgsl: BODY, glsl: GLSL, uniforms: { [name]: 1 } })
      ).toThrow(`[game] Filter "fx.x": uniform "${name}" is reserved.\n  Rename it.`);
    }
  });

  it("refuses finalColor and vTextureCoord: the GLSL header declares them", () => {
    for (const name of ["finalColor", "vTextureCoord"]) {
      expect(() =>
        defineFilter("fx.x", { wgsl: BODY, glsl: GLSL, uniforms: { [name]: 1 } })
      ).toThrow(`[game] Filter "fx.x": uniform "${name}" is reserved.\n  Rename it.`);
    }
  });

  it("refuses an empty id", () => {
    expect(() => defineFilter("", { wgsl: BODY, glsl: GLSL })).toThrow(
      "[game] A filter needs an id.\n  Pass a non-empty string as the first argument."
    );
  });

  it("refuses the reserved uniform names", () => {
    expect(() =>
      defineFilter("fx.x", { wgsl: BODY, glsl: GLSL, uniforms: { enabled: 1 } })
    ).toThrow('[game] Filter "fx.x": uniform "enabled" is reserved.\n  Rename it.');
    expect(() => defineFilter("fx.x", { wgsl: BODY, glsl: GLSL, uniforms: { order: 1 } })).toThrow(
      '[game] Filter "fx.x": uniform "order" is reserved.\n  Rename it.'
    );
  });

  it("refuses a name WGSL cannot carry", () => {
    expect(() =>
      defineFilter("fx.x", { wgsl: BODY, glsl: GLSL, uniforms: { "my-amount": 1 } })
    ).toThrow(
      '[game] Filter "fx.x": uniform "my-amount" is not a valid name.\n  Start with a lower-case letter and use letters and digits only.'
    );
    expect(() => defineFilter("fx.x", { wgsl: BODY, glsl: GLSL, uniforms: { Amount: 1 } })).toThrow(
      'uniform "Amount" is not a valid name'
    );
  });

  it("refuses a declaration of another form", () => {
    const five = [1, 2, 3, 4, 5] as unknown as [number, number];

    expect(() =>
      defineFilter("fx.x", { wgsl: BODY, glsl: GLSL, uniforms: { wide: five } })
    ).toThrow(
      '[game] Filter "fx.x": uniform "wide" must be a number, { color } or 2 to 4 numbers.\n  Got [1,2,3,4,5].'
    );
    expect(() =>
      defineFilter("fx.x", {
        wgsl: BODY,
        glsl: GLSL,
        uniforms: { odd: "red" as unknown as number }
      })
    ).toThrow('uniform "odd" must be a number, { color } or 2 to 4 numbers');
  });

  it("refuses passes below 1 or a fraction", () => {
    expect(() => defineFilter("fx.x", { wgsl: BODY, glsl: GLSL, passes: 0 })).toThrow(
      '[game] Filter "fx.x": passes must be an integer of at least 1.\n  Got 0.'
    );
    expect(() => defineFilter("fx.x", { wgsl: BODY, glsl: GLSL, passes: 1.5 })).toThrow(
      "passes must be an integer of at least 1"
    );
  });

  it("refuses a negative padding and a padding that names no number uniform", () => {
    expect(() => defineFilter("fx.x", { wgsl: BODY, glsl: GLSL, padding: -1 })).toThrow(
      '[game] Filter "fx.x": padding must be 0 or more pixels.\n  Got -1.'
    );
    expect(() =>
      defineFilter("fx.x", {
        wgsl: BODY,
        glsl: GLSL,
        uniforms: { tint: { color: 0 } },
        padding: "tint"
      })
    ).toThrow(
      '[game] Filter "fx.x": padding names no number uniform "tint".\n  Name one of its number uniforms.'
    );
  });
});

describe("wgsl", () => {
  it("writes a struct in declaration order and the fu binding", () => {
    expect(
      uniformStruct([
        { name: "amount", type: "f32", form: "number", size: 1 },
        { name: "color", type: "vec3<f32>", form: "color", size: 3 }
      ])
    ).toBe(
      "struct FilterUniforms {\n  amount: f32,\n  color: vec3<f32>,\n};\n\n" +
        "@group(1) @binding(0) var<uniform> fu: FilterUniforms;\n"
    );
    expect(uniformStruct([])).toBe("");
  });

  it("starts the header with the bindings Pixi's filter system fills", () => {
    expect(HEADER).toContain("@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;");
    expect(HEADER).toContain("@group(0) @binding(1) var uTexture: texture_2d<f32>;");
    expect(HEADER).toContain("@group(0) @binding(2) var uSampler: sampler;");
    expect(HEADER).toContain("fn mainVertex(");
    expect(assemble([], "body")).toBe(`${HEADER}body`);
  });
});

describe("glsl", () => {
  it("writes the GLSL ES 3.0 header Pixi's WebGL filter system fills", () => {
    expect(GLSL_HEADER).toBe(
      "#version 300 es\nprecision highp float;\n\n" +
        "in vec2 vTextureCoord;\nout vec4 finalColor;\n\n" +
        "uniform sampler2D uTexture;\n" +
        "uniform vec4 uInputSize;\nuniform vec4 uInputPixel;\nuniform vec4 uInputClamp;\n" +
        "uniform vec4 uOutputFrame;\nuniform vec4 uGlobalFrame;\nuniform vec4 uOutputTexture;\n\n"
    );
  });

  it("declares a float, a colour as vec3 and a tuple as vec2 to vec4, in declaration order", () => {
    expect(
      glslUniforms([
        { name: "amount", type: "f32", form: "number", size: 1 },
        { name: "color", type: "vec3<f32>", form: "color", size: 3 },
        { name: "offset", type: "vec2<f32>", form: "vector", size: 2 },
        { name: "tint", type: "vec3<f32>", form: "vector", size: 3 },
        { name: "box", type: "vec4<f32>", form: "vector", size: 4 }
      ])
    ).toBe(
      "uniform float amount;\nuniform vec3 color;\nuniform vec2 offset;\n" +
        "uniform vec3 tint;\nuniform vec4 box;\n\n"
    );
    expect(glslUniforms([])).toBe("");
    expect(assembleGlsl([], "body")).toBe(`${GLSL_HEADER}body`);
  });
});

describe("the built-in filters", () => {
  it("have the fields and defaults of the table", () => {
    expect(Glow({ strength: 4 }).value).toEqual({
      strength: 4,
      distance: 10,
      color: 0xff_ff_ff,
      alpha: 1,
      enabled: true,
      order: 0
    });
    expect(Outline.defaults).toEqual({
      thickness: 2,
      color: 0x00_00_00,
      alpha: 1,
      enabled: true,
      order: 0
    });
    expect(Blur.defaults).toEqual({
      strength: 8,
      quality: 0,
      resolution: 0,
      repeatEdgePixels: true,
      enabled: true,
      order: 0
    });
    expect(ColorMatrix.defaults).toEqual({
      brightness: 1,
      saturation: 0,
      contrast: 0,
      hue: 0,
      grayscale: 0,
      enabled: true,
      order: 0
    });
    expect(Noise.defaults).toEqual({ amount: 0.5, seed: 0, enabled: true, order: 0 });
    expect(Displacement.defaults).toEqual({
      map: "",
      scaleX: 20,
      scaleY: 20,
      enabled: true,
      order: 0
    });
    expect(Alpha.defaults).toEqual({ alpha: 1, enabled: true, order: 0 });
  });

  it("draw Glow and Outline with our WGSL and GLSL, padded by their live reach", () => {
    expect(Glow.filter.padding).toBe("distance");
    expect(Outline.filter.padding).toBe("thickness");
    expect(Glow.filter.source).toContain("fu.distance");
    expect(Outline.filter.source).toContain("fu.thickness");
    expect(Glow.filter.glsl.endsWith(GLOW_GLSL)).toBe(true);
    expect(Glow.filter.glsl).toContain("uniform float distance;");
    expect(Outline.filter.glsl.endsWith(OUTLINE_GLSL)).toBe(true);
    expect(Outline.filter.glsl).toContain("uniform float thickness;");
    expect(Glow.filter.uniforms.map(uniform => uniform.name)).toEqual([
      "strength",
      "distance",
      "color",
      "alpha"
    ]);
  });

  it("are listed in registration order, ours first, then the Pixi-core kinds", () => {
    const kinds = builtInKinds();

    expect(kinds.map(kind => kind.id)).toEqual([
      "effects.glow",
      "effects.outline",
      "effects.blur",
      "effects.colorMatrix",
      "effects.noise",
      "effects.displacement",
      "effects.alpha"
    ]);
    expect(kinds.map(kind => (kind.source === "core" ? kind.core : "wgsl"))).toEqual([
      "wgsl",
      "wgsl",
      "blur",
      "colorMatrix",
      "noise",
      "displacement",
      "alpha"
    ]);
    expect(kinds[2]?.component).toBe(Blur);
  });
});
