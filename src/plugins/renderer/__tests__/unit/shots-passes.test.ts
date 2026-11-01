import { afterEach, describe, expect, it, vi } from "vitest";
import { startShots } from "../shots-gpu";

// ---------------------------------------------------------------------------
// Unit: the passes of one take on a fake device. Their order and sizes are what make the shot the exact average of the
// canvas; a pass in the wrong order shows on the GPU as a black or stale picture, and no error.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The passes of a device, as one line each.
 *
 * @param passes - What the fake device recorded.
 * @returns For example `"box canvas 1080x2340 > hop 270x585"`.
 */
function lines(passes: ReadonlyArray<{ pipeline: string; from: string; to: string }>): string[] {
  return passes.map(pass => `${pass.pipeline} ${pass.from} > ${pass.to}`);
}

describe("the passes of a take", () => {
  // Bug: a hop reads the wrong texture, or the blur ends in the extra texture and the shot stays unblurred.
  it("hop down from the canvas, then blur both axes at the shot's size through one extra texture", async () => {
    const { mock, gpu } = await startShots();

    mock.api.shots.take("shot.room");
    mock.runPhase("render");

    expect(lines(gpu().passes)).toEqual([
      "box canvas 1080x2340 > hop 270x585",
      "box hop 270x585 > shot 96x208",
      "blur shot 96x208 > hop 96x208",
      "blur hop 96x208 > shot 96x208"
    ]);
  });

  // Bug: the first hop keeps three taps, or a blur pass steps along the wrong axis, or the sigma stays in reference
  // units: `blur: 22` over a 1080 u frame is 1.96 texels, a kernel of radius 6 in 4 taps.
  it("hand each pass its uniform", async () => {
    const { mock, gpu } = await startShots();

    mock.api.shots.take("shot.room");
    mock.runPhase("render");

    const [first, last, across, down] = gpu().passes;

    expect(first?.data?.[6]).toBe(2);
    expect(last?.data?.[6]).toBe(3);
    expect(across?.data?.[0]).toBeCloseTo(1 / 96, 6);
    expect(across?.data?.[1]).toBe(0);
    expect(across?.data?.[4]).toBe(4);
    expect(down?.data?.[0]).toBe(0);
    expect(down?.data?.[1]).toBeCloseTo(1 / 208, 6);
  });

  // Bug: the triangle is not a full-screen one of 3 vertices, and part of the shot stays black.
  it("draw one triangle a pass", async () => {
    const { mock, gpu } = await startShots();

    mock.api.shots.take("shot.room");
    mock.runPhase("render");

    expect(gpu().passes.map(pass => pass.vertices)).toEqual([3, 3, 3, 3]);
  });

  // Bug: `blur: 0` still draws a Gaussian of no taps, a black shot, or makes the extra texture for nothing.
  it("end at the last hop with a blur of 0", async () => {
    const { mock, gpu } = await startShots({ shots: { width: 96, height: 208, blur: 0 } });

    mock.api.shots.take("shot.room");
    mock.runPhase("render");

    expect(lines(gpu().passes)).toEqual([
      "box canvas 1080x2340 > hop 270x585",
      "box hop 270x585 > shot 96x208"
    ]);
    expect(gpu().textures).toHaveLength(1);
  });

  // Bug: a canvas smaller than 4 x the shot still goes through a hop texture.
  it("go straight to the shot from a small canvas", async () => {
    const { mock, gpu } = await startShots({
      canvas: { width: 300, height: 650 },
      shots: { width: 96, height: 208, blur: 0 }
    });

    mock.api.shots.take("shot.room");
    mock.runPhase("render");

    expect(lines(gpu().passes)).toEqual(["box canvas 300x650 > shot 96x208"]);
    expect(gpu().textures).toEqual([]);
  });

  // Bug: the passes are submitted one by one, or the textures of the take go before the submit and the GPU reads
  // destroyed textures; or they stay, and every take leaks a quarter of the canvas.
  it("submit once and let the hop textures and the uniforms go after it", async () => {
    const { mock, gpu } = await startShots();

    mock.api.shots.take("shot.room");
    mock.runPhase("render");

    expect(gpu().submits).toBe(1);
    expect(gpu().textures.map(texture => texture.destroyedAfter)).toEqual([1, 1]);
    expect(gpu().uniforms.map(uniform => uniform.destroyedAfter)).toEqual([1, 1, 1, 1]);
  });

  // Bug: a uniform buffer outside the shape of its struct is a GPU validation error, and the shot stays empty.
  it("size each uniform by its struct", async () => {
    const { mock, gpu } = await startShots();

    mock.api.shots.take("shot.room");
    mock.runPhase("render");

    expect(gpu().uniforms.map(uniform => uniform.size)).toEqual([32, 32, 288, 288]);
  });
});

describe("the pipelines", () => {
  // Bug: a pipeline of another format or topology fails at the first pass, in the frame of the take.
  it("draw triangle lists into bgra8unorm", async () => {
    const { gpu } = await startShots();

    expect(gpu().compiles.map(compile => compile.primitive.topology)).toEqual([
      "triangle-list",
      "triangle-list"
    ]);
    expect(gpu().compiles.map(compile => compile.fragment.targets[0]?.format)).toEqual([
      "bgra8unorm",
      "bgra8unorm"
    ]);
  });
});
