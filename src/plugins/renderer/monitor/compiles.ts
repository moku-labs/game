/* eslint-disable unicorn/no-null -- a compile without a label is named `null` in the log (spec 11 R5). */
/**
 * @file renderer/monitor — pipeline compiles of an agent build (R5). Pixi creates its WebGPU pipelines in a private
 * method, so no subclass sees a creation; the count is taken one level lower, on GPU objects that belong to this
 * application, never on a prototype and never on a Pixi object (OQ4): own properties on the engine's own device, and
 * `linkProgram` on this application's WebGL context. The remover deletes the own property, so the prototype's method
 * shows through again. A restore attaches to the new device or context.
 */
import { pageNow } from "./clock";
import { COUNT, type MonitorSinks, type PerfCtx } from "./types";
import { cell } from "./units";

/**
 * Counts one compile of the frame and keeps it in the next of the 64 pre-made records: its frame, its label by
 * reference and the CPU time of the creation call, the part a frame waits for.
 *
 * @param sinks - The sinks.
 * @param frame - The frame running now.
 * @param label - The pipeline's label, or `null`.
 * @param ms - The time of the call.
 */
export function recordCompile(
  sinks: MonitorSinks,
  frame: number,
  label: string | null,
  ms: number
): void {
  const ring = sinks.compiles;
  const record = ring.records[ring.next];

  sinks.counts[COUNT.compiles] = cell(sinks.counts, COUNT.compiles) + 1;
  ring.next = (ring.next + 1) % ring.records.length;
  ring.size = Math.min(ring.size + 1, ring.records.length);

  if (record === undefined) return;

  record.frame = frame;
  record.label = label;
  record.ms = ms;
}

/**
 * The compiles of one frame still in the ring, oldest first.
 *
 * @param sinks - The sinks.
 * @param frame - The frame number.
 * @returns Label and time of each.
 */
export function compilesOf(
  sinks: MonitorSinks,
  frame: number
): { label: string | null; ms: number }[] {
  const ring = sinks.compiles;
  const found: { label: string | null; ms: number }[] = [];

  for (let age = ring.size - 1; age >= 0; age -= 1) {
    const record = ring.records[(ring.next - 1 - age + ring.records.length) % ring.records.length];

    if (record?.frame === frame) found.push({ label: record.label, ms: record.ms });
  }

  return found;
}

/**
 * Counts the render pipelines and the shader modules the engine's own device creates.
 *
 * @param pc - The perf context.
 * @param device - The engine's own device.
 * @returns The remover.
 */
function wrapDevice(pc: PerfCtx, device: GPUDevice): () => void {
  const { sinks } = pc;
  const createRenderPipeline = device.createRenderPipeline;
  const createShaderModule = device.createShaderModule;

  Reflect.defineProperty(device, "createRenderPipeline", {
    configurable: true,
    writable: true,
    /**
     * Creates the pipeline and counts it, with the time the call took.
     *
     * @param descriptor - The pipeline descriptor.
     * @returns The pipeline.
     */
    value: function countedPipeline(
      this: GPUDevice,
      descriptor: GPURenderPipelineDescriptor
    ): GPURenderPipeline {
      const started = pageNow();
      const made = createRenderPipeline.call(this, descriptor);

      recordCompile(sinks, pc.perf.frame, descriptor.label ?? null, pageNow() - started);

      return made;
    }
  });
  Reflect.defineProperty(device, "createShaderModule", {
    configurable: true,
    writable: true,
    /**
     * Creates the shader module and counts it for the header, not per frame.
     *
     * @param descriptor - The module descriptor.
     * @returns The module.
     */
    value: function countedModule(
      this: GPUDevice,
      descriptor: GPUShaderModuleDescriptor
    ): GPUShaderModule {
      sinks.compiles.shaderModules += 1;

      return createShaderModule.call(this, descriptor);
    }
  });

  return (): void => {
    Reflect.deleteProperty(device, "createRenderPipeline");
    Reflect.deleteProperty(device, "createShaderModule");
  };
}

/**
 * Counts the programs this application's WebGL context links: one program, one compile.
 *
 * @param pc - The perf context.
 * @param gl - The application's context.
 * @returns The remover.
 */
function wrapGl(pc: PerfCtx, gl: WebGL2RenderingContext): () => void {
  const { sinks } = pc;
  const linkProgram = gl.linkProgram;

  Reflect.defineProperty(gl, "linkProgram", {
    configurable: true,
    writable: true,
    /**
     * Links the program and counts it, with the time the call took.
     *
     * @param program - The program.
     */
    value: function countedLink(this: WebGL2RenderingContext, program: WebGLProgram): void {
      const started = pageNow();

      linkProgram.call(this, program);
      // A WebGL program has no label: the log says null.
      recordCompile(sinks, pc.perf.frame, null, pageNow() - started);
    }
  });

  return (): void => {
    Reflect.deleteProperty(gl, "linkProgram");
  };
}

/**
 * Installs the compile counting on the GPU object of this application: the engine's own device on WebGPU, the
 * context on WebGL.
 *
 * @param pc - The perf context.
 * @param target - The device or the context.
 * @returns The remover, which deletes the own properties again.
 */
export function attachCompileCounting(
  pc: PerfCtx,
  target: GPUDevice | WebGL2RenderingContext
): () => void {
  return "createRenderPipeline" in target ? wrapDevice(pc, target) : wrapGl(pc, target);
}
