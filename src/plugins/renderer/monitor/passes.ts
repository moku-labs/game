/* eslint-disable unicorn/no-null -- a pass without a label is named `null` in the log (spec 11 R6.1). */
/**
 * @file renderer/monitor — the render passes of an agent build (R6). On WebGPU the counting encoder counts each pass
 * where Pixi begins it and hands it to the pass sink here, which records it in the pass ring and asks the GPU timer
 * for its timestamp writes. On WebGL there is no encoder: a pass is a bound render target, seen on Pixi's public
 * runners. Passes are counted only inside a frame. Kind: `canvas` for the root, `filter` while a filter applies,
 * `texture` otherwise; the label is the target's or its texture's, and a pooled filter target is named by the kind
 * being applied.
 */

import type { GpuTimer } from "./gpu-timer";
import { NO_STENCIL, writePass } from "./ring";
import { COUNT, type PassSink, type PassTarget, type PerfCtx } from "./types";
import { cell } from "./units";

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
 * @param target - The target the pass draws into.
 * @returns The kind's index.
 */
function kindOf(pc: PerfCtx, target: PassTarget): number {
  if (target.isRoot) return KIND.canvas;

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
 * Creates the WebGPU pass sink the counting encoder calls: each pass of a frame goes into the pass ring, with the
 * frame number and its index in the frame, and gets the timer's timestamp writes when there is a timer.
 *
 * @param pc - The perf context.
 * @param timer - The GPU timer of the application, or `undefined` without `timestamp-query`.
 * @returns The sink.
 */
export function createPassSink(pc: PerfCtx, timer: GpuTimer | undefined): PassSink {
  return {
    begin: (descriptor, target) => {
      const kind = kindOf(pc, target);
      const sequence = writePass(
        pc.perf.ring.passes,
        pc.perf.frame,
        cell(pc.sinks.counts, COUNT.passes) - 1,
        kind,
        descriptor.depthStencilAttachment === undefined ? 0 : 1,
        target.pixelWidth,
        target.pixelHeight,
        labelOf(pc, target, kind)
      );

      timer?.timePass(descriptor, sequence);
    },

    resolve: commandEncoder => timer?.resolve(commandEncoder)
  };
}

/**
 * Counts the WebGL passes of every frame on Pixi's public runners: a target change emitted by `bind` is one pass; at
 * `renderStart` (added after Pixi's systems, so the root is bound by then) the root is one pass when `bind` emitted
 * nothing, because the previous render call ended on the root. Only inside a frame. Stencil is not measured on WebGL.
 *
 * @param renderer - Pixi's WebGL renderer.
 * @param pc - The perf context.
 * @returns The remover.
 */
export function attachGlPasses(renderer: PassRenderer, pc: PerfCtx): () => void {
  const state = { changed: false };

  /**
   * Counts one bound target as a pass of the frame.
   *
   * @param target - The target.
   */
  const count = (target: PassTarget): void => {
    const { counts } = pc.sinks;
    const kind = kindOf(pc, target);
    const index = cell(counts, COUNT.passes);

    counts[COUNT.passes] = index + 1;
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

      if (pc.sinks.inFrame) count(target);
    }
  };
  const start = {
    /** The root is bound: one pass when no change was emitted for it. */
    renderStart: (): void => {
      if (pc.sinks.inFrame && !state.changed) count(renderer.renderTarget.renderTarget);
    }
  };

  renderer.runners.prerender.add(prerender);
  renderer.renderTarget.onRenderTargetChange.add(change);
  renderer.runners.renderStart.add(start);

  return (): void => {
    renderer.runners.prerender.remove(prerender);
    renderer.renderTarget.onRenderTargetChange.remove(change);
    renderer.runners.renderStart.remove(start);
  };
}
