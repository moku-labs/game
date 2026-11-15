/**
 * @file renderer plugin — how the renderer destroys a texture it owns whole, its source included: loaded files
 * (`sync`), kept pictures (`kept`) and the warm-up's probe target. A plain module of the plugin root, so neither
 * module imports the other's run-time code (L1).
 */
import type { PixiTexture, PixiTextureSource } from "./types";

/** One listener as eventemitter3, Pixi's emitter, keeps it. */
type Listener = { readonly fn: unknown; readonly context: unknown };

/** An emitter as eventemitter3 keeps its listeners: one listener alone, or a list of them. */
type Emitter = {
  readonly _events?: Record<string, Listener | Listener[] | undefined>;
  off(event: string, fn: unknown, context: unknown): unknown;
};

/** A bound resource as Pixi tags it: a texture source, a style (`textureSampler`), a uniform group, a buffer. */
type Resource = { readonly _resourceType?: string } | null | undefined;

/** A Pixi bind group: its resources by binding number, the numbers in use, the dirty flag of its key. */
type Group = {
  resources: Record<number, Resource>;
  readonly _resourceKeys: readonly number[];
  _dirty: boolean;
  readonly onResourceChange: unknown;
};

/**
 * Destroys a texture with its source, after every bind group that binds the source let go of it. Pixi 8.22 caches
 * the bind group of every batch it drew, forever, and each listens to `change` on the source and on its style: left
 * alone, a group warns `[BindGroup] ... destroyed while still bound to a shader` when the source goes, keeps the
 * destroyed source, and keeps its listeners on `Texture.EMPTY`, which pads every group (F194). For every texture the
 * renderer owns whole: loaded files, kept pictures, the warm-up target.
 *
 * @param texture - The texture, its source its own.
 */
export function destroyWhole(texture: PixiTexture): void {
  const source = texture.source;
  const style = source.style;
  const owned = ownsStyle(source);
  const empty = emptyOf(texture);

  if (empty !== undefined) releaseBindGroups(source, empty);
  // A shared style lives on with its other sources: only this source's own listener leaves it.
  if (owned) style.removeAllListeners("change");
  else dropListeners(style as unknown as Emitter, source);
  source.removeAllListeners("change");
  texture.destroy(true);
}

/**
 * Makes every Pixi bind group that binds a source let go of it, before the source is destroyed. The group's slots of
 * the source, and of its style when the source owns it, take `Texture.EMPTY`'s, with no listener: EMPTY never
 * changes. A group left with no texture source but EMPTY can never be drawn again (Pixi keys the cache by texture
 * uids, never reused), so its listeners on EMPTY and on any shared style are dropped and its style slots take EMPTY's
 * too: only the group object stays in Pixi's cache. A group that still binds a live texture keeps every listener.
 * Allocates nothing.
 *
 * @param source - The source about to be destroyed.
 * @param empty - The source of `Texture.EMPTY`.
 */
export function releaseBindGroups(source: PixiTextureSource, empty: PixiTextureSource): void {
  const listeners = (source as unknown as Emitter)._events?.change;

  if (listeners === undefined) return;
  if (!Array.isArray(listeners)) {
    releaseListener(listeners, source, empty);

    return;
  }

  for (const listener of listeners) releaseListener(listener, source, empty);
}

/**
 * Releases the source from one listener's group, when the listener is a bind group's.
 *
 * @param listener - A `change` listener of the source.
 * @param source - The source about to be destroyed.
 * @param empty - The source of `Texture.EMPTY`.
 */
function releaseListener(
  listener: Listener,
  source: PixiTextureSource,
  empty: PixiTextureSource
): void {
  const group = listener.context as Group | null | undefined;

  if (group === null || typeof group !== "object" || listener.fn !== group.onResourceChange) return;
  if (group.resources === null) return;
  if (!releaseSlots(group, source, empty)) return;

  dropDead(group, empty);
}

/**
 * Swaps the group's slots of the source, and of its owned style, for EMPTY's, and says whether the group is dead.
 *
 * @param group - The bind group.
 * @param source - The source about to be destroyed.
 * @param empty - The source of `Texture.EMPTY`.
 * @returns True when no slot binds a texture source other than EMPTY, nor anything but a style.
 */
function releaseSlots(group: Group, source: PixiTextureSource, empty: PixiTextureSource): boolean {
  const owned = ownsStyle(source);
  const style = source.style as unknown as Resource;
  const resources = group.resources;
  const keys = group._resourceKeys;
  let dead = true;

  for (const key of keys) {
    const resource = resources[key];

    if (resource === (source as unknown as Resource)) resources[key] = empty as unknown as Resource;
    else if (owned && resource === style) resources[key] = empty.style as unknown as Resource;
    else if (bindsMore(resource, empty)) dead = false;
  }

  group._dirty = true;

  return dead;
}

/**
 * Whether a slot keeps its group alive: a texture source other than EMPTY, or a resource that is not a style.
 *
 * @param resource - The slot's resource.
 * @param empty - The source of `Texture.EMPTY`.
 * @returns True when the group may still be drawn with it.
 */
function bindsMore(resource: Resource, empty: PixiTextureSource): boolean {
  if (resource === null || resource === undefined) return false;
  if (resource === (empty as unknown as Resource)) return false;

  return resource._resourceType !== "textureSampler";
}

/**
 * Drops a dead group's listeners from EMPTY's source and style and from any shared style it still binds, whose
 * slots take EMPTY's style.
 *
 * @param group - The dead bind group.
 * @param empty - The source of `Texture.EMPTY`.
 */
function dropDead(group: Group, empty: PixiTextureSource): void {
  const resources = group.resources;
  const keys = group._resourceKeys;
  const emptyStyle = empty.style as unknown as Resource;

  for (const key of keys) {
    const resource = resources[key];

    if (resource === null || resource === undefined || resource === emptyStyle) continue;
    if (resource === (empty as unknown as Resource)) continue;
    dropListeners(resource as unknown as Emitter, group);
    resources[key] = emptyStyle;
  }

  dropListeners(empty as unknown as Emitter, group);
  dropListeners(empty.style as unknown as Emitter, group);
}

/**
 * Removes every `change` listener of one context from an emitter. A list is compacted in place: eventemitter3's own
 * `off` copies the whole list per call, and EMPTY's lists hold one listener per padding slot of every live group.
 *
 * @param emitter - The emitter.
 * @param context - The context whose listeners go.
 */
function dropListeners(emitter: Emitter, context: unknown): void {
  const listeners = emitter._events?.change;

  if (listeners === undefined) return;
  if (!Array.isArray(listeners)) {
    if (listeners.context === context) emitter.off("change", listeners.fn, context);

    return;
  }

  let kept = 0;

  for (const listener of listeners) {
    if (listener.context !== context) listeners[kept++] = listener;
  }

  listeners.length = kept;
}

/**
 * The source of `Texture.EMPTY`, read from the texture's own class: every texture class of Pixi inherits the static
 * `EMPTY` of `Texture`, and the renderer's modules hold no Pixi module here.
 *
 * @param texture - Any Pixi texture.
 * @returns The source of `Texture.EMPTY`; undefined for a texture of no Pixi class, which no bind group binds.
 */
function emptyOf(texture: PixiTexture): PixiTextureSource | undefined {
  return (texture.constructor as unknown as { readonly EMPTY?: PixiTexture }).EMPTY?.source;
}

/**
 * Whether a source owns its style: Pixi marks a style handed in from outside as shared (`_ownsStyle` false).
 *
 * @param source - The source.
 * @returns False only for a shared style.
 */
function ownsStyle(source: PixiTextureSource): boolean {
  return (source as unknown as { readonly _ownsStyle?: boolean })._ownsStyle !== false;
}
