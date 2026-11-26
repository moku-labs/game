/**
 * @file renderer/kept — the Sources of F126 stage 5. A view that carries `Source` is drawn, with its subtree, into a
 * texture the screen's size at a share of the canvas resolution, in the flush of a drawn frame, before the stage pass,
 * and kept until something under it changes. A frosted window (a slot whose quad names a `back`) reads the nearest
 * Source drawn before it: its chain runs from that texture once per take, into results the Source holds and windows of
 * equal keys share, and its body draws on the window's quad over them, in the canvas pass. A Source no window reads
 * holds nothing. The steady frame allocates nothing: the find is cached by the structure version, the placement is
 * written in place.
 */
import type { Entity } from "../../world/types";
import { Source } from "../components";
import { BYTES_PER_MB, roundTo } from "../monitor/units";
import type {
  FilterSlot,
  FilterSlotInputs,
  FilterSlotQuadTexture,
  PixiContainer,
  PixiFilter,
  PixiFilterManager,
  PixiModule,
  PixiRenderTexture,
  PixiShader,
  PixiTexture,
  PixiTextureSource
} from "../types";
import { TEXEL_BYTES } from "./geometry";
import { drawsItself, dropTexture, fitTexture, labelOf } from "./render";
import { enabledSlot } from "./shade";
import type {
  HeldChain,
  KeptCtx,
  KeptRecord,
  KeptShade,
  KeptState,
  SourceRecord,
  SourceStats
} from "./types";

/** The share a Source of another value draws at. */
const DEFAULT_SCALE = 0.25;

/** Pixels in a megapixel. */
const MPX = 1e6;

/** A find walked a container whose children Pixi sorts before the next render: its answer is not kept. */
const FIND = { unsettled: false };

/** The size a take or a result asks `fitTexture` for: one object, written in place (a literal per take allocates). */
const SIZE = { width: 0, height: 0, resolution: 1 };

/** The values of a uniform group, as the placement writes them. */
type UniformValues = Record<string, unknown>;

/**
 * Reads the scale of a Source's component into its record: 0.5 or 0.25, anything else 0.25, warning once in a dev build
 * for one it does not draw at. Written, not answered: a fraction a call hands back is boxed when it is not inlined.
 *
 * @param kctx - The kept context.
 * @param source - The Source.
 */
function readScale(kctx: KeptCtx, source: SourceRecord): void {
  const { entity } = source;
  const value = kctx.ctx.deps.world.ecs.get(entity, Source);
  // Read plainly and compared in place, at every take: a fraction read through `?.` into a value of no known type, or
  // handed to a call, is boxed (16 B a take).
  const asked = value === undefined ? DEFAULT_SCALE : value.scale;
  const scale = asked === 0.5 ? 0.5 : DEFAULT_SCALE;
  const { warnedScale } = kctx.state;

  if (
    typeof __MOKU_GAME_DEV__ !== "undefined" &&
    __MOKU_GAME_DEV__ &&
    asked !== scale &&
    !warnedScale.has(entity)
  ) {
    warnedScale.add(entity);
    kctx.ctx.log.warn("renderer:source-scale", { entity, scale: asked });
  }

  source.scale = scale;
}

/**
 * Makes the record of a view that got `Source`: no top until its view is there, dirty, no texture.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws, for its matrices; none while inert.
 * @param entity - The entity.
 */
export function addSource(kctx: KeptCtx, pixi: PixiModule | undefined, entity: Entity): void {
  const { state } = kctx;

  if (state.sourceByEntity.has(entity) || pixi === undefined) return;

  const source: SourceRecord = {
    entity,
    top: undefined,
    wasGroup: false,
    scale: DEFAULT_SCALE,
    texture: undefined,
    resolution: 0,
    version: 0,
    dirty: true,
    readers: 0,
    held: [],
    matrix: new pixi.Matrix(),
    seen: new pixi.Matrix(),
    identity: new pixi.Matrix(),
    sprite: undefined,
    keeper: undefined,
    drawing: undefined,
    bytes: 0
  };

  // The resolution is handed to each window's seam when its steps move (`key`): a field V8 keeps tagged hands the number
  // it holds, where a double field would box it at every ask. A non-number once moves the field; the number goes back.
  Reflect.set(source, "resolution", false);
  source.resolution = 0;
  readScale(kctx, source);
  state.sources.push(source);
  state.sourceByEntity.set(entity, source);
  kctx.ctx.state.sync.structureVersion += 1;
}

/**
 * Undoes the render group a take made of a top, and makes Pixi work out the colour and the display status of its subtree
 * again (as `record.ts` does for a picture's top).
 *
 * @param state - The kept state.
 * @param top - The top.
 */
function ungroupTop(state: KeptState, top: PixiContainer): void {
  if (!state.madeGroups.has(top)) return;

  if (!top.destroyed && state.byTop.get(top)?.mode !== "kept") {
    const { alpha, renderable } = top;

    top.disableRenderGroup();
    top.alpha = alpha === 0 ? 1 : 0;
    top.alpha = alpha;
    top.renderable = !renderable;
    top.renderable = renderable;
    state.madeGroups.delete(top);
  }
}

/**
 * Frees one result: its targets destroyed (each was registered with `host.keep`, so it is let go there first), and the
 * result taken off its Source.
 *
 * @param kctx - The kept context.
 * @param source - Its Source.
 * @param held - The result.
 */
function freeHeld(kctx: KeptCtx, source: SourceRecord, held: HeldChain): void {
  for (const target of held.targets) if (target !== undefined) dropTexture(kctx, target);

  held.targets.length = 0;

  const at = source.held.indexOf(held);

  if (at !== -1) source.held.splice(at, 1);
}

/**
 * Lets a window go of the result its mesh bound: freed when no window reads it.
 *
 * @param kctx - The kept context.
 * @param record - The window's record.
 */
export function releaseHeld(kctx: KeptCtx, record: KeptRecord): void {
  const { held, source } = record;

  record.held = undefined;

  if (held === undefined) return;

  held.refs -= 1;

  if (held.refs <= 0 && source !== undefined) freeHeld(kctx, source, held);
}

/**
 * Drops what a Source holds: its texture and every result drawn from it, and the render group its take made; dirty, so
 * a reader that comes back is taken again (A6).
 *
 * @param kctx - The kept context.
 * @param source - The Source.
 */
export function dropSourceTexture(kctx: KeptCtx, source: SourceRecord): void {
  for (const record of kctx.state.records) {
    if (record.source === source && record.held !== undefined) releaseHeld(kctx, record);
  }

  for (let held = source.held.at(-1); held !== undefined; held = source.held.at(-1)) {
    freeHeld(kctx, source, held);
  }

  if (source.texture !== undefined) {
    dropTexture(kctx, source.texture);
    source.texture = undefined;
  }

  source.sprite?.destroy();
  source.sprite = undefined;
  source.bytes = 0;
  source.dirty = true;

  if (source.top !== undefined) ungroupTop(kctx.state, source.top);
}

/**
 * Lets the top of a Source go when its view leaves, as `syncTops` does for a view that is gone: its texture dropped, its
 * render group undone, out of the top map. The Source stays with its entity and finds its next top in `syncTops`. A
 * leaving view's wrapper goes to a pool (hot path 2в), and a view of the same entity built in the same pass may get the
 * same container back; `syncTops` would take it for the old top and keep the old picture.
 *
 * @param kctx - The kept context.
 * @param entity - The entity whose view leaves.
 */
export function leaveSourceTop(kctx: KeptCtx, entity: Entity): void {
  const { state } = kctx;
  const source = state.sourceByEntity.get(entity);

  if (source?.top === undefined) return;

  dropSourceTexture(kctx, source);

  if (state.sourceByTop.get(source.top) === source) state.sourceByTop.delete(source.top);

  source.top = undefined;
  source.wasGroup = false;
  kctx.ctx.state.sync.structureVersion += 1;
}

/**
 * Drops the record of a view that lost `Source` or left: its texture and results freed, its render group restored, out
 * of the maps; every window finds again.
 *
 * @param kctx - The kept context.
 * @param entity - The entity.
 */
export function removeSource(kctx: KeptCtx, entity: Entity): void {
  const { state } = kctx;
  const source = state.sourceByEntity.get(entity);

  if (source === undefined) return;

  dropSourceTexture(kctx, source);

  for (const record of state.records) {
    if (record.source === source) {
      record.source = undefined;
      record.reader = false;
      // Stepped in the next flush, also a calm one: it goes back to the backdrop path.
      record.dirtyS3 = true;
    }
  }

  if (source.top !== undefined && state.sourceByTop.get(source.top) === source) {
    state.sourceByTop.delete(source.top);
  }

  state.sourceByEntity.delete(entity);
  state.sources.splice(state.sources.indexOf(source), 1);
  state.warnedScale.delete(entity);
  kctx.ctx.state.sync.structureVersion += 1;
}

/**
 * Watches the `Source` components: the ones there already, then every add and removal.
 *
 * @param kctx - The kept context.
 * @returns The removers of the two hooks.
 */
export function watchSources(kctx: KeptCtx): Array<() => void> {
  const { ecs } = kctx.ctx.deps.world;
  const pixi = kctx.host.pixi();

  for (const [entity] of ecs.query(Source)) addSource(kctx, pixi, entity);

  return [
    ecs.onAdded(Source, entity => addSource(kctx, kctx.host.pixi(), entity)),
    ecs.onRemoved(Source, entity => removeSource(kctx, entity))
  ];
}

/**
 * Marks dirty every Source whose top is a node or one of its ancestors: a change of the node is a change of its
 * picture. Per mark: a walk up the parents, nothing made.
 *
 * @param state - The kept state.
 * @param node - The marked view's top.
 */
export function markSources(state: KeptState, node: PixiContainer): void {
  if (state.sources.length === 0) return;

  for (let at: PixiContainer | null = node; at !== null; at = at.parent) {
    const source = state.sourceByTop.get(at);

    if (source !== undefined) source.dirty = true;
  }
}

/**
 * Marks every Source dirty: a resize, a resolution step, a restore or a debug switch (A6).
 *
 * @param state - The kept state.
 */
export function markAllSources(state: KeptState): void {
  for (let index = 0; index < state.sources.length; index += 1) {
    const source = state.sources[index];

    if (source !== undefined) source.dirty = true;
  }
}

/**
 * The first Source in a subtree, the node itself first, then its children last first, each depth first.
 *
 * @param state - The kept state.
 * @param node - The node.
 * @returns The Source, or `undefined`.
 */
function sourceIn(state: KeptState, node: PixiContainer | undefined): SourceRecord | undefined {
  if (node === undefined) return undefined;

  const own = state.sourceByTop.get(node);

  if (own !== undefined) return own;

  const { children } = node;

  for (let at = children.length - 1; at >= 0; at -= 1) {
    const found = sourceIn(state, children[at]);

    // Which of two Sources in the subtree comes first may change when Pixi sorts it: the answer waits for the sort. A
    // subtree with no Source answers none in any order.
    if (found !== undefined) {
      if (node.sortableChildren && node.sortDirty) FIND.unsettled = true;

      return found;
    }
  }

  return undefined;
}

/**
 * Tells whether a container holds a Source below it: the order of its children can then change what a window finds.
 * Per call: a walk up the parents of each Source's top, nothing made.
 *
 * @param state - The kept state.
 * @param node - The container.
 * @returns True when a Source's top is under it.
 */
export function holdsSource(state: KeptState, node: PixiContainer): boolean {
  for (let index = 0; index < state.sources.length; index += 1) {
    const top = state.sources[index]?.top;

    if (top !== undefined && isBelow(top, node)) return true;
  }

  return false;
}

/**
 * Tells whether a node hangs below another, at any depth. Per call: a walk up the parents, nothing made.
 *
 * @param node - The node.
 * @param above - The other.
 * @returns True when `above` is one of its ancestors.
 */
function isBelow(node: PixiContainer, above: PixiContainer): boolean {
  for (let at = node.parent; at !== null; at = at.parent) if (at === above) return true;

  return false;
}

/**
 * The nearest Source drawn before a window: from its top up the parents to the stage, at each level the earlier
 * siblings, last first, each subtree depth first, last child first. An ancestor's own Source is never the answer: the
 * window would read itself. Allocates nothing.
 *
 * @param state - The kept state.
 * @param top - The window's top.
 * @returns The Source, or `undefined` for none.
 */
export function findSource(state: KeptState, top: PixiContainer): SourceRecord | undefined {
  FIND.unsettled = false;

  if (state.sources.length === 0) return undefined;

  let node = top;

  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    const { children } = parent;

    // A sort Pixi still owes moves which siblings come before the window only when a Source hangs under this level.
    if (parent.sortableChildren && parent.sortDirty && holdsSource(state, parent)) {
      FIND.unsettled = true;
    }

    for (let at = children.indexOf(node) - 1; at >= 0; at -= 1) {
      const found = sourceIn(state, children[at]);

      if (found !== undefined) return found;
    }

    node = parent;
  }

  return undefined;
}

/**
 * The quad of a record's one enabled slot when it names a back: the window of a Source.
 *
 * @param record - The record.
 * @returns The slot, or `undefined`.
 */
export function backSlot(record: KeptRecord): FilterSlot | undefined {
  const slot = enabledSlot(record.slots);

  return slot?.quad?.back === undefined ? undefined : slot;
}

/**
 * Tells whether a window's result is current: its Source holds a texture, and the result was drawn from its take while
 * its chain's version is the one it was found for (A1). The version moves whenever the steps change, so a frame reads
 * two whole numbers per window: no key is asked for, no resolution read (a fraction read off a Pixi source and handed
 * on boxes, 16 B a window).
 *
 * @param record - The window's record, its Source found.
 * @returns True when the mesh may draw over it.
 */
export function heldCurrent(record: KeptRecord): boolean {
  const { source, held } = record;
  const slot = backSlot(record);

  if (source?.texture === undefined || slot === undefined) return false;

  const { inputs } = slot;

  if (inputs === undefined) return true;

  return (
    held !== undefined &&
    held.at === source.version &&
    held.kind === slot.kind &&
    record.heldOf === inputs &&
    record.heldVersion === inputs.version()
  );
}

/**
 * What a slot's chain draws at a Source's resolution: its key, NaN for a seam without one (never shared).
 *
 * @param inputs - The seam.
 * @param source - The Source, with its texture.
 * @returns The key.
 */
function keyOf(inputs: FilterSlotInputs, source: SourceRecord): number {
  return inputs.key === undefined ? Number.NaN : inputs.key(source.resolution);
}

/**
 * Step 1 of the flush (A5): every window finds its Source when the structure moved since its last find, a window that
 * found none is reported once (dev builds, WebGPU), and the readers of each Source are counted. A Source no window
 * reads any more lets its texture go. Per frame: a walk of the records, nothing made.
 *
 * @param kctx - The kept context.
 */
export function resolveReaders(kctx: KeptCtx): void {
  const { state } = kctx;

  // The tops first: a Source that got its top moves the version, and the finds of this flush are made after it.
  syncTops(kctx);

  const version = kctx.ctx.state.sync.structureVersion;

  for (let index = 0; index < state.sources.length; index += 1) {
    const source = state.sources[index];

    if (source !== undefined) source.readers = 0;
  }
  for (let index = 0; index < state.records.length; index += 1) {
    const record = state.records[index];

    if (record !== undefined) resolveOne(kctx, record, version);
  }
  for (let index = 0; index < state.sources.length; index += 1) {
    const source = state.sources[index];

    if (source?.readers === 0 && source.texture !== undefined) dropSourceTexture(kctx, source);
  }
}

/**
 * One window of step 1: its Source found again when the structure moved, its result let go when it reads none or
 * another, counted as a reader while it was eligible with it.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param version - The structure version now.
 */
function resolveOne(kctx: KeptCtx, record: KeptRecord, version: number): void {
  if (backSlot(record) === undefined) {
    if (record.source !== undefined || record.held !== undefined) leaveSource(kctx, record);

    return;
  }

  if (record.sourceAt !== version) {
    const found = findSource(kctx.state, record.top);

    // Another Source, or none: stepped in this flush, also a calm one, so it changes path at once.
    if (found !== record.source) {
      leaveSource(kctx, record);
      record.dirtyS3 = true;
    }

    record.source = found;
    record.sourceAt = FIND.unsettled ? -1 : version;
  }

  if (record.source === undefined) {
    reportUnserved(kctx, record);

    return;
  }

  if (record.reader) record.source.readers += 1;
  else if (record.held !== undefined) releaseHeld(kctx, record);
}

/**
 * A window lets its Source go: its result is released, it reads none, its cached find is dropped.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 */
function leaveSource(kctx: KeptCtx, record: KeptRecord): void {
  releaseHeld(kctx, record);
  record.source = undefined;
  record.reader = false;
  // The answer it was found for is gone: a window that comes back finds again, whatever the structure did.
  record.sourceAt = -1;
}

/**
 * Reports once a window that stays on the backdrop path for want of a Source: dev builds on WebGPU only (on WebGL no
 * Source is ever read).
 *
 * @param kctx - The kept context.
 * @param record - The record.
 */
function reportUnserved(kctx: KeptCtx, record: KeptRecord): void {
  if (record.unserved || kctx.host.kind() !== "webgpu") return;
  if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) return;

  record.unserved = true;

  for (const listener of kctx.state.unserved) listener(record.entity);
}

/**
 * Follows the view of every Source: another top re-keys it (its texture dropped, the find of every window moved), a view
 * gone leaves it without a top. Per drawn frame: a map read per Source.
 *
 * @param kctx - The kept context.
 */
function syncTops(kctx: KeptCtx): void {
  const { state } = kctx;
  const { views } = kctx.ctx.state.sync;
  for (let index = 0; index < state.sources.length; index += 1) {
    const source = state.sources[index];

    if (source === undefined) continue;

    const view = views.get(source.entity);
    const top = view === undefined ? undefined : (view.wrapper ?? view.object);

    if (top === source.top) continue;

    dropSourceTexture(kctx, source);

    if (source.top !== undefined && state.sourceByTop.get(source.top) === source) {
      state.sourceByTop.delete(source.top);
    }

    source.top = top;
    source.wasGroup = top?.isRenderGroup ?? false;
    if (top !== undefined) state.sourceByTop.set(top, source);
    kctx.ctx.state.sync.structureVersion += 1;
  }
}

/**
 * Step 2 of the flush (A5): every dirty Source with readers is taken, then every reader's result is brought up to its
 * Source's take and its chain's steps. Drawn frames only: a take outside the flush shows an empty canvas on WebGPU.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 */
export function takeSources(kctx: KeptCtx, pixi: PixiModule): void {
  const { state } = kctx;

  state.sourceTakes = 0;
  state.sourcePixels = 0;

  if (state.sources.length === 0) return;
  for (let index = 0; index < state.sources.length; index += 1) {
    const source = state.sources[index];

    if (source === undefined || source.readers === 0) continue;
    if (!source.dirty && movedSinceTake(source)) source.dirty = true;
    if (source.dirty) takeSource(kctx, pixi, source);
  }
  for (let index = 0; index < state.records.length; index += 1) {
    const record = state.records[index];

    if (record?.reader === true && record.source?.texture !== undefined)
      bringHeld(kctx, pixi, record);
  }
}

/**
 * Tells whether a taken Source's top stands elsewhere on the canvas than at its take: a node above it moved, which marks
 * only that node, and the texture holds the subtree at its canvas place. Per drawn frame and read Source: the top's world
 * transform read into a scratch matrix and compared, nothing made.
 *
 * @param source - The Source, read.
 * @returns True when its texture shows the subtree where it no longer is.
 */
function movedSinceTake(source: SourceRecord): boolean {
  const { top, texture, matrix, seen } = source;

  if (top === undefined || top.destroyed || texture === undefined) return false;

  top.getGlobalTransform(seen, false);

  return (
    seen.a !== matrix.a ||
    seen.b !== matrix.b ||
    seen.c !== matrix.c ||
    seen.d !== matrix.d ||
    seen.tx !== matrix.tx ||
    seen.ty !== matrix.ty
  );
}

/**
 * Gives a bare view under a Source its wrapper before its first take, as a picture's first take does (spec 23 D4): a
 * view that draws itself made the root of the take's render group draws other pixels than live (Pixi's sprite pipe
 * keeps the group transform it cached, the root's own tint and alpha are applied twice). The Source moves to the
 * wrapper; the wrap marks nothing, it draws the same pixels.
 *
 * @param kctx - The kept context.
 * @param source - The Source, its top known.
 * @param top - Its top.
 * @returns The top to take: the wrapper, or the top as it was.
 */
function wrapBareSource(kctx: KeptCtx, source: SourceRecord, top: PixiContainer): PixiContainer {
  const view = kctx.ctx.state.sync.views.get(source.entity);

  if (view === undefined || view.wrapper !== undefined || !drawsItself(top)) return top;

  const wrapper = kctx.wrap(source.entity);

  if (wrapper === undefined || wrapper === top) return top;

  const { state } = kctx;

  if (state.sourceByTop.get(top) === source) state.sourceByTop.delete(top);
  source.top = wrapper;
  source.wasGroup = wrapper.isRenderGroup;
  state.sourceByTop.set(wrapper, source);

  return wrapper;
}

/**
 * Takes one Source: the screen's size at `resolution × scale` (rounded up), the top at its canvas transform, its alpha
 * and visibility as drawn (a hidden top gives a transparent picture). A top that is itself kept is taken live from its
 * subtree. The render makes the top a render group, undone when the Source lets its texture go. A take that did not
 * render stays dirty.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param source - The Source, dirty, with readers.
 */
function takeSource(kctx: KeptCtx, pixi: PixiModule, source: SourceRecord): void {
  const screen = kctx.host.screen();

  if (source.top === undefined || source.top.destroyed || screen === undefined) return;

  const top = wrapBareSource(kctx, source, source.top);

  const was = source.texture;
  const wasWidth = was === undefined ? -1 : was.source.pixelWidth;
  const wasHeight = was === undefined ? -1 : was.source.pixelHeight;
  const texture = fitSource(kctx, pixi, source, top, screen);
  const group = top.isRenderGroup;
  const kept = kctx.state.byTop.get(top)?.mode === "kept" && !top.renderable;

  if (kept) top.renderable = true;

  const rendered = kctx.host.renderTo(
    top,
    texture,
    top.getGlobalTransform(source.matrix, false),
    true
  );

  if (kept) top.renderable = false;
  if (!rendered) return;
  if (!group && !source.wasGroup) kctx.state.madeGroups.add(top);

  const { pixelWidth, pixelHeight } = texture.source;

  source.version += 1;
  source.dirty = false;
  // Its device size, as `textureBytes` counts it: a fraction handed to a call per take is boxed.
  source.bytes = pixelWidth * pixelHeight * TEXEL_BYTES;
  kctx.state.sourceTakes += 1;
  kctx.state.sourcePixels += pixelWidth * pixelHeight;
  kctx.state.flushPasses += 1;

  // A texture drawn again in place, at its size, is read by every window as it stands: their meshes bind it and their
  // placement holds. A new texture, or one of another size, is bound and placed again by each.
  if (texture === was && pixelWidth === wasWidth && pixelHeight === wasHeight) return;

  for (let index = 0; index < kctx.state.records.length; index += 1) {
    const record = kctx.state.records[index];

    if (record?.source === source) record.dirtyS3 = true;
  }
}

/**
 * Gives a Source its texture for a take: the screen's size at `resolution × scale`, rounded up, the one it holds resized
 * in place, or a new one (its label made only then); the resolution kept on the record.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param source - The Source.
 * @param top - Its top, for the label.
 * @param screen - The screen, CSS px.
 * @param screen.width - Its width.
 * @param screen.height - Its height.
 * @returns The texture, on the Source.
 */
function fitSource(
  kctx: KeptCtx,
  pixi: PixiModule,
  source: SourceRecord,
  top: PixiContainer,
  screen: { readonly width: number; readonly height: number }
): PixiRenderTexture {
  readScale(kctx, source);

  const resolution = kctx.host.resolution() * source.scale;

  SIZE.width = Math.ceil(screen.width * resolution) / resolution;
  SIZE.height = Math.ceil(screen.height * resolution) / resolution;
  SIZE.resolution = resolution;

  // The label only for a texture made or taken from the pool: a texture kept is resized in place, its label stands.
  const texture = fitTexture(
    kctx,
    pixi,
    source.texture,
    SIZE,
    needsTexture(source.texture) ? `source:${labelOf(top)}` : ""
  );

  source.texture = texture;
  // Kept plainly: Pixi answers a source's resolution through a getter, a boxed fraction when the call is not inlined.
  // Written only when it moves: the tagged field takes a new number at each write.
  if (source.resolution !== resolution) source.resolution = resolution;

  return texture;
}

/**
 * Tells whether `fitTexture` makes or takes a texture for this one (none held, or destroyed): only then is a label read.
 *
 * @param texture - The texture held.
 * @returns True when a texture is to be made.
 */
function needsTexture(texture: PixiRenderTexture | undefined): boolean {
  return texture === undefined || texture.destroyed;
}

/**
 * Tells whether a result was drawn with the steps a seam's chain draws now: an equal key, or for a seam without one,
 * the same seam.
 *
 * @param held - The result.
 * @param inputs - The seam.
 * @param key - Its key at the Source's resolution; NaN for none.
 * @returns True when it was.
 */
function sameSteps(held: HeldChain, inputs: FilterSlotInputs, key: number): boolean {
  return Number.isNaN(key) ? held.owner === inputs : held.key === key;
}

/**
 * Brings a reader's result up to its Source's take and its chain's steps: kept when current; else one of another window
 * with equal steps, shared; else its own drawn again in place when nobody else reads it or every window that reads it
 * draws the same steps (a retake of the Source under windows that share), or a new one. A change of the result its
 * mesh binds owes the mesh its bindings (`dirtyS3`).
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param record - The reader, its Source with a texture.
 */
function bringHeld(kctx: KeptCtx, pixi: PixiModule, record: KeptRecord): void {
  const slot = backSlot(record);
  const { source } = record;
  const inputs = slot?.inputs;

  if (slot === undefined || source === undefined || inputs === undefined) return;
  if (heldCurrent(record)) return;

  const own = record.held;

  // A take of the Source under a window whose steps stand: its result drawn again in place, shared or not. Its key is
  // the one it was drawn with; none is asked (a fraction handed to the seam boxes).
  if (own !== undefined && stepsStand(record, own, slot, inputs, source)) {
    own.owner = inputs;
    drawHeld(kctx, pixi, source, own, inputs, true);
    noteSeam(record, inputs);

    return;
  }

  const key = keyOf(inputs, source);
  const shared = sharedHeld(source, slot, key);

  if (shared !== undefined) {
    holdResult(kctx, record, shared);
    noteSeam(record, inputs);

    return;
  }

  // Its own again: nobody else reads it, it holds these steps (the other readers share them, by their equal key), or
  // every other reader's steps moved too (a tween of them all): each asks its key at its turn and leaves if it differs.
  const reuse =
    own !== undefined &&
    own.kind === slot.kind &&
    (own.refs === 1 || sameSteps(own, inputs, key) || othersMoved(kctx, record, own));
  const held = reuse
    ? own
    : {
        kind: slot.kind,
        key,
        owner: inputs,
        at: -1,
        resolution: 0,
        sizedWidth: -1,
        sizedHeight: -1,
        targets: [],
        scales: [],
        refs: 0,
        bytes: 0
      };

  if (held !== own) {
    source.held.push(held);
    holdResult(kctx, record, held);
  }

  held.owner = inputs;
  drawHeld(kctx, pixi, source, held, inputs, false);
  // The key asked once: the draw runs the chains at the resolution the ask ran them at.
  held.key = key;
  noteSeam(record, inputs);
}

/**
 * Tells whether every other window that reads a result has steps that moved since it was drawn: none of them reads it
 * as current, so it may be drawn again in place with this window's steps. Per call: a walk of the records, two whole
 * numbers each, nothing made.
 *
 * @param kctx - The kept context.
 * @param record - The window that asks.
 * @param held - The result.
 * @returns True when no other reader holds it current.
 */
function othersMoved(kctx: KeptCtx, record: KeptRecord, held: HeldChain): boolean {
  for (let index = 0; index < kctx.state.records.length; index += 1) {
    const other = kctx.state.records[index];

    if (other === undefined || other === record || other.held !== held) continue;

    const inputs = backSlot(other)?.inputs;

    if (
      inputs === undefined ||
      (other.heldOf === inputs && other.heldVersion === inputs.version())
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Tells whether a window's result was drawn with the steps its chain draws now, at the resolution the Source has now:
 * the same seam, its version as noted, the same kind. Numbers compared, no call.
 *
 * @param record - The window's record.
 * @param held - Its result.
 * @param slot - Its slot.
 * @param inputs - The slot's seam.
 * @param source - Its Source, with a texture.
 * @returns True when a take of the Source owes the result a draw and nothing else.
 */
function stepsStand(
  record: KeptRecord,
  held: HeldChain,
  slot: FilterSlot,
  inputs: FilterSlotInputs,
  source: SourceRecord
): boolean {
  const { texture } = source;

  // The texture read plainly (a fraction through `?.` is boxed), the resolution off the record (Pixi's is a getter).
  return (
    texture !== undefined &&
    held.kind === slot.kind &&
    record.heldOf === inputs &&
    record.heldVersion === inputs.version() &&
    held.resolution === source.resolution
  );
}

/**
 * Notes the seam and the version a window's result was found or drawn for: `heldCurrent` compares them.
 *
 * @param record - The window's record.
 * @param inputs - Its seam.
 */
function noteSeam(record: KeptRecord, inputs: FilterSlotInputs): void {
  record.heldOf = inputs;
  record.heldVersion = inputs.version();
}

/**
 * A result of the Source drawn from its take with the steps a slot's chain draws now, by another window.
 *
 * @param source - The Source.
 * @param slot - The window's slot.
 * @param key - Its chain's key at the Source's resolution.
 * @returns The result, or `undefined`.
 */
function sharedHeld(source: SourceRecord, slot: FilterSlot, key: number): HeldChain | undefined {
  for (let index = 0; index < source.held.length; index += 1) {
    const held = source.held[index];
    const sameKey = Number.isNaN(key) ? held?.owner === slot.inputs : held?.key === key;

    if (held !== undefined && held.at === source.version && held.kind === slot.kind && sameKey)
      return held;
  }

  return undefined;
}

/**
 * Points a window at a result: the one it held before let go, the mesh's bindings owed.
 *
 * @param kctx - The kept context.
 * @param record - The window's record.
 * @param held - The result.
 */
function holdResult(kctx: KeptCtx, record: KeptRecord, held: HeldChain): void {
  if (record.held === held) return;

  releaseHeld(kctx, record);
  record.held = held;
  held.refs += 1;
  record.dirtyS3 = true;
}

/**
 * Sizes a result's targets: the Source's frame at its resolution times each input's scale; an empty chain leaves a hole,
 * and its input reads the Source itself. A target made, dropped or resized owes its windows their bindings.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param source - The Source, with its texture.
 * @param held - The result.
 * @param inputs - The seam that draws it.
 * @returns True when one target or more is to be drawn.
 */
function sizeHeld(
  kctx: KeptCtx,
  pixi: PixiModule,
  source: SourceRecord,
  held: HeldChain,
  inputs: FilterSlotInputs
): boolean {
  const texture = source.texture;

  if (texture === undefined) return false;

  const { pixelWidth, pixelHeight } = texture.source;
  // The Source is of the size the targets were made for: a target at its scale stands as it is.
  const same = held.sizedWidth === pixelWidth && held.sizedHeight === pixelHeight;
  let any = false;
  let moved = false;

  held.bytes = 0;

  for (let index = 0; index < inputs.count; index += 1) {
    const scale = inputs.scaleOf(index);
    const target = held.targets[index];

    if (scale === undefined) {
      if (target !== undefined) {
        dropTexture(kctx, target);
        moved = true;
      }

      // A hole: the input reads the Source as it is.
      held.targets[index] = undefined;
      continue;
    }

    const stands =
      same && target !== undefined && !target.destroyed && held.scales[index] === scale;

    held.scales[index] = scale;
    any = true;
    if (!stands && fitTarget(kctx, pixi, source, held, index)) moved = true;

    const fitted = held.targets[index];

    if (fitted !== undefined) {
      held.bytes += fitted.source.pixelWidth * fitted.source.pixelHeight * TEXEL_BYTES;
    }
  }

  // Another texture, or one of another size, under an input: every window that reads the result binds and places again.
  if (moved) markHolders(kctx, held);

  return any;
}

/**
 * Fits one target of a result to its Source at the scale `held.scales` holds for it (read there: a fraction handed to a
 * call is boxed): resized in place, or made, its label only then.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param source - The Source, with its texture.
 * @param held - The result.
 * @param index - The input.
 * @returns True when the target is another texture, or of another size, than before.
 */
function fitTarget(
  kctx: KeptCtx,
  pixi: PixiModule,
  source: SourceRecord,
  held: HeldChain,
  index: number
): boolean {
  const { texture } = source;
  const target = held.targets[index];

  if (texture === undefined) return false;

  const wasWidth = target === undefined ? -1 : target.source.pixelWidth;
  const wasHeight = target === undefined ? -1 : target.source.pixelHeight;

  // The resolution off the record: Pixi answers a source's through a getter, a boxed fraction when it is not inlined.
  SIZE.width = texture.source.width;
  SIZE.height = texture.source.height;
  SIZE.resolution = source.resolution * (held.scales[index] ?? 1);

  const fitted = fitTexture(
    kctx,
    pixi,
    target,
    SIZE,
    needsTexture(target) ? `source:${source.entity}#${index}` : ""
  );

  held.targets[index] = fitted;

  return (
    fitted !== target ||
    fitted.source.pixelWidth !== wasWidth ||
    fitted.source.pixelHeight !== wasHeight
  );
}

/**
 * Owes every window that reads a result its bindings and placement (`dirtyS3`).
 *
 * @param kctx - The kept context.
 * @param held - The result.
 */
function markHolders(kctx: KeptCtx, held: HeldChain): void {
  for (let index = 0; index < kctx.state.records.length; index += 1) {
    const record = kctx.state.records[index];

    if (record?.held === held) record.dirtyS3 = true;
  }
}

/**
 * The keeper of a Source: a sprite of its texture carrying an `AlphaFilter` at the texture's resolution, whose apply
 * draws the chain of the result being drawn from Pixi's copy of it and draws nothing itself. Made once per Source.
 *
 * @param pixi - The module that draws.
 * @param source - The Source, with its texture.
 * @returns The sprite.
 */
function keeperOf(pixi: PixiModule, source: SourceRecord): NonNullable<SourceRecord["sprite"]> {
  const texture = source.texture ?? pixi.Texture.EMPTY;
  // Made in a function of its own: a closure over `source` here would give every call a context for it, 40 B a draw.
  const keeper = source.keeper ?? makeKeeper(pixi, source);
  const { resolution } = source;

  if (keeper.resolution !== resolution) keeper.resolution = resolution;
  if (keeper.padding !== 0) keeper.padding = 0;

  if (source.sprite === undefined || source.sprite.destroyed) {
    source.sprite = new pixi.Sprite(texture);
    source.sprite.label = `source:${source.entity}#chain`;
    source.sprite.filters = [keeper];
  } else if (source.sprite.texture !== texture) {
    source.sprite.texture = texture;
  }

  return source.sprite;
}

/**
 * Makes the keeper of a Source, once: an `AlphaFilter` whose apply draws the chain of the result being drawn.
 *
 * @param pixi - The module that draws.
 * @param source - The Source.
 * @returns The keeper, kept on the Source.
 */
function makeKeeper(pixi: PixiModule, source: SourceRecord): PixiFilter {
  const keeper = new pixi.AlphaFilter({ alpha: 1 });

  keeper.apply = (manager: PixiFilterManager, input: PixiTexture): void => {
    const { drawing } = source;

    drawing?.owner.draw(manager, input, drawing.targets);
  };
  source.keeper = keeper;

  return keeper;
}

/**
 * Draws a result's chain from its Source's texture: the keeper's sprite rendered over the texture without a clear, its
 * apply drawing every input into the result's targets. A scale that changed inside the draw sizes the targets again and
 * draws once more. Counted as off-canvas passes: the copy and each stage.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param source - The Source, with its texture.
 * @param held - The result.
 * @param inputs - The seam that draws it.
 * @param stand - Its steps and its Source's resolution are those it was last drawn with.
 */
function drawHeld(
  kctx: KeptCtx,
  pixi: PixiModule,
  source: SourceRecord,
  held: HeldChain,
  inputs: FilterSlotInputs,
  stand: boolean
): void {
  const texture = source.texture;

  held.at = source.version;

  if (texture === undefined) return;

  held.resolution = source.resolution;

  const { pixelWidth, pixelHeight } = texture.source;
  // Steps that stand over a Source of the size the targets were made for: they stand too, and no scale is asked of the
  // seam (a fraction a seam answers through a call it is not inlined into is boxed, 16 B a call).
  const sized = stand && held.sizedWidth === pixelWidth && held.sizedHeight === pixelHeight;

  if (sized ? !drawsTarget(held) : !sizeHeld(kctx, pixi, source, held, inputs)) return;

  held.sizedWidth = pixelWidth;
  held.sizedHeight = pixelHeight;

  const sprite = keeperOf(pixi, source);

  source.drawing = held;
  kctx.host.renderTo(sprite, texture, source.identity, false);

  if (!sized && scalesMoved(held, inputs) && sizeHeld(kctx, pixi, source, held, inputs)) {
    kctx.host.renderTo(sprite, texture, source.identity, false);
  }

  source.drawing = undefined;

  const perInput = inputs.stages.length / Math.max(inputs.count, 1);
  let pixels = pixelWidth * pixelHeight;

  for (let index = 0; index < held.targets.length; index += 1) {
    const target = held.targets[index];

    if (target !== undefined)
      pixels += target.source.pixelWidth * target.source.pixelHeight * perInput;
  }

  kctx.state.flushPasses += 1 + inputs.stages.length;
  kctx.state.sourcePixels += pixels;
}

/**
 * Tells whether a result has a target to draw: an empty chain leaves only holes.
 *
 * @param held - The result.
 * @returns True when one target or more is there.
 */
function drawsTarget(held: HeldChain): boolean {
  for (let index = 0; index < held.targets.length; index += 1) {
    if (held.targets[index] !== undefined) return true;
  }

  return false;
}

/**
 * Tells whether a scale of a chain changed inside its draw: a target was sized at another scale than it asks for now, or
 * a hole and a target changed places.
 *
 * @param held - The result, drawn.
 * @param inputs - The seam that drew it.
 * @returns True when one did.
 */
function scalesMoved(held: HeldChain, inputs: FilterSlotInputs): boolean {
  for (let index = 0; index < inputs.count; index += 1) {
    const scale = inputs.scaleOf(index);
    const target = held.targets[index];

    if ((scale === undefined) !== (target === undefined)) return true;
    // The scale each target was sized at, kept with it: no size is read back through Pixi's getters.
    if (scale !== undefined && held.scales[index] !== scale) return true;
  }

  return false;
}

/**
 * Binds a texture under a quad's names where it differs: a write Pixi takes as a change of the group.
 *
 * @param shader - The mesh's shader.
 * @param names - The names.
 * @param texture - The texture.
 */
function bindTexture(
  shader: PixiShader,
  names: FilterSlotQuadTexture,
  texture: PixiTextureSource
): void {
  const { resources } = shader;

  if (resources[names.texture] !== texture) resources[names.texture] = texture;
  if (resources[names.sampler] !== texture.style) resources[names.sampler] = texture.style;
}

/**
 * Writes one number of a uniform where it differs, at 32 bits.
 *
 * @param target - The uniform's numbers.
 * @param index - The number.
 * @param value - Its value.
 */
function writeNumber(target: Float32Array, index: number, value: number): void {
  const rounded = Math.fround(value);

  if (target[index] !== rounded) target[index] = rounded;
}

/**
 * Writes the placement of one texture into a quad's uniforms, in place, compare-then-write: `scale` 1 over its frame in
 * canvas px, `offset` the window's origin over that frame, `clamp` half a texel inside it.
 *
 * @param uniforms - The values of the instance's group.
 * @param names - The texture's names.
 * @param texture - The texture, the screen's size.
 * @param x - The window's picture origin, canvas px.
 * @param y - The same down.
 */
function writePlace(
  uniforms: UniformValues,
  names: FilterSlotQuadTexture,
  texture: PixiTextureSource,
  x: number,
  y: number
): void {
  const scale = uniforms[names.scale];
  const offset = uniforms[names.offset];
  const clamp = uniforms[names.clamp];
  const { width, height, pixelWidth, pixelHeight } = texture;

  if (scale instanceof Float32Array) {
    writeNumber(scale, 0, 1 / width);
    writeNumber(scale, 1, 1 / height);
  }

  if (offset instanceof Float32Array) {
    writeNumber(offset, 0, x / width);
    writeNumber(offset, 1, y / height);
  }

  if (clamp instanceof Float32Array) {
    writeNumber(clamp, 0, 0.5 / pixelWidth);
    writeNumber(clamp, 1, 0.5 / pixelHeight);
    writeNumber(clamp, 2, 1 - 0.5 / pixelWidth);
    writeNumber(clamp, 3, 1 - 0.5 / pixelHeight);
  }
}

/**
 * Binds a served window's Source and results on its mesh and writes their placement at the window's picture origin,
 * in place. A result with a hole binds the Source for that input. Per frame of a moving window: numbers written where
 * they differ, nothing made.
 *
 * @param shade - The window's shade, its shader on the slot's quad.
 * @param record - The window's record, served.
 * @param x - The window's picture origin, canvas px.
 * @param y - The same down.
 */
export function bindServed(shade: KeptShade, record: KeptRecord, x: number, y: number): void {
  const { back, fu } = shade.quad;
  const texture = record.source?.texture?.source;

  if (back === undefined || texture === undefined) return;

  const uniforms: UniformValues | undefined = fu?.uniforms;

  bindTexture(shade.shader, back, texture);
  if (uniforms !== undefined) writePlace(uniforms, back, texture, x, y);

  const { inputs } = back;
  const targets = record.held?.targets;
  // eslint-disable-next-line unicorn/no-for-loop -- per frame of a moving window: `for…of` over a frozen array allocates.
  for (let index = 0; index < inputs.length; index += 1) {
    const names = inputs[index];
    const bound = targets?.[index]?.source ?? texture;

    if (names === undefined) continue;

    bindTexture(shade.shader, names, bound);
    if (uniforms !== undefined) writePlace(uniforms, names, bound, x, y);
  }
}

/**
 * Lets every Source's texture go: the kept switch went off, or the module is reset.
 *
 * @param kctx - The kept context.
 */
export function dropSourceTextures(kctx: KeptCtx): void {
  for (const source of kctx.state.sources) {
    if (source.texture !== undefined) dropSourceTexture(kctx, source);
  }
}

/**
 * The numbers `stats().sources` reports.
 *
 * @param state - The kept state.
 * @returns The stats.
 */
export function sourceStats(state: KeptState): SourceStats {
  let bytes = 0;

  for (const source of state.sources) {
    bytes += source.bytes;
    for (const held of source.held) bytes += held.bytes;
  }

  return {
    count: state.sources.length,
    takes: state.sourceTakes,
    mb: roundTo(bytes / BYTES_PER_MB, 2),
    mpx: roundTo(state.sourcePixels / MPX, 3)
  };
}
