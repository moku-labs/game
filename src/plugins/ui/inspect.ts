/**
 * @file ui plugin — the ui sources of the `/inspect` door: the live screen as data and the rect
 * of one element on the page. Production-safe: both only read.
 */
import { defineSource } from "../flow/doors/define";
import type { HeadlessApp } from "../flow/headless";
import type { Api as RendererApi } from "../renderer/types";
import type { UiApi, UiNode } from "./types";

/** A rect: left, top, width and height. */
type Rect = UiNode["rect"];

/** The keyed node first, then every node above it up to the root. */
type Chain = [UiNode, ...UiNode[]];

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
  let rect: Rect = { ...chain[0].rect };

  for (const above of chain) {
    const fit = above.fitScale ?? 1;

    if (fit === 1) continue;

    const centre = { x: above.rect.x + above.rect.w / 2, y: above.rect.y + above.rect.h / 2 };

    rect = {
      x: centre.x + fit * (rect.x - centre.x),
      y: centre.y + fit * (rect.y - centre.y),
      w: rect.w * fit,
      h: rect.h * fit
    };
  }

  return rect;
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
 * the renderer is inert.
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
  read: (app: HeadlessApp & { readonly ui: UiApi; readonly renderer: RendererApi }, { key }) => {
    // eslint-disable-next-line unicorn/no-array-callback-reference, unicorn/prefer-array-some -- `ui.find` takes a key, not a callback.
    const onScreen = app.ui.find(key) !== undefined;
    const chain = onScreen ? chainTo(app.ui.tree(), key) : undefined;

    return chain === undefined ? undefined : onPage(app.renderer, drawnRect(chain));
  }
});
