/**
 * @file ui plugin — the ui sources of the `/inspect` door: the live screen as data, and where an
 * element or a view is on the page. Production-safe: every one only reads. `game.rect` stays until
 * the flow catalogue moves to `game.locate`, which answers the same numbers for a key.
 */
import { defineSource } from "../flow/doors/define";
import type { HeadlessApp } from "../flow/headless";
import type { ProjectionTarget } from "../input/target";
import { readTarget } from "../input/target";
import type { Api as RendererApi } from "../renderer/types";
import type { Api as WorldApi } from "../world/types";
import type { UiApi, UiNode } from "./types";
import { scaleByFits } from "./visual";

/** A rect: left, top, width and height. */
type Rect = UiNode["rect"];

/** The keyed node first, then every node above it up to the root. */
type Chain = [UiNode, ...UiNode[]];

/** What the key form needs of an app: the ui and the renderer's viewport. */
type KeyApp = HeadlessApp & { readonly ui: UiApi; readonly renderer: RendererApi };

/** What `game.locate` needs of an app: the ui, the renderer and the world's projection keys. */
type LocateApp = KeyApp & { readonly world: WorldApi };

/**
 * Finds a keyed node and the nodes above it.
 *
 * @param node - Where the search starts.
 * @param key - The key of the element.
 * @returns The node and its ancestors, nearest first, or `undefined` when no node has the key.
 */
function chainTo(node: UiNode, key: string): Chain | undefined {
  if (node.key === key) return [node];

  for (const child of node.children) {
    const chain = chainTo(child, key);

    if (chain !== undefined) {
      chain.push(node);

      return chain;
    }
  }

  return undefined;
}

/**
 * Where an element is drawn at rest, in root coordinates. Its rect in the snapshot is natural,
 * so every fitted node on the way up, the element itself included, scales it about its centre,
 * the way ui draws a `fit: "contain"`.
 *
 * @param chain - The element and its ancestors, nearest first.
 * @returns The drawn rect.
 */
function drawnRect(chain: Chain): Rect {
  return scaleByFits(
    chain[0].rect,
    chain.map(node => ({ rect: node.rect, fit: node.fitScale ?? 1 }))
  );
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
 * Where a live ui element is on the page: its layout box, scaled by every fitted element above
 * it, through the viewport.
 *
 * @param app - The app with ui and renderer.
 * @param key - The `key` prop of the element.
 * @returns The rect in CSS px, or `undefined` when no live element has the key.
 */
function locateKey(app: KeyApp, key: string): Rect | undefined {
  // eslint-disable-next-line unicorn/no-array-callback-reference, unicorn/prefer-array-some -- `ui.find` takes a key, not a callback.
  const onScreen = app.ui.find(key) !== undefined;
  const chain = onScreen ? chainTo(app.ui.tree(), key) : undefined;

  return chain === undefined ? undefined : onPage(app.renderer, drawnRect(chain));
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
 * Where an element is on the page, in CSS px: its layout box, so a bare button with no fill has
 * one, scaled by every fitted element above it, through the viewport. In reference units while
 * the renderer is inert. Replaced by `game.locate`, which answers the same numbers for a key.
 *
 * @example
 * ```ts
 * // An e2e script clicks Home's Play plank on a 390 px wide phone.
 * read(app, sources.rect, { key: "play" }); // { x: 101.9, y: 469.2, w: 189.2, h: 54.6 }
 * read(app, sources.rect, { key: "nothing" }); // undefined: not on screen
 * ```
 */
export const rectSource = defineSource({
  id: "game.rect",
  title: "Element rect",
  input: { key: "string" },
  changes: "frame",
  read: (app: KeyApp, { key }) => locateKey(app, key)
});

/**
 * Where something is on the page, in CSS px, by either of the two addresses the doors use: a ui
 * element by its `key` (its layout box, scaled by every fitted element above it, so a bare button
 * with no fill has one), or a view by its `target` projection key (the box the renderer draws for
 * it). Both go through the viewport, so the numbers are what Playwright clicks. In reference units
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
