/* eslint-disable unicorn/no-null -- a compile without a label is named `null` in the log (spec 11 R5). */
/**
 * @file renderer/monitor — pipeline compiles of an agent build (R5). Pixi creates its WebGPU pipelines in a private
 * method, so no subclass sees a creation; the count is taken one level lower, on GPU objects that belong to this
 * application, never on a prototype and never on a Pixi object (OQ4): own properties on the engine's own device, and
 * `linkProgram` on this application's WebGL context. The remover deletes the own property, so the prototype's method
 * shows through again. A restore attaches to the new device or context. Each record also notes where it happened:
 * the pass of the frame, and the filter kind and its owner while a filter applies; a compile of a plain batch has
 * none. The flush turns the records into `shader` events.
 */
import { pageNow } from "./clock";
import { SHADER_WHATS, type ShaderEventDetail } from "./log-types";
import { COUNT, type MonitorSinks, type PerfCtx } from "./types";
import { cell, roundTo } from "./units";

/**
 * Keeps one compile or shader module in the next of the 64 pre-made records: its frame, its label by reference, the
 * CPU time of the creation call, the part a frame waits for, and the pass, filter kind and owner of the moment.
 *
 * @param sinks - The sinks.
 * @param frame - The frame running now.
 * @param label - The pipeline's or module's label, or `null`.
 * @param ms - The time of the call.
 * @param module - True for a WebGPU shader module.
 */
function writeRecord(
  sinks: MonitorSinks,
  frame: number,
  label: string | null,
  ms: number,
  module: boolean
): void {
  const ring = sinks.compiles;
  const record = ring.records[ring.next];
  const applying = sinks.filterDepth > 0;

  ring.next = (ring.next + 1) % ring.records.length;
  ring.size = Math.min(ring.size + 1, ring.records.length);
  ring.written += 1;

  if (record === undefined) return;

  record.frame = frame;
  record.label = label;
  record.ms = ms;
  record.module = module;
  record.pass = sinks.inFrame ? cell(sinks.counts, COUNT.passes) - 1 : -1;
  record.kind = applying ? sinks.filterKind + 1 : 0;
  record.owner = applying ? sinks.filterOwner : 0;
}

/**
 * Counts one compile of the frame and keeps its record.
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
  sinks.counts[COUNT.compiles] = cell(sinks.counts, COUNT.compiles) + 1;
  writeRecord(sinks, frame, label, ms, false);
}

/**
 * Keeps the record of one shader module: not a compile of the frame's count, a `shader` event of its own.
 *
 * @param sinks - The sinks.
 * @param frame - The frame running now.
 * @param label - The module's label, or `null`.
 * @param ms - The time of the call.
 */
export function recordModule(
  sinks: MonitorSinks,
  frame: number,
  label: string | null,
  ms: number
): void {
  sinks.compiles.shaderModules += 1;
  writeRecord(sinks, frame, label, ms, true);
}

/**
 * The compiles of one frame still in the ring, oldest first; shader modules left out.
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

    if (record?.frame === frame && !record.module) {
      found.push({ label: record.label, ms: record.ms });
    }
  }

  return found;
}

/**
 * The details of the `shader` events not sent yet, oldest first, from the records still in the ring (the 64 newest);
 * marks them sent. Built at the flush: it allocates.
 *
 * @param pc - The perf context.
 * @param viewOf - The label of an entity's view now, or `null`.
 * @returns One detail per compile or module.
 */
export function takeShaderEvents(
  pc: PerfCtx,
  viewOf: (entity: number) => string | null
): ShaderEventDetail[] {
  const ring = pc.sinks.compiles;
  const { kindNames } = pc.sinks;
  const first = Math.max(ring.sent, ring.written - ring.records.length);
  const boot = pc.perf.firstDrawnFrame;
  const details: ShaderEventDetail[] = [];

  for (let sequence = first; sequence < ring.written; sequence += 1) {
    const record = ring.records[sequence % ring.records.length];

    if (record === undefined) continue;

    details.push({
      what: record.module ? SHADER_WHATS[1] : SHADER_WHATS[0],
      label: record.label,
      ms: roundTo(record.ms, 2),
      frame: record.frame,
      boot: Number.isNaN(boot) || record.frame <= boot,
      during: {
        pass: record.pass < 0 ? null : record.pass,
        filter: record.kind === 0 ? null : (kindNames[record.kind - 1] ?? "other"),
        owner: record.owner === 0 ? null : record.owner,
        view: record.owner === 0 ? null : viewOf(record.owner)
      }
    });
  }

  ring.sent = ring.written;

  return details;
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
     * Creates the shader module and keeps its record: counted for the header and sent as a `shader` event, not a
     * compile of the frame.
     *
     * @param descriptor - The module descriptor.
     * @returns The module.
     */
    value: function countedModule(
      this: GPUDevice,
      descriptor: GPUShaderModuleDescriptor
    ): GPUShaderModule {
      const started = pageNow();
      const made = createShaderModule.call(this, descriptor);

      recordModule(sinks, pc.perf.frame, descriptor.label ?? null, pageNow() - started);

      return made;
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
