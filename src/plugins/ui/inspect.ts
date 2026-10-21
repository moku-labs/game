/**
 * @file ui plugin — the ui sources of the `/inspect` door: the live screen as data, and where an
 * element or a view is on the page. Production-safe: every one only reads.
 */
import { defineSource } from "../flow/doors/define";
import type { HeadlessApp } from "../flow/headless";
import type { ProjectionTarget } from "../input/target";
import { readTarget } from "../input/target";
import { NineSlice, Shape } from "../renderer/components";
import { parentOf, rootPoseOf } from "../renderer/sync/pose";
import type { Api as RendererApi } from "../renderer/types";
import type { Entity, Api as WorldApi } from "../world/types";
import { Box } from "./components";
import type { UiApi, UiNode } from "./types";
import { drawnRect as poseRect } from "./visual";

/** How deep a parent chain is followed for clips; deeper is treated as a loop. */
const MAX_DEPTH = 32;

/** A rect: left, top, width and height. */
type Rect = UiNode["rect"];

/** What `game.locate` needs of an app: the ui, the renderer's viewport and the world's poses and projection keys. */
type LocateApp = HeadlessApp & {
  readonly ui: UiApi;
  readonly renderer: RendererApi;
  readonly world: WorldApi;
};

/**
 * Where a box of an entity's own space lands in root space: `0, 0, w, h` through its root pose,
 * which composes every `Transform` up its `Parent` chain (a scroll's offset, a fit, a slot, a
 * motion). The rotation is left out, as the guide does.
 *
 * @param ecs - The world read.
 * @param entity - The entity.
 * @param w - The width of the box in the entity's own units.
 * @param h - The height of the box.
 * @returns The rect in root coordinates.
 */
function rootBoxOf(ecs: WorldApi["ecs"], entity: Entity, w: number, h: number): Rect {
  return poseRect(rootPoseOf(ecs, entity), { x: 0, y: 0, w, h });
}

/**
 * The box an entity clips its children to, the way the renderer masks them: the `width × height`
 * of a clipping `NineSlice`, the `w × h` of a clipping `Shape`, in root coordinates.
 *
 * @param ecs - The world read.
 * @param entity - The entity.
 * @returns The clip in root coordinates, or `undefined` when the entity clips nothing.
 */
function clipOf(ecs: WorldApi["ecs"], entity: Entity): Rect | undefined {
  const panel = ecs.get(entity, NineSlice);

  if (panel?.clip === true) return rootBoxOf(ecs, entity, panel.width, panel.height);

  const shape = ecs.get(entity, Shape);

  return shape?.clip === true ? rootBoxOf(ecs, entity, shape.w, shape.h) : undefined;
}

/**
 * The part of a rect inside another.
 *
 * @param rect - The rect to cut.
 * @param clip - The rect it is cut to.
 * @returns The overlap, or `undefined` when they do not overlap.
 */
function intersect(rect: Rect, clip: Rect): Rect | undefined {
  const x = Math.max(rect.x, clip.x);
  const y = Math.max(rect.y, clip.y);
  const right = Math.min(rect.x + rect.w, clip.x + clip.w);
  const bottom = Math.min(rect.y + rect.h, clip.y + clip.h);

  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : undefined;
}

/**
 * Where an element is drawn, in root coordinates: its `Box` size through its root pose, cut by
 * every clipping entity above it (a `scroll`, an `overflow: "hidden"`), as the renderer masks it.
 * Its own clip masks only its children, so it never cuts the element itself.
 *
 * @param ecs - The world read.
 * @param entity - The element's entity.
 * @returns The drawn rect, or `undefined` when no part of it shows: cut away by a clip, or drawn
 *   at no size (an element entering from scale 0), as `renderer.sync.boundsOf` answers a view.
 */
function drawnRectOf(ecs: WorldApi["ecs"], entity: Entity): Rect | undefined {
  const box = ecs.get(entity, Box);

  if (box === undefined) return undefined;

  const own = rootBoxOf(ecs, entity, box.w, box.h);
  let drawn: Rect | undefined = own.w > 0 && own.h > 0 ? own : undefined;

  for (
    let above = parentOf(ecs, entity), depth = 0;
    above !== 0 && drawn !== undefined && depth < MAX_DEPTH;
    above = parentOf(ecs, above), depth += 1
  ) {
    const clip = clipOf(ecs, above);

    if (clip !== undefined) drawn = intersect(drawn, clip);
  }

  return drawn;
}

/**
 * Maps a rect in reference units to CSS px of the page through both of its corners.
 *
 * @param renderer - The renderer, for its viewport.
 * @param rect - The rect in reference units.
 * @returns The rect in CSS px; the same numbers while the renderer is inert.
 */
function onPage(renderer: RendererApi, rect: Rect): Rect {
  const topLeft = renderer.viewport.toScreen({ x: rect.x, y: rect.y });
  const bottomRight = renderer.viewport.toScreen({ x: rect.x + rect.w, y: rect.y + rect.h });

  return {
    x: topLeft.x,
    y: topLeft.y,
    w: bottomRight.x - topLeft.x,
    h: bottomRight.y - topLeft.y
  };
}

/**
 * Where a live ui element is on the page: where it is drawn (its layout box through its root pose,
 * so a scroll's offset, a fit and a slot move it), cut by every clipping element above it,
 * through the viewport.
 *
 * @param app - The app with ui, renderer and world.
 * @param key - The `key` prop of the element.
 * @returns The rect in CSS px, or `undefined` when no live element has the key or a clip above
 *   hides all of it.
 */
function locateKey(app: LocateApp, key: string): Rect | undefined {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);
  const drawn = entity === undefined ? undefined : drawnRectOf(app.world.ecs, entity);

  return drawn === undefined ? undefined : onPage(app.renderer, drawn);
}

/**
 * Where a view is on the page: the box the renderer draws for the entity of its projection key,
 * through the viewport.
 *
 * @param app - The app with ui, renderer and world.
 * @param target - The projection key of the view.
 * @returns The rect in CSS px, or `undefined` when the view is not live or has no drawn box.
 */
function locateTarget(app: LocateApp, target: ProjectionTarget): Rect | undefined {
  const entity = app.world.projection.entityOf(target.projection, target.key);
  const bounds = entity === undefined ? undefined : app.renderer.sync.boundsOf(entity);

  if (bounds === undefined) return undefined;

  return onPage(app.renderer, { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height });
}

/**
 * The live screen as plain data: every root, every element with its natural rect, its style,
 * its state flags and the fit scale of a fitted one.
 *
 * @example
 * ```ts
 * // The editor's tree panel lists the HUD.
 * read(app, sources.ui).children.map(child => child.key); // ["coins", "settings", "order"]
 * ```
 */
export const uiSource = defineSource({
  id: "game.ui",
  title: "UI tree",
  input: {},
  changes: "frame",
  read: (app: HeadlessApp & { readonly ui: UiApi }) => app.ui.tree()
});

/**
 * Where something is on the page, in CSS px, by either of the two addresses the doors use: a ui
 * element by its `key` (its layout box through its drawn pose, so a scroll's offset and a fit move
 * it and a bare button with no fill has one, cut by every clip above it), or a view by its `target`
 * projection key (the box the renderer draws for it). Both go through the viewport, so the numbers are what Playwright clicks. In reference units
 * while the renderer is inert; a view has no drawn box then.
 *
 * @example
 * ```ts
 * // An e2e script clicks Home's Play plank on a 390 px wide phone.
 * read(app, sources.locate, { key: "play" }); // { x: 101.9, y: 469.2, w: 189.2, h: 54.6 }
 * // An agent finds the coin c7 before it drags it: 64 x 64 u, drawn at (540, 300).
 * read(app, sources.locate, { target: { projection: "board.items", key: "c7" } });
 * // { x: 183.4, y: 96.8, w: 23.1, h: 23.1 }; undefined while nothing draws it
 * ```
 */
export const locateSource = defineSource({
  id: "game.locate",
  title: "Locate",
  input: { key: "string?", target: "json?" },
  changes: "frame",
  read: (app: LocateApp, { key, target }): Rect | undefined => {
    if (key !== undefined && target === undefined) return locateKey(app, key);
    if (target !== undefined && key === undefined) return locateTarget(app, readTarget(target));

    throw new Error(
      "[game] game.locate takes a key or a target.\n  Pass exactly one of { key } and { target }."
    );
  }
});
