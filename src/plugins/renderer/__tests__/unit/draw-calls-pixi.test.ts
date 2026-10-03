import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";
import { createCountingClasses } from "../../monitor/draw-calls";

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
  });

  it("are subclassed with the identical metadata object", () => {
    const classes = createCountingClasses(pixi, { frame: 0, last: 0 });

    expect(Object.getPrototypeOf(classes.batch)).toBe(pixi.GpuBatchAdaptor);
    expect(Object.getPrototypeOf(classes.graphics)).toBe(pixi.GpuGraphicsAdaptor);
    expect(Object.getPrototypeOf(classes.encoder)).toBe(pixi.GpuEncoderSystem);
    expect(classes.batch.extension).toBe(pixi.GpuBatchAdaptor.extension);
    expect(classes.graphics.extension).toBe(pixi.GpuGraphicsAdaptor.extension);
    expect(classes.encoder.extension).toBe(pixi.GpuEncoderSystem.extension);
  });

  it("exports every name the renderer and effects build with", () => {
    const exported = {
      Filter: pixi.Filter,
      GpuProgram: pixi.GpuProgram,
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
});
