/**
 * @file input plugin — API factory. `app.input.*` is the same door the finger uses: it builds the
 * answer with the very same functions of `answers.ts` and hands it to `flow.gate`. It moves
 * nothing — no coordinates, no frames, no `Held`, no `settle` — so it works headless.
 */
import type { ComponentType } from "../world/types";
import { addTapListener, dropAnswer, notifyTap, submit, swipeAnswer, tapAnswer } from "./answers";
import {
  type CarryValue,
  Draggable,
  DropTarget,
  type IntentValue,
  Pressable,
  Swipeable,
  Tappable,
  Touchable
} from "./components";
import { resolveTarget } from "./hit";
import { addControl } from "./hover";
import { addKeyListener, runKeys } from "./keys";
import { withDeps } from "./lifecycle";
import type { Direction, InputApi, InputCtx, KernelSlice, Target } from "./types";

/** One resolved target: the entity and the component the gesture needs. */
type Found<Value extends object> = { entity: number; value: Readonly<Value> };

/**
 * Resolves a target and reads the component the gesture needs. A missing view or a missing
 * component is reported and answered with `undefined`; nothing throws and the gate is not called.
 *
 * @param ctx - Domain context of the input plugin.
 * @param target - What the caller pointed at.
 * @param component - The component the gesture reads.
 * @returns The entity and the component value, or `undefined`.
 */
function find<Value extends object>(
  ctx: InputCtx,
  target: Target,
  component: ComponentType<Value>
): Found<Value> | undefined {
  const entity = resolveTarget(ctx, target);
  const value = entity === undefined ? undefined : ctx.deps.world.ecs.get(entity, component);

  if (entity === undefined || value === undefined) {
    ctx.log.warn(`input: target has no ${component.componentName}`, { target });

    return undefined;
  }

  return { entity, value };
}

/**
 * Answers the intent of a component that names one: `Tappable` for a tap, `Pressable` for a long
 * press.
 *
 * @param ctx - Domain context of the input plugin.
 * @param target - What the caller pointed at.
 * @param component - The gesture component to read.
 * @returns What `flow.gate.answer` returned.
 */
function answerIntent(
  ctx: InputCtx,
  target: Target,
  component: ComponentType<IntentValue>
): boolean {
  const found = find(ctx, target, component);

  return found !== undefined && submit(ctx, found.entity, tapAnswer(found.value));
}

/**
 * Taps a view the way the finger does: the `onTap` listeners run first, then the `Tappable` is
 * answered. A view that carries only `Touchable` reaches the listeners and answers nothing, which
 * is what a ui button with local state does, so it is not reported as a mistake.
 *
 * @param ctx - Domain context of the input plugin.
 * @param target - What the caller pointed at.
 * @returns What `flow.gate.answer` returned.
 */
function answerTap(ctx: InputCtx, target: Target): boolean {
  const entity = resolveTarget(ctx, target);

  if (entity === undefined) {
    ctx.log.warn("input: target has no Tappable", { target });

    return false;
  }

  notifyTap(ctx, entity);

  const tappable = ctx.deps.world.ecs.get(entity, Tappable);

  if (tappable === undefined) {
    if (!ctx.deps.world.ecs.has(entity, Touchable)) {
      ctx.log.warn("input: target has no Tappable", { target });
    }

    return false;
  }

  return submit(ctx, entity, tapAnswer(tappable));
}

/**
 * Answers a drop: the source brings the payload, the destination names the intent.
 *
 * @param ctx - Domain context of the input plugin.
 * @param from - The view that is carried.
 * @param to - The view it is dropped on.
 * @returns What `flow.gate.answer` returned.
 */
function answerDrop(ctx: InputCtx, from: Target, to: Target): boolean {
  const carried: Found<CarryValue> | undefined = find(ctx, from, Draggable);

  if (carried === undefined) return false;

  const onto = find(ctx, to, DropTarget);

  return onto !== undefined && submit(ctx, carried.entity, dropAnswer(carried.value, onto.value));
}

/**
 * Answers a swipe: the component's intent with the direction added to the payload.
 *
 * @param ctx - Domain context of the input plugin.
 * @param target - What the caller pointed at.
 * @param direction - Which way the finger would have gone.
 * @returns What `flow.gate.answer` returned.
 */
function answerSwipe(ctx: InputCtx, target: Target, direction: Direction): boolean {
  const found = find(ctx, target, Swipeable);

  return found !== undefined && submit(ctx, found.entity, swipeAnswer(found.value, direction));
}

/**
 * Creates the input API: `app.input.tap`, `.press`, `.drag`, `.swipe`, `.onTap`, `.onKey`,
 * `.key`, `.cursor` and `.controls`.
 *
 * @param ctx - Kernel context of the input plugin.
 * @returns The plugin API.
 */
export function createInputApi(ctx: KernelSlice): InputApi {
  const inputCtx = withDeps(ctx);

  return {
    tap: target => answerTap(inputCtx, target),
    press: target => answerIntent(inputCtx, target, Pressable),
    drag: (from, to) => answerDrop(inputCtx, from, to),
    swipe: (target, direction) => answerSwipe(inputCtx, target, direction),
    onTap: fn => addTapListener(inputCtx.state, fn),
    onKey: fn => addKeyListener(inputCtx.state, fn),
    key: (key, options) => runKeys(inputCtx, { key, shift: options?.shift ?? false }),
    cursor: () => inputCtx.state.cursor ?? inputCtx.config.cursor.idle,
    controls: { add: component => addControl(inputCtx.state, component) }
  };
}
