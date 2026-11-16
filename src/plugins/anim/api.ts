/**
 * @file anim plugin — API factory. It is a thin view on `ctx.state`: the same functions the
 * frame step and the `play` handler run on, so a choreography played from a test and one played
 * from a node are the same timeline.
 */
import { createRuntime, finishAllAnim, withDeps } from "./lifecycle";
import { startTimeline } from "./timeline/play";
import { snapshotOf } from "./timeline/ring";
import type {
  AnimApi,
  AnimationDefinition,
  AnyAnimationDefinition,
  KernelSlice,
  MarkListener,
  PlayHandle,
  SlotTags,
  SlotValues,
  TimelinesSnapshot
} from "./types";

/**
 * Creates the anim API: `app.anim.play`, `finishAll`, `active`, `timelines`, `onMark`, `reducedMotion`,
 * `setReducedMotion` and `replace`.
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

    timelines: (): TimelinesSnapshot => snapshotOf(actx.state),

    onMark: (fn: MarkListener): (() => void) => {
      actx.state.markListeners.add(fn);

      return (): void => {
        actx.state.markListeners.delete(fn);
      };
    },

    reducedMotion: (): boolean => actx.state.reducedMotion,

    setReducedMotion: (on: boolean): void => {
      actx.state.reducedMotion = on;
    },

    replace: (definition: AnyAnimationDefinition): void => {
      if (!actx.state.registry.has(definition.id)) {
        throw new Error(
          `[game] Animation "${definition.id}" is not registered.\n` +
            "  Register it before replacing it."
        );
      }

      actx.state.registry.set(definition.id, definition);
    }
  };
}
