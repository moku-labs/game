/**
 * @file The click of every control (design §4). One small plugin hears every tap and plays
 * `ui.click` when the tapped view is a control: it carries `Tappable` (it names an intent) or
 * `LocalWrite` (it writes local state, like a settings tab). A panel that only swallows the tap
 * carries `Touchable` alone, and so does a disabled control: both stay silent. The sound goes
 * through `flow.fx`, so no node plays a click and a game without `audio` hears nothing.
 */
import type { World } from "@moku-labs/game";
import {
  createPlugin,
  flowPlugin,
  inputPlugin,
  LocalWrite,
  sfx,
  Tappable,
  worldPlugin
} from "@moku-labs/game";

/**
 * Whether a tapped view is a control, which clicks when it is tapped.
 *
 * @param ecs - The world the view lives in.
 * @param entity - The view `input.onTap` reported.
 * @returns True for a view with `Tappable` or `LocalWrite`.
 */
export function isControl(ecs: World.EcsApi, entity: World.Entity): boolean {
  return ecs.has(entity, Tappable) || ecs.has(entity, LocalWrite);
}

/**
 * The click of every control: on start it adds one `input.onTap` listener, which runs before the
 * tap is answered. `input` drops its listeners when it stops.
 */
export const soundsPlugin = createPlugin("sounds", {
  depends: [flowPlugin, inputPlugin, worldPlugin],
  onStart: ctx => {
    const { ecs } = ctx.require(worldPlugin);
    const flow = ctx.require(flowPlugin);

    ctx.require(inputPlugin).onTap(entity => {
      if (isControl(ecs, entity)) flow.fx.dispatch(sfx("ui.click"));
    });
  }
});
