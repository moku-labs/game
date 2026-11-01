/**
 * @file renderer plugin — the fake GPU of the shots tests. Not a test file. A small stand-in of the WebGPU calls a take
 * makes, recording its passes by what they read and where they draw, over the mock renderer: every application the
 * fake Pixi makes gets its own device and a canvas of the asked size, so a restore brings a new one.
 */
import type { ShotsConfig } from "../shots/types";
import { FakeApplication, type FakeSource, FakeTexture } from "./fake-pixi";
import { createMockRenderer, type MockRenderer } from "./mock-renderer";

/** A fake GPU texture: a name for the records, its size, and when it went. */
export type FakeGpuTexture = {
  name: string;
  width: number;
  height: number;
  /** `queue.submit` calls made when it was destroyed; `undefined` while it lives. */
  destroyedAfter: number | undefined;
  createView(): { of: FakeGpuTexture };
  destroy(): void;
};

/** A fake uniform buffer: what `writeBuffer` put in it, and when it went. */
export type FakeUniform = {
  size: number;
  data: Float32Array | undefined;
  destroyedAfter: number | undefined;
  destroy(): void;
};

/** One drawn pass of a take: the pipeline, what it read, where it drew and its uniform. */
export type ShotPass = {
  pipeline: "box" | "blur";
  from: string;
  to: string;
  data: Float32Array | undefined;
  /** Vertices of the draw. */
  vertices: number;
};

/** What a pipeline compile was asked for. */
export type FakePipelineDescriptor = {
  fragment: { module: { code: string }; targets: Array<{ format: string }> };
  primitive: { topology: string };
};

/** One device of the fake GPU and what it recorded. */
export type ShotGpu = {
  /** Every compile asked for, in order. */
  compiles: FakePipelineDescriptor[];
  /** The pipelines the compiles answered, in order. */
  pipelines: object[];
  passes: ShotPass[];
  /** Texture copies, as `from > to`. */
  copies: string[];
  /** The textures made for a take: hops and the extra one of the blur. */
  textures: FakeGpuTexture[];
  uniforms: FakeUniform[];
  submits: number;
  /** Stage renders of the application when each read of the canvas texture happened. */
  canvasReads: number[];
};

/** What `createRenderPipelineAsync` waits for, and what it fails with. */
type Compile = { gate: Promise<void>; failure: Error | undefined };

/** What a shot renderer is opened with. */
export type ShotOptions = {
  /** `config.shots`; 96 x 208, `blur: 22` when left out, `undefined` for none. */
  shots?: ShotsConfig | undefined;
  /** The canvas texture in device pixels; 1080 x 2340 when left out. */
  canvas?: { width: number; height: number };
  onDemand?: boolean;
  kind?: "webgpu" | "webgl";
  dom?: boolean;
};

/** The mock renderer over the fake GPU. */
export type ShotRenderer = {
  mock: MockRenderer;
  /** One per application made, in order. */
  gpus: ShotGpu[];
  /** The device of the last application. */
  gpu(): ShotGpu;
  /** Every options object `RenderTexture.create` was handed. */
  created: Array<Record<string, unknown>>;
  /** Every source `initSource` was handed, on any device. */
  initialised: object[];
  /** What the next compiles wait for and fail with: a test holds one back or breaks it. */
  compile: Compile;
};

/** What a draw without a pipeline or a bind group throws: WebGPU refuses it too. */
const NO_PIPELINE = "the fake GPU got a pass without a pipeline";

/**
 * Makes a fake GPU texture.
 *
 * @param gpu - What counts the submits.
 * @param gpu.submits - The submits so far.
 * @param name - Its name in the records.
 * @param width - Its width.
 * @param height - Its height.
 * @returns The texture.
 */
function gpuTexture(
  gpu: { submits: number },
  name: string,
  width: number,
  height: number
): FakeGpuTexture {
  const texture: FakeGpuTexture = {
    name,
    width,
    height,
    destroyedAfter: undefined,
    createView: () => ({ of: texture }),
    destroy: () => {
      texture.destroyedAfter = gpu.submits;
    }
  };

  return texture;
}

/**
 * The size of a texture, as a record reads it.
 *
 * @param texture - The texture.
 * @returns For example `"hop 270x585"`.
 */
function named(texture: FakeGpuTexture): string {
  return `${texture.name} ${texture.width}x${texture.height}`;
}

/**
 * Makes the fake device of one application.
 *
 * @param compile - What its compiles wait for.
 * @returns The device, and what it recorded.
 */
function createGpu(compile: Compile): { gpu: ShotGpu; device: object } {
  const gpu: ShotGpu = {
    compiles: [],
    pipelines: [],
    passes: [],
    copies: [],
    textures: [],
    uniforms: [],
    submits: 0,
    canvasReads: []
  };
  const pipelineNames = new WeakMap<object, "box" | "blur">();
  const device = {
    createShaderModule: (descriptor: { code: string }) => descriptor,
    createSampler: () => ({ label: "sampler" }),
    createRenderPipelineAsync: async (descriptor: FakePipelineDescriptor) => {
      const { gate, failure } = compile;

      gpu.compiles.push(descriptor);
      await gate;

      if (failure !== undefined) throw failure;

      const pipeline = { getBindGroupLayout: () => ({ label: "layout" }) };

      gpu.pipelines.push(pipeline);
      pipelineNames.set(
        pipeline,
        descriptor.fragment.module.code.includes("Kernel") ? "blur" : "box"
      );

      return pipeline;
    },
    createTexture: (descriptor: { size: { width: number; height: number } }) => {
      const texture = gpuTexture(gpu, "hop", descriptor.size.width, descriptor.size.height);

      gpu.textures.push(texture);

      return texture;
    },
    createBuffer: (descriptor: { size: number }) => {
      const uniform: FakeUniform = {
        size: descriptor.size,
        data: undefined,
        destroyedAfter: undefined,
        destroy: () => {
          uniform.destroyedAfter = gpu.submits;
        }
      };

      gpu.uniforms.push(uniform);

      return uniform;
    },
    createBindGroup: (descriptor: {
      entries: [
        { resource: { of: FakeGpuTexture } },
        unknown,
        { resource: { buffer: FakeUniform } }
      ];
    }) => descriptor,
    createCommandEncoder: () => ({
      beginRenderPass: (descriptor: { colorAttachments: [{ view: { of: FakeGpuTexture } }] }) => {
        const bound: { pipeline?: object; group?: Parameters<typeof device.createBindGroup>[0] } =
          {};

        return {
          setPipeline: (pipeline: object) => {
            bound.pipeline = pipeline;
          },
          setBindGroup: (_index: number, group: Parameters<typeof device.createBindGroup>[0]) => {
            bound.group = group;
          },
          draw: (vertices: number) => {
            const pipeline =
              bound.pipeline === undefined ? undefined : pipelineNames.get(bound.pipeline);

            if (pipeline === undefined || bound.group === undefined) throw new Error(NO_PIPELINE);

            gpu.passes.push({
              pipeline,
              from: named(bound.group.entries[0].resource.of),
              to: named(descriptor.colorAttachments[0].view.of),
              data: bound.group.entries[2].resource.buffer.data,
              vertices
            });
          },
          end: () => undefined
        };
      },
      copyTextureToTexture: (
        from: { texture: FakeGpuTexture },
        to: { texture: FakeGpuTexture }
      ) => {
        gpu.copies.push(`${named(from.texture)} > ${named(to.texture)}`);
      },
      finish: () => ({ label: "commands" })
    }),
    queue: {
      writeBuffer: (buffer: FakeUniform, _offset: number, data: Float32Array) => {
        buffer.data = data;
      },
      submit: () => {
        gpu.submits += 1;
      }
    }
  };

  return { gpu, device };
}

/**
 * Creates the mock renderer over the fake GPU, not started. Every application it makes gets a device of its own, a
 * canvas that answers `getContext("webgpu")`, and a texture system that answers `getGpuSource`.
 *
 * @param options - The config and the canvas.
 * @returns The renderer and the records.
 */
export function createShotRenderer(options: ShotOptions = {}): ShotRenderer {
  const { canvas = { width: 1080, height: 2340 } } = options;
  const shots = "shots" in options ? options.shots : { width: 96, height: 208, blur: 22 };
  const mock = createMockRenderer({
    config: { shots, onDemand: options.onDemand ?? false },
    kind: options.kind ?? "webgpu",
    ...(options.dom === undefined ? {} : { dom: options.dom })
  });
  const opened: ShotRenderer = {
    mock,
    gpus: [],
    gpu: () => {
      const gpu = opened.gpus.at(-1);

      if (gpu === undefined) throw new Error("the fake GPU has no device yet");

      return gpu;
    },
    created: [],
    initialised: [],
    compile: { gate: Promise.resolve(), failure: undefined }
  };

  /** An application with a device, a canvas and a texture system a take can use. */
  class ShotApplication extends FakeApplication {
    /**
     * Creates the renderer, then lays the fake GPU over it.
     *
     * @param initOptions - What the renderer asked Pixi for.
     */
    public override async init(initOptions: Record<string, unknown>): Promise<void> {
      await super.init(initOptions);

      const { renderer } = this;
      const live = renderer.gpu?.device;

      if (live === undefined) return;

      const { gpu, device } = createGpu(opened.compile);
      const current = gpuTexture(gpu, "canvas", canvas.width, canvas.height);
      const sources = new WeakMap<object, FakeGpuTexture>();

      opened.gpus.push(gpu);
      Object.assign(live, device);
      Object.assign(this.canvas, {
        getContext: () => ({
          getCurrentTexture: () => {
            gpu.canvasReads.push(renderer.renders);

            return current;
          }
        })
      });
      Object.assign(renderer.texture, {
        initSource: (source: object) => {
          opened.initialised.push(source);
        },
        getGpuSource: (source: FakeSource) => {
          const known = sources.get(source) ?? gpuTexture(gpu, "shot", source.width, source.height);

          sources.set(source, known);

          return known;
        }
      });
    }
  }

  Object.assign(mock.pixi.module, {
    Application: ShotApplication,
    RenderTexture: {
      create: (textureOptions: { width: number; height: number }) => {
        opened.created.push(textureOptions);

        return new FakeTexture({
          source: { width: textureOptions.width, height: textureOptions.height, destroyed: false }
        });
      }
    }
  });

  return opened;
}

/**
 * Holds back the compiles that start from now on, until the test ends them. The next compiles run at once again.
 *
 * @param opened - The renderer.
 * @returns What ends the held compiles: `finish` lets them land, `fail` breaks them.
 */
export function holdCompiles(opened: ShotRenderer): {
  finish(): void;
  fail(error: Error): void;
  release(): void;
} {
  const held = Promise.withResolvers<void>();

  opened.compile.gate = held.promise;

  return {
    finish: () => held.resolve(),
    fail: error => held.reject(error),
    release: () => {
      opened.compile.gate = Promise.resolve();
    }
  };
}

/** Yields the microtask queue, so a compile or a restore can finish. */
export async function settle(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}

/**
 * Starts the mock renderer over the fake GPU and lets its pipelines compile.
 *
 * @param options - The config and the canvas.
 * @returns The started renderer.
 */
export async function startShots(options: ShotOptions = {}): Promise<ShotRenderer> {
  const opened = createShotRenderer(options);

  await opened.mock.start();
  await settle();

  return opened;
}
