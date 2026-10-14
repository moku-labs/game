/**
 * @file effects/filters — the one guard around the apply of every filter the engine builds.
 * Pixi's `FilterSystem.pop` has no `try/finally`: a throw out of an `apply` skips the return of
 * every pooled texture of the view, every frame. The guard is Pixi's own extension point, the
 * `apply` method of a filter; nothing of Pixi is patched or subclassed.
 */
import type { PixiFilter } from "../../renderer/types";
import type { EffectsCtx } from "../types";
import type { FilterInstance } from "./types";

/** Pixi's filter system, as a guarded `apply` gets it. */
type Manager = Parameters<PixiFilter["apply"]>[0];

/** The input texture of an `apply`. */
type Input = Parameters<PixiFilter["apply"]>[1];

/** The output of an `apply`. */
type Output = Parameters<PixiFilter["apply"]>[2];

/** A Pixi filter whose `apply` the guard wraps: the instance's own, or one pass of a `Blur`. */
type Target = Pick<PixiFilter, "apply">;

/**
 * Draws the input straight through in place of a broken instance: its switched-off filter goes
 * to Pixi's `applyFilter`, which draws its passthrough filter for a disabled one. A second throw
 * is swallowed, so nothing ever leaves the guard.
 *
 * @param manager - Pixi's filter system.
 * @param instance - The broken instance.
 * @param input - The input texture.
 * @param output - The output.
 * @param clearMode - Whether the output is cleared.
 */
function passThrough(
  manager: Manager,
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
 * Switches an instance off for good and logs `effects:broken` once per kind per run.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance whose apply threw.
 * @param id - The kind id.
 * @param error - What the apply threw.
 */
function breakInstance(
  ectx: EffectsCtx,
  instance: FilterInstance,
  id: string,
  error: unknown
): void {
  instance.broken = true;
  instance.filter.enabled = false;

  const key = `broken:apply:${id}`;

  if (ectx.state.warned.has(key)) return;

  ectx.state.warned.add(key);
  ectx.log.error("effects:broken", {
    filter: id,
    reason: "apply",
    message: error instanceof Error ? error.message : String(error)
  });
}

/**
 * Wraps the `apply` of one Pixi filter with an own property: an unbroken instance draws through
 * the original, a throw breaks it and draws the input straight through, a broken one draws
 * straight through at once.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance the filter belongs to.
 * @param id - The kind id.
 * @param target - The filter whose `apply` is wrapped.
 */
function guardTarget(ectx: EffectsCtx, instance: FilterInstance, id: string, target: Target): void {
  const original = target.apply.bind(target);

  target.apply = (manager: Manager, input: Input, output: Output, clearMode: boolean): void => {
    if (!instance.broken) {
      try {
        original(manager, input, output, clearMode);

        return;
      } catch (error) {
        breakInstance(ectx, instance, id, error);
      }
    }

    passThrough(manager, instance, input, output, clearMode);
  };
}

/**
 * Guards the `apply` of an instance's Pixi filter, and for a `Blur` of its two passes too: a throw switches the
 * instance off for good, draws the input straight through in its place, so the view shows unfiltered in this very
 * frame and Pixi gives every pooled texture back, and is logged once per kind.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param instance - The instance `createFilter` just built.
 * @param id - The kind id, for the log line.
 */
export function guardApply(ectx: EffectsCtx, instance: FilterInstance, id: string): void {
  guardTarget(ectx, instance, id, instance.filter);

  // A throw inside one pass still lets `BlurFilter.apply` reach the return of its temp texture.
  if (instance.kind === "blur") {
    guardTarget(ectx, instance, id, instance.filter.blurXFilter);
    guardTarget(ectx, instance, id, instance.filter.blurYFilter);
  }
}
