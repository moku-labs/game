/**
 * @file anim plugin — API factory. It is a thin view on `ctx.state`: the same functions the
 * frame step and the `play` handler run on, so a choreography played from a test and one played
 * from a node are the same timeline.
 */
import { createRuntime, finishAllAnim, withDeps } from "./lifecycle";
import { startTimeline } from "./timeline/play";
import type {
  AnimApi,
  AnimationDefinition,
  KernelSlice,
  MarkListener,
  PlayHandle,
  SlotTags,
  SlotValues
} from "./types";

/**
 * Creates the anim API: `app.anim.play`, `finishAll`, `active`, `onMark`, `reducedMotion` and
 * `setReducedMotion`.
 *
 * @param ctx - Kernel context of the anim plugin.
 * @returns The plugin API.
 */
export function createAnimApi(ctx: KernelSlice): AnimApi {
  const actx = withDeps(ctx);
  const rt = createRuntime(actx);

  return {
    play: <Tags extends SlotTags>(
      animation: AnimationDefinition<Tags>,
      slots: SlotValues<Tags>
    ): PlayHandle => startTimeline(actx, rt, animation, slots),

    finishAll: (): void => finishAllAnim(actx, rt),

    active: (): number => actx.state.tracks.size,

    onMark: (fn: MarkListener): (() => void) => {
      actx.state.markListeners.add(fn);

      return (): void => {
        actx.state.markListeners.delete(fn);
      };
    },

    reducedMotion: (): boolean => actx.state.reducedMotion,

    setReducedMotion: (on: boolean): void => {
      actx.state.reducedMotion = on;
    }
  };
}
