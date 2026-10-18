import * as pixi from "pixi.js";
import { afterEach, describe, expect, it } from "vitest";
import { createSdfTextPipe } from "../../host/sdf-text";

// ---------------------------------------------------------------------------
// Unit test against the real pixi.js module, no GPU: the local uniforms of every distance-field text share one shape
// and one `uDistance` accessor (E1 of change 2026-10-18-render-path-garbage), so Pixi's generated sync function reads
// them monomorphic, and the accessor answers what the formula with `Math.hypot` answered.
// ---------------------------------------------------------------------------

/** The font family of the texts here: `distanceField.range` 4 at a `baseRenderedFontSize` of 32, the text at 32. */
const FAMILY = "sdf-uniforms";

/** The linear part of a transform. */
type Linear = { a: number; b: number; c: number; d: number };

/** What the uniforms of a text are read for here. */
type Uniforms = { uDistance: number };

/** The renderer's pipe as a test drives it: a shader made, and Pixi's own update of a laid-out text. */
type DrivenPipe = {
  getSdfShader(): InstanceType<typeof pixi.Shader>;
  updateRenderable(text: unknown): void;
};

afterEach(() => {
  pixi.Cache.remove(`${FAMILY}-bitmap`);
});

/**
 * Builds the renderer's pipe on a renderer stub whose graphics pipe takes a text's proxy, so Pixi's own
 * `updateRenderable` runs and writes `uDistance` while the pipe names the text.
 *
 * @param resolution - Device pixels per CSS pixel.
 * @returns The pipe.
 */
function drivenPipe(resolution: number): DrivenPipe {
  const Pipe = createSdfTextPipe(pixi);
  const renderer = {
    name: "webgpu",
    uid: 1,
    resolution,
    limits: { maxBatchableTextures: 16 },
    gc: { addResourceHash: (): void => undefined },
    renderPipes: { graphics: { updateRenderable: (): void => undefined } }
  };

  pixi.Cache.set(`${FAMILY}-bitmap`, {
    baseRenderedFontSize: 32,
    distanceField: { range: 4, type: "msdf" }
  });

  return new Pipe(
    renderer as unknown as ConstructorParameters<typeof Pipe>[0]
  ) as unknown as DrivenPipe;
}

/**
 * A laid-out text as Pixi's `updateRenderable` reads it: its proxy holds the shader, its group transform is what Pixi
 * scales the distance by, its world transform what the renderer's accessor reads at the draw.
 *
 * @param shader - The text's shader.
 * @param group - Its transform against its render group.
 * @param world - Its world transform.
 * @returns The text.
 */
function laidOut(
  shader: InstanceType<typeof pixi.Shader>,
  group: Linear,
  world: Linear
): { worldTransform: Linear } {
  return {
    _gpuData: { 1: { context: { customShader: shader } } },
    _style: { fontFamily: FAMILY, fontSize: 32 },
    groupTransform: group,
    worldTransform: world
  } as { worldTransform: Linear };
}

/**
 * The scale of a transform as the accessor measured it before E1, with `Math.hypot`. Pure.
 *
 * @param m - The linear part.
 * @returns The mean length of its two axes.
 */
function hypotScale(m: Linear): number {
  return (Math.hypot(m.a, m.b) + Math.hypot(m.c, m.d)) / 2;
}

/**
 * The scale of a transform as Pixi's `_updateDistanceField` measures it, with `Math.sqrt`. Pure.
 *
 * @param m - The linear part.
 * @returns The mean length of its two axes.
 */
function pixiScale(m: Linear): number {
  // eslint-disable-next-line unicorn/prefer-modern-math-apis -- Pixi's own formula, as it writes the distance.
  return (Math.sqrt(m.a * m.a + m.b * m.b) + Math.sqrt(m.c * m.c + m.d * m.d)) / 2;
}

describe("the local uniforms of SDF texts", () => {
  // Bug: an accessor pair made per text, or laid over the data property Pixi's group made, sends every uniforms object
  // to dictionary mode: Pixi's sync function reads them megamorphic and boxes every distance it reads (320 B a frame
  // for 20 texts on the A26).
  it("share one shape and one uDistance accessor, which Pixi's walk of the uniforms sees", () => {
    const pipe = drivenPipe(1);
    const first = pipe.getSdfShader().resources.localUniforms.uniforms as object;
    const second = pipe.getSdfShader().resources.localUniforms.uniforms as object;
    const walked: string[] = [];

    for (const name in first) walked.push(name);

    expect(second).not.toBe(first);
    expect(Object.getOwnPropertyDescriptor(second, "uDistance")?.get).toBe(
      Object.getOwnPropertyDescriptor(first, "uDistance")?.get
    );
    expect(Reflect.ownKeys(second)).toEqual(Reflect.ownKeys(first));
    // WebGL's sync walks the uniforms with `for…in`: the four uniforms, the accessor's state left out.
    expect(walked.toSorted()).toEqual(["uColor", "uDistance", "uRound", "uTransformMatrix"]);
  });

  // Bug: `Math.sqrt(a * a + b * b)` in place of `Math.hypot` must not move the edge width the GPU gets: the uniform
  // buffer holds a float32.
  it("answers what the formula with Math.hypot answered, as the float32 the GPU reads", () => {
    const resolution = 2.81;
    const transforms: Array<[Linear, Linear]> = [
      [
        { a: 1, b: 0, c: 0, d: 1 },
        { a: 0.25, b: 0, c: 0, d: 0.25 }
      ],
      [
        { a: 0.5, b: 0, c: 0, d: 0.5 },
        {
          a: 1.7 * Math.cos(0.5),
          b: 1.7 * Math.sin(0.5),
          c: -1.7 * Math.sin(0.5),
          d: 1.7 * Math.cos(0.5)
        }
      ],
      [
        { a: 0.8, b: 0.3, c: -0.2, d: 1.1 },
        { a: 0.013, b: 0, c: 0, d: 0.017 }
      ],
      [
        { a: 3, b: 4, c: 0, d: 2 },
        { a: 0.6, b: -0.8, c: 0.8, d: 0.6 }
      ]
    ];

    for (const [group, world] of transforms) {
      const pipe = drivenPipe(resolution);
      const shader = pipe.getSdfShader();
      const uniforms = shader.resources.localUniforms.uniforms as Uniforms;
      const text = laidOut(shader, group, world);
      // Pixi's own distance: the group scale, the font's range of 4 at its own size.
      const written = pixiScale(group) * 4;

      pipe.updateRenderable(text);

      const before = (written / hypotScale(group)) * hypotScale(world) * resolution;

      expect(Math.fround(uniforms.uDistance)).toBe(Math.fround(before));
    }
  });

  // Bug: the answer kept for a still text is handed back after the text scaled, so its edge keeps the old width.
  it("answers the kept number while the text is still, and the new one the draw after it scales", () => {
    const pipe = drivenPipe(2.81);
    const shader = pipe.getSdfShader();
    const uniforms = shader.resources.localUniforms.uniforms as Uniforms;
    const text = laidOut(shader, { a: 1, b: 0, c: 0, d: 1 }, { a: 0.5, b: 0, c: 0, d: 0.5 });

    pipe.updateRenderable(text);

    const still = uniforms.uDistance;

    expect(uniforms.uDistance).toBe(still);
    expect(still).toBeCloseTo(5.62, 10);

    text.worldTransform = { a: 0.75, b: 0, c: 0, d: 0.75 };

    expect(uniforms.uDistance).toBeCloseTo(8.43, 10);
  });
});
