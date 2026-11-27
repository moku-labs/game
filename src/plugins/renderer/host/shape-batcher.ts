/**
 * @file renderer/host — SPIKE (hot path 5): a `Shape` drawn as one quad by a signed-distance shader. A sprite of
 * Pixi's white texture carries the shape's numbers under `SHAPE`; the routing batch pipe hands its element to
 * `ShapeBatcher`, which packs the quad from those numbers and draws the fill and the stroke in the fragment step,
 * with hard edges as Pixi's geometry has on a canvas without antialiasing. The arc's band follows Pixi's polygon of
 * the same segments (48 for a ring), so its edge falls on the same pixels. A new width, height or sweep rewrites the
 * quad's vertices through Pixi's `updateRenderable`: no geometry, no instruction rebuild.
 */
import type { PixiModule } from "../types";

/** The key of the shape's numbers on its sprite. */
export const SHAPE: unique symbol = Symbol.for("moku-shape") as never;

/** The name the shape batcher registers under. */
export const SHAPE_BATCHER = "moku-shape";

/** Floats of one vertex: position 2, local 2, colour 1, texture id 1, box 4, arc 4, fill 1, stroke 1, tint 1. */
const VERTEX_SIZE = 17;

/** Bytes of one vertex. */
const STRIDE = VERTEX_SIZE * 4;

/** The program's name. */
const PROGRAM_NAME = "moku-shape-batch";

/** What the shader draws one shape from. */
export type ShapeRecord = {
  w: number;
  h: number;
  radius: number;
  strokeWidth: number;
  sweep: number;
  arc: number;
  butt: number;
  /** Fill colour with its alpha, `abgr` as the vertex takes it. */
  fill: number;
  /** Stroke colour, opaque, `abgr`. */
  stroke: number;
  /** How far the quad reaches past the box, units. */
  margin: number;
};

export const WGSL = {
  name: "moku-shape-bit",
  vertex: {
    header: `
            @in aShapeBox: vec4<f32>;
            @in aShapeArc: vec4<f32>;
            @in aShapeFill: vec4<f32>;
            @in aShapeStroke: vec4<f32>;
            @in aShapeTint: vec4<f32>;
            @out @interpolate(flat) vShapeBox: vec4<f32>;
            @out @interpolate(flat) vShapeArc: vec4<f32>;
            @out @interpolate(flat) vShapeFill: vec4<f32>;
            @out @interpolate(flat) vShapeStroke: vec4<f32>;
            @out @interpolate(flat) vShapeTint: vec4<f32>;
        `,
    main: `
            vShapeBox = aShapeBox;
            vShapeArc = aShapeArc;
            vShapeFill = aShapeFill;
            vShapeStroke = aShapeStroke;
            vShapeTint = aShapeTint;
        `
  },
  fragment: {
    header: `
            @in @interpolate(flat) vShapeBox: vec4<f32>;
            @in @interpolate(flat) vShapeArc: vec4<f32>;
            @in @interpolate(flat) vShapeFill: vec4<f32>;
            @in @interpolate(flat) vShapeStroke: vec4<f32>;
            @in @interpolate(flat) vShapeTint: vec4<f32>;

            fn mokuUnit(a: f32) -> vec2<f32> {
                return vec2<f32>(sin(a), -cos(a));
            }

            fn mokuQuad(v: vec2<f32>, k: f32, seg: f32, radius: f32, hw: f32) -> bool {
                let a0 = radius * mokuUnit(k * seg);
                let to = radius * mokuUnit((k + 1.0) * seg);
                let len = distance(a0, to);
                let along = dot(v - a0, (to - a0) / len);
                let across = dot(v, mokuUnit((k + 0.5) * seg)) - radius * cos(seg * 0.5);

                return along >= 0.0 && along <= len && abs(across) <= hw;
            }

            fn mokuBox(v: vec2<f32>, size: vec2<f32>, r: f32) -> f32 {
                let q = abs(v) - (size * 0.5 - vec2<f32>(r, r));
                var d = max(q.x, q.y) - r;

                if (r > 0.0) {
                    let n = ceil(2.3 * sqrt(2.0 * r));
                    let seg = 1.5707963267948966 / n;
                    let j = clamp(floor(atan2(q.y, q.x) / seg), 0.0, n - 1.0);
                    let mid = (j + 0.5) * seg;

                    d = max(d, dot(q, vec2<f32>(cos(mid), sin(mid))) - r * cos(seg * 0.5));
                }

                return d;
            }

            fn mokuArc(v: vec2<f32>, size: vec2<f32>, width: f32, sweep: f32, butt: f32) -> f32 {
                let tau = 6.283185307179586;
                let radius = (min(size.x, size.y) - width) * 0.5;
                let hw = width * 0.5;
                let count = max(2.0, ceil(sweep * 48.0));
                let seg = sweep * tau / count;
                let ring = sweep >= 1.0;
                var phi = atan2(v.x, -v.y);

                if (phi < 0.0) { phi = phi + tau; }

                var k = floor(phi / seg);

                if (ring) { k = min(k, count - 1.0); }

                var inside = false;

                if (k < count) {
                    let across = dot(v, mokuUnit((k + 0.5) * seg)) - radius * cos(seg * 0.5);

                    inside = abs(across) <= hw;

                    if (!ring && k == 0.0) {
                        let a0 = radius * mokuUnit(0.0);
                        let to = radius * mokuUnit(seg);

                        inside = inside && dot(v - a0, to - a0) >= 0.0;
                    }

                    if (!ring && k == count - 1.0) {
                        let a0 = radius * mokuUnit((count - 1.0) * seg);
                        let to = radius * mokuUnit(count * seg);

                        inside = inside && dot(v - to, to - a0) <= 0.0;
                    }
                }

                if (!ring) {
                    inside = inside || mokuQuad(v, 0.0, seg, radius, hw) || mokuQuad(v, count - 1.0, seg, radius, hw);

                    if (butt < 0.5) {
                        inside = inside || distance(v, radius * mokuUnit(0.0)) <= hw ||
                            distance(v, radius * mokuUnit(count * seg)) <= hw;
                    }
                }

                return select(0.0, 1.0, inside);
            }
        `,
    main: `
            let shapeSize = vShapeBox.xy;
            let shapeV = vUV - shapeSize * 0.5;
            var fillCover = 0.0;
            var strokeCover = 0.0;

            if (vShapeArc.y > 0.5) {
                strokeCover = mokuArc(shapeV, shapeSize, vShapeBox.w, vShapeArc.x, vShapeArc.z);
            } else {
                let d = mokuBox(shapeV, shapeSize, vShapeBox.z);

                fillCover = select(0.0, 1.0, d <= 0.0);
                strokeCover = select(0.0, 1.0, vShapeBox.w > 0.0 && abs(d) <= vShapeBox.w * 0.5);
            }

            let shapeTint = vec4<f32>(vShapeTint.rgb * vShapeTint.a, vShapeTint.a);
            let shapeFill = vec4<f32>(vShapeFill.rgb * vShapeFill.a, vShapeFill.a) * shapeTint * fillCover;
            let shapeStroke = vec4<f32>(vShapeStroke.rgb * vShapeStroke.a, vShapeStroke.a) * shapeTint * strokeCover;

            outColor = shapeStroke + shapeFill * (1.0 - shapeStroke.a);
        `
  }
};

const GLSL = {
  name: "moku-shape-bit",
  vertex: {
    header: `
            in vec4 aShapeBox;
            in vec4 aShapeArc;
            in vec4 aShapeFill;
            in vec4 aShapeStroke;
            in vec4 aShapeTint;
            out vec4 vShapeBox;
            out vec4 vShapeArc;
            out vec4 vShapeFill;
            out vec4 vShapeStroke;
            out vec4 vShapeTint;
        `,
    main: `
            vShapeBox = aShapeBox;
            vShapeArc = aShapeArc;
            vShapeFill = aShapeFill;
            vShapeStroke = aShapeStroke;
            vShapeTint = aShapeTint;
        `
  },
  fragment: {
    header: `
            in vec4 vShapeBox;
            in vec4 vShapeArc;
            in vec4 vShapeFill;
            in vec4 vShapeStroke;
            in vec4 vShapeTint;

            vec2 mokuUnit(float a) { return vec2(sin(a), -cos(a)); }

            bool mokuQuad(vec2 v, float k, float seg, float radius, float hw) {
                vec2 a0 = radius * mokuUnit(k * seg);
                vec2 to = radius * mokuUnit((k + 1.0) * seg);
                float len = distance(a0, to);
                float along = dot(v - a0, (to - a0) / len);
                float across = dot(v, mokuUnit((k + 0.5) * seg)) - radius * cos(seg * 0.5);
                return along >= 0.0 && along <= len && abs(across) <= hw;
            }

            float mokuBox(vec2 v, vec2 size, float r) {
                vec2 q = abs(v) - (size * 0.5 - vec2(r));
                float d = max(q.x, q.y) - r;
                if (r > 0.0) {
                    float n = ceil(2.3 * sqrt(2.0 * r));
                    float seg = 1.5707963267948966 / n;
                    float j = clamp(floor(atan(q.y, q.x) / seg), 0.0, n - 1.0);
                    float mid = (j + 0.5) * seg;
                    d = max(d, dot(q, vec2(cos(mid), sin(mid))) - r * cos(seg * 0.5));
                }
                return d;
            }

            float mokuArc(vec2 v, vec2 size, float width, float sweep, float butt) {
                float tau = 6.283185307179586;
                float radius = (min(size.x, size.y) - width) * 0.5;
                float hw = width * 0.5;
                float count = max(2.0, ceil(sweep * 48.0));
                float seg = sweep * tau / count;
                bool ring = sweep >= 1.0;
                float phi = atan(v.x, -v.y);
                if (phi < 0.0) phi += tau;
                float k = floor(phi / seg);
                if (ring) k = min(k, count - 1.0);
                bool inside = false;
                if (k < count) {
                    float across = dot(v, mokuUnit((k + 0.5) * seg)) - radius * cos(seg * 0.5);
                    inside = abs(across) <= hw;
                    if (!ring && k == 0.0) {
                        vec2 a0 = radius * mokuUnit(0.0);
                        vec2 to = radius * mokuUnit(seg);
                        inside = inside && dot(v - a0, to - a0) >= 0.0;
                    }
                    if (!ring && k == count - 1.0) {
                        vec2 a0 = radius * mokuUnit((count - 1.0) * seg);
                        vec2 to = radius * mokuUnit(count * seg);
                        inside = inside && dot(v - to, to - a0) <= 0.0;
                    }
                }
                if (!ring) {
                    inside = inside || mokuQuad(v, 0.0, seg, radius, hw) || mokuQuad(v, count - 1.0, seg, radius, hw);
                    if (butt < 0.5) {
                        inside = inside || distance(v, radius * mokuUnit(0.0)) <= hw ||
                            distance(v, radius * mokuUnit(count * seg)) <= hw;
                    }
                }
                return inside ? 1.0 : 0.0;
            }
        `,
    main: `
            vec2 shapeSize = vShapeBox.xy;
            vec2 shapeV = vUV - shapeSize * 0.5;
            float fillCover = 0.0;
            float strokeCover = 0.0;
            if (vShapeArc.y > 0.5) {
                strokeCover = mokuArc(shapeV, shapeSize, vShapeBox.w, vShapeArc.x, vShapeArc.z);
            } else {
                float d = mokuBox(shapeV, shapeSize, vShapeBox.z);
                fillCover = d <= 0.0 ? 1.0 : 0.0;
                strokeCover = (vShapeBox.w > 0.0 && abs(d) <= vShapeBox.w * 0.5) ? 1.0 : 0.0;
            }
            vec4 shapeTint = vec4(vShapeTint.rgb * vShapeTint.a, vShapeTint.a);
            vec4 shapeFill = vec4(vShapeFill.rgb * vShapeFill.a, vShapeFill.a) * shapeTint * fillCover;
            vec4 shapeStroke = vec4(vShapeStroke.rgb * vShapeStroke.a, vShapeStroke.a) * shapeTint * strokeCover;
            outColor = shapeStroke + shapeFill * (1.0 - shapeStroke.a);
        `
  }
};

/** A quad element of a sprite, as the batcher packs it. */
type QuadElement = Parameters<
  InstanceType<PixiModule["DefaultBatcher"]>["packQuadAttributes"]
>[0] & {
  readonly renderable?: { readonly [SHAPE]?: ShapeRecord } | null;
};

/**
 * Builds the shape batcher class from the loaded module.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The batcher class with its extension.
 */
export function createShapeBatcher(pixi: PixiModule): unknown {
  const shaders = new Map<number, InstanceType<PixiModule["Shader"]>>();
  const shaderFor = (maxTextures: number): InstanceType<PixiModule["Shader"]> => {
    const known = shaders.get(maxTextures);

    if (known !== undefined) return known;

    const shader = new pixi.Shader({
      gpuProgram: pixi.compileHighShaderGpuProgram({
        name: PROGRAM_NAME,
        bits: [pixi.colorBit, pixi.generateTextureBatchBit(maxTextures), WGSL, pixi.roundPixelsBit]
      }),
      glProgram: pixi.compileHighShaderGlProgram({
        name: PROGRAM_NAME,
        bits: [
          pixi.colorBitGl,
          pixi.generateTextureBatchBitGl(maxTextures),
          GLSL,
          pixi.roundPixelsBitGl
        ]
      }),
      resources: { batchSamplers: pixi.getBatchSamplersUniformGroup(maxTextures) }
    });

    shaders.set(maxTextures, shader);

    return shader;
  };

  const buffer = (): InstanceType<PixiModule["Geometry"]> => {
    const vertices = new pixi.Buffer({
      data: new Float32Array(1),
      label: "attribute-shape-batch-buffer",
      usage: pixi.BufferUsage.VERTEX | pixi.BufferUsage.COPY_DST,
      shrinkToFit: false
    });
    const indexBuffer = new pixi.Buffer({
      data: new Uint32Array(1),
      label: "index-shape-batch-buffer",
      usage: pixi.BufferUsage.INDEX | pixi.BufferUsage.COPY_DST,
      shrinkToFit: false
    });

    return new pixi.Geometry({
      attributes: {
        aPosition: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 0 },
        aUV: { buffer: vertices, format: "float32x2", stride: STRIDE, offset: 8 },
        aColor: { buffer: vertices, format: "unorm8x4", stride: STRIDE, offset: 16 },
        aTextureIdAndRound: { buffer: vertices, format: "uint16x2", stride: STRIDE, offset: 20 },
        aShapeBox: { buffer: vertices, format: "float32x4", stride: STRIDE, offset: 24 },
        aShapeArc: { buffer: vertices, format: "float32x4", stride: STRIDE, offset: 40 },
        aShapeFill: { buffer: vertices, format: "unorm8x4", stride: STRIDE, offset: 56 },
        aShapeStroke: { buffer: vertices, format: "unorm8x4", stride: STRIDE, offset: 60 },
        aShapeTint: { buffer: vertices, format: "unorm8x4", stride: STRIDE, offset: 64 }
      },
      indexBuffer
    });
  };

  /** The batcher: Pixi's, with a vertex that carries the shape. */
  class ShapeBatcher extends pixi.Batcher {
    public static readonly extension = {
      type: [pixi.ExtensionType.Batcher],
      name: SHAPE_BATCHER
    } as const;

    public readonly name = SHAPE_BATCHER;

    public geometry = buffer();

    public shader = shaderFor(this.maxTextures);

    protected vertexSize = VERTEX_SIZE;

    /** A shape is always a quad: nothing to pack as a mesh. */
    public packAttributes(): void {
      // A shape is always a quad.
    }

    /**
     * Packs the four corners of a shape's quad from its record.
     *
     * @param element - The sprite's element.
     * @param f - The buffer as floats.
     * @param u - The buffer as unsigned integers.
     * @param index - The first float of the element.
     * @param textureId - The element's texture slot.
     */
    public packQuadAttributes(
      element: QuadElement,
      f: Float32Array,
      u: Uint32Array,
      index: number,
      textureId: number
    ): void {
      const record = element.renderable?.[SHAPE];

      if (record === undefined) return;

      const { a, b, c, d, tx, ty } = element.transform;
      const m = record.margin;
      const x0 = -m;
      const y0 = -m;
      const x1 = record.w + m;
      const y1 = record.h + m;
      const round = (textureId << 16) | (element.roundPixels & 0xff_ff);

      writeVertex(
        f,
        u,
        index,
        a * x0 + c * y0 + tx,
        d * y0 + b * x0 + ty,
        x0,
        y0,
        round,
        record,
        element.color
      );
      writeVertex(
        f,
        u,
        index + VERTEX_SIZE,
        a * x1 + c * y0 + tx,
        d * y0 + b * x1 + ty,
        x1,
        y0,
        round,
        record,
        element.color
      );
      writeVertex(
        f,
        u,
        index + VERTEX_SIZE * 2,
        a * x1 + c * y1 + tx,
        d * y1 + b * x1 + ty,
        x1,
        y1,
        round,
        record,
        element.color
      );
      writeVertex(
        f,
        u,
        index + VERTEX_SIZE * 3,
        a * x0 + c * y1 + tx,
        d * y1 + b * x0 + ty,
        x0,
        y1,
        round,
        record,
        element.color
      );
    }
  }

  return ShapeBatcher;
}

/**
 * Writes one vertex of a shape's quad.
 *
 * @param f - Floats.
 * @param u - Unsigned view.
 * @param at - First float.
 * @param x - Position x.
 * @param y - Position y.
 * @param lx - Local x.
 * @param ly - Local y.
 * @param round - Texture id and rounding.
 * @param record - The shape.
 * @param tint - The element colour.
 */
function writeVertex(
  f: Float32Array,
  u: Uint32Array,
  at: number,
  x: number,
  y: number,
  lx: number,
  ly: number,
  round: number,
  record: ShapeRecord,
  tint: number
): void {
  f[at] = x;
  f[at + 1] = y;
  f[at + 2] = lx;
  f[at + 3] = ly;
  u[at + 4] = 0xff_ff_ff_ff;
  u[at + 5] = round;
  f[at + 6] = record.w;
  f[at + 7] = record.h;
  f[at + 8] = record.radius;
  f[at + 9] = record.strokeWidth;
  f[at + 10] = record.sweep;
  f[at + 11] = record.arc;
  f[at + 12] = record.butt;
  f[at + 13] = 0;
  u[at + 14] = record.fill;
  u[at + 15] = record.stroke;
  u[at + 16] = tint;
}
