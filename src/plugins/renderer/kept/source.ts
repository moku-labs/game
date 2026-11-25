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
  PixiFilterManager,
  PixiModule,
  PixiShader,
  PixiTexture,
  PixiTextureSource
} from "../types";
import { textureBytes } from "./geometry";
import { dropTexture, fitTexture, labelOf } from "./render";
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

/** The values of a uniform group, as the placement writes them. */
type UniformValues = Record<string, unknown>;

/**
 * The share a Source's value asks for: 0.5 or 0.25, anything else 0.25.
 *
 * @param scale - The `scale` of the component.
 * @returns The share.
 * @example
 * ```ts
 * scaleOf(0.125); // 0.25
 * ```
 */
export function scaleOf(scale: unknown): number {
  return typeof scale === "number" && (scale === 0.5 || scale === 0.25) ? scale : DEFAULT_SCALE;
}

/**
 * Reads the scale of a Source's component, warning once in a dev build for one it does not draw at.
 *
 * @param kctx - The kept context.
 * @param entity - The entity.
 * @returns The share.
 */
function readScale(kctx: KeptCtx, entity: Entity): number {
  const asked: unknown = kctx.ctx.deps.world.ecs.get(entity, Source)?.scale;
  const scale = scaleOf(asked);
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

  return scale;
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
    scale: readScale(kctx, entity),
    texture: undefined,
    version: 0,
    dirty: true,
    readers: 0,
    held: [],
    matrix: new pixi.Matrix(),
    identity: new pixi.Matrix(),
    sprite: undefined,
    keeper: undefined,
    drawing: undefined,
    bytes: 0
  };

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
 * Frees one result: its targets back to the module's pool as textures, its bytes given back.
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

  if (node.sortableChildren && node.sortDirty) FIND.unsettled = true;

  for (let at = children.length - 1; at >= 0; at -= 1) {
    const found = sourceIn(state, children[at]);

    if (found !== undefined) return found;
  }

  return undefined;
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

    if (parent.sortableChildren && parent.sortDirty) FIND.unsettled = true;

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
  const resolution = source.texture?.source.resolution ?? 1;

  return inputs.key === undefined ? Number.NaN : inputs.key(resolution);
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
  const version = kctx.ctx.state.sync.structureVersion;

  syncTops(kctx);
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
 * A window lets its Source go: its result is released, it reads none.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 */
function leaveSource(kctx: KeptCtx, record: KeptRecord): void {
  releaseHeld(kctx, record);
  record.source = undefined;
  record.reader = false;
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

    if (source !== undefined && source.readers > 0 && source.dirty) takeSource(kctx, pixi, source);
  }
  for (let index = 0; index < state.records.length; index += 1) {
    const record = state.records[index];

    if (record?.reader === true && record.source?.texture !== undefined)
      bringHeld(kctx, pixi, record);
  }
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
  const { top } = source;
  const screen = kctx.host.screen();

  if (top === undefined || top.destroyed || screen === undefined) return;

  source.scale = readScale(kctx, source.entity);

  const resolution = kctx.host.resolution() * source.scale;
  const width = Math.ceil(screen.width * resolution) / resolution;
  const height = Math.ceil(screen.height * resolution) / resolution;
  const texture = fitTexture(
    kctx,
    pixi,
    source.texture,
    { width, height, resolution },
    `source:${labelOf(top)}`
  );

  source.texture = texture;

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
  source.bytes = textureBytes(texture.source.width, texture.source.height, resolution);
  kctx.state.sourceTakes += 1;
  kctx.state.sourcePixels += pixelWidth * pixelHeight;
  kctx.state.flushPasses += 1;

  // Every window over it binds and places again: the texture may be new or of another size.
  for (let index = 0; index < kctx.state.records.length; index += 1) {
    const record = kctx.state.records[index];

    if (record?.source === source) record.dirtyS3 = true;
  }
}

/**
 * Brings a reader's result up to its Source's take and its chain's steps: kept when current; else one of another window
 * with equal steps, shared; else its own drawn again in place when nobody else reads it, or a new one. A change of the
 * result its mesh binds owes the mesh its bindings (`dirtyS3`).
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

  const key = keyOf(inputs, source);
  const shared = sharedHeld(source, slot, key);

  if (shared !== undefined) {
    holdResult(kctx, record, shared);
    noteSeam(record, inputs);

    return;
  }

  const own = record.held;
  const held =
    own !== undefined && own.refs === 1
      ? own
      : { kind: slot.kind, key, owner: inputs, at: -1, targets: [], refs: 0, bytes: 0 };

  if (held !== own) {
    source.held.push(held);
    holdResult(kctx, record, held);
  }

  held.owner = inputs;
  drawHeld(kctx, pixi, source, held, inputs);
  held.key = keyOf(inputs, source);
  noteSeam(record, inputs);
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
 * and its input reads the Source itself.
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

  const { width, height, resolution } = texture.source;
  let any = false;

  held.bytes = 0;

  for (let index = 0; index < inputs.count; index += 1) {
    const scale = inputs.scaleOf(index);
    const target = held.targets[index];

    if (scale === undefined) {
      if (target !== undefined) dropTexture(kctx, target);

      // A hole: the input reads the Source as it is.
      held.targets[index] = undefined;
      continue;
    }

    const fitted = fitTexture(
      kctx,
      pixi,
      target,
      { width, height, resolution: resolution * scale },
      `source:${source.entity}#${index}`
    );

    held.targets[index] = fitted;
    held.bytes += textureBytes(width, height, resolution * scale);
    any = true;
  }

  return any;
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

  if (source.keeper === undefined) {
    const keeper = new pixi.AlphaFilter({ alpha: 1 });

    keeper.apply = (manager: PixiFilterManager, input: PixiTexture): void => {
      const { drawing } = source;

      drawing?.owner.draw(manager, input, drawing.targets);
    };
    source.keeper = keeper;
  }

  const resolution = texture.source.resolution;

  if (source.keeper.resolution !== resolution) source.keeper.resolution = resolution;
  if (source.keeper.padding !== 0) source.keeper.padding = 0;

  if (source.sprite === undefined || source.sprite.destroyed) {
    source.sprite = new pixi.Sprite(texture);
    source.sprite.label = `source:${source.entity}#chain`;
    source.sprite.filters = [source.keeper];
  } else if (source.sprite.texture !== texture) {
    source.sprite.texture = texture;
  }

  return source.sprite;
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
 */
function drawHeld(
  kctx: KeptCtx,
  pixi: PixiModule,
  source: SourceRecord,
  held: HeldChain,
  inputs: FilterSlotInputs
): void {
  const texture = source.texture;

  held.at = source.version;

  if (texture === undefined || !sizeHeld(kctx, pixi, source, held, inputs)) return;

  const sprite = keeperOf(pixi, source);

  source.drawing = held;
  kctx.host.renderTo(sprite, texture, source.identity, false);

  if (scalesMoved(held, inputs) && sizeHeld(kctx, pixi, source, held, inputs)) {
    kctx.host.renderTo(sprite, texture, source.identity, false);
  }

  source.drawing = undefined;

  const { pixelWidth, pixelHeight } = texture.source;
  const perInput = inputs.stages.length / Math.max(inputs.count, 1);
  let pixels = pixelWidth * pixelHeight;

  for (const target of held.targets) {
    if (target !== undefined)
      pixels += target.source.pixelWidth * target.source.pixelHeight * perInput;
  }

  kctx.state.flushPasses += 1 + inputs.stages.length;
  kctx.state.sourcePixels += pixels;
}

/**
 * Tells whether a scale of a chain changed inside its draw: the targets have another size than it asks for now.
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
    if (target !== undefined && scale !== undefined) {
      const wanted = Math.round(target.source.width * target.source.resolution);

      if (Math.abs(wanted - target.source.pixelWidth) > 1) return true;
    }
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
