/**
 * @file ui/layout — the visual half of `guide`: four dimmed rectangles around the target, leaving
 * a hole over it. The gate narrowing belongs to the runner; `ui` only draws.
 */
import type { FxHandler } from "../../flow/fx/types";
import {
  NineSlice,
  Shape,
  Sprite,
  Transform,
  type TransformValue
} from "../../renderer/components";
import { rootPoseOf } from "../../renderer/sync/pose";
import { Layer, Order } from "../../world/ecs/define";
import type { Entity } from "../../world/types";
import { Box, UI_OWNER } from "../components";
import type { UiCtx } from "../types";
import { visualRectOf } from "../visual";
import type { ElementLookup, Rect } from "./types";

/** How dark the four rectangles around the hole are. */
const DIM_ALPHA = 0.6;

/** Where the guide is drawn: above every popup root of the `ui` layer. */
const GUIDE_ORDER = 1_000_000;

/**
 * Reads the target a guide names out of its payload.
 *
 * @param payload - What `guide()` put in the descriptor.
 * @returns The projection and key, or `undefined` when the guide names no target.
 * @example
 * ```ts
 * readTarget({ target: { projection: "hud", key: "play" } })?.key; // "play"
 * ```
 */
export function readTarget(payload: unknown): { projection: string; key: string } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;

  const target = (payload as { target?: unknown }).target;

  if (typeof target !== "object" || target === null) return undefined;

  const record = target as { projection?: unknown; key?: unknown };

  if (typeof record.projection !== "string" || typeof record.key !== "string") return undefined;

  return { projection: record.projection, key: record.key };
}

/**
 * Where a local box of a view lands in root space: moved by the pose, scaled around its pivot.
 * A guide hole is axis-aligned, so the rotation is left out.
 *
 * @param pose - The root pose of the view, `rootPoseOf` of `renderer`.
 * @param local - The box in the view's local units.
 * @returns The rect in root coordinates.
 * @example
 * ```ts
 * drawnRect({ x: 200, y: 200, rotation: 0, scale: 0.8, pivot: { x: 250, y: 250 } },
 *   { x: 50, y: 50, w: 100, h: 100 }); // { x: 40, y: 40, w: 80, h: 80 }
 * ```
 */
export function drawnRect(pose: Readonly<TransformValue>, local: Rect): Rect {
  return {
    x: pose.x + pose.scale * (local.x - pose.pivot.x),
    y: pose.y + pose.scale * (local.y - pose.pivot.y),
    w: local.w * pose.scale,
    h: local.h * pose.scale
  };
}

/**
 * The rect of the view a guide points at: where a ui element is drawn (its `Box` scaled by every
 * fitted element on the way up), the `Box` of an element the lookup does not know, else where a
 * view is drawn: its pose composed through the `Parent` chain (a view a ui slot hosts sits in the
 * slot's space) with the size of its panel or its sprite. A sprite of size 0 is drawn at its
 * texture's size, which `ui` does not know: its hole has size 0.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param entity - The entity the target named.
 * @param lookup - How an entity becomes its ui element; nothing for a view `ui` does not own.
 * @returns The rect, or `undefined` when the view carries no size.
 */
export function rectOfTarget(ctx: UiCtx, entity: Entity, lookup?: ElementLookup): Rect | undefined {
  const element = lookup?.(entity);

  if (element !== undefined && lookup !== undefined) return visualRectOf(element, lookup);

  const ecs = ctx.deps.world.ecs;
  const box = ecs.get(entity, Box);

  if (box !== undefined) return { x: box.x, y: box.y, w: box.w, h: box.h };
  if (!ecs.has(entity, Transform)) return undefined;

  const pose = rootPoseOf(ecs, entity);
  const panel = ecs.get(entity, NineSlice);

  if (panel !== undefined) return drawnRect(pose, { x: 0, y: 0, w: panel.width, h: panel.height });

  const sprite = ecs.get(entity, Sprite);

  if (sprite === undefined) return undefined;

  const { anchor, width, height } = sprite;

  return drawnRect(pose, { x: -anchor.x * width, y: -anchor.y * height, w: width, h: height });
}

/**
 * The four rectangles that cover the screen except the hole.
 *
 * @param screen - The viewport rect.
 * @param hole - The rect left uncovered, or nothing for a full dim.
 * @returns Between one and four rectangles.
 * @example
 * ```ts
 * dimRects({ x: 0, y: 0, w: 100, h: 100 }, undefined).length; // 1
 * ```
 */
export function dimRects(screen: Rect, hole: Rect | undefined): Rect[] {
  if (hole === undefined) return [screen];

  return [
    { x: 0, y: 0, w: screen.w, h: hole.y },
    { x: 0, y: hole.y + hole.h, w: screen.w, h: Math.max(0, screen.h - hole.y - hole.h) },
    { x: 0, y: hole.y, w: hole.x, h: hole.h },
    { x: hole.x + hole.w, y: hole.y, w: Math.max(0, screen.w - hole.x - hole.w), h: hole.h }
  ];
}

/**
 * Builds the `guide` handler. It returns at once: the node continues while the dim stays on
 * screen, and the root leaves when the narrow is lifted.
 *
 * @param ctx - Domain context of the ui plugin.
 * @returns The handler `flow.fx.handle("guide", ...)` takes.
 */
export function createGuideHandler(ctx: UiCtx): FxHandler {
  return (descriptor, { signal, mode }) => {
    if (mode === "fast") return;

    const ecs = ctx.deps.world.ecs;
    const target = readTarget(descriptor.payload);
    const entity = target
      ? ctx.deps.world.projection.entityOf(target.projection, target.key)
      : undefined;
    const lookup: ElementLookup = element => ctx.state.jsx.elements.get(element);
    const hole = entity === undefined ? undefined : rectOfTarget(ctx, entity, lookup);

    if (target !== undefined && hole === undefined) ctx.log.warn("ui:guide-target-missing", target);

    const size = ctx.deps.renderer.viewport.size();
    const screen: Rect = { x: 0, y: 0, w: size.width, h: size.height };
    const spawned = dimRects(screen, hole).map(rect =>
      ecs.spawn(UI_OWNER, [
        Layer({ name: "ui" }),
        Order({ value: GUIDE_ORDER }),
        Transform({ x: rect.x, y: rect.y }),
        Shape({ w: rect.w, h: rect.h, fill: 0x00_00_00, alpha: DIM_ALPHA })
      ])
    );

    signal.addEventListener(
      "abort",
      () => {
        for (const dim of spawned) ecs.despawn(dim);
      },
      { once: true }
    );
  };
}
