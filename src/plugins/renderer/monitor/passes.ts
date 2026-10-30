/* eslint-disable unicorn/no-null -- a pass without a label is named `null` in the log (spec 11 R6.1). */
/**
 * @file renderer/monitor — the render passes of an agent build (R6). On WebGPU the counting encoder counts each pass
 * where Pixi begins it and hands it to the pass sink here, which records it in the pass ring and asks the GPU timer
 * for its timestamp writes. On WebGL there is no encoder: a pass is a bound render target, seen on Pixi's public
 * runners. Passes are counted only inside a frame. Kind: `canvas` for the canvas, `filter` while a filter applies,
 * `texture` otherwise; the label is the target's or its texture's, and a pooled filter target is named by the kind
 * being applied. On WebGPU the canvas is the view's render target, kept at attach and compared by identity: Pixi 8.22
 * marks every WebGPU target `isRoot` when it first binds it. On WebGL `isRoot` is the canvas's alone. Each pass also
 * gets its detail: the entity whose filter draws it and the filter's kind, the draw count of the frame when it began
 * (WebGPU), and its target's format and resolution. A canvas pass is counted apart (`COUNT.canvas`): on WebGPU where the
 * lazy canvas pass really begins it, which also names the reason in the ring's `restart` column, on WebGL at every bind
 * of the canvas, its reason not known.
 */

import type { GpuTimer } from "./gpu-timer";
import { NO_STENCIL, writePass, writePassDetail } from "./ring";
import {
  COUNT,
  type MonitorSinks,
  type PassSink,
  type PassTarget,
  type PerfCtx,
  SECTION
} from "./types";
import { cellF64 } from "./units";

/** The pass kinds by index: canvas, texture, filter. */
const KIND = { canvas: 0, texture: 1, filter: 2 } as const;

/**
 * A runner of Pixi's renderer: items are objects with a method of the runner's name.
 */
type Runner = { add(item: object): unknown; remove(item: object): unknown };

/**
 * What the WebGL pass count needs of Pixi's WebGL renderer: three public runners and the bound target.
 */
export type PassRenderer = {
  readonly runners: { readonly prerender: Runner; readonly renderStart: Runner };
  readonly renderTarget: {
    readonly onRenderTargetChange: Runner;
    readonly renderTarget: PassTarget;
  };
};

/**
 * The kind of a pass by the rule of R6.1.
 *
 * @param pc - The perf context.
 * @param canvas - The pass draws into the canvas.
 * @returns The kind's index.
 */
function kindOf(pc: PerfCtx, canvas: boolean): number {
  if (canvas) return KIND.canvas;

  return pc.sinks.filterDepth > 0 ? KIND.filter : KIND.texture;
}

/**
 * The label of a pass: the target's, its texture's, or for a filter pass on an unlabelled pooled target the kind
 * being applied (an interned string: no allocation). An empty label names nothing.
 *
 * @param pc - The perf context.
 * @param target - The target.
 * @param kind - The pass kind.
 * @returns The label, or `null`.
 */
function labelOf(pc: PerfCtx, target: PassTarget, kind: number): string | null {
  const own = target.label || target.colorTexture?.label;

  if (own) return own;

  return kind === KIND.filter ? (pc.sinks.kindNames[pc.sinks.filterKind] ?? null) : null;
}

/**
 * Writes the detail of the pass just recorded: for a filter pass the owner and the 1-based kind of the apply running
 * now, the frame's draws so far, the target's format and resolution.
 *
 * @param pc - The perf context.
 * @param target - The target.
 * @param kind - The pass kind.
 */
function writeDetail(pc: PerfCtx, target: PassTarget, kind: number): void {
  const { sinks } = pc;
  const filter = kind === KIND.filter;

  writePassDetail(
    pc.perf.ring.passes,
    filter ? sinks.filterOwner : 0,
    filter ? sinks.filterKind + 1 : 0,
    sinks.draws.frame,
    target.colorTexture?.source
  );
}

/**
 * Writes why the canvas pass just begun began into its slot of the pass ring: the counting encoder wrote the slot when
 * the pass began, before the lazy canvas pass told the monitor. Only while the slot was written: with the `passes`
 * section off the newest slot is an older pass's.
 *
 * @param pc - The perf context.
 * @param restart - The reason, an index into `CANVAS_RESTARTS`.
 */
export function noteRestart(pc: PerfCtx, restart: number): void {
  const { sinks } = pc;

  if (sinks.passes === undefined || (sinks.sections & SECTION.passes) === 0) return;

  const { passes } = pc.perf.ring;

  passes.restart[passes.newest] = restart;
}

/**
 * Creates the WebGPU pass sink the counting encoder calls: each pass of a frame goes into the pass ring, with the
 * frame number and its index in the frame, while the `passes` section is on, and gets the timer's timestamp writes
 * when there is a timer and the `gpu` section is on (a pass the ring does not keep has the number -1).
 *
 * @param pc - The perf context.
 * @param timer - The GPU timer of the application, or `undefined` without `timestamp-query`.
 * @param canvas - The application's canvas target, `renderer.view.renderTarget`; `undefined` without an application.
 * @returns The sink.
 */
export function createPassSink(
  pc: PerfCtx,
  timer: GpuTimer | undefined,
  canvas: PassTarget | undefined
): PassSink {
  return {
    begin: (descriptor, target) => {
      const { sections } = pc.sinks;
      let sequence = -1;

      if ((sections & SECTION.passes) !== 0) {
        const kind = kindOf(pc, target === canvas);

        sequence = writePass(
          pc.perf.ring.passes,
          pc.perf.frame,
          cellF64(pc.sinks.counts, COUNT.passes) - 1,
          kind,
          descriptor.depthStencilAttachment === undefined ? 0 : 1,
          target.pixelWidth,
          target.pixelHeight,
          labelOf(pc, target, kind)
        );
        writeDetail(pc, target, kind);
      }

      if ((sections & SECTION.gpu) !== 0) timer?.timePass(descriptor, sequence);
    },

    resolve: commandEncoder => timer?.resolve(commandEncoder)
  };
}

/**
 * Counts the WebGL passes of every frame on Pixi's public runners: a target change emitted by `bind` is one pass; at
 * `renderStart` (added after Pixi's systems, so the root is bound by then) the root is one pass when `bind` emitted
 * nothing, because the previous render call ended on the root. A pass on the canvas counts as a canvas pass too. Only
 * inside a frame. Every build counts (F8); `record` also writes each pass into the ring of an agent build. Stencil is
 * not measured on WebGL.
 *
 * @param renderer - Pixi's WebGL renderer.
 * @param sinks - The sinks the count goes into.
 * @param record - Writes the pass with its index in the frame; an agent build's ring, `undefined` elsewhere.
 * @returns The remover.
 */
export function countGlPasses(
  renderer: PassRenderer,
  sinks: MonitorSinks,
  record?: (target: PassTarget, index: number) => void
): () => void {
  const state = { changed: false };

  /**
   * Counts one bound target as a pass of the frame.
   *
   * @param target - The target.
   */
  const count = (target: PassTarget): void => {
    const { counts } = sinks;
    const index = cellF64(counts, COUNT.passes);

    counts[COUNT.passes] = index + 1;
    if (target.isRoot) counts[COUNT.canvas] = cellF64(counts, COUNT.canvas) + 1;
    record?.(target, index);
  };
  const prerender = {
    /** A render call starts: no target changed yet. */
    prerender: (): void => {
      state.changed = false;
    }
  };
  const change = {
    /**
     * A new target is bound.
     *
     * @param target - The target bound now.
     */
    onRenderTargetChange: (target: PassTarget): void => {
      state.changed = true;

      if (sinks.inFrame) count(target);
    }
  };
  const start = {
    /** The root is bound: one pass when no change was emitted for it. */
    renderStart: (): void => {
      if (sinks.inFrame && !state.changed) count(renderer.renderTarget.renderTarget);
    }
  };

  sinks.measuring = true;
  renderer.runners.prerender.add(prerender);
  renderer.renderTarget.onRenderTargetChange.add(change);
  renderer.runners.renderStart.add(start);

  return (): void => {
    renderer.runners.prerender.remove(prerender);
    renderer.renderTarget.onRenderTargetChange.remove(change);
    renderer.runners.renderStart.remove(start);
  };
}

/**
 * Counts and records the WebGL passes of an agent build: `countGlPasses` with each pass written into the ring, with
 * its kind and its label, while the `passes` section is on.
 *
 * @param renderer - Pixi's WebGL renderer.
 * @param pc - The perf context.
 * @returns The remover.
 */
export function attachGlPasses(renderer: PassRenderer, pc: PerfCtx): () => void {
  return countGlPasses(renderer, pc.sinks, (target, index) => {
    if ((pc.sinks.sections & SECTION.passes) === 0) return;

    const kind = kindOf(pc, target.isRoot);

    writePass(
      pc.perf.ring.passes,
      pc.perf.frame,
      index,
      kind,
      NO_STENCIL,
      target.pixelWidth,
      target.pixelHeight,
      labelOf(pc, target, kind)
    );
    writeDetail(pc, target, kind);
  });
}
