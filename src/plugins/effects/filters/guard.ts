/**
 * @file effects/filters — the one guard around the apply of every filter the engine builds, and the one "broken"
 * state. Pixi's `FilterSystem.pop` has no `try/finally`: a throw out of an `apply` skips the return of every pooled
 * texture of the view, every frame. The guard is Pixi's own extension point, the `apply` method of a filter; nothing
 * of Pixi is patched or subclassed. A shader that does not compile, an apply that throws and a chain that fails all
 * lead here: one `effects:broken` line per kind and reason, the declared fallback drawn instead (or the view
 * unfiltered), a striped mark over the view in dev builds only, and never a blank frame.
 */
import type { PixiFilter, PixiFilterManager } from "../../renderer/types";
import type { EffectsCtx } from "../types";
import { createStandIn } from "./instance";
import type { FilterDefinition, FilterInstance, FilterKind } from "./types";

/** The input texture of an `apply`. */
type Input = Parameters<PixiFilter["apply"]>[1];

/** The output of an `apply`. */
type Output = Parameters<PixiFilter["apply"]>[2];

/** A Pixi filter whose `apply` the guard wraps: the instance's own, or one pass of a `Blur`. */
type Target = Pick<PixiFilter, "apply">;

/** Why a kind or an instance is broken. */
export type BrokenReason = "compile" | "apply" | "chain";

/** What an `effects:broken` line names besides the kind: the stage that failed, or the input whose chain did. */
type BrokenDetail = { readonly stage?: string; readonly input?: string };

/**
 * The message of what an apply or a chain threw.
 *
 * @param error - What was thrown.
 * @returns Its message.
 * @example
 * ```ts
 * messageOf(new Error("the device said no")); // "the device said no"
 * ```
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Logs `effects:broken` once per kind and reason per run, in every build, with the stage or the input that failed
 * and the id of the declared fallback.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param id - The kind id.
 * @param fallback - The kind's declared fallback, if any.
 * @param reason - Why it broke.
 * @param message - What failed, in words.
 * @param detail - The stage or the input that failed.
 */
export function logBroken(
  ectx: EffectsCtx,
  id: string,
  fallback: FilterDefinition | undefined,
  reason: BrokenReason,
  message: string,
  detail?: BrokenDetail
): void {
  const key = `broken:${reason}:${id}`;

  if (ectx.state.warned.has(key)) return;

  ectx.state.warned.add(key);
  ectx.log.error("effects:broken", {
    filter: id,
    reason,
    message,
    ...detail,
    ...(fallback === undefined ? {} : { fallback: fallback.id })
  });
}

/**
 * Breaks an instance for good: logs it once per kind and reason, then builds the stand-in that draws in its place
 * (its fallback, with the dev mark in a dev build). Without a stand-in the filter is switched off and the view draws
 * unfiltered; a stand-in that breaks in its turn gets no stand-in of its own.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance that broke.
 * @param kind - Its kind; `undefined` only for a kind the plugin does not know.
 * @param reason - `"apply"` or `"chain"`.
 * @param message - What was thrown, or what the chain did wrong.
 * @param detail - The input whose chain failed.
 */
export function breakInstance(
  ectx: EffectsCtx,
  instance: FilterInstance,
  kind: FilterKind | undefined,
  reason: BrokenReason,
  message: string,
  detail?: BrokenDetail
): void {
  instance.broken = true;

  const fallback = kind?.source === "wgsl" ? kind.definition.fallback : undefined;

  logBroken(ectx, instance.kindId, fallback, reason, message, detail);

  const pixi = ectx.deps.renderer.host.pixi();

  if (!instance.standIn && kind !== undefined && pixi !== undefined) {
    instance.replacement = createStandIn(ectx, pixi, kind, instance.value);
  }

  if (instance.replacement === undefined) instance.filter.enabled = false;
}

/**
 * Draws the input straight through in place of a broken instance with no stand-in: its switched-off filter goes to
 * Pixi's `applyFilter`, which draws its passthrough filter for a disabled one. A second throw is swallowed, so
 * nothing ever leaves the guard.
 *
 * @param manager - Pixi's filter system.
 * @param instance - The broken instance.
 * @param input - The input texture.
 * @param output - The output.
 * @param clearMode - Whether the output is cleared.
 */
function passThrough(
  manager: PixiFilterManager,
  instance: FilterInstance,
  input: Input,
  output: Output,
  clearMode: boolean
): void {
  try {
    manager.applyFilter(instance.filter, input, output, clearMode);
  } catch {
    // The view stays undrawn this frame; Pixi still gets every pooled texture back.
  }
}

/**
 * Draws what a broken instance shows: its stand-in, through the stand-in's own guarded apply, or the input straight
 * through. So the frame of a break already shows the stand-in or the unfiltered view, never nothing.
 *
 * @param instance - The broken instance.
 * @param manager - Pixi's filter system.
 * @param input - The input texture.
 * @param output - The output.
 * @param clearMode - Whether the output is cleared.
 */
export function drawBroken(
  instance: FilterInstance,
  manager: PixiFilterManager,
  input: Input,
  output: Output,
  clearMode: boolean
): void {
  if (instance.replacement === undefined) {
    passThrough(manager, instance, input, output, clearMode);

    return;
  }

  // The stand-in's own guarded apply: one of ours, or its pair with the dev mark.
  const target: Target = instance.replacement.filter;

  target.apply(manager, input, output, clearMode);
}

/**
 * Wraps the `apply` of one Pixi filter with an own property: an unbroken instance draws through the original, a throw
 * breaks it and draws what a broken one shows, a broken one draws that at once.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance the filter belongs to.
 * @param kind - Its kind.
 * @param target - The filter whose `apply` is wrapped.
 */
function guardTarget(
  ectx: EffectsCtx,
  instance: FilterInstance,
  kind: FilterKind,
  target: Target
): void {
  const original = target.apply.bind(target);

  target.apply = (
    manager: PixiFilterManager,
    input: Input,
    output: Output,
    clearMode: boolean
  ): void => {
    if (!instance.broken) {
      try {
        original(manager, input, output, clearMode);

        return;
      } catch (error) {
        breakInstance(ectx, instance, kind, "apply", messageOf(error));
      }
    }

    drawBroken(instance, manager, input, output, clearMode);
  };
}

/**
 * Guards the `apply` of an instance's Pixi filter, and for a `Blur` of its two passes too: a throw breaks the
 * instance for good and draws its stand-in or the input straight through in its place, so the view shows in this very
 * frame and Pixi gives every pooled texture back, and is logged once per kind.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance `createFilter` or `createStandIn` just built.
 * @param kind - The kind it draws for: the log line's id and the fallback.
 */
export function guardApply(ectx: EffectsCtx, instance: FilterInstance, kind: FilterKind): void {
  guardTarget(ectx, instance, kind, instance.filter);

  // A throw inside one pass still lets `BlurFilter.apply` reach the return of its temp texture.
  if (instance.kind === "blur") {
    guardTarget(ectx, instance, kind, instance.filter.blurXFilter);
    guardTarget(ectx, instance, kind, instance.filter.blurYFilter);
  }
}
