/* eslint-disable sonarjs/public-static-readonly -- the records of the fakes are reset per test */
/**
 * @file effects plugin — the fake Pixi module the effects tests run on. Not a test file: the
 * projects only collect `*.test.ts`. It extends the renderer's fake module with a particle
 * container that counts its uploads, particles with every field the step writes, a program that
 * records its sources (WGSL and GLSL), a filter that keeps the resolution it was built at and the
 * five core filters recording their setter calls, plus a fake GPU device for the dev WGSL check
 * and a fake WebGL2 context for the dev GLSL check.
 */

import {
  createFakePixi,
  FakeFilter,
  FakeGlProgram,
  FakeGpuProgram,
  FakeParticle,
  FakeParticleContainer,
  type FakePixi,
  FakePoint,
  FakeRectangle,
  type FakeSource,
  FakeSprite,
  FakeTexture,
  FakeUniformGroup
} from "../../renderer/__tests__/fake-pixi";
import type { PixiModule } from "../../renderer/types";

/** A particle with every field the step writes, at Pixi's defaults. */
export class FakeFxParticle extends FakeParticle {
  public scaleX = 1;
  public scaleY = 1;
  public anchorX = 0;
  public anchorY = 0;
  public rotation = 0;
  public color = 0xff_ff_ff_ff;

  public constructor(
    options: FakeTexture | { texture: FakeTexture; anchorX?: number; anchorY?: number }
  ) {
    super(options);
    if (options instanceof FakeTexture) return;
    this.anchorX = options.anchorX ?? 0;
    this.anchorY = options.anchorY ?? 0;
  }
}

/** What a particle container was built with. */
export type FakeContainerOptions = {
  dynamicProperties?: Record<string, boolean>;
  texture?: FakeTexture;
  blendMode?: string;
};

/** A particle container that records its options, its bounds area and every `update()`. */
export class FakeFxParticleContainer extends FakeParticleContainer {
  /** Every container the fake module made, in creation order. */
  public static made: FakeFxParticleContainer[] = [];

  public override particleChildren: FakeFxParticle[] = [];
  public options: FakeContainerOptions;
  public texture: FakeTexture | undefined;
  public blendMode: string;
  public boundsArea: FakeRectangle | undefined = undefined;
  /** How often `update()` uploaded the particles. */
  public updates = 0;
  public destroyOptions: unknown = undefined;

  public constructor(options: FakeContainerOptions = {}) {
    super();
    this.options = options;
    this.texture = options.texture;
    this.blendMode = options.blendMode ?? "normal";
    FakeFxParticleContainer.made.push(this);
  }

  /** Marks every particle attribute dirty, as Pixi's does. */
  public update(): void {
    this.updates += 1;
  }

  /**
   * Frees the container and records how.
   *
   * @param options - Pixi's destroy options.
   * @param options.children - True to free the children too.
   * @param options.texture - True to free the texture too.
   */
  public override destroy(options?: { children?: boolean; texture?: boolean }): void {
    this.destroyOptions = options;
    super.destroy(options);
  }
}

/** A GPU program that records every source it was built from. */
export class FakeFxGpuProgram extends FakeGpuProgram {
  /** Every program `from` built, in order. */
  public static made: FakeFxGpuProgram[] = [];

  /**
   * Builds a program and records it.
   *
   * @param options - Name, vertex and fragment sources.
   * @returns A new program.
   */
  public static override from(options: Record<string, unknown>): FakeFxGpuProgram {
    const program = new FakeFxGpuProgram(options);

    FakeFxGpuProgram.made.push(program);

    return program;
  }
}

/** A GL program that records every source it was built from. */
export class FakeFxGlProgram extends FakeGlProgram {
  /** Every program `from` built, in order. */
  public static made: FakeFxGlProgram[] = [];

  /**
   * Builds a program and records it.
   *
   * @param options - Name, vertex and fragment sources.
   * @returns A new program.
   */
  public static override from(options: Record<string, unknown>): FakeFxGlProgram {
    const program = new FakeFxGlProgram(options);

    FakeFxGlProgram.made.push(program);

    return program;
  }
}

/** Pixi's `Filter` with the resolution it was built at: a number, `"inherit"`, or 1 by default. */
export class FakeFxFilter extends FakeFilter {
  public resolution: number | "inherit";

  public constructor(options: Record<string, unknown> = {}) {
    super(options);
    const { resolution } = options;

    this.resolution = resolution === "inherit" || typeof resolution === "number" ? resolution : 1;
  }
}

/** The fake of Pixi's `BlurFilter`: its four setters recorded in call order. */
export class FakeFxBlurFilter extends FakeFilter {
  public readonly calls: string[] = [];
  private strengthValue: number;
  private qualityValue: number;
  private resolutionValue: number;
  private repeatValue = false;

  public constructor(options: { strength?: number; quality?: number; resolution?: number } = {}) {
    super({ ...options, resources: { blurUniforms: new FakeUniformGroup({}) } });
    this.strengthValue = options.strength ?? 8;
    this.qualityValue = options.quality ?? 4;
    this.resolutionValue = options.resolution ?? 1;
  }

  /** @returns The blur strength. */
  public get strength(): number {
    return this.strengthValue;
  }

  public set strength(value: number) {
    this.calls.push(`strength=${value}`);
    this.strengthValue = value;
  }

  /** @returns The passes per axis. */
  public get quality(): number {
    return this.qualityValue;
  }

  public set quality(value: number) {
    this.calls.push(`quality=${value}`);
    this.qualityValue = value;
  }

  /** @returns The resolution of the pass textures. */
  public get resolution(): number {
    return this.resolutionValue;
  }

  public set resolution(value: number) {
    this.calls.push(`resolution=${value}`);
    this.resolutionValue = value;
  }

  /** @returns Whether the edge pixels repeat. */
  public get repeatEdgePixels(): boolean {
    return this.repeatValue;
  }

  public set repeatEdgePixels(value: boolean) {
    this.calls.push(`repeatEdgePixels=${value}`);
    this.repeatValue = value;
  }
}

/** The fake of Pixi's `ColorMatrixFilter`: every composing call recorded. */
export class FakeFxColorMatrixFilter extends FakeFxFilter {
  public readonly calls: string[] = [];

  public constructor(options: { resolution?: number | "inherit" } = {}) {
    super({ ...options, resources: { colorMatrixUniforms: new FakeUniformGroup({}) } });
  }

  /** Back to the identity. */
  public reset(): void {
    this.calls.push("reset");
  }

  /**
   * @param value - Brightness.
   * @param multiply - Compose with the current matrix.
   */
  public brightness(value: number, multiply: boolean): void {
    this.calls.push(`brightness(${value},${multiply})`);
  }

  /**
   * @param value - Saturation.
   * @param multiply - Compose with the current matrix.
   */
  public saturate(value: number, multiply: boolean): void {
    this.calls.push(`saturate(${value},${multiply})`);
  }

  /**
   * @param value - Contrast.
   * @param multiply - Compose with the current matrix.
   */
  public contrast(value: number, multiply: boolean): void {
    this.calls.push(`contrast(${value},${multiply})`);
  }

  /**
   * @param value - Hue rotation in degrees.
   * @param multiply - Compose with the current matrix.
   */
  public hue(value: number, multiply: boolean): void {
    this.calls.push(`hue(${value},${multiply})`);
  }
}

/** The fake of Pixi's `NoiseFilter`: its two setters recorded. */
export class FakeFxNoiseFilter extends FakeFxFilter {
  public readonly calls: string[] = [];
  public readonly built: { noise?: number; seed?: number; resolution?: number | "inherit" };

  public constructor(
    options: { noise?: number; seed?: number; resolution?: number | "inherit" } = {}
  ) {
    super({ ...options, resources: { noiseUniforms: new FakeUniformGroup({}) } });
    this.built = options;
  }

  public set noise(value: number) {
    this.calls.push(`noise=${value}`);
  }

  public set seed(value: number) {
    this.calls.push(`seed=${value}`);
  }
}

/** The fake of Pixi's `DisplacementFilter`: its map sprite and its scale point. */
export class FakeFxDisplacementFilter extends FakeFxFilter {
  public readonly sprite: FakeSprite;
  public readonly scale: FakePoint;

  public constructor(options: {
    sprite: FakeSprite;
    scale?: { x: number; y: number };
    resolution?: number | "inherit";
  }) {
    super({ ...options, resources: { filterUniforms: new FakeUniformGroup({}) } });
    this.sprite = options.sprite;
    this.scale = new FakePoint(options.scale?.x ?? 20, options.scale?.y ?? 20);
  }
}

/** The fake of Pixi's `AlphaFilter`: its setter recorded. */
export class FakeFxAlphaFilter extends FakeFxFilter {
  public readonly calls: string[] = [];
  public readonly built: { alpha?: number; resolution?: number | "inherit" };

  public constructor(options: { alpha?: number; resolution?: number | "inherit" } = {}) {
    super({ ...options, resources: { alphaUniforms: new FakeUniformGroup({}) } });
    this.built = options;
  }

  public set alpha(value: number) {
    this.calls.push(`alpha=${value}`);
  }
}

/** A sprite that records how it was destroyed. */
export class FakeFxSprite extends FakeSprite {
  public destroyOptions: unknown = undefined;

  /**
   * Frees the sprite and records how.
   *
   * @param options - Pixi's destroy options.
   * @param options.children - True to free the children too.
   * @param options.texture - True to free the texture too.
   */
  public override destroy(options?: { children?: boolean; texture?: boolean }): void {
    this.destroyOptions = options;
    super.destroy(options);
  }
}

/** One message of a fake WGSL compilation. */
export type FakeMessage = {
  type: "error" | "warning" | "info";
  lineNum: number;
  linePos: number;
  message: string;
};

/** The fake GPU device: the sources it compiled and the messages it answers with. */
export type FakeDevice = {
  compiled: string[];
  messages: FakeMessage[];
  device: GPUDevice;
};

/**
 * Creates a fake GPU device whose shader modules answer `getCompilationInfo()` with the messages
 * a test sets.
 *
 * @param messages - What every compilation reports.
 * @returns The device and its records.
 */
export function createFakeDevice(messages: FakeMessage[] = []): FakeDevice {
  const fake: FakeDevice = {
    compiled: [],
    messages,
    device: {} as GPUDevice
  };
  const device = {
    createShaderModule: (descriptor: { code: string }) => {
      fake.compiled.push(descriptor.code);

      return { getCompilationInfo: () => Promise.resolve({ messages: fake.messages }) };
    }
  };

  fake.device = device as unknown as GPUDevice;

  return fake;
}

/** The fake WebGL2 context: what it compiled and the answer a test sets for every compile. */
export type FakeGl = {
  /** The shader type of every `createShader`, in order. */
  created: number[];
  /** Every GLSL source compiled, in order. */
  compiled: string[];
  /** How many shaders were deleted. */
  deleted: number;
  /** What `getShaderParameter(shader, COMPILE_STATUS)` answers. */
  status: boolean;
  /** What `getShaderInfoLog(shader)` answers. */
  log: string;
  /** False makes `createShader` answer null, as a lost context does. */
  makesShaders: boolean;
  context: WebGL2RenderingContext;
};

/**
 * Creates a fake WebGL2 context whose compiles answer the status and the log a test sets: a
 * success with an empty log by default.
 *
 * @returns The context and its records.
 */
export function createFakeGl(): FakeGl {
  const FRAGMENT_SHADER = 0x8b_30;
  const COMPILE_STATUS = 0x8b_81;
  const fake: FakeGl = {
    created: [],
    compiled: [],
    deleted: 0,
    status: true,
    log: "",
    makesShaders: true,
    context: {} as WebGL2RenderingContext
  };
  const context = {
    FRAGMENT_SHADER,
    COMPILE_STATUS,
    createShader: (type: number): { source: string } | null => {
      fake.created.push(type);

      // eslint-disable-next-line unicorn/no-null -- WebGL answers null when it makes no shader.
      return fake.makesShaders ? { source: "" } : null;
    },
    shaderSource: (shader: { source: string }, source: string): void => {
      shader.source = source;
    },
    compileShader: (shader: { source: string }): void => {
      fake.compiled.push(shader.source);
    },
    getShaderParameter: (_shader: unknown, name: number): unknown =>
      name === COMPILE_STATUS ? fake.status : undefined,
    getShaderInfoLog: (): string => fake.log,
    deleteShader: (): void => {
      fake.deleted += 1;
    }
  };

  fake.context = context as unknown as WebGL2RenderingContext;

  return fake;
}

/** The fake module plus the renderer's handles. */
export type FakeEffectsPixi = FakePixi;

/**
 * Creates the renderer's fake Pixi module with the effects classes swapped in. The records of the
 * effects fakes start over.
 *
 * @param options - Passed to the renderer's `createFakePixi`.
 * @returns The module and the recorded applications.
 */
export function createFakeEffectsPixi(
  options: Parameters<typeof createFakePixi>[0] = {}
): FakeEffectsPixi {
  const base = createFakePixi(options);

  FakeFxParticleContainer.made = [];
  FakeFxGpuProgram.made = [];
  FakeFxGlProgram.made = [];

  const module = {
    ...(base.module as unknown as Record<string, unknown>),
    ParticleContainer: FakeFxParticleContainer,
    Particle: FakeFxParticle,
    Filter: FakeFxFilter,
    GpuProgram: FakeFxGpuProgram,
    GlProgram: FakeFxGlProgram,
    UniformGroup: FakeUniformGroup,
    BlurFilter: FakeFxBlurFilter,
    ColorMatrixFilter: FakeFxColorMatrixFilter,
    NoiseFilter: FakeFxNoiseFilter,
    DisplacementFilter: FakeFxDisplacementFilter,
    AlphaFilter: FakeFxAlphaFilter,
    Sprite: FakeFxSprite,
    Rectangle: FakeRectangle
  } as unknown as PixiModule;

  return { ...base, module };
}

/**
 * A texture on a shared source, as one atlas page hands out.
 *
 * @param source - The page.
 * @param side - Width and height of the frame in pixels.
 * @returns The texture.
 */
export function atlasTexture(source: FakeSource, side = 32): FakeTexture {
  return new FakeTexture({ source, frame: new FakeRectangle(0, 0, side, side) });
}
