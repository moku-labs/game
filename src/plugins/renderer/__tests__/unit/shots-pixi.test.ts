import * as pixi from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createShotTexture } from "../../shots/state";

// ---------------------------------------------------------------------------
// Unit: the texture of a shot over the real Pixi. Pixi ignores an option it does not know, so only its own classes can
// say what these options did.
// ---------------------------------------------------------------------------

describe("the texture of a shot", () => {
  // Bug: a misspelt option leaves a nearest-filtered, repeating, collected texture: a stretched shot shows diamonds and
  // its edges wrap, or Pixi's collector takes it off the GPU a minute after the take.
  it("is a linear, clamped, kept bgra8unorm target of the shot's size at resolution 1", () => {
    const host = { keep: vi.fn(), initSource: vi.fn() };
    const texture = createShotTexture(pixi, host, { width: 96, height: 208, blur: 22 });
    const { source } = texture;

    expect([source.pixelWidth, source.pixelHeight, source.resolution]).toEqual([96, 208, 1]);
    expect(source.format).toBe("bgra8unorm");
    expect(source.style.magFilter).toBe("linear");
    expect(source.style.minFilter).toBe("linear");
    expect(source.style.addressModeU).toBe("clamp-to-edge");
    expect(source.style.addressModeV).toBe("clamp-to-edge");
    expect(source.autoGarbageCollect).toBe(false);
    expect(source.autoGenerateMipmaps).toBe(false);
    expect(host.keep).toHaveBeenCalledWith(source, true);
    expect(host.initSource).toHaveBeenCalledWith(source);
  });
});
