import { readFileSync } from "node:fs";
import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";
import { PIXI_GPU_FEATURES } from "../../host/gpu";
import { createCountingClasses } from "../../monitor/draw-calls";
import { createSinks } from "../../monitor/state";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU: the three classes the
// draw-call counter subclasses exist under the names and methods it relies on.
// The CI pin: a rename in Pixi fails here.
// ---------------------------------------------------------------------------

describe("the draw classes of the real Pixi module", () => {
  it("register under the names the counter swaps", () => {
    expect(pixi.GpuBatchAdaptor.extension).toEqual({
      type: [pixi.ExtensionType.WebGPUPipesAdaptor],
      name: "batch"
    });
    expect(pixi.GpuGraphicsAdaptor.extension).toEqual({
      type: [pixi.ExtensionType.WebGPUPipesAdaptor],
      name: "graphics"
    });
    expect(pixi.GpuEncoderSystem.extension).toEqual({
      type: [pixi.ExtensionType.WebGPUSystem],
      name: "encoder",
      priority: 1
    });
  });

  it("draw through the methods the counting subclasses override", () => {
    expect(typeof pixi.GpuBatchAdaptor.prototype.execute).toBe("function");
    expect(typeof pixi.GpuGraphicsAdaptor.prototype.execute).toBe("function");
    expect(typeof pixi.GpuEncoderSystem.prototype.draw).toBe("function");
    expect(typeof pixi.GpuEncoderSystem.prototype.drawIndirect).toBe("function");
    expect(typeof pixi.GpuEncoderSystem.prototype.beginRenderPass).toBe("function");
    expect(typeof pixi.GpuEncoderSystem.prototype.finishRenderPass).toBe("function");
    expect(typeof pixi.GpuEncoderSystem.prototype.postrender).toBe("function");
    expect(typeof pixi.FilterSystem.prototype.applyFilter).toBe("function");
    expect(typeof Reflect.get(pixi.GpuTextureSystem.prototype, "onSourceUpdate")).toBe("function");
    expect(typeof Reflect.get(pixi.GlTextureSystem.prototype, "onSourceUpdate")).toBe("function");
  });

  it("register the filter and texture systems under the names the counting swaps", () => {
    expect(pixi.FilterSystem.extension).toEqual({
      type: [pixi.ExtensionType.WebGLSystem, pixi.ExtensionType.WebGPUSystem],
      name: "filter"
    });
    expect(pixi.GpuTextureSystem.extension).toEqual({
      type: [pixi.ExtensionType.WebGPUSystem],
      name: "texture"
    });
    expect(pixi.GlTextureSystem.extension).toEqual({
      type: [pixi.ExtensionType.WebGLSystem],
      name: "texture"
    });
  });

  it("register BatcherPipe under the name the rebuild counter swaps, with buildStart public", () => {
    expect(pixi.BatcherPipe.extension).toEqual({
      type: [
        pixi.ExtensionType.WebGLPipes,
        pixi.ExtensionType.WebGPUPipes,
        pixi.ExtensionType.CanvasPipes
      ],
      name: "batch"
    });
    expect(typeof pixi.BatcherPipe.prototype.buildStart).toBe("function");
    expect(typeof pixi.BatcherPipe.getBatcher).toBe("function");
  });

  it("ask the device for the features the engine's own device keeps", () => {
    const source = readFileSync(
      new URL(
        "../../../../../node_modules/pixi.js/lib/rendering/renderers/gpu/GpuDeviceSystem.mjs",
        import.meta.url
      ),
      "utf8"
    );
    const list = /const requiredFeatures = \[([^\]]*)\]/.exec(source)?.[1] ?? "";
    const features = [...list.matchAll(/"([^"]+)"/g)].map(match => match[1]);

    expect(features).toEqual([...PIXI_GPU_FEATURES]);
  });

  it("are subclassed with the identical metadata object", () => {
    const classes = createCountingClasses(pixi, createSinks());

    expect(Object.getPrototypeOf(classes.batch)).toBe(pixi.GpuBatchAdaptor);
    expect(Object.getPrototypeOf(classes.graphics)).toBe(pixi.GpuGraphicsAdaptor);
    expect(Object.getPrototypeOf(classes.encoder)).toBe(pixi.GpuEncoderSystem);
    expect(classes.batch.extension).toBe(pixi.GpuBatchAdaptor.extension);
    expect(classes.graphics.extension).toBe(pixi.GpuGraphicsAdaptor.extension);
    expect(classes.encoder.extension).toBe(pixi.GpuEncoderSystem.extension);
    expect(Object.getPrototypeOf(classes.filter)).toBe(pixi.FilterSystem);
    expect(Object.getPrototypeOf(classes.gpuTexture)).toBe(pixi.GpuTextureSystem);
    expect(Object.getPrototypeOf(classes.glTexture)).toBe(pixi.GlTextureSystem);
    expect(classes.filter.extension).toBe(pixi.FilterSystem.extension);
    expect(classes.gpuTexture.extension).toBe(pixi.GpuTextureSystem.extension);
    expect(classes.glTexture.extension).toBe(pixi.GlTextureSystem.extension);
    expect(Object.getPrototypeOf(classes.batcher)).toBe(pixi.BatcherPipe);
    expect(classes.batcher.extension).toBe(pixi.BatcherPipe.extension);
    expect(classes.batcher.getBatcher).toBe(pixi.BatcherPipe.getBatcher);
  });

  it("exports every name the renderer and effects build with", () => {
    const exported = {
      Filter: pixi.Filter,
      GpuProgram: pixi.GpuProgram,
      GlProgram: pixi.GlProgram,
      defaultFilterVert: pixi.defaultFilterVert,
      UniformGroup: pixi.UniformGroup,
      BlurFilter: pixi.BlurFilter,
      ColorMatrixFilter: pixi.ColorMatrixFilter,
      NoiseFilter: pixi.NoiseFilter,
      DisplacementFilter: pixi.DisplacementFilter,
      AlphaFilter: pixi.AlphaFilter,
      ParticleContainer: pixi.ParticleContainer,
      Particle: pixi.Particle,
      extensions: pixi.extensions,
      GpuBatchAdaptor: pixi.GpuBatchAdaptor,
      GpuGraphicsAdaptor: pixi.GpuGraphicsAdaptor,
      GpuEncoderSystem: pixi.GpuEncoderSystem
    };

    for (const [name, value] of Object.entries(exported)) expect(value, name).toBeDefined();
  });

  it("hands a filter's GLSL the texture coordinate from its default vertex stage", () => {
    // The GLSL header of a custom filter declares `in vec2 vTextureCoord;` for this stage.
    expect(pixi.defaultFilterVert.startsWith("in vec2 aPosition;")).toBe(true);
    expect(pixi.defaultFilterVert).toContain("out vec2 vTextureCoord;");
    expect(typeof pixi.GlProgram.from).toBe("function");
  });
});
