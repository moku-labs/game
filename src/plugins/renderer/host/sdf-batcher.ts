/**
 * @file renderer/host — the batch of distance-field (MSDF, SDF) bitmap text. Pixi 8.22 draws every distance-field
 * label with a shader of its own, the custom shader of its graphics context: one draw per label through the graphics
 * adaptor, a uniform bind group per label, and a break of the batch around it. The renderer batches them through
 * Pixi's public batcher extension instead: `SdfBatcher` packs Pixi's default vertex (position, uv, colour, texture id
 * and rounding) and one float more, the edge width of the glyph's label, and the routing pipe hands the glyphs of a
 * label to it, so consecutive labels share one draw. Text never joins a batch of sprites: Pixi hands those to its
 * default batcher by name. The shader is Pixi's SDF shader without its local uniforms: the fragment step applies the
 * alpha once (Pixi's step raises the premultiplied alpha into the coverage, so a label at alpha 0.5 drew at about
 * 0.25), and the edge is measured in device pixels at the label's world scale (PX1, K5). The vertex carries Pixi's
 * distance at the label's scale in its render group times the renderer's resolution; the vertex shader multiplies it
 * by the scale of the render group's world transform, a global uniform, so a group that scales (a kept picture's,
 * a camera's) needs no new vertices. No Pixi prototype and no Pixi instance is patched. Both backends: the WGSL
 * program on WebGPU, the GLSL one on WebGL.
 */
import type { PixiModule } from "../types";

/** The key of the glyph record on the proxy graphics of every bitmap text the renderer's pipe lays out. */
export const SDF = Symbol("moku-sdf-glyphs");

/** The name the renderer's batcher of distance-field glyphs registers under, and the element's `batcherName`. */
export const SDF_BATCHER = "moku-sdf";

/** The name of Pixi's default batcher, which an element goes back to. */
const DEFAULT_BATCHER = "default";

/** Floats of one vertex: position 2, uv 2, colour 1 (unorm8x4), texture id and rounding 1 (uint16x2), distance 1. */
const VERTEX_SIZE = 7;

/** Bytes of one vertex. */
const STRIDE = VERTEX_SIZE * 4;

/** The name of the renderer's batched SDF program, on both backends. */
const PROGRAM_NAME = "moku-sdf-batch";

/**
 * The edge of the glyphs of one bitmap text, kept on its proxy graphics under `SDF`: one shape for every text. It
 * changes only with the text's font family or size.
 */
export type SdfGlyphs = {
  /**
   * Pixi's distance at scale 1, CSS px: the font's range times the text's size over the font's base size
   * (`AbstractBitmapTextPipe._updateDistanceField`). 0 for a font without a distance field, which Pixi's default
   * batcher draws.
   */
  perScale: number;
  /** The font family it was measured for. */
  family: string | string[] | undefined;
  /** The font size it was measured for. */
  size: number;
};

/** What the routing pipe reads of an element: its batcher name and the glyphs of the text it belongs to, if any. */
type Routed = {
  batcherName: string;
  readonly renderable?: { readonly [SDF]?: SdfGlyphs } | null;
};

/** Pixi's batcher pipe, as the renderer subclasses it. */
type BatcherPipe = InstanceType<PixiModule["BatcherPipe"]>;

/** An element a batcher pipe adds to a batch. */
type BatchableElement = Parameters<BatcherPipe["addToBatch"]>[0];

/** The instructions a batcher pipe adds batches to. */
type InstructionSet = Parameters<BatcherPipe["addToBatch"]>[1];

/** One batch of instructions, as the batcher pipe draws it. */
type Batch = Parameters<BatcherPipe["execute"]>[0];

/** A glyph quad of a text as Pixi's graphics pipe hands it over: a mesh element of Pixi's default batch. */
type MeshElement = Parameters<InstanceType<PixiModule["DefaultBatcher"]>["packAttributes"]>[0] &
  Routed;

/** A quad element of Pixi's default batch. */
type QuadElement = Parameters<InstanceType<PixiModule["DefaultBatcher"]>["packQuadAttributes"]>[0] &
  Routed;

/** A Pixi shader: the two programs and the batch sampler slots. */
type Shader = InstanceType<PixiModule["Shader"]>;

/** The geometry a batcher draws from. */
type Geometry = InstanceType<PixiModule["Geometry"]>;

/** A piece of Pixi's high shader, as `compileHighShaderGpuProgram` takes it. */
type ShaderBit = Parameters<PixiModule["compileHighShaderGpuProgram"]>[0]["bits"][number];

/** A GLSL piece of Pixi's high shader, as `compileHighShaderGlProgram` takes it. */
type ShaderBitGl = Parameters<PixiModule["compileHighShaderGlProgram"]>[0]["bits"][number];

/** The batcher of distance-field glyphs: Pixi's batcher, and the resolution its distances are packed at. */
export type SdfGlyphBatcher = InstanceType<PixiModule["Batcher"]> & {
  /** Device pixels per CSS pixel the distances in the buffer are packed at; `NaN` before the first draw. */
  density: number;
  /**
   * Packs every element of the batches again at a resolution and hands the buffer to the GPU.
   *
   * @param density - Device pixels per CSS pixel.
   */
  packAt(density: number): void;
};

/** The batcher class: what Pixi's registry files under `SDF_BATCHER`. */
export type SdfBatcherClass = (new (
  options: ConstructorParameters<PixiModule["Batcher"]>[0]
) => SdfGlyphBatcher) & {
  readonly extension: { readonly type: readonly string[]; readonly name: string };
};

/**
 * The renderer's piece of the high shader: the glyph's edge width from the vertex, at the scale of the render group,
 * and the coverage with the alpha applied once. The template's `outColor * vColor` applies the colour and every alpha.
 */
const SDF_BIT: ShaderBit = {
  name: "moku-sdf-batch-bit",
  vertex: {
    header: `
            @in aSdfDistance: f32;
            @out @interpolate(flat) vSdfDistance: f32;
        `,
    main: `
            let sdfWorld = globalUniforms.uWorldTransformMatrix;
            vSdfDistance = aSdfDistance * (length(sdfWorld[0].xy) + length(sdfWorld[1].xy)) * 0.5;
        `
  },
  fragment: {
    header: `
            @in @interpolate(flat) vSdfDistance: f32;
        `,
    main: `
            outColor = vec4<f32>(calculateMSDFAlpha(outColor, vec4<f32>(vColor.rgb / max(vColor.a, 1e-4), 1.0), vSdfDistance));
        `
  }
};

/**
 * The same piece in GLSL, for the WebGL program. Pixi compiles its batch programs as GLSL ES 1.00 (its `in` and `out`
 * are macros), where `flat` is a reserved word: the distance is a plain varying, the same at the three vertices of a
 * glyph's triangle, as Pixi's own texture id is.
 */
const SDF_BIT_GL: ShaderBitGl = {
  name: "moku-sdf-batch-bit",
  vertex: {
    header: `
            in float aSdfDistance;
            out float vSdfDistance;
        `,
    main: `
            vSdfDistance = aSdfDistance * (length(uWorldTransformMatrix[0].xy) + length(uWorldTransformMatrix[1].xy)) * 0.5;
        `
  },
  fragment: {
    header: `
            in float vSdfDistance;
        `,
    main: `
            outColor = vec4(calculateMSDFAlpha(outColor, vec4(vColor.rgb / max(vColor.a, 1e-4), 1.0), vSdfDistance));
        `
  }
};

/**
 * The edge width one vertex of an element carries: Pixi's distance at the element's scale in its render group, times
 * the resolution. A text's group transform is what Pixi scales by; the render group's own scale is the shader's.
 *
 * @param element - The element.
 * @param a - `a` of its group transform.
 * @param b - `b` of its group transform.
 * @param c - `c` of its group transform.
 * @param d - `d` of its group transform.
 * @param density - Device pixels per CSS pixel.
 * @returns The distance, device px at the render group's scale 1; 0 for an element without glyphs.
 */
function distanceOf(
  element: Routed,
  a: number,
  b: number,
  c: number,
  d: number,
  density: number
): number {
  const glyphs = element.renderable?.[SDF];

  if (glyphs === undefined) return 0;

  // per pack: the square root of the squares, as Pixi's own; `Math.hypot` takes its arguments as a list.
  // eslint-disable-next-line unicorn/prefer-modern-math-apis -- the hot path's form, E1.
  return (glyphs.perScale * (Math.sqrt(a * a + b * b) + Math.sqrt(c * c + d * d)) * density) / 2;
}

/**
 * Keeps one shader per batch texture limit: made the first time a limit is asked for, shared by every batcher after.
 * Its own function, because lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @param make - Makes the shader of one texture limit.
 * @returns The shader for a texture limit.
 */
function cachedBy(make: (maxTextures: number) => Shader): (maxTextures: number) => Shader {
  const shaders = new Map<number, Shader>();

  return (maxTextures: number): Shader => {
    const known = shaders.get(maxTextures);

    if (known !== undefined) return known;

    const shader = make(maxTextures);

    shaders.set(maxTextures, shader);

    return shader;
  };
}

/**
 * The shaders of the batcher: Pixi's five SDF bits on both backends with the local uniforms replaced by the
 * renderer's piece, and Pixi's batch sampler slots for WebGL, as Pixi's own `DefaultShader` carries them.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The shader for a texture limit.
 */
function sdfShaders(pixi: PixiModule): (maxTextures: number) => Shader {
  return cachedBy(
    maxTextures =>
      new pixi.Shader({
        gpuProgram: pixi.compileHighShaderGpuProgram({
          name: PROGRAM_NAME,
          bits: [
            pixi.colorBit,
            pixi.generateTextureBatchBit(maxTextures),
            SDF_BIT,
            pixi.mSDFBit,
            pixi.roundPixelsBit
          ]
        }),
        glProgram: pixi.compileHighShaderGlProgram({
          name: PROGRAM_NAME,
          bits: [
            pixi.colorBitGl,
            pixi.generateTextureBatchBitGl(maxTextures),
            SDF_BIT_GL,
            pixi.mSDFBitGl,
            pixi.roundPixelsBitGl
          ]
        }),
        resources: { batchSamplers: pixi.getBatchSamplersUniformGroup(maxTextures) }
      })
  );
}

/**
 * The geometry of one batcher: Pixi's batch geometry with the distance after the texture id, one buffer of 7 floats a
 * vertex.
 *
 * @param pixi - The loaded Pixi module.
 * @returns A new geometry.
 */
function sdfGeometry(pixi: PixiModule): Geometry {
  const buffer = new pixi.Buffer({
    data: new Float32Array(1),
    label: "attribute-sdf-batch-buffer",
    usage: pixi.BufferUsage.VERTEX | pixi.BufferUsage.COPY_DST,
    shrinkToFit: false
  });
  const indexBuffer = new pixi.Buffer({
    data: new Uint32Array(1),
    label: "index-sdf-batch-buffer",
    usage: pixi.BufferUsage.INDEX | pixi.BufferUsage.COPY_DST,
    shrinkToFit: false
  });

  return new pixi.Geometry({
    attributes: {
      aPosition: { buffer, format: "float32x2", stride: STRIDE, offset: 0 },
      aUV: { buffer, format: "float32x2", stride: STRIDE, offset: 8 },
      aColor: { buffer, format: "unorm8x4", stride: STRIDE, offset: 16 },
      aTextureIdAndRound: { buffer, format: "uint16x2", stride: STRIDE, offset: 20 },
      aSdfDistance: { buffer, format: "float32", stride: STRIDE, offset: 24 }
    },
    indexBuffer
  });
}

/**
 * Builds the batcher of distance-field glyphs from the module object, at call time, because Pixi's `Batcher` arrives
 * with the lazily loaded module. Its packing is Pixi's `DefaultBatcher`'s loop with the distance written after the
 * texture id; the distances are packed at the resolution the batcher pipe last drew it at (`packAt`).
 *
 * @param pixi - The loaded Pixi module.
 * @returns The batcher class, with the extension Pixi's registry files it under.
 */
export function createSdfBatcher(pixi: PixiModule): SdfBatcherClass {
  const shaderFor = sdfShaders(pixi);

  /** Pixi's batcher, with a vertex that carries the edge width of its glyph. */
  class SdfBatcher extends pixi.Batcher {
    public static readonly extension = {
      type: [pixi.ExtensionType.Batcher],
      name: SDF_BATCHER
    } as const;

    public readonly name = SDF_BATCHER;

    public geometry: Geometry = sdfGeometry(pixi);

    public shader: Shader = shaderFor(this.maxTextures);

    /** Device pixels per CSS pixel the distances are packed at; a double from the start, so writes box nothing. */
    public density = Number.NaN;

    protected vertexSize = VERTEX_SIZE;

    /**
     * Packs the vertices of a mesh element: Pixi's default vertex and the distance.
     *
     * @param element - The element.
     * @param float32View - The attribute buffer as floats.
     * @param uint32View - The attribute buffer as unsigned integers.
     * @param index - The first float of the element.
     * @param textureId - The element's slot in its batch's textures.
     */
    public packAttributes(
      element: MeshElement,
      float32View: Float32Array,
      uint32View: Uint32Array,
      index: number,
      textureId: number
    ): void {
      const textureIdAndRound = (textureId << 16) | (element.roundPixels & 0xff_ff);
      const { a, b, c, d, tx, ty } = element.transform;
      const distance = distanceOf(element, a, b, c, d, this.density);
      const positions = element.positions;
      const uvs = element.uvs;
      const argb = element.color;
      const end = element.attributeOffset + element.attributeSize;
      let at = index;

      // per glyph vertex of a rebuild or a moved label: indexed, every field written in place.
      for (let vertex = element.attributeOffset; vertex < end; vertex += 1) {
        const x = positions[vertex * 2] ?? 0;
        const y = positions[vertex * 2 + 1] ?? 0;

        float32View[at] = a * x + c * y + tx;
        float32View[at + 1] = d * y + b * x + ty;
        float32View[at + 2] = uvs[vertex * 2] ?? 0;
        float32View[at + 3] = uvs[vertex * 2 + 1] ?? 0;
        uint32View[at + 4] = argb;
        uint32View[at + 5] = textureIdAndRound;
        float32View[at + 6] = distance;
        at += VERTEX_SIZE;
      }
    }

    /**
     * Packs the four vertices of a quad element: Pixi's default quad and the distance.
     *
     * @param element - The element.
     * @param float32View - The attribute buffer as floats.
     * @param uint32View - The attribute buffer as unsigned integers.
     * @param index - The first float of the element.
     * @param textureId - The element's slot in its batch's textures.
     */
    public packQuadAttributes(
      element: QuadElement,
      float32View: Float32Array,
      uint32View: Uint32Array,
      index: number,
      textureId: number
    ): void {
      const { a, b, c, d, tx, ty } = element.transform;
      const { minX, minY, maxX, maxY } = element.bounds;
      const uvs = element.texture.uvs;
      const argb = element.color;
      const textureIdAndRound = (textureId << 16) | (element.roundPixels & 0xff_ff);
      const distance = distanceOf(element, a, b, c, d, this.density);

      // Pixi's four corners in its order, each followed by its uv, the colour, the texture id and the distance.
      float32View[index] = a * minX + c * minY + tx;
      float32View[index + 1] = d * minY + b * minX + ty;
      float32View[index + 2] = uvs.x0;
      float32View[index + 3] = uvs.y0;
      uint32View[index + 4] = argb;
      uint32View[index + 5] = textureIdAndRound;
      float32View[index + 6] = distance;
      float32View[index + 7] = a * maxX + c * minY + tx;
      float32View[index + 8] = d * minY + b * maxX + ty;
      float32View[index + 9] = uvs.x1;
      float32View[index + 10] = uvs.y1;
      uint32View[index + 11] = argb;
      uint32View[index + 12] = textureIdAndRound;
      float32View[index + 13] = distance;
      float32View[index + 14] = a * maxX + c * maxY + tx;
      float32View[index + 15] = d * maxY + b * maxX + ty;
      float32View[index + 16] = uvs.x2;
      float32View[index + 17] = uvs.y2;
      uint32View[index + 18] = argb;
      uint32View[index + 19] = textureIdAndRound;
      float32View[index + 20] = distance;
      float32View[index + 21] = a * minX + c * maxY + tx;
      float32View[index + 22] = d * maxY + b * minX + ty;
      float32View[index + 23] = uvs.x3;
      float32View[index + 24] = uvs.y3;
      uint32View[index + 25] = argb;
      uint32View[index + 26] = textureIdAndRound;
      float32View[index + 27] = distance;
    }

    /**
     * Packs every element of the drawn batches again at a resolution and hands the buffer to the GPU.
     *
     * @param density - Device pixels per CSS pixel.
     */
    public packAt(density: number): void {
      this.density = density;

      // once per resolution change: every element of the drawn batches, indexed.
      for (let batch = 0; batch < this.batchIndex; batch += 1) {
        const elements = this.batches[batch]?.elements;

        if (elements === undefined) continue;

        // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
        for (let at = 0; at < elements.length; at += 1) {
          const element = elements[at];

          if (element !== undefined) this.updateElement(element);
        }
      }

      this.dirty = false;
      this.geometry.buffers[0]?.update(this.attributeSize * 4);
    }
  }

  return SdfBatcher;
}

/**
 * Tells whether a batch's batcher is the renderer's batcher of distance-field glyphs.
 *
 * @param batcher - The batcher of a batch.
 * @returns True for the SDF batcher.
 */
function isSdfBatcher(batcher: Batch["batcher"]): batcher is Batch["batcher"] & SdfGlyphBatcher {
  return batcher.name === SDF_BATCHER;
}

/**
 * Builds the renderer's batcher pipe from the module object, at call time. It keeps the base's `static extension`
 * object, so the registry files it under the same types and name, and Pixi's batcher registry, which `getBatcher`
 * reads. `addToBatch` names the batcher of an element before Pixi adds it: the glyphs of a distance-field text go to
 * `SDF_BATCHER`; a pooled element that carried that name before, now another graphics' or a plain font's, goes back to
 * Pixi's default. `execute` packs the distances of a batcher again when the renderer's resolution changed since it
 * last drew, before Pixi binds its geometry. The monitor's counting pipe of a dev build extends this pipe.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The pipe class.
 */
export function createSdfBatcherPipe(pixi: PixiModule): PixiModule["BatcherPipe"] {
  /** Pixi's batcher pipe, which routes the glyphs of distance-field text to the renderer's batcher. */
  class SdfRoutingBatcherPipe extends pixi.BatcherPipe {
    public static override readonly extension = pixi.BatcherPipe.extension;

    /**
     * Names the element's batcher, then adds it as Pixi does.
     *
     * @param element - The element.
     * @param instructionSet - The instructions of its render group.
     */
    public override addToBatch(element: BatchableElement, instructionSet: InstructionSet): void {
      routeElement(element);
      super.addToBatch(element, instructionSet);
    }

    /**
     * Draws a batch as Pixi does; the first batch of an SDF batcher's run first packs the distances again when the
     * resolution moved.
     *
     * @param batch - The batch.
     */
    public override execute(batch: Batch): void {
      const batcher = batch.batcher;

      // per batch draw: two compares; the distances are packed again only after the resolution changed.
      if (batch.action === "startBatch" && isSdfBatcher(batcher)) {
        const resolution = this.renderer.resolution;

        if (batcher.density !== resolution) batcher.packAt(resolution);
      }

      super.execute(batch);
    }
  }

  return SdfRoutingBatcherPipe;
}

/**
 * Names the batcher of one element: `SDF_BATCHER` for a glyph of a distance-field text, Pixi's default again for an
 * element that carried that name from an earlier owner, as it was otherwise.
 *
 * @param element - The element.
 */
function routeElement(element: Routed): void {
  const glyphs = element.renderable?.[SDF];

  if (glyphs !== undefined && glyphs.perScale > 0) element.batcherName = SDF_BATCHER;
  else if (element.batcherName === SDF_BATCHER) element.batcherName = DEFAULT_BATCHER;
}
