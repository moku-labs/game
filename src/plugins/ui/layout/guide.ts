/**
 * @file ui/layout — the visual half of `guide`: four dimmed rectangles around the target, leaving
 * a hole over it. The gate narrowing belongs to the runner; `ui` only draws.
 */
import type { FxHandler } from "../../flow/fx/types";
import { NineSlice, Shape, Sprite, Transform } from "../../renderer/components";
import { Layer, Order } from "../../world/ecs/define";
import type { Entity } from "../../world/types";
import { Box, UI_OWNER } from "../components";
import type { UiCtx } from "../types";
import type { Rect } from "./types";

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
 * The rect of the view a guide points at: its `Box` when it is a ui element, else its transform
 * with the size of its sprite or panel.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param entity - The entity the target named.
 * @returns The rect, or `undefined` when the view carries no size.
 */
export function rectOfTarget(ctx: UiCtx, entity: Entity): Rect | undefined {
  const ecs = ctx.deps.world.ecs;
  const box = ecs.get(entity, Box);

  if (box !== undefined) return { x: box.x, y: box.y, w: box.w, h: box.h };

  const transform = ecs.get(entity, Transform);

  if (transform === undefined) return undefined;

  const panel = ecs.get(entity, NineSlice);

  if (panel !== undefined) {
    return { x: transform.x, y: transform.y, w: panel.width, h: panel.height };
  }

  return ecs.has(entity, Sprite) ? { x: transform.x, y: transform.y, w: 0, h: 0 } : undefined;
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
    const hole = entity === undefined ? undefined : rectOfTarget(ctx, entity);

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
