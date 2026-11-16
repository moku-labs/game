/**
 * @file ui plugin — the fixture of the perf test and bench of an overlay's fade from its mount frame (F205). Not a
 * test file. The level is written into a stub world: the measure is the catch-up itself, once per overlay mount.
 */
import type { TweenOptions } from "../../../world/projection/types";
import { fadeFromMount } from "../../jsx/overlay";
import type { Element } from "../../jsx/types";
import type { UiCtx } from "../../types";

/** The level track of a `fade: 120` overlay with no motion of its own. */
const FADE: TweenOptions = Object.freeze({ ms: 120, ease: "out", reduced: "keep" });

/**
 * The catch-up of a fading overlay's level in its mount frame of 16.7 ms.
 *
 * @returns The call `enterOverlay` makes once per mount.
 */
export function fadeMount(): () => void {
  const ecs = { set: (): void => undefined };
  const ctx = { deps: { world: { ecs } } } as unknown as UiCtx;
  const element = { entity: 7 } as unknown as Element;

  return () => {
    fadeFromMount(ctx, element, FADE, 16.7);
  };
}
