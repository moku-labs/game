/**
 * @file The bench's own filter bodies, shaped like the cases of a real game, never taken from one.
 * Rendering is WebGPU, so the WGSL body is what is measured. `defineFilter` asks for a GLSL twin
 * too: all of them share one pass-through, so WebGL draws the scenes without their looks.
 */
import { defineFilter } from "../../../../src/index.ts";

/** The GLSL twin the filter API asks for. */
const GLSL_PASS = "void main() { finalColor = texture(uTexture, vTextureCoord); }";

/** The opening of a fragment body: `n` is the place in the input, 0 to 1. */
const OPEN = `@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = uv / gfu.uInputClamp.zw;
  let c = textureSampleLevel(uTexture, uSampler, uv, 0.0);`;

/**
 * A fragment body from its lines after the opening.
 *
 * @param lines - The WGSL after `n` and `c`, down to the return.
 * @returns The body.
 * @example
 * ```ts
 * body("return c;").endsWith("return c;\n}"); // true
 * ```
 */
function body(lines: string): string {
  return `${OPEN}\n  ${lines}\n}`;
}

/** The tiny live breaker of `slope-N`: one uniform, written each frame, never kept. */
export const Breaker = defineFilter("bench.breaker", {
  wgsl: body("return vec4<f32>(c.rgb * (0.9 + 0.1 * sin(fu.phase + n.x)), c.a);"),
  glsl: GLSL_PASS,
  uniforms: { phase: 0 },
  cache: false
});

/** One full-screen live filter: a grade with a vignette. */
export const FullGrade = defineFilter("bench.fullGrade", {
  wgsl: body(`let edge = 1.0 - 0.4 * distance(n, vec2<f32>(0.5, 0.5));
  return vec4<f32>(c.rgb * edge * (0.95 + 0.05 * sin(fu.phase)), c.a);`),
  glsl: GLSL_PASS,
  uniforms: { phase: 0 },
  cache: false
});

/** The drop shadow of a board item: eight taps of the input's alpha, offset down and right. */
export const Shadow = defineFilter("bench.shadow", {
  wgsl: body(`var shade = 0.0;
  for (var i = 0; i < 8; i++) {
    let turn = f32(i) * 0.785;
    let at = uv + (vec2<f32>(3.0, 3.0) + vec2<f32>(cos(turn), sin(turn)) * 3.0) * gfu.uInputPixel.zw;
    shade += textureSampleLevel(uTexture, uSampler, clamp(at, gfu.uInputClamp.xy, gfu.uInputClamp.zw), 0.0).a;
  }
  return c + vec4<f32>(0.0, 0.0, 0.0, shade * 0.06) * (1.0 - c.a);`),
  glsl: GLSL_PASS,
  padding: 10
});

/** The filtered root of the `glow` scene: one number over everything under it. */
export const RootTint = defineFilter("bench.rootTint", {
  wgsl: body("return vec4<f32>(c.rgb * fu.strength, c.a);"),
  glsl: GLSL_PASS,
  uniforms: { strength: 0.95 }
});

/** An object's glow on the ward: reads where it is drawn, breathes and glints. */
export const ObjectGlow = defineFilter("bench.objectGlow", {
  wgsl: body(`let at = canvasPixel(uv);
  let band = 0.5 + 0.5 * sin(at.x * 0.04 + at.y * 0.02 + fu.glint);
  return vec4<f32>(c.rgb * (1.0 + (0.6 + 0.4 * fu.breath) * band), c.a);`),
  glsl: GLSL_PASS,
  uniforms: { breath: 0, glint: 0 },
  cache: "placed"
});

/**
 * A round wipe with a wobbling edge, the fog's body: `taps` extra reads make the develop heavier.
 *
 * @param taps - The extra reads of the input.
 * @returns The WGSL lines.
 * @example
 * ```ts
 * fogLines(0).includes("for (var i = 0; i < 0; i++)"); // true
 * ```
 */
function fogLines(taps: number): string {
  return `var sum = c;
  for (var i = 0; i < ${taps}; i++) {
    let at = uv + vec2<f32>(f32(i) * 2.0, 0.0) * gfu.uInputPixel.zw;
    sum += textureSampleLevel(uTexture, uSampler, clamp(at, gfu.uInputClamp.xy, gfu.uInputClamp.zw), 0.0);
  }
  let wobble = 0.04 * sin(n.x * 37.0 + n.y * 23.0);
  let edge = smoothstep(fu.radius, fu.radius + 0.12, distance(n, vec2<f32>(0.5, 0.5)) + wobble);
  return (sum / ${taps + 1}.0) * (1.0 - edge);`;
}

/** The fog's wipe on a tile, drawn live. */
export const FogWipeLive = defineFilter("bench.fogWipeLive", {
  wgsl: body(fogLines(0)),
  glsl: GLSL_PASS,
  uniforms: { radius: 0 },
  cache: false
});

/** The same wipe, kept as a picture between two writes. */
export const FogWipeLocal = defineFilter("bench.fogWipeLocal", {
  wgsl: body(fogLines(0)),
  glsl: GLSL_PASS,
  uniforms: { radius: 0 },
  cache: "local"
});

/** The fog developing over the wide layer, drawn live. */
export const FogDevelopLive = defineFilter("bench.fogDevelopLive", {
  wgsl: body(fogLines(4)),
  glsl: GLSL_PASS,
  uniforms: { radius: 0 },
  cache: false
});

/** The same develop, kept as a picture between two writes. */
export const FogDevelopLocal = defineFilter("bench.fogDevelopLocal", {
  wgsl: body(fogLines(4)),
  glsl: GLSL_PASS,
  uniforms: { radius: 0 },
  cache: "local"
});

/** A card's perspective flip and fold: reads the canvas origin through the engine's helper. */
export const FlipFold = defineFilter("bench.flipFold", {
  wgsl: body(`let at = canvasPixel(uv);
  let lean = 1.0 + sin(fu.angle) * (n.x - 0.5) * 0.7;
  let flat = max(abs(cos(fu.angle)), 0.02);
  let p = vec2<f32>(0.5 + (n.x - 0.5) / flat * lean, 0.5 + (n.y - 0.5) * lean);
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) {
    return vec4<f32>(0.0);
  }
  let fold = 0.8 + 0.2 * sin(at.y * 0.03 + fu.angle);
  return textureSampleLevel(uTexture, uSampler, p * gfu.uInputClamp.zw, 0.0) * fold;`),
  glsl: GLSL_PASS,
  uniforms: { angle: 0 },
  padding: 8
});

/** The flip of an order row, shaped like OrderFlip: one number, written each frame. */
const ROW_FLIP = body(`let lean = 1.0 + sin(fu.angle) * (n.x - 0.5) * 0.5;
  let flat = max(abs(cos(fu.angle)), 0.02);
  let p = vec2<f32>(0.5 + (n.x - 0.5) * lean, 0.5 + (n.y - 0.5) / flat * lean);
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) {
    return vec4<f32>(0.0);
  }
  return textureSampleLevel(uTexture, uSampler, p * gfu.uInputClamp.zw, 0.0);`);

/** The row flip, kept: the engine draws it through its own shader while its number changes. */
export const RowFlip = defineFilter("bench.rowFlip", {
  wgsl: ROW_FLIP,
  glsl: GLSL_PASS,
  uniforms: { angle: 0 },
  padding: 8,
  cache: "local"
});

/** The row flip, drawn live. */
export const RowFlipLive = defineFilter("bench.rowFlipLive", {
  wgsl: ROW_FLIP,
  glsl: GLSL_PASS,
  uniforms: { angle: 0 },
  padding: 8,
  cache: false
});

/** The fixed drop of the rest arm: a kept picture that never changes. */
export const RestShade = defineFilter("bench.restShade", {
  wgsl: body("return vec4<f32>(c.rgb * fu.strength, c.a);"),
  glsl: GLSL_PASS,
  uniforms: { strength: 0.9 },
  cache: "local"
});

/** A soft round window over a picture and a subtree: draws only the disc of its area. */
export const LensWindow = defineFilter("bench.lensWindow", {
  wgsl: body("return c * smoothstep(0.5, 0.5 - fu.soft, distance(n, vec2<f32>(0.5, 0.5)));"),
  glsl: GLSL_PASS,
  uniforms: { x: 195, y: 420, reach: 120, soft: 0.2 },
  area: value => [value.x - value.reach, value.y - value.reach, value.reach * 2, value.reach * 2]
});

/** Promo: a perspective map of live text. */
export const PromoMap = defineFilter("bench.promoMap", {
  wgsl: body(`let squeeze = 1.0 + fu.tilt * (n.y - 0.5);
  let p = vec2<f32>(0.5 + (n.x - 0.5) * squeeze, n.y);
  return textureSampleLevel(uTexture, uSampler, clamp(p, vec2<f32>(0.0), vec2<f32>(1.0)) * gfu.uInputClamp.zw, 0.0);`),
  glsl: GLSL_PASS,
  uniforms: { tilt: 0.5 },
  padding: 4
});

/** Promo: a quad drawn from time alone, where the view has content. */
export const PromoProcedural = defineFilter("bench.promoProcedural", {
  wgsl: body(`let wave = 0.5 + 0.5 * sin(n.x * 6.0 + n.y * 3.0 + fu.time);
  return vec4<f32>(wave, 0.4, 1.0 - wave, 1.0) * c.a;`),
  glsl: GLSL_PASS,
  uniforms: { time: 0 },
  cache: false
});

/** Promo: a column mirrored under itself, faded by a gradient. */
export const PromoMirror = defineFilter("bench.promoMirror", {
  wgsl: body(`let y = 1.0 - abs(n.y * 2.0 - 1.0);
  let p = vec2<f32>(n.x, y) * gfu.uInputClamp.zw;
  let shade = select(1.0, 1.0 - y, n.y > 0.5);
  return textureSampleLevel(uTexture, uSampler, p, 0.0) * shade;`),
  glsl: GLSL_PASS
});

/** Promo: a stroke drawn along by a sweep. */
export const PromoStroke = defineFilter("bench.promoStroke", {
  wgsl: body("return c * (1.0 - smoothstep(fu.sweep, fu.sweep + 0.08, n.x));"),
  glsl: GLSL_PASS,
  uniforms: { sweep: 0 }
});

/** Every filter of the bench, for the feature. */
export const BENCH_FILTERS = [
  Breaker,
  FullGrade,
  Shadow,
  RootTint,
  ObjectGlow,
  FogWipeLive,
  FogWipeLocal,
  FogDevelopLive,
  FogDevelopLocal,
  FlipFold,
  RowFlip,
  RowFlipLive,
  RestShade,
  LensWindow,
  PromoMap,
  PromoProcedural,
  PromoMirror,
  PromoStroke
];
