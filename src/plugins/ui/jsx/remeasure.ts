/**
 * @file ui/jsx — the remeasure step: a text `text` wrote this frame is measured again, and its
 * root solves only when it takes another size. A bound text is written when the string it shows
 * changes; any text when `text` resolves it again, after a new locale or when its font arrives.
 * An icon without a size carries no `Text`: it is measured again when the line it is squared on
 * moved.
 */
import { Text } from "../../text/components";
import { Exiting } from "../../world/ecs/define";
import type { LayoutModule } from "../layout/types";
import type { UiCtx } from "../types";
import type { JsxState } from "./types";

/**
 * Asks for a solve of every root with a text that measures to another size now. `text` writes
 * `resolved` earlier in this phase: for a bound text when the string it shows changed, so a
 * counter that stands still walks nothing, and for every label it resolved again, a message after
 * a new locale or any label whose font arrived. No root is reconciled for it and no view runs. A
 * leaving text is out of the flow: its roll solves nothing.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state: the elements and their roots.
 * @param layout - The layout module, which measures the text again.
 */
export function markResizedTexts(ctx: UiCtx, state: JsxState, layout: LayoutModule): void {
  const ecs = ctx.deps.world.ecs;

  for (const entity of ecs.changed(Text)) {
    const element = state.elements.get(entity);
    const root = element === undefined ? undefined : state.roots.get(element.root);

    if (element === undefined || root === undefined || ecs.has(entity, Exiting)) continue;
    if (layout.remeasure(element)) root.needsSolve = true;
  }
}

/**
 * Asks for a solve of every root with an icon that takes another size now. An icon without a
 * size is square on one line of the `body` text style and carries no `Text`, so `text` never
 * names it. The layout reads that line once per call, and the icons are walked only when it
 * moved: the body font arrived, left or was replaced, with or without a text on the screen. A
 * leaving icon is out of the flow.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state: the elements and their roots.
 * @param layout - The layout module, which knows the line and measures the icon again.
 */
export function markResizedIcons(ctx: UiCtx, state: JsxState, layout: LayoutModule): void {
  if (!layout.iconLineMoved()) return;

  const ecs = ctx.deps.world.ecs;

  for (const element of state.elements.values()) {
    const root = state.roots.get(element.root);
    const isLiveIcon = element.type === "icon" && !ecs.has(element.entity, Exiting);

    if (!isLiveIcon || root === undefined) continue;
    if (layout.remeasure(element)) root.needsSolve = true;
  }
}
