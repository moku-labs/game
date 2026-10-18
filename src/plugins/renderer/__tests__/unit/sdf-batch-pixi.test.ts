import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSdfBatcher, createSdfBatcherPipe, SDF_BATCHER } from "../../host/sdf-batcher";
import type { PixiModule } from "../../types";
import { glyphsOf, PLAIN_FAMILY, type SdfBatchStage, sdfBatchStage } from "../sdf-text-stage";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU: distance-field labels drawn by the renderer's batcher (change
// 2026-10-18-sdf-batch-scopes). The renderer's text pipe, Pixi's own graphics pipe and context system, the routing
// batch pipe and the SDF batcher run as a render group's rebuild runs them; the GPU part (the shader) is pinned by its
// sources.
// ---------------------------------------------------------------------------

/** The stage of the running test, removed from Pixi's registry after it. */
let stage: SdfBatchStage | undefined;

afterEach(() => {
  stage?.remove();
  stage = undefined;
  vi.unstubAllGlobals();
});

/**
 * Builds the batch stage of a test.
 *
 * @param resolution - The renderer's resolution.
 * @returns The stage.
 */
function stageAt(resolution = 1): SdfBatchStage {
  stage = sdfBatchStage(resolution);

  return stage;
}

/** Floats of one vertex of the SDF batch. */
const VERTEX = 7;

/**
 * The distance every vertex of a build's SDF batch carries, in buffer order.
 *
 * @param batcher - The SDF batcher.
 * @param batcher.attributeBuffer - Its attribute buffer.
 * @param batcher.attributeBuffer.float32View - The buffer as floats.
 * @param batcher.attributeSize - Floats in use.
 * @returns The distances.
 */
function distances(batcher: {
  attributeBuffer: { float32View: Float32Array };
  attributeSize: number;
}): number[] {
  const out: number[] = [];

  for (let at = 6; at < batcher.attributeSize; at += VERTEX) {
    out.push(batcher.attributeBuffer.float32View[at] ?? Number.NaN);
  }

  return out;
}

describe("a distance-field label on the renderer's pipes", () => {
  // Bug: Pixi's own pipe hands every label a shader of its own, which makes its context unbatchable: one draw and a
  // uniform bind group per label (A26 board: about 20 draws a frame, 538 KB/s of garbage).
  it("gets no shader, so its graphics context stays batchable", () => {
    const { label, build, contexts } = stageAt();
    const text = label("123");

    build([text]);

    const proxy = (text._gpuData as Record<number, InstanceType<typeof pixi.Graphics>>)[1];

    expect(proxy?.context.customShader).toBeFalsy();
    expect(proxy && contexts.updateGpuContext(proxy.context).isBatchable).toBe(true);
  });

  // Bug: Pixi's `"auto"` batch mode gives a context of 400 vertices or more (50 glyphs) up, and a context without a
  // shader then draws the glyph atlas as a plain texture: a long label lost its distance field.
  it("keeps a label of 60 glyphs batchable and in the SDF batch", () => {
    const { label, build, batches, contexts } = stageAt();
    const text = label("0123456789".repeat(6));
    const set = build([text]);
    const proxy = (text._gpuData as Record<number, InstanceType<typeof pixi.Graphics>>)[1];

    expect(proxy?.context.batchMode).toBe("batch");
    expect(proxy && contexts.updateGpuContext(proxy.context).isBatchable).toBe(true);
    expect(batches(set).map(batch => batch.batcher.name)).toEqual([SDF_BATCHER]);
  });

  // Bug: consecutive labels drew one by one through the graphics adaptor.
  it("draws ten consecutive labels in one draw", () => {
    const { label, build, batches } = stageAt();
    const set = build(Array.from({ length: 10 }, (_, index) => label(String(index * 7))));

    expect(batches(set)).toHaveLength(1);
    expect(set.instructions.slice(0, set.instructionSize).map(i => i.renderPipeId)).toEqual([
      "batch"
    ]);
  });

  // Bug: a plain bitmap font in the SDF batch draws its glyphs through the distance-field step: blank or blotched.
  it("leaves a plain bitmap font to Pixi's default batcher", () => {
    const { label, build, batches } = stageAt();
    const plain = label("12", { family: PLAIN_FAMILY });
    const set = build([plain]);

    expect(glyphsOf(plain)?.perScale).toBe(0);
    expect(batches(set).map(batch => batch.batcher.name)).toEqual(["default"]);
  });
});

describe("the routing batch pipe", () => {
  // Bug: Pixi pools its batchable elements: one that carried a label's glyphs comes back for a plain graphics, which the
  // SDF batcher would draw through the distance-field step.
  it("sends a pooled element that carried the SDF name back to Pixi's default batcher", () => {
    const { batchPipe } = stageAt();
    const set = new pixi.InstructionSet();
    const element = new pixi.BatchableGraphics();

    element.batcherName = SDF_BATCHER;
    element.renderable = new pixi.Graphics();
    Object.assign(element, {
      geometryData: { vertices: [0, 0, 1, 0, 1, 1], uvs: [0, 0, 1, 0, 1, 1], indices: [0, 1, 2] },
      attributeOffset: 0,
      attributeSize: 3,
      indexOffset: 0,
      indexSize: 3,
      baseColor: 0xff_ff_ff,
      alpha: 1,
      texture: pixi.Texture.WHITE
    });
    batchPipe.buildStart(set);
    batchPipe.addToBatch(element, set);

    expect(element.batcherName).toBe("default");
  });

  // Bug: a routing pipe with metadata or a batcher registry of its own: Pixi files it under another name, or
  // `getBatcher` misses the SDF batcher.
  it("subclasses Pixi's batch pipe with its metadata object and its batcher registry", () => {
    const Pipe = createSdfBatcherPipe(pixi as unknown as PixiModule);

    expect(Object.getPrototypeOf(Pipe)).toBe(pixi.BatcherPipe);
    expect(Pipe.extension).toBe(pixi.BatcherPipe.extension);
    expect(Pipe.getBatcher).toBe(pixi.BatcherPipe.getBatcher);
  });
});

describe("the SDF batcher", () => {
  // Bug: an edge width left out of the vertex, or packed without the label's scale or the resolution.
  it("packs Pixi's default vertex and the label's distance at its scale and the resolution", () => {
    const { label, build, elements, draw, sdfBatcher } = stageAt(2.8);
    const text = label("12");

    text.groupTransform.set(0.5, 0, 0, 0.5, 10, 20);

    const set = build([text]);
    const batcher = sdfBatcher(set);

    draw(set);

    const [element] = elements(text);
    const reference = new pixi.DefaultBatcher({ maxTextures: 16 });
    const expected = new Float32Array(element === undefined ? 0 : element.attributeSize * 6);

    if (element !== undefined) {
      reference.packAttributes(element, expected, new Uint32Array(expected.buffer), 0, 0);
    }

    const packed = batcher.attributeBuffer.float32View;
    const packedBits = batcher.attributeBuffer.uint32View;
    const expectedBits = new Uint32Array(expected.buffer);

    for (let vertex = 0; vertex < (element?.attributeSize ?? 0); vertex += 1) {
      const at = (element?._attributeStart ?? 0) + vertex * VERTEX;

      expect([...packed.subarray(at, at + 4)]).toEqual([
        ...expected.subarray(vertex * 6, vertex * 6 + 4)
      ]);
      expect(packedBits[at + 4]).toBe(expectedBits[vertex * 6 + 4]);
      // The texture id of a batch of one texture is 0, as the reference packed it.
      expect(packedBits[at + 5]).toBe(expectedBits[vertex * 6 + 5]);
    }

    // Pixi's distance: the range of 4 at the font's own size, at scale 0.5, times 2.8.
    expect(distances(batcher)).toEqual(Array.from({ length: 8 }, () => Math.fround(5.6)));
  });

  // Bug: a quad element of the batch keeps Pixi's corner order but loses the distance.
  it("packs a quad with Pixi's corners and the distance", () => {
    const Batcher = createSdfBatcher(pixi as unknown as PixiModule);
    const { label, build } = stageAt();
    const text = label("1");

    build([text]);

    const batcher = new Batcher({ maxTextures: 16 });
    const reference = new pixi.DefaultBatcher({ maxTextures: 16 });
    const quad = {
      transform: new pixi.Matrix(2, 0, 0, 2, 5, 6),
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 4 },
      texture: pixi.Texture.WHITE,
      color: 0xff_ff_ff_ff,
      roundPixels: 1 as const,
      renderable: (text._gpuData as Record<number, object>)[1]
    };
    const packed = new Float32Array(28);
    const expected = new Float32Array(24);

    batcher.density = 1;
    batcher.packQuadAttributes(quad as never, packed, new Uint32Array(packed.buffer), 0, 3);
    reference.packQuadAttributes(quad as never, expected, new Uint32Array(expected.buffer), 0, 3);

    for (let corner = 0; corner < 4; corner += 1) {
      const mine = new Uint32Array(packed.buffer, corner * 28, 6);
      const pixis = new Uint32Array(expected.buffer, corner * 24, 6);

      expect([...mine]).toEqual([...pixis]);
      expect(packed[corner * 7 + 6]).toBe(8);
    }
  });

  // Bug: a change of the canvas's resolution (C-d) left every still label with the edge of the old resolution.
  it("packs every distance again when the resolution changed, before the batch draws", () => {
    const current = stageAt(2.8);
    const set = current.build([current.label("1"), current.label("2")]);
    const batcher = current.sdfBatcher(set);
    const buffer = batcher.geometry.buffers[0];

    current.draw(set);

    expect(distances(batcher)).toEqual(Array.from({ length: 8 }, () => Math.fround(11.2)));

    const uploads = buffer?._updateID ?? 0;

    current.draw(set);

    // A still resolution packs nothing again.
    expect(buffer?._updateID).toBe(uploads);

    current.renderer.resolution = 2;
    current.draw(set);

    expect(distances(batcher)).toEqual(Array.from({ length: 8 }, () => 8));
    expect(buffer?._updateID).toBe(uploads + 1);
  });

  // Bug: a label whose view scaled since its render group was built kept the edge of the old scale (K5).
  it("packs the label's new scale when Pixi updates the label", () => {
    const { label, build, draw, sdfBatcher, textPipe } = stageAt(1);
    const text = label("1");
    const set = build([text]);
    const batcher = sdfBatcher(set);

    draw(set);
    text.groupTransform.set(0.75, 0, 0, 0.75, 0, 0);
    textPipe.updateRenderable(text);

    expect(distances(batcher)).toEqual([3, 3, 3, 3]);
  });

  // Pin: the engine measures the edge with Pixi's own formula; a Pixi that changes `_updateDistanceField` fails here.
  it("measures Pixi's own distance: what `_updateDistanceField` writes at the same scale", () => {
    const { label, build } = stageAt();
    const text = label("1", { size: 48 });

    build([text]);
    text.groupTransform.set(0.6, 0, 0, 0.6, 0, 0);

    const written: number[] = [];
    const recorder = {
      context: {
        customShader: {
          resources: {
            localUniforms: {
              uniforms: {
                set uDistance(value: number) {
                  written.push(value);
                }
              }
            }
          }
        }
      }
    };
    const pixiPipe = { _getGpuBitmapText: () => recorder };
    const update = Reflect.get(pixi.BitmapTextPipe.prototype, "_updateDistanceField") as (
      this: object,
      text: unknown
    ) => void;

    update.call(pixiPipe, text);

    expect(written).toHaveLength(1);
    expect((glyphsOf(text)?.perScale ?? 0) * 0.6).toBeCloseTo(written[0] ?? 0, 12);
  });

  // Bug: a text update measured the font again (a cache key string and a lookup per update).
  it("measures the edge again only when the font size changes", () => {
    const { label, build, textPipe } = stageAt();
    const text = label("1");
    const set = build([text]);
    const glyphs = glyphsOf(text);
    const lookups = vi.spyOn(pixi.Cache, "has");

    text.text = "22";
    textPipe.addRenderable(text, set);
    textPipe.updateRenderable(text);

    expect(lookups).not.toHaveBeenCalled();
    expect(glyphs?.perScale).toBe(4);

    text.style.fontSize = 64;
    textPipe.addRenderable(text, set);

    expect(lookups).toHaveBeenCalledTimes(1);
    expect(glyphsOf(text)).toBe(glyphs);
    expect(glyphs?.perScale).toBe(8);
  });
});

describe("the shader of the SDF batch", () => {
  /** Pixi's step that hands `calculateMSDFAlpha` the premultiplied colour: the double alpha. */
  const pixiStep = "calculateMSDFAlpha(outColor, vColor,";

  // Bug: Pixi's batch adaptor binds groups 0 and 1 alone; a shader that reads local uniforms of group 2 fails to draw.
  it("compiles both programs without local uniforms or a third bind group", () => {
    const { label, build, sdfBatcher } = stageAt();
    const batcher = sdfBatcher(build([label("1")]));
    const { gpuProgram, glProgram } = batcher.shader;
    const sources = [
      gpuProgram.vertex?.source ?? "",
      gpuProgram.fragment?.source ?? "",
      glProgram.vertex,
      glProgram.fragment
    ];

    for (const source of sources) {
      expect(source).not.toContain("localUniforms");
      expect(source).not.toContain("@group(2)");
      expect(source).not.toContain("uDistance");
    }
  });

  // Bug: the coverage raised the premultiplied alpha, then the template multiplied by it again: alpha 0.5 drew 0.25.
  it("hands the coverage the colour un-premultiplied and scales the edge by the render group's world scale", () => {
    const { label, build, sdfBatcher } = stageAt();
    const { gpuProgram, glProgram } = sdfBatcher(build([label("1")])).shader;

    expect(gpuProgram.fragment?.source).toContain(
      "calculateMSDFAlpha(outColor, vec4<f32>(vColor.rgb / max(vColor.a, 1e-4), 1.0), vSdfDistance)"
    );
    expect(gpuProgram.fragment?.source).not.toContain(pixiStep);
    expect(gpuProgram.fragment?.source).toContain("outColor * vColor");
    expect(gpuProgram.vertex?.source).toContain(
      "(length(sdfWorld[0].xy) + length(sdfWorld[1].xy)) * 0.5"
    );
    expect(glProgram.fragment).toContain(
      "calculateMSDFAlpha(outColor, vec4(vColor.rgb / max(vColor.a, 1e-4), 1.0), vSdfDistance)"
    );
    expect(glProgram.fragment).not.toContain(pixiStep);
    expect(glProgram.vertex).toContain(
      "(length(uWorldTransformMatrix[0].xy) + length(uWorldTransformMatrix[1].xy)) * 0.5"
    );
  });

  // Bug: a shader compiled per batcher: every render group's first SDF batch compiled the programs again.
  it("is one shader per texture limit, shared by every batcher", () => {
    stageAt();

    const Batcher = createSdfBatcher(pixi as unknown as PixiModule);
    const first = new Batcher({ maxTextures: 16 });
    const second = new Batcher({ maxTextures: 16 });
    const other = new Batcher({ maxTextures: 8 });

    expect(second.shader).toBe(first.shader);
    expect(other.shader).not.toBe(first.shader);
    expect(first.geometry).not.toBe(second.geometry);
  });

  // Pin: the step the renderer writes calls Pixi's coverage function with these three arguments, which raises the
  // shape colour's alpha into the coverage; a Pixi that changes it fails here.
  it("relies on Pixi's coverage function as Pixi 8.22 writes it", () => {
    expect(pixi.mSDFBit.fragment?.header).toContain(
      "fn calculateMSDFAlpha(msdfColor:vec4<f32>, shapeColor:vec4<f32>, distance:f32) -> f32"
    );
    expect(pixi.mSDFBit.fragment?.header).toContain("pow(shapeColor.a * alpha, gamma)");
    expect(pixi.mSDFBitGl.fragment?.header).toContain(
      "float calculateMSDFAlpha(vec4 msdfColor, vec4 shapeColor, float distance)"
    );
    expect(pixi.mSDFBitGl.fragment?.header).toContain("pow(shapeColor.a * alpha, gamma)");
  });
});
