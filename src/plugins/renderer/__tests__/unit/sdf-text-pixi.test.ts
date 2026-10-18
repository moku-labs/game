import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";
import { createSdfTextPipe } from "../../host/sdf-text";
import type { PixiModule } from "../../types";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU: the pieces the renderer's batched distance-field text builds on
// exist under their names, with the members and the layout it relies on. The CI pin: a Pixi rename, or a Pixi whose
// batch vertex or batcher registry moves, fails here.
// ---------------------------------------------------------------------------

describe("the pieces of the real Pixi module the batched text builds on", () => {
  it("register the bitmap text pipe under the name the renderer swaps, on both backends", () => {
    expect(pixi.BitmapTextPipe.extension).toEqual({
      type: [pixi.ExtensionType.WebGLPipes, pixi.ExtensionType.WebGPUPipes],
      name: "bitmapText"
    });

    for (const member of ["getSdfShader", "initGpuText", "addRenderable", "updateRenderable"]) {
      expect(typeof Reflect.get(pixi.BitmapTextPipe.prototype, member), member).toBe("function");
    }
  });

  it("file a batcher under its name in the batcher pipe's registry, which getBatcher reads", () => {
    expect(pixi.ExtensionType.Batcher).toBe("batcher");
    expect(pixi.DefaultBatcher.extension).toEqual({
      type: [pixi.ExtensionType.Batcher],
      name: "default"
    });
    expect(pixi.BatcherPipe._availableBatchers.default).toBe(pixi.DefaultBatcher);
    expect(typeof pixi.BatcherPipe.getBatcher).toBe("function");
  });

  // The batch vertex the SDF batcher extends by one float: Pixi's six, in Pixi's order.
  it("lay the default batch vertex out as six 32-bit fields", () => {
    const { attributes } = new pixi.BatchGeometry();
    const layout = Object.entries(attributes).map(([name, attribute]) => [
      name,
      attribute.format,
      attribute.offset,
      attribute.stride
    ]);

    expect(layout).toEqual([
      ["aPosition", "float32x2", 0, 24],
      ["aUV", "float32x2", 8, 24],
      ["aColor", "unorm8x4", 16, 24],
      ["aTextureIdAndRound", "uint16x2", 20, 24]
    ]);
  });

  it("export every name the batched text builds with", () => {
    const exported = {
      Batcher: pixi.Batcher,
      BatcherPipe: pixi.BatcherPipe,
      BitmapTextPipe: pixi.BitmapTextPipe,
      Buffer: pixi.Buffer,
      BufferUsage: pixi.BufferUsage,
      Cache: pixi.Cache,
      ExtensionType: pixi.ExtensionType,
      Geometry: pixi.Geometry,
      Shader: pixi.Shader,
      compileHighShaderGpuProgram: pixi.compileHighShaderGpuProgram,
      colorBit: pixi.colorBit,
      generateTextureBatchBit: pixi.generateTextureBatchBit,
      mSDFBit: pixi.mSDFBit,
      roundPixelsBit: pixi.roundPixelsBit,
      compileHighShaderGlProgram: pixi.compileHighShaderGlProgram,
      colorBitGl: pixi.colorBitGl,
      generateTextureBatchBitGl: pixi.generateTextureBatchBitGl,
      mSDFBitGl: pixi.mSDFBitGl,
      roundPixelsBitGl: pixi.roundPixelsBitGl,
      getBatchSamplersUniformGroup: pixi.getBatchSamplersUniformGroup
    };

    for (const [name, value] of Object.entries(exported)) expect(value, name).toBeDefined();
  });

  it("subclass the bitmap text pipe with the identical metadata object", () => {
    const Pipe = createSdfTextPipe(pixi as unknown as PixiModule);

    expect(Object.getPrototypeOf(Pipe)).toBe(pixi.BitmapTextPipe);
    expect(Pipe.extension).toBe(pixi.BitmapTextPipe.extension);
  });
});
