/**
 * @file renderer/kept — one cached view: whether it may be kept, the keys of its stages, its two lives and the policy
 * between them (P4). A view that stood still for two drawn frames is taken, a stack drawn direct in its first frame
 * without a change, at most one first take a frame and none while an alpha is due (F114); a kept view whose subtree
 * changes in three drawn frames in a row goes live until it stood still for eight; a move only moves the quad. A step
 * of the renderer resolution keeps the pictures: one drawn lower is refined a few a flush (F126). A kept view whose filter
 * numbers keep changing goes on its filter's own shader and back to a sprite at rest (F126 stage 2, `shade.ts`). A view
 * with a node under its top that blends otherwise than normally is never taken (F68). Taking and releasing happen inside
 * the flush, before the stage pass, both halves in the same frame (K3).
 */
import type { FilterSlot, SyncState, SyncWriters, View } from "../sync/types";
import type {
  FilterSlotInputs,
  PixiContainer,
  PixiFilter,
  PixiModule,
  PixiRenderTexture,
  PixiTexture
} from "../types";
import { makeRoom, warnRefused } from "./budget";
import { drawnBounds } from "./drawn-bounds";
import {
  cutSpan,
  drawnResolution,
  fitsTexture,
  gridSpan,
  KEY,
  KEY_SIZE,
  linearBounds,
  onGrid,
  paddingOnGrid,
  storeMatrix,
  textureBytes
} from "./geometry";
import {
  bytesOf,
  dropTexture,
  endLoan,
  firstInputs,
  labelOf,
  poolTexture,
  renderStage1,
  renderStage2,
  renderStage3,
  setOrigins,
  standInOf
} from "./render";
import { enabledSlot, enterShade, leaveShade, renderShade } from "./shade";
import { destroyRecord } from "./state";
import {
  type KeptCtx,
  type KeptMatrices,
  type KeptQuad,
  type KeptRecord,
  type KeptState,
  RETAKE,
  WHY
} from "./types";

/** Drawn frames a live view stands still before it is taken. */
export const TAKE_AFTER = 2;

/** Stage-1 retakes in a row after which a kept view goes live. */
export const CHURN_LIMIT = 3;

/** Drawn frames a view that churned stands still before it is taken again. */
export const CALM_AFTER = 8;

/**
 * How far a kept picture is drawn scaled from the scale it was taken at, either way (F67): past it the texels would
 * blur or shimmer, and the picture is taken again at the new scale.
 */
export const SCALED_LIMIT = 2;

/**
 * Views with a filter drawn live, not yet kept, from which a first take of one of them waits for no other (F119): each
 * breaks the canvas pass with its filter in every frame it waits, while its take renders into small targets before the
 * stage pass. Fewer keep the one-a-frame spread of F114 (a few pieces of the board under the leaving memory).
 */
export const CROWD = 4;

/**
 * First takes a frame among a crowd drawn live (F119): a take costs about one pass more than the live draw it ends, so
 * no frame of a board's entry passes the live frame before it by more than this; forty shadows rest in four frames.
 */
export const CROWD_TAKES = 10;

/**
 * Limited takes a flush (F126): the refining of a picture coarser than the canvas after a step of the resolution and
 * the settle of a picture at rest off its grid, together. Forty pictures that owe one are taken over twenty frames; on
 * the bench a picture is 4 passes, 5–6 ms on the A26 at 221 MHz: two keep the frame near 29 ms, four took it to 44.
 */
export const REFINE_TAKES = 2;

/**
 * Times stage 3 alone is owed before a record goes on its own shader (F126 stage 2): a stage 3 pass costs about 1.9 ms on
 * the A26, a mesh frame 0.08 ms, so a view that keeps writing pays twice and then stops paying.
 */
export const QUAD_AFTER = 2;

/**
 * Drawn frames without a change before a shaded record goes back to a sprite, about a second at the 30 frames of the
 * A26. Staying costs 0.08 ms GPU and 0.03 ms CPU a frame on the bench's small body, and the whole body's fill on a heavy
 * one; going back costs one stage 3 pass and a rebuild of the render group's instructions.
 */
export const QUAD_CALM = 30;

/** The reasons an ancestor may be hidden by and still draw the view: an overlay's range, a kept ancestor's picture. */
const DRAWN_ANYWAY = ["freeze", "kept"] as const;

/** The tint of a container that tints nothing. */
const WHITE = 0xff_ff_ff;

/**
 * What a stack of filters draws with this frame: how many are enabled, their smallest resolution, their padding, the
 * alpha they multiply by when every enabled one is an `AlphaFilter` (NaN otherwise), and the passes they apply. Reused: one object for the
 * module.
 */
type Stack = { enabled: number; rs: number; P: number; alpha: number; passes: number };

/** The numbers of one frame of a record: the stack and the top's world transform. */
type Numbers = Stack & {
  r: number;
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
};

/** The numbers of the record being stepped. One object: a step allocates nothing. */
const NOW: Numbers = {
  enabled: 0,
  rs: 1,
  P: 0,
  alpha: Number.NaN,
  passes: 0,
  r: 1,
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0
};

/** What a record draws: its life, the passes of the flush so far, its quad's translation and whether the quad shows. */
type Drawing = {
  mode: KeptRecord["mode"];
  passes: number;
  qtx: number;
  qty: number;
  shown: boolean;
};

/** What a kept record owes `refresh`: nothing, the filter output, or the pre-pass results and the filter output. */
const OWED = { none: 0, output: 1, chain: 2 } as const;

/** The stack of a record looked at before the step (F114), or above it (F126). One object: the look allocates nothing. */
const DUE: Stack = { enabled: 0, rs: 1, P: 0, alpha: Number.NaN, passes: 0 };

/** What the record being stepped drew before its step. One object: a step allocates nothing. */
const BEFORE: Drawing = {
  mode: "live",
  passes: 0,
  qtx: Number.NaN,
  qty: Number.NaN,
  shown: false
};

/**
 * Reads what the enabled filters of a stack draw with: how many, the smallest resolution, the padding sum Pixi
 * pads by (whole pixels), and the alpha they multiply by while every one is an `AlphaFilter`. A filter on `"inherit"`
 * draws at the renderer resolution (Pixi's own rule), the one `markAlphaDue` wrote to `NOW`.
 *
 * @param slots - The record's slots.
 * @param alphaFilter - Pixi's `AlphaFilter` class.
 * @param into - Where the numbers go.
 */
function readStack(
  slots: readonly FilterSlot[],
  alphaFilter: PixiModule["AlphaFilter"],
  into: Stack
): void {
  let enabled = 0;
  let rs = Number.POSITIVE_INFINITY;
  let padding = 0;
  let alpha = 1;
  let passes = 0;

  // per drawn frame and record: `effects` hands its lists frozen, and `for…of` over a frozen array allocates (88 B).
  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < slots.length; index += 1) {
    const filter = slots[index]?.filter;

    if (filter === undefined || !filter.enabled) continue;

    enabled += 1;
    passes += slots[index]?.passes ?? 0;

    const own: number | "inherit" = filter.resolution;

    // Each side its own `min`: merging `NOW.r` with `own` merges a number with a string, which boxes a fractional one.
    rs = own === "inherit" ? Math.min(rs, NOW.r) : Math.min(rs, own);
    padding += filter.padding;
    alpha *= filter instanceof alphaFilter ? filter.alpha : Number.NaN;
  }

  into.enabled = enabled;
  into.rs = enabled === 0 ? NOW.r : rs;
  into.P = Math.trunc(padding);
  into.alpha = alpha;
  into.passes = passes;
}

/**
 * Tells whether a stack draws as its subtree picture at an alpha (F54): every enabled filter an `AlphaFilter`, no
 * padding, at the renderer resolution. The quad then draws the picture itself at that alpha, as Pixi's alpha pass
 * draws its input: no stage 3, no pass when the alpha changes.
 *
 * @param stack - The stack's numbers.
 * @returns True when it does.
 */
function drawsDirect(stack: Stack): boolean {
  return !Number.isNaN(stack.alpha) && stack.P === 0 && stack.rs === NOW.r;
}

/**
 * Tells whether the record being stepped may draw through its filter's own body (F126 stage 2): on WebGPU, one enabled
 * filter with a quad, no inputs, on `"inherit"`, at the canvas resolution, and not drawn direct. An `Alpha` beside it does
 * not fit: stage 3 draws `F(A·x)` in stack order, the mesh would draw `A·F(x)`, and for a body that is not alpha-linear
 * the picture would pop at every entry. A top that blends otherwise never gets here: `pictureWhy` refuses it. A mesh
 * destroyed with a parent around it has nothing left to draw on. Read on `NOW`, once a step; allocates nothing.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @returns True when it fits.
 */
function shadeFits(kctx: KeptCtx, record: KeptRecord): boolean {
  if (kctx.host.kind() !== "webgpu" || NOW.enabled !== 1) return false;
  if (NOW.rs !== NOW.r || drawsDirect(NOW)) return false;

  const slot = enabledSlot(record.slots);

  return (
    slot?.quad !== undefined &&
    slot.inputs === undefined &&
    slot.filter.resolution === "inherit" &&
    (!record.shaded || record.shade?.mesh.destroyed !== true)
  );
}

/**
 * Tells whether a take the budget refused still does not fit (P6.3); the pool's bytes are the take's to have (F119).
 *
 * @param state - The kept state.
 * @param record - The record.
 * @returns True when it still does not fit.
 */
function refusalHolds(state: KeptState, record: KeptRecord): boolean {
  return (
    record.refused > 0 &&
    state.bytes - state.poolBytes + record.refused - record.bytes > state.budget
  );
}

/**
 * Tells whether a first take waits for the next frame, and why (F114): a stack drawn direct never does; a view drawn
 * live while a crowd of them waits only when `CROWD_TAKES` were taken in this frame already (F119); any other waits when
 * an alpha is due or this frame took one already.
 *
 * @param state - The kept state.
 * @param direct - The stack draws direct.
 * @param live - The view is drawn live in this frame.
 * @returns The `WHY` it waits for, 0 when it does not.
 */
function heldBack(state: KeptState, direct: boolean, live: boolean): number {
  if (direct) return 0;
  if (live && state.liveWaiting >= CROWD) return state.firstTakes >= CROWD_TAKES ? WHY.waiting : 0;
  if (state.alphaDue) return WHY.alphaDue;

  return state.firstTakes > 0 ? WHY.waiting : 0;
}

/**
 * Tells whether a view is drawn live in the stage pass of this frame (F119): every ancestor up to the stage is
 * renderable, none drawn through an overlay's range picture or a kept ancestor's picture. Waiting, it costs a filter
 * pass on the canvas; its take costs about the same, in small targets before the stage pass.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @returns True when it is drawn live.
 */
function drawnLive(kctx: KeptCtx, record: KeptRecord): boolean {
  const stage = kctx.host.stage();

  for (let node = record.top.parent; node !== stage; node = node.parent) {
    if (node === null || !node.renderable) return false;
  }

  return true;
}

/**
 * Tells whether a blend mode draws over what is under it as a picture does.
 *
 * @param mode - A container's or a filter's blend mode.
 * @returns True for `"inherit"` and `"normal"`.
 */
function plainBlend(mode: string): boolean {
  return mode === "inherit" || mode === "normal";
}

/**
 * Tells whether a node holds filters.
 *
 * @param node - The node.
 * @returns True when it holds at least one.
 */
function holdsFilters(node: PixiContainer): boolean {
  const filters: readonly PixiFilter[] | null | undefined = node.filters;

  return filters !== null && filters !== undefined && filters.length > 0;
}

/**
 * Tells whether the filters of a stack draw like a picture: none reads the backdrop, every one blends normally.
 *
 * @param slots - The record's slots.
 * @returns 0 when they do, else the `WHY` of the first that does not.
 */
function filtersWhy(slots: readonly FilterSlot[]): number {
  // per drawn frame and record: a frozen list, walked by index (`for…of` allocates over a frozen array).
  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < slots.length; index += 1) {
    const filter = slots[index]?.filter;

    if (filter === undefined || !filter.enabled) continue;
    if (filter.blendRequired) return WHY.backdrop;
    if (!plainBlend(filter.blendMode)) return WHY.filterBlend;
  }

  return 0;
}

/**
 * The filters `sync` keeps for an entity, as `setFilters` stored them.
 *
 * @param state - The sync state.
 * @param entity - The entity.
 * @returns Its slots, empty when it has none.
 */
function filtersOf(state: SyncState, entity: number): readonly FilterSlot[] {
  return state.filters.get(entity) ?? [];
}

/**
 * Tells whether the view's top is drawn: no hidden reason but its own picture and an overlay's range holds it.
 *
 * @param sync - The writers of `sync`: its reader of the hidden reasons.
 * @param view - The view.
 * @returns True when nothing else hides it.
 */
function topDrawn(sync: SyncWriters, view: View): boolean {
  const { hiddenBy } = sync;

  if (hiddenBy(view, "cover")) return false;
  if (hiddenBy(view, "alpha") && (view.kind !== "adapter" || view.wrapper === undefined))
    return false;

  return !(hiddenBy(view, "empty") && view.wrapper === undefined);
}

/**
 * Tells whether an ancestor is drawn: renderable, or hidden only by an overlay's range or a kept ancestor's picture,
 * which draw it anyway.
 *
 * @param kctx - The kept context.
 * @param node - The ancestor.
 * @returns True when it is drawn.
 */
function drawnAnyway(kctx: KeptCtx, node: PixiContainer): boolean {
  return node.renderable || kctx.sync.hiddenOnlyAmong(kctx.hidden, node, DRAWN_ANYWAY);
}

/**
 * Tells whether an ancestor filters a placed record's view: a filter of its own or its kept picture. A placed filter's
 * canvas position would then not be the canvas pixel live.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param node - The ancestor.
 * @returns True when the record is placed and the ancestor filters it.
 */
function filtersPlaced(kctx: KeptCtx, record: KeptRecord, node: PixiContainer): boolean {
  return (
    record.category === "placed" &&
    (holdsFilters(node) || kctx.state.byTop.get(node)?.mode === "kept")
  );
}

/**
 * Tells whether an ancestor draws what is under it as a picture would: visible, untinted, blending normally, drawn (an
 * overlay's range and a kept ancestor's picture count), and for a placed filter holding no filter (its canvas position
 * would not be the canvas pixel live). Its alpha is not read (F113): the quad hangs in the top's parent and Pixi
 * multiplies it by the ancestors' alpha, while stage 1 renders the top as a root without them. A fading ancestor so
 * draws the picture at `A·F(x)`, live draws `F(A·x)`: the same for an alpha-linear filter, the whole picture faded for
 * one that is not.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param node - The ancestor.
 * @returns 0 when it does, else the `WHY` it does not.
 */
function ancestorWhy(kctx: KeptCtx, record: KeptRecord, node: PixiContainer): number {
  if (!node.visible) return WHY.ancestorHidden;
  if (node.tint !== WHITE) return WHY.ancestorTint;
  if (!plainBlend(node.blendMode)) return WHY.ancestorBlend;
  if (!drawnAnyway(kctx, node)) return WHY.ancestorHidden;

  return filtersPlaced(kctx, record, node) ? WHY.placedUnderFilter : 0;
}

/**
 * Tells whether every ancestor up to the stage draws the view as a picture would (`ancestorWhy`).
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param stage - The stage of the application.
 * @returns 0 when they do, else the `WHY` of the first that does not.
 */
function ancestorsWhy(kctx: KeptCtx, record: KeptRecord, stage: PixiContainer): number {
  for (let node = record.top.parent; node !== stage; node = node.parent) {
    if (node === null) return WHY.ancestorHidden;

    const why = ancestorWhy(kctx, record, node);

    if (why !== 0) return why;
  }

  return 0;
}

/**
 * Whether a record may be kept this frame (P4.1): the switch on, an enabled filter, filters that draw like a picture, a
 * top and a visual that blend normally (the visual sits inside the wrapper of a kept bare view, D4), a top that is
 * drawn, ancestors that draw it as a picture would.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param view - Its view.
 * @param stack - The stack of this frame.
 * @returns 0 when it may be kept, else the `WHY` of the first check that failed.
 */
function eligible(kctx: KeptCtx, record: KeptRecord, view: View, stack: Stack): number {
  const stage = kctx.host.stage();

  if (!keepingOn(kctx) || stage === undefined || stack.enabled === 0) return WHY.off;

  const filters = filtersWhy(record.slots);

  if (filters !== 0) return filters;

  const picture = pictureWhy(record.top, view);

  if (picture !== 0) return picture;
  if (!topDrawn(kctx.sync, view)) return WHY.hidden;

  return ancestorsWhy(kctx, record, stage);
}

/**
 * Tells whether the kept cache may keep anything this frame: switched on and not bypassed.
 *
 * @param kctx - The kept context.
 * @returns True when pictures may be kept.
 */
function keepingOn(kctx: KeptCtx): boolean {
  return kctx.state.on && !kctx.state.bypassed;
}

/**
 * Tells whether a top and its visual draw as a picture does: the top visible and not faded out, both blending
 * normally (the visual sits inside the wrapper of a kept bare view, D4).
 *
 * @param top - The record's top.
 * @param view - Its view.
 * @returns 0 when they do, else the `WHY` they do not.
 */
function pictureWhy(top: PixiContainer, view: View): number {
  if (top.visible && top.alpha > 0) {
    return plainBlend(top.blendMode) && plainBlend(view.object.blendMode) ? 0 : WHY.topBlend;
  }

  return WHY.fadedOut;
}

/**
 * Tells whether a node under a top blends otherwise than normally, at any depth (F68): drawn into a picture, it would
 * blend with the picture's empty texture, not with what is drawn under the view, and a glow would cover the board under
 * it instead of lighting it. Recursive, by index over `children`: allocates nothing.
 *
 * @param node - The top, or a node under it; its own blend is not read (`eligible` reads the top's and the visual's).
 * @returns True when a node under it blends otherwise.
 */
function blendsBelow(node: PixiContainer): boolean {
  const { children } = node;

  // per take attempt: a walk of the subtree, no iterator.
  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];

    if (child !== undefined && (!plainBlend(child.blendMode) || blendsBelow(child))) return true;
  }

  return false;
}

/**
 * Tells whether a record's subtree holds a node that blends otherwise than normally, and remembers a yes (`blended`):
 * a refused record is not walked again until a change under its top clears it (`stepRecord`). The first refusal of a
 * top is warned once per run, by its label.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @returns True when the record may not be taken.
 */
function blendedBelow(kctx: KeptCtx, record: KeptRecord): boolean {
  if (record.blended) return true;
  if (!blendsBelow(record.top)) return false;

  record.blended = true;

  const { warnedBlend } = kctx.state;
  const label = labelOf(record.top);

  if (!warnedBlend.has(label)) {
    warnedBlend.add(label);
    kctx.ctx.log.warn("renderer:kept-blend", { picture: label });
  }

  return true;
}

/**
 * Tells whether a view of kind `"Display"` hangs in a subtree, the top included: a game's own object it may write
 * without telling the renderer when `onDemand` is off. A walk, made only at a take.
 *
 * @param kctx - The kept context.
 * @param top - The subtree's top.
 * @returns True when one does.
 */
function holdsDisplay(kctx: KeptCtx, top: PixiContainer): boolean {
  const { entityOf, views } = kctx.ctx.state.sync;
  const open: PixiContainer[] = [top];

  for (let node = open.pop(); node !== undefined; node = open.pop()) {
    const entity = entityOf.get(node);

    if (entity !== undefined && views.get(entity)?.kind === "Display") return true;

    open.push(...node.children);
  }

  return false;
}

/**
 * Makes the record of a filtered view, live, with keys no frame has seen.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param entity - The entity.
 * @param view - Its view.
 * @param slots - Its slots.
 * @param category - The worst category of the slots.
 * @returns The record, in the maps and the list.
 */
export function createRecord(
  kctx: KeptCtx,
  pixi: PixiModule,
  entity: number,
  view: View,
  slots: readonly FilterSlot[],
  category: "local" | "placed"
): KeptRecord {
  const top = view.wrapper ?? view.object;
  const key = new Float64Array(KEY_SIZE).fill(Number.NaN);
  const record: KeptRecord = {
    entity,
    top,
    wasGroup: top.isRenderGroup,
    mode: "live",
    slots,
    category,
    standIn: undefined,
    keeperStandIn: undefined,
    quad: undefined,
    shade: undefined,
    shaded: false,
    outputRuns: 0,
    outputAt: 0,
    shadedAt: 0,
    keeper: undefined,
    s1: undefined,
    s2: [],
    s3: undefined,
    s1Version: 0,
    s2InputsVersion: 0,
    s2PictureVersion: 0,
    s2Of: undefined,
    dirtyS1: true,
    dirtyS2: false,
    dirtyS3: false,
    key,
    matrix: new pixi.Matrix(),
    still: 0,
    churn: 0,
    calm: false,
    quiet: 0,
    lastDrawn: kctx.state.frame,
    depth: 0,
    bytes: 0,
    settle: false,
    coarse: false,
    refined: false,
    redrawn: false,
    refused: 0,
    cut: false,
    direct: false,
    displays: undefined,
    blended: false,
    takenAt: Number.NaN,
    spared: false,
    idle: false,
    alphaDue: false,
    alphaMissed: false,
    idleSeen: false,
    why: WHY.waiting,
    calmIn: TAKE_AFTER,
    markBy: 0,
    retakeWhy: 0,
    retakeBy: 0,
    retakeAt: 0
  };
  const { state } = kctx;

  state.records.push(record);
  state.byEntity.set(entity, record);
  state.byTop.set(top, record);
  state.unsorted = true;

  return record;
}

/**
 * Draws a kept record live again, in this frame (P4.4): the loan of stage 2 ends, the filters go back onto the top,
 * the reason `"kept"` goes without a mark (the two halves draw the same pixels), the quad hides. Its textures stay.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param view - Its view, `undefined` when it left.
 * @param putBack - False when the view is leaving: the release strips its filters anyway.
 */
export function goLive(
  kctx: KeptCtx,
  record: KeptRecord,
  view: View | undefined,
  putBack: boolean
): void {
  leaveShade(record);
  endLoan(record.s2Of);
  setOrigins(record.slots, 0, 0);

  // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
  if (record.standIn !== undefined && !record.standIn.destroyed) record.standIn.filters = null;

  // Onto the view's top now: a view that got a wrapper while kept takes its filters on the new top.
  if (view !== undefined && putBack) {
    kctx.sync.applyFilters(view, filtersOf(kctx.ctx.state.sync, record.entity), noMark);
  }

  if (view !== undefined) kctx.sync.swapHidden(kctx.hidden, view, "kept", false);
  if (record.quad?.visible === true) record.quad.visible = false;

  ungroup(kctx, record);
  record.mode = "live";
  record.still = 0;
}

/**
 * Undoes the render group the cache made of a top that is drawn live again: drawn with its filters inside a parent's
 * filter pass, a top that stays a render group draws other pixels than the container it was (found by the browser
 * leg, T4). Its subtree's colour is worked out again. The next take makes it one again.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 */
function ungroup(kctx: KeptCtx, record: KeptRecord): void {
  const { madeGroups } = kctx.state;

  if (!madeGroups.has(record.top)) return;

  if (!record.top.destroyed) {
    record.top.disableRenderGroup();
    recolour(record.top);
  }

  madeGroups.delete(record.top);
}

/**
 * Makes Pixi work out the colour of a top's subtree again after it stopped being a render group. Pixi's
 * `disableRenderGroup` hands the children to the parent's group with the colour and alpha they had inside the group
 * they left, which leave out the top's own: a top at alpha 0.5 would draw its subtree at 1 from then on (Pixi's
 * `enableRenderGroup` flags them, the way back does not). An alpha written away and back, through Pixi's public
 * setter, flags the top, and Pixi's next update carries the flag down the subtree; nothing is drawn in between.
 *
 * @param top - The top, no render group any more.
 */
function recolour(top: PixiContainer): void {
  const alpha = top.alpha;

  top.alpha = alpha === 0 ? 1 : 0;
  top.alpha = alpha;
}

/**
 * The `before` of a filter write the cache makes: none marks, the frame is decided already and draws the same pixels.
 */
function noMark(): void {
  // The flush writes inside the render phase, after the decision: nothing to mark.
}

/**
 * Drops a record (P4.6): live first when kept, then every engine object and texture destroyed, the render group the
 * cache made undone, out of the maps and the list.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param view - Its view, `undefined` when it left.
 * @param putBack - False when the view is leaving.
 */
export function dropRecord(
  kctx: KeptCtx,
  record: KeptRecord,
  view: View | undefined,
  putBack: boolean
): void {
  const { state } = kctx;

  if (record.mode === "kept") goLive(kctx, record, view, putBack);

  endLoan(record.s2Of);
  // Its textures wait in the pool for the next take of their size (F119).
  destroyRecord(record, texture => poolTexture(kctx, texture));
  ungroup(kctx, record);

  state.bytes -= record.bytes;
  record.bytes = 0;

  const at = state.records.indexOf(record);

  if (at !== -1) state.records.splice(at, 1);
  if (state.byEntity.get(record.entity) === record) state.byEntity.delete(record.entity);
  if (state.byTop.get(record.top) === record) state.byTop.delete(record.top);
}

/**
 * Writes the keys the next frames compare a live record with: the linear part and the stack resolution of this frame.
 *
 * @param record - The record.
 * @param now - This frame's numbers.
 */
function writeSeen(record: KeptRecord, now: Numbers): void {
  const { key } = record;

  key[KEY.seenA] = now.a;
  key[KEY.seenB] = now.b;
  key[KEY.seenC] = now.c;
  key[KEY.seenD] = now.d;
  key[KEY.seenRs] = now.rs;
}

/**
 * Tells whether this frame's linear part differs from the one a set of keys holds. Pure.
 *
 * @param key - The record's key.
 * @param now - This frame's numbers.
 * @param base - The index of `a` in the set: `KEY.a` (the take) or `KEY.seenA` (the last frame).
 * @returns True when one number differs.
 */
function linearMoved(key: Float64Array, now: Numbers, base: number): boolean {
  return (
    key[base] !== now.a ||
    key[base + 1] !== now.b ||
    key[base + 2] !== now.c ||
    key[base + 3] !== now.d
  );
}

/**
 * Tells whether this frame's linear part or stack resolution differs from the ones a set of keys holds.
 *
 * @param key - The record's key.
 * @param now - This frame's numbers.
 * @param base - The index of `a` in the set: `KEY.a` (the take) or `KEY.seenA` (the last frame).
 * @param rsAt - The index of the stack resolution in the set.
 * @returns True when one differs.
 */
function linearDiffers(key: Float64Array, now: Numbers, base: number, rsAt: number): boolean {
  return linearMoved(key, now, base) || key[rsAt] !== now.rs;
}

/**
 * The bytes a take needs: the subtree picture, the filter output and the pre-pass results.
 *
 * @param record - The record.
 * @param now - This frame's numbers.
 * @param box - The picture's size, CSS px.
 * @param box.w1 - Width.
 * @param box.h1 - Height.
 * @param box.Ps - The padding on the grid.
 * @returns Bytes.
 */
function neededBytes(
  record: KeptRecord,
  now: Numbers,
  box: { w1: number; h1: number; Ps: number }
): number {
  const { w1, h1, Ps } = box;
  let bytes = textureBytes(w1, h1, now.rs);

  // A stack drawn direct keeps no filter output.
  if (!drawsDirect(now)) bytes += textureBytes(w1 + 2 * Ps, h1 + 2 * Ps, now.r);

  const first = firstInputs(record.slots);

  if (first !== undefined) {
    for (let index = 0; index < first.inputs.count; index += 1) {
      const scale = first.inputs.scaleOf(index) ?? 0;

      bytes += textureBytes(w1 + 2 * now.P, h1 + 2 * now.P, now.rs * scale);
    }
  }

  return bytes;
}

/**
 * Hands the filters of a live record from its top to its stand-in, before stage 1 renders the top without them: the
 * enabled ones, as `sync` hangs them (E3).
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param record - The record.
 * @param view - Its view.
 */
function handFilters(kctx: KeptCtx, pixi: PixiModule, record: KeptRecord, view: View): void {
  const standIn = standInOf(pixi, record);

  kctx.sync.clearFilters(record.top);
  kctx.sync.applyFilters(view, filtersOf(kctx.ctx.state.sync, record.entity), noMark, standIn);
}

/**
 * Writes the take keys of a record: the linear part, the stack resolution and the translation of this frame, and the
 * picture's box on the canvas.
 *
 * @param record - The record.
 * @param now - This frame's numbers.
 * @param box - The picture's box: its first texel on each axis and its size in CSS px.
 * @param box.x - The span of the picture across, on the `rs` grid.
 * @param box.x.first - Its first texel.
 * @param box.y - The span of the picture down, on the `rs` grid.
 * @param box.y.first - Its first texel.
 * @param box.w1 - The picture's width, CSS px.
 * @param box.h1 - The picture's height, CSS px.
 */
function writeTakeKeys(
  record: KeptRecord,
  now: Numbers,
  box: { x: { first: number }; y: { first: number }; w1: number; h1: number }
): void {
  const { key } = record;

  key[KEY.a] = now.a;
  key[KEY.b] = now.b;
  key[KEY.c] = now.c;
  key[KEY.d] = now.d;
  key[KEY.rs] = now.rs;
  key[KEY.tx] = now.tx;
  key[KEY.ty] = now.ty;
  key[KEY.X0] = box.x.first / now.rs;
  key[KEY.Y0] = box.y.first / now.rs;
  key[KEY.w1] = box.w1;
  key[KEY.h1] = box.h1;
}

/**
 * Refuses a take that cannot succeed until something changes (nothing to render, a `Display` without `onDemand`, too
 * big for a texture) and remembers it (F114): the record attempts nothing until a change under its top or a move of it.
 *
 * @param record - The record.
 * @returns False, the refusal.
 */
function refuseIdle(record: KeptRecord): boolean {
  record.idle = true;
  record.idleSeen = true;

  return false;
}

/**
 * Takes or retakes the picture of a record: stages 1, 2 (when its first filter has inputs) and 3, at the phase of this
 * frame. The bounds are cut to the filter area of the top when it holds one (F43). Refused, and the view drawn live,
 * for a `Display` in the subtree without `onDemand`, a node under the top that blends otherwise (F68, warned once per
 * top), empty bounds, a picture over 4096 device pixels, a picture cut to the canvas while its linear part moves (it
 * is never drawn scaled, F113), or a budget that has no room (P6.3, warned once).
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record.
 * @param view - Its view.
 * @param now - This frame's numbers.
 * @param turned - True when the linear part moved since the last frame: a first take under a zoom.
 * @returns True when every stage rendered.
 */
function takePicture(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View,
  now: Numbers,
  turned = false
): boolean {
  const { top } = record;

  record.displays = !kctx.ctx.config.onDemand && holdsDisplay(kctx, top);

  // A game's own object it may write unseen without `onDemand`, and an empty subtree, are never kept.
  if (record.displays) return refuseIdle(record);
  // A glow under the top would blend with the picture's empty texture: a retake goes live (F68).
  if (blendedBelow(kctx, record)) return false;

  // What Pixi draws of the subtree, no node it skips (F58); a filter area bounds what the filters draw, so it bounds
  // the picture too (F43): same pixels, a smaller texture.
  const drawn = drawnBounds(pixi, top);

  if (!drawn.isValid) return refuseIdle(record);

  const local = clippedToArea(drawn, top.filterArea);

  if (isEmptyBounds(local)) return refuseIdle(record);

  // The picture's box on the canvas, cut to it as the live pass cuts its target (F53), on the grid of the stack
  // resolution, and its padding; both textures must fit.
  const box = linearBounds(now.a, now.b, now.c, now.d, local);
  const screen = kctx.host.screen();
  const width = screen?.width ?? Number.POSITIVE_INFINITY;
  const height = screen?.height ?? Number.POSITIVE_INFINITY;
  const Ps = paddingOnGrid(now.P, now.rs);
  const across = cutSpan(now.tx + box.x0, now.tx + box.x1, width, Ps);
  const down = cutSpan(now.ty + box.y0, now.ty + box.y1, height, Ps);

  if (isEmptySpan(across) || isEmptySpan(down)) return refuseIdle(record);

  // Cut when the canvas took a side off the box.
  const cut =
    across.start > now.tx + box.x0 ||
    across.end < now.tx + box.x1 ||
    down.start > now.ty + box.y0 ||
    down.end < now.ty + box.y1;

  // A cut picture is never drawn scaled: taken while an ancestor zooms, it would be taken again every frame (F113). The
  // refusal is remembered: the record waits for rest (`linearResets`), and the take at rest writes `cut` again.
  if (cut && turned) {
    record.cut = true;

    return false;
  }

  const x = gridSpan(across.start, across.end, now.rs);
  const y = gridSpan(down.start, down.end, now.rs);
  const w1 = x.texels / now.rs;
  const h1 = y.texels / now.rs;

  if (!fitsTexture(w1, h1, now.rs) || !fitsTexture(w1 + 2 * Ps, h1 + 2 * Ps, now.r)) {
    return refuseIdle(record);
  }

  // The budget makes room by drawing the least recently drawn pictures live; no room refuses the take (P6.3).
  const needed = neededBytes(record, now, { w1, h1, Ps });

  if (
    !makeRoom(kctx, needed - record.bytes, record, kept =>
      goLive(kctx, kept, kctx.ctx.state.sync.views.get(kept.entity), true)
    )
  ) {
    record.refused = needed;
    kctx.state.frameRefused += 1;
    warnRefused(kctx, labelOf(top));

    return false;
  }

  record.refused = 0;
  record.cut = cut;
  record.key[KEY.sw] = width;
  record.key[KEY.sh] = height;
  writeTakeKeys(record, now, { x, y, w1, h1 });

  const ok = renderStages(kctx, pixi, matrices, record, view, now);

  record.settle = false;
  record.coarse &&= !ok;
  writeSeen(record, now);

  return ok;
}

/**
 * Tells whether a span holds nothing: its end is not after its start. Pure.
 *
 * @param span - The span.
 * @param span.start - Its start.
 * @param span.end - Its end.
 * @returns True when it is empty.
 * @example
 * ```ts
 * isEmptySpan({ start: -10, end: -10 }); // true
 * ```
 */
function isEmptySpan(span: { start: number; end: number }): boolean {
  return span.end <= span.start;
}

/** Local bounds as the kept geometry reads them. */
type LocalBox = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * The local bounds of a top cut to its filter area, both in the top's own units: its filters draw nothing outside
 * the area. With no area the bounds are returned as they are. Pure.
 *
 * @param bounds - The top's local bounds.
 * @param area - The filter area on the top, or none.
 * @returns The bounds the picture takes.
 * @example
 * ```ts
 * clippedToArea({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, { x: 100, y: 100, width: 40, height: 40 }); // { minX: 100, minY: 100, maxX: 140, maxY: 140 }
 * ```
 */
function clippedToArea(
  bounds: Readonly<LocalBox>,
  area: Readonly<{ x: number; y: number; width: number; height: number }> | null | undefined
): Readonly<LocalBox> {
  if (area === null || area === undefined) return bounds;

  return {
    minX: Math.max(bounds.minX, area.x),
    minY: Math.max(bounds.minY, area.y),
    maxX: Math.min(bounds.maxX, area.x + area.width),
    maxY: Math.min(bounds.maxY, area.y + area.height)
  };
}

/**
 * Tells whether local bounds hold nothing to draw: no width or no height. Pure.
 *
 * @param bounds - The bounds of a subtree in its own space.
 * @returns True when they are empty.
 * @example
 * ```ts
 * isEmptyBounds({ minX: 0, minY: 0, maxX: 0, maxY: 40 }); // true
 * ```
 */
function isEmptyBounds(
  bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>
): boolean {
  return !(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY);
}

/**
 * Renders the stages of a take whose keys are written: the subtree picture, the pre-pass results of the first filter
 * with inputs, the filter output; the budget counts the textures after. A live view whose take failed draws live
 * again: its filters go back on its top.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record.
 * @param view - Its view.
 * @param now - This frame's numbers.
 * @returns True when every stage rendered.
 */
function renderStages(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View,
  now: Numbers
): boolean {
  const live = record.mode === "live";

  if (live) handFilters(kctx, pixi, record, view);

  const first = firstInputs(record.slots);
  let ok = renderStage1(kctx, pixi, matrices, record);

  // A stack of alphas draws the picture itself (F54): no pre-pass, no filter output.
  if (drawsDirect(now)) {
    goDirect(kctx, record);
    account(kctx, record);

    if (!ok && live) putFiltersBack(kctx, record, view);

    return ok;
  }

  record.direct = false;

  // A stack that stopped fitting leaves before anything is drawn for it: the frame draws a sprite of stage 3.
  if (record.shaded && !shadeFits(kctx, record)) leaveShade(record);

  if (ok && first !== undefined) {
    renderStage2(kctx, pixi, matrices, record, {
      inputs: first.inputs,
      resolution: now.r,
      padding: now.P
    });
  } else if (record.s2Of !== undefined) {
    releaseInputs(kctx, record);
  }

  // Under the mode a retake costs stage 1 and one copy.
  if (record.shaded) record.shadedAt = kctx.state.frame;

  ok = ok && (record.shaded ? renderShade : renderStage3)(kctx, pixi, matrices, record, now);
  account(kctx, record);

  if (!ok && live) putFiltersBack(kctx, record, view);

  return ok;
}

/**
 * Puts the filters of a live record whose take failed back on its top: it draws live again.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param view - Its view.
 */
function putFiltersBack(kctx: KeptCtx, record: KeptRecord, view: View): void {
  // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
  if (record.standIn !== undefined) record.standIn.filters = null;
  kctx.sync.applyFilters(view, filtersOf(kctx.ctx.state.sync, record.entity), noMark, record.top);
}

/**
 * Lets a record draw its subtree picture itself (F54): the pre-pass results and the filter output go, and the quad
 * shows the picture at the stack's alpha from now on.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 */
function goDirect(kctx: KeptCtx, record: KeptRecord): void {
  leaveShade(record);

  if (record.s2Of !== undefined) releaseInputs(kctx, record);

  if (record.s3 !== undefined) {
    dropTexture(kctx, record.s3);
    record.s3 = undefined;
  }

  record.direct = true;
}

/**
 * Ends the loan of stage 2 when the first filter with inputs left the stack: the results are destroyed.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 */
function releaseInputs(kctx: KeptCtx, record: KeptRecord): void {
  endLoan(record.s2Of);
  record.s2Of = undefined;
  for (const target of record.s2.splice(0)) dropTexture(kctx, target);
}

/**
 * Brings the budget's count up to the record's textures as they are now.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 */
function account(kctx: KeptCtx, record: KeptRecord): void {
  const bytes = bytesOf(record);

  kctx.state.bytes += bytes - record.bytes;
  record.bytes = bytes;
}

/**
 * The quad of a picture whose top's world transform has another linear part than at the take (F67): the picture is
 * drawn through `W · W₀⁻¹`, this frame's world transform after the inverse of the one it was taken at, so it scales,
 * turns and moves with an ancestor's zoom as the live subtree would.
 *
 * @param key - The record's key.
 * @param Ps - The padding of the picture the quad shows.
 * @param inverse - The inverse of the parent's world transform.
 * @param local - Where the quad's local transform goes.
 */
function scaledQuad(
  key: Float64Array,
  Ps: number,
  inverse: KeptMatrices["local"],
  local: KeptMatrices["local"]
): void {
  const a0 = key[KEY.a] ?? 1;
  const b0 = key[KEY.b] ?? 0;
  const c0 = key[KEY.c] ?? 0;
  const d0 = key[KEY.d] ?? 1;
  const det = a0 * d0 - b0 * c0;
  // `L = L₁ · L₀⁻¹`, Pixi's order: x' = a·x + c·y, y' = b·x + d·y.
  const la = (NOW.a * d0 - NOW.c * b0) / det;
  const lb = (NOW.b * d0 - NOW.d * b0) / det;
  const lc = (NOW.c * a0 - NOW.a * c0) / det;
  const ld = (NOW.d * a0 - NOW.b * c0) / det;
  // The picture's corner, relative to the translation it was taken at, carried by `L` to this frame's translation.
  const px = (key[KEY.X0] ?? 0) - Ps - (key[KEY.tx] ?? 0);
  const py = (key[KEY.Y0] ?? 0) - Ps - (key[KEY.ty] ?? 0);
  const x = la * px + lc * py + NOW.tx;
  const y = lb * px + ld * py + NOW.ty;

  local.a = inverse.a * la + inverse.c * lb;
  local.b = inverse.b * la + inverse.d * lb;
  local.c = inverse.a * lc + inverse.c * ld;
  local.d = inverse.b * lc + inverse.d * ld;
  local.tx = inverse.a * x + inverse.c * y + inverse.tx;
  local.ty = inverse.b * x + inverse.d * y + inverse.ty;
}

/**
 * Tells whether a kept picture may be drawn scaled to this frame's linear part instead of taken again (F67): its
 * subtree and its stack resolution are as at the take (a stepped picture's resolution followed the canvas: F126), its
 * filters follow the view (not its canvas place), it was not cut to the canvas, and the area scale stays within
 * `SCALED_LIMIT` of the take's either way.
 *
 * @param record - The record, kept.
 * @param stepped - A step of the resolution passed over the picture.
 * @returns True when the quad may scale.
 */
function scalable(record: KeptRecord, stepped: boolean): boolean {
  const { key } = record;

  const unscalable = record.dirtyS1 || record.cut || record.category === "placed";

  if (unscalable || (!stepped && key[KEY.rs] !== NOW.rs)) return false;

  const taken = Math.abs(
    (key[KEY.a] ?? 1) * (key[KEY.d] ?? 1) - (key[KEY.b] ?? 0) * (key[KEY.c] ?? 0)
  );
  const now = Math.abs(NOW.a * NOW.d - NOW.b * NOW.c);
  const limit = SCALED_LIMIT * SCALED_LIMIT;

  const withinLimit = now <= taken * limit && now * limit >= taken;

  return taken > 0 && now > 0 && withinLimit;
}

/**
 * The quad of a kept record, drawing `output`: made once, the mesh of a shaded record reading its texture through its
 * shader (`Mesh.texture` does not reach it).
 *
 * @param pixi - The module that draws.
 * @param record - The record, kept.
 * @param output - What it draws.
 * @returns The quad.
 */
function quadDrawing(
  pixi: PixiModule,
  record: KeptRecord,
  output: PixiRenderTexture | PixiTexture
): KeptQuad {
  if (record.quad === undefined || record.quad.destroyed) {
    record.quad = new pixi.Sprite(output);
    record.quad.label = `kept:${labelOf(record.top)}`;
  }

  if (!record.shaded && record.quad.texture !== output) record.quad.texture = output;

  return record.quad;
}

/**
 * Hangs a quad right above its top in the same parent.
 *
 * @param quad - The quad.
 * @param top - The top.
 * @param parent - The top's parent.
 */
function hangQuad(quad: KeptQuad, top: PixiContainer, parent: PixiContainer): void {
  if (quad.parent === parent && parent.children[parent.getChildIndex(top) + 1] === quad) return;

  quad.removeFromParent();
  parent.addChildAt(quad, parent.getChildIndex(top) + 1);
}

/**
 * Places the quad of a kept record (P3.5, P2.4): beside its top in the same parent, at the top's depth, drawing the
 * filter output at its canvas place `O + Δ` with an identity world scale, or scaled to this frame's linear part when
 * it differs from the take's (F67); shown while the top is visible and no cover or alpha hides it. Every value is compared before it is written.
 *
 * @param sync - The writers of `sync`: its reader of the hidden reasons.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, kept.
 * @param view - Its view.
 */
function placeQuad(
  sync: SyncWriters,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View
): void {
  const { top, key } = record;
  const parent = top.parent;
  // A stack of alphas shows the subtree picture itself at their alpha (F54), any other stack its filter output. The
  // picture leaves out the top's own alpha: the quad draws it (F120).
  const output = (record.direct ? record.s1 : record.s3) ?? pixi.Texture.EMPTY;
  const alpha = (record.direct ? NOW.alpha : 1) * top.alpha;

  const quad = quadDrawing(pixi, record, output);

  if (parent === null) return;

  hangQuad(quad, top, parent);

  if (quad.zIndex !== top.zIndex) quad.zIndex = top.zIndex;
  if (quad.blendMode !== top.blendMode) quad.blendMode = top.blendMode;
  if (quad.alpha !== alpha) quad.alpha = alpha;

  // The filter output at its canvas place `O + Δ`, brought into the parent's space: with an identity world scale, or
  // through `W · W₀⁻¹` when the linear part moved since the take (F67). Inline: in a helper of its own V8 boxes a number
  // of this frame (16 B on a fading quad, `keptFade`).
  const inverse = parent.getGlobalTransform(matrices.parent, false).invert();
  const Ps = record.direct ? 0 : (key[KEY.Ps] ?? 0);
  const { local } = matrices;

  if (linearDiffers(key, NOW, KEY.a, KEY.rs)) {
    scaledQuad(key, Ps, inverse, local);
  } else {
    const x = (key[KEY.X0] ?? 0) - Ps + NOW.tx - (key[KEY.tx] ?? 0);
    const y = (key[KEY.Y0] ?? 0) - Ps + NOW.ty - (key[KEY.ty] ?? 0);

    // Written field by field, not through `set`: a computed double handed to a call is boxed, and this runs every frame.
    local.a = inverse.a;
    local.b = inverse.b;
    local.c = inverse.c;
    local.d = inverse.d;
    local.tx = inverse.a * x + inverse.c * y + inverse.tx;
    local.ty = inverse.b * x + inverse.d * y + inverse.ty;
  }

  // The mesh's geometry is the unit square: its matrix carries the size a sprite takes from its texture.
  if (record.shaded) {
    local.a *= output.width;
    local.b *= output.width;
    local.c *= output.height;
    local.d *= output.height;
  }

  if (storeMatrix(key, KEY.qa, local)) quad.setFromMatrix(local);

  // Shown while the top is visible and no cover or alpha hides it.
  const visible = top.visible && !sync.hiddenBy(view, "alpha") && !sync.hiddenBy(view, "cover");

  if (quad.visible !== visible) quad.visible = visible;
}

/**
 * Shows the picture of a record that was just taken: the reason `"kept"` hides the top without a mark, the quad shows
 * in the same flush (K3).
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param view - Its view.
 */
function toKept(kctx: KeptCtx, record: KeptRecord, view: View): void {
  record.mode = "kept";
  record.calm = false;
  record.churn = 0;
  record.why = 0;
  record.calmIn = 0;
  record.idleSeen = false;
  kctx.sync.swapHidden(kctx.hidden, view, "kept", true);
}

/**
 * Tells whether a node draws itself: a Pixi view (a sprite, a nine-slice, a graphics, a particle container), not a
 * plain container. Pixi types `renderPipeId` on every container, but only a view holds one.
 *
 * @param node - The node.
 * @returns True for a view.
 */
function drawsItself(node: PixiContainer): boolean {
  const pipe: string | undefined = node.renderPipeId;

  return pipe !== undefined;
}

/**
 * Reads the world transform of a record's top into this frame's numbers.
 *
 * @param record - The record.
 */
function readWorld(record: KeptRecord): void {
  const world = record.top.getGlobalTransform(record.matrix, false);

  NOW.a = world.a;
  NOW.b = world.b;
  NOW.c = world.c;
  NOW.d = world.d;
  NOW.tx = world.tx;
  NOW.ty = world.ty;
}

/**
 * Gives a bare view its wrapper before its first take (spec 23 D4): the root of the picture's first render is then a
 * plain container, and the visual inside keeps its own transform, tint and alpha. A view that draws itself made the
 * root of a render group draws other pixels than live (Pixi's sprite pipe keeps the group transform it cached, so a
 * sprite lands outside its picture; the root's own tint and alpha are applied twice). The record moves to the new
 * top, which keeps it from then on, also while the view is drawn live, so a view that pulses wraps once. The wrap
 * marks nothing: it draws the same pixels. The numbers of the frame and the keys of the last one are read again from
 * the wrapper.
 *
 * @param kctx - The kept context.
 * @param record - The record, live and about to be taken.
 * @param view - Its view.
 */
function wrapBare(kctx: KeptCtx, record: KeptRecord, view: View): void {
  if (view.wrapper !== undefined || !drawsItself(record.top)) return;

  const wrapper = kctx.wrap(record.entity);

  if (wrapper === undefined || wrapper === record.top) return;

  const { state } = kctx;

  if (state.byTop.get(record.top) === record) state.byTop.delete(record.top);
  record.top = wrapper;
  record.wasGroup = wrapper.isRenderGroup;
  state.byTop.set(wrapper, record);
  // One level deeper now: the list is sorted again before the next flush.
  state.unsorted = true;
  readWorld(record);
  writeSeen(record, NOW);
}

/**
 * Tells whether a move of a live record's linear part or stack resolution resets its still frames (F113): a zoom or a
 * turn of an ancestor does not, the picture is taken at it and drawn scaled (F67). It does for a new stack resolution,
 * a `"placed"` record (never drawn scaled), a calm one (a picture that churned waits for real rest) and one cut to the
 * canvas at its last take or refusal (never drawn scaled either).
 *
 * @param record - The record, live, whose linear part or stack resolution moved since the last frame.
 * @returns True when the move resets its still frames.
 */
function linearResets(record: KeptRecord): boolean {
  return (
    record.key[KEY.seenRs] !== NOW.rs || record.category === "placed" || record.calm || record.cut
  );
}

/**
 * The still frames a live record waits before it is taken: eight after churning, none for a stack drawn direct (its
 * take costs one pass, its live draw two: F114; a take that rendered nothing is remembered, `idle`), two otherwise.
 *
 * @param record - The record, live.
 * @returns Drawn frames.
 */
function waitOf(record: KeptRecord): number {
  if (record.calm) return CALM_AFTER;

  return drawsDirect(NOW) ? 0 : TAKE_AFTER;
}

/**
 * Notes why a live record that may be kept is not taken in this frame, from what the policy keeps on it: a `Display`
 * found under its top, a take that rendered nothing or a cut under a move, a refused take, a glow under the top, else
 * the still frames it waits for. A move offers a take again but changes neither of the first two: they stand until a
 * change under the top, so a moving view does not flip to a wait.
 *
 * @param state - The kept state.
 * @param record - The record, live.
 * @param changed - It changed in this frame.
 * @param turned - Its linear part moved in this frame.
 */
function noteHeld(state: KeptState, record: KeptRecord, changed: boolean, turned: boolean): void {
  record.calmIn = 0;

  if (record.displays === true) record.why = WHY.display;
  else if (record.idleSeen || (turned && record.cut)) record.why = WHY.idle;
  else if (refusalHolds(state, record)) record.why = WHY.budget;
  else if (record.blended) record.why = WHY.blendBelow;
  else {
    record.why = record.calm ? WHY.churn : WHY.waiting;
    // A frame it changed in is no still frame, also for a stack that waits for none.
    record.calmIn = Math.max(waitOf(record) - record.still, changed ? 1 : 0);
  }
}

/**
 * Notes what a take was for, in numbers: `why()` names them when it is asked. A mark's reasons keep who marked.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param why - The `RETAKE` of the take.
 */
function noteTake(kctx: KeptCtx, record: KeptRecord, why: number): void {
  record.retakeWhy = why;
  record.retakeBy = why === RETAKE.mark || why === RETAKE.innerFirst ? record.markBy : 0;
  record.retakeAt = kctx.state.frame;
}

/**
 * Marks every kept record above a record that was just first taken, settled or refined: their retake in this flush is
 * not churn (F114, F126), so the inner takes spread over frames do not drop the outer picture to live.
 *
 * @param kctx - The kept context.
 * @param record - The record just taken.
 */
function spareAbove(kctx: KeptCtx, record: KeptRecord): void {
  for (let node = record.top.parent; node !== null; node = node.parent) {
    const above = kctx.state.byTop.get(node);

    if (above !== undefined) above.spared = true;
  }
}

/**
 * A live record's frame (P4.2): still frames are counted, and a zoom or turn of an ancestor counts as still (F113); at
 * two, none for a stack drawn direct, eight after churning, the record is taken, a bare view in a wrapper of its own
 * (D4). An idle record waits for a change or a move; one first take a frame, and none while an alpha is due (F114). A
 * record with a node under its top that blends otherwise stays live, before any wrap (F68).
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record.
 * @param view - Its view.
 */
function stepLive(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View
): void {
  const { state } = kctx;
  const { key } = record;
  // A record's first frame has no frame before it to turn from: a new view that did not change is still (F114).
  const turned = !Number.isNaN(key[KEY.seenA]) && linearDiffers(key, NOW, KEY.seenA, KEY.seenRs);
  const changed = record.dirtyS1 || (turned && linearResets(record));
  const moved = turned || NOW.tx !== key[KEY.lastTx] || NOW.ty !== key[KEY.lastTy];

  writeSeen(record, NOW);
  record.still = changed ? 0 : record.still + 1;

  // A take that rendered nothing is not tried again until the view moves (a change under it clears it too).
  if (moved) record.idle = false;
  // Never taken in a frame its view changed in: a stack drawn direct waits for its first frame without a change. A
  // refused take is not offered again until it fits (P6.3): no thrash. A glow under the top stays live, remembered until
  // the subtree changes (F68).
  const staysLive =
    changed ||
    record.still < waitOf(record) ||
    record.idle ||
    refusalHolds(state, record) ||
    blendedBelow(kctx, record);

  if (staysLive) {
    noteHeld(state, record, changed, turned);

    return;
  }

  // One first take per frame, inner first: the others stay live and wait (F114). A stack drawn direct takes for one
  // pass, less than its live draw: never held back, and while one is due the others wait for the next frame. A view
  // drawn live is not held back either: waiting, it breaks the canvas pass in every frame (F119).
  const held = heldBack(state, drawsDirect(NOW), drawnLive(kctx, record));

  if (held !== 0) {
    record.why = held;
    record.calmIn = 0;

    return;
  }

  wrapBare(kctx, record, view);

  if (!takePicture(kctx, pixi, matrices, record, view, NOW, turned)) {
    record.still = 0;
    noteHeld(state, record, false, turned);

    return;
  }

  state.firstTakes += 1;

  record.takenAt = state.frame;
  toKept(kctx, record, view);
  noteTake(kctx, record, RETAKE.first);
  spareAbove(kctx, record);
}

/**
 * Retakes a kept record's picture at this frame; a refused take draws the view live.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, kept.
 * @param view - Its view.
 * @param why - The `RETAKE` of the take.
 * @returns True when every stage rendered.
 */
function retakeOrGoLive(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View,
  why: number
): boolean {
  if (takePicture(kctx, pixi, matrices, record, view, NOW)) {
    noteTake(kctx, record, why);

    return true;
  }

  goLive(kctx, record, view, true);
  noteHeld(kctx.state, record, false, false);

  return false;
}

/**
 * A stage-1 change of a kept record (P4.3): retaken, or after three in a row drawn live and calm, so it stands still
 * for eight frames before the next take.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, kept.
 * @param view - Its view.
 * @param why - The `RETAKE` of a retake.
 */
function churn(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View,
  why: number
): void {
  record.churn += 1;

  if (record.churn < CHURN_LIMIT) {
    retakeOrGoLive(kctx, pixi, matrices, record, view, why);

    return;
  }

  goLive(kctx, record, view, true);
  record.calm = true;
  writeSeen(record, NOW);
  noteHeld(kctx.state, record, false, false);
}

/**
 * What a retake of a kept record owes itself to: a new stack resolution, a change under its top, or a linear part it may
 * not be drawn at. A stepped record owes the step nothing here.
 *
 * @param record - The record, kept, about to be retaken.
 * @param stepped - A step of the resolution passed over the picture.
 * @returns The `RETAKE`.
 */
function retakeWhy(record: KeptRecord, stepped: boolean): number {
  if (!stepped && record.key[KEY.rs] !== NOW.rs) return RETAKE.resolution;
  if (record.dirtyS1) return RETAKE.mark;

  return record.cut || record.category === "placed" ? RETAKE.placedMove : RETAKE.scaleLimit;
}

/**
 * What a refresh of a kept record owes itself to, read before the render writes its keys. Under `hold` the resolution
 * is no reason: what is owed is the filter's.
 *
 * @param record - The record, kept.
 * @param chain - Stage 2 is redone too.
 * @param hold - A step of the resolution owes no stage.
 * @returns The `RETAKE`.
 */
function refreshWhy(record: KeptRecord, chain: boolean, hold: boolean): number {
  if (chain) return RETAKE.chain;

  return hold || NOW.r === record.key[KEY.r] ? RETAKE.filter : RETAKE.resolution;
}

/**
 * Notes a move of a kept record: a quad that left its picture's texel grid owes one settle retake at rest, and asks
 * for the frame it happens in. The grid is the picture's own: a step of the resolution leaves it where it was (F126).
 *
 * @param kctx - The kept context.
 * @param record - The record, kept.
 */
function noteMove(kctx: KeptCtx, record: KeptRecord): void {
  const { key } = record;
  const rs = key[KEY.rs] ?? 1;
  const drawn = drawnResolution(key, record.direct);

  record.settle =
    !onGrid(NOW.tx - (key[KEY.tx] ?? 0), rs, drawn) ||
    !onGrid(NOW.ty - (key[KEY.ty] ?? 0), rs, drawn);

  // The settle retake happens at rest: a frame is asked for, in which the view stands where it is now.
  if (record.settle) kctx.demand.request();
}

/**
 * Notes what a frame of a kept record left it owing at rest: a move off its grid, and a picture drawn scaled, which is
 * sampled off its grid too and owes one settle retake, in a frame asked for.
 *
 * @param kctx - The kept context.
 * @param record - The record, kept.
 * @param moved - It moved in this frame.
 * @param scaled - It is drawn at another linear part than at the take.
 */
function noteRest(kctx: KeptCtx, record: KeptRecord, moved: boolean, scaled: boolean): void {
  if (moved) noteMove(kctx, record);

  if (scaled && !record.settle) {
    record.settle = true;
    kctx.demand.request();
  }
}

/**
 * Tells whether the canvas has another size than at the take.
 *
 * @param kctx - The kept context.
 * @param key - The record's key.
 * @returns True when it does.
 */
function canvasChanged(kctx: KeptCtx, key: Float64Array): boolean {
  const screen = kctx.host.screen();

  return screen !== undefined && (screen.width !== key[KEY.sw] || screen.height !== key[KEY.sh]);
}

/**
 * Tells whether a step of the renderer resolution passed over a kept picture (F126): drawn at another resolution than
 * the canvas, with a stack that followed the canvas there: a resolution of its own, or `"inherit"`. A picture cut to the
 * canvas or placed, a filter that wrote its own resolution and a mixed stack whose fixed resolution the step crossed
 * are no step: their change is read as a change of the stack.
 *
 * @param record - The record, kept.
 * @returns True when the picture was stepped over.
 */
function resolutionStepped(record: KeptRecord): boolean {
  if (record.cut || record.category === "placed") return false;

  const { key } = record;
  const drawn = drawnResolution(key, record.direct);

  if (drawn === NOW.r) return false;

  const fixedStack = key[KEY.rs] === NOW.rs;
  const followsCanvas = key[KEY.rs] === drawn && NOW.rs === NOW.r;

  return fixedStack || followsCanvas;
}

/**
 * Tells whether a take under `REFINE_TAKES` is left in this flush, and counts it; with none left the next frame is
 * asked for, in which the debt is paid.
 *
 * @param kctx - The kept context.
 * @returns True when the take may happen now.
 */
function limitLeft(kctx: KeptCtx): boolean {
  const { state } = kctx;

  if (state.frameRefines >= REFINE_TAKES) {
    kctx.demand.request();

    return false;
  }

  state.frameRefines += 1;

  return true;
}

/**
 * Refines a picture coarser than the canvas, the limit counted (P4.3): whole for a stack drawn direct and one whose
 * resolution moved, stage 3 alone for one on a fixed resolution. `refined` tells the pictures above that this change
 * was nothing else, and only once it rendered; it spares them, so refinements spread over frames do not churn an outer
 * picture that is marked to live.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, kept and `coarse`.
 * @param view - Its view.
 * @param moved - It moved in this frame.
 * @param scaled - It is drawn at another linear part than at the take.
 */
function refine(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View,
  moved: boolean,
  scaled: boolean
): void {
  const { key } = record;
  const alone = drawsDirect(NOW) || stagesOwed(record, true) === OWED.none;

  if (record.direct || key[KEY.rs] !== NOW.rs) {
    record.refined = retakeOrGoLive(kctx, pixi, matrices, record, view, RETAKE.resolution) && alone;
    if (record.refined) spareAbove(kctx, record);

    return;
  }

  refresh(kctx, pixi, matrices, record, view, false);
  record.coarse = drawnResolution(key, record.direct) !== NOW.r;
  record.refined = !record.coarse && alone;
  if (record.refined) spareAbove(kctx, record);
  noteRest(kctx, record, moved, scaled);
  // The take keys stand: a settle owed from before fires at rest, in a frame asked for.
  if (record.settle) kctx.demand.request();
}

/**
 * The retake a stage-1 change or a zoom past the limit owes a kept record, which counts as churn unless an inner
 * record's spread take alone caused it (F114).
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, kept.
 * @param view - Its view.
 * @param stepped - A step of the resolution passed over the picture.
 * @param scaled - It is drawn at another linear part than at the take.
 * @returns True when one was owed.
 */
function retakeOwed(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View,
  stepped: boolean,
  scaled: boolean
): boolean {
  if (!record.dirtyS1 && (!scaled || scalable(record, stepped))) return false;

  // Retaken for an inner record's spread take alone: not churn (F114).
  if (record.spared && !scaled) {
    retakeOrGoLive(kctx, pixi, matrices, record, view, RETAKE.innerFirst);
  } else {
    churn(kctx, pixi, matrices, record, view, retakeWhy(record, stepped));
  }

  return true;
}

/**
 * The settle retake of a kept record at rest, under the limit (P2.5, F114): it spares the pictures above it, so a settle
 * spread over frames does not churn an outer picture to live. With the limit spent `settle` stays set.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, kept.
 * @param view - Its view.
 * @returns True when the picture was taken again.
 */
function settleTake(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View
): boolean {
  if (!limitLeft(kctx)) return false;

  spareAbove(kctx, record);
  retakeOrGoLive(kctx, pixi, matrices, record, view, RETAKE.settle);

  return true;
}

/**
 * A kept record's frame (P4.3): a stage-1 change retakes (three in a row go live and calm); otherwise a picture coarser
 * than the canvas after a step of the resolution is refined under the limit, at rest after an off-grid move or a zoom
 * one settle retake is owed under the same limit, and a new chain version redoes stages 2 and 3, a filter value, the
 * resolution, the padding or (placed) a move stage 3. A step is neither a move nor a scale, and on the way down it owes
 * nothing (F126).
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record.
 * @param view - Its view.
 */
function stepKept(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View
): void {
  const { key } = record;
  const stepped = resolutionStepped(record);
  // The linear part moved since the last frame: the view turns or scales under an ancestor's zoom.
  const turned = stepped
    ? linearMoved(key, NOW, KEY.seenA)
    : linearDiffers(key, NOW, KEY.seenA, KEY.seenRs);
  const scaled = stepped ? linearMoved(key, NOW, KEY.a) : linearDiffers(key, NOW, KEY.a, KEY.rs);

  writeSeen(record, NOW);

  if (retakeOwed(kctx, pixi, matrices, record, view, stepped, scaled)) return;

  const moved = turned || NOW.tx !== key[KEY.lastTx] || NOW.ty !== key[KEY.lastTy];

  // A picture cut to the canvas shows what it left out once it moves or the canvas changes size (F53).
  if (record.cut && (moved || canvasChanged(kctx, key))) {
    churn(kctx, pixi, matrices, record, view, RETAKE.canvas);

    return;
  }

  record.churn = 0;
  // Not tied to rest: under a move `settle` never fires, and a picture that keeps moving must still get sharp.
  record.coarse = stepped && NOW.r > drawnResolution(key, record.direct);

  if (record.coarse && limitLeft(kctx)) {
    refine(kctx, pixi, matrices, record, view, moved, scaled);

    return;
  }

  // A stepped picture is resampled anyway: its settle waits for the end of the step. A zoom still owes its take at rest.
  const atRest = !moved && record.settle && (scaled || !stepped);

  if (atRest && settleTake(kctx, pixi, matrices, record, view)) return;
  if (refresh(kctx, pixi, matrices, record, view, stepped)) return;

  noteRest(kctx, record, moved, scaled);
}

/**
 * Tells whether stage 2 is owed: a new chain, a new chain version, or a new subtree picture under it.
 *
 * @param record - The record, kept.
 * @param inputs - The seam of its first filter with inputs.
 * @returns True when it is.
 */
function chainOwed(record: KeptRecord, inputs: FilterSlotInputs): boolean {
  return (
    record.dirtyS2 ||
    inputs !== record.s2Of ||
    inputs.version() !== record.s2InputsVersion ||
    record.s1Version !== record.s2PictureVersion
  );
}

/**
 * Tells whether stage 3 is owed for its own keys: a filter value, the resolution, the padding, a placed filter's move.
 * Under `hold` the resolution is no reason, and a stack drawn direct has no padding: its key is stale.
 *
 * @param record - The record, kept.
 * @param hold - A step of the resolution owes no stage.
 * @returns True when it is.
 */
function outputOwed(record: KeptRecord, hold: boolean): boolean {
  const { key } = record;
  const resolutionOwed = !hold && NOW.r !== key[KEY.r];
  const paddingOwed = hold && record.direct ? NOW.P !== 0 : NOW.P !== key[KEY.P];
  const placedMoved =
    record.category === "placed" && (NOW.tx !== key[KEY.s3Tx] || NOW.ty !== key[KEY.s3Ty]);

  return record.dirtyS3 || resolutionOwed || paddingOwed || placedMoved;
}

/**
 * What a kept record that does not draw direct owes `refresh`: read by it and by the refining. Stage 3 follows stage 2,
 * and a chain that left.
 *
 * @param record - The record, kept.
 * @param hold - A step of the resolution owes no stage.
 * @returns The `OWED`.
 */
function stagesOwed(record: KeptRecord, hold: boolean): number {
  const inputs = firstInputs(record.slots)?.inputs;

  if (inputs !== undefined && chainOwed(record, inputs)) return OWED.chain;

  const inputsLeft = inputs === undefined && record.s2Of !== undefined;

  return inputsLeft || outputOwed(record, hold) ? OWED.output : OWED.none;
}

/**
 * Redoes stage 2 and 3, or stage 3 alone, when their keys changed (P4.3): a refresh never counts as churn. Under `hold`
 * the resolution owes nothing, and what else is owed lands on one resolution: a stack whose resolution moved is taken
 * whole, before anything is released or rendered, so stage 3 is never drawn at a new `rs` over a stage 1 of an old one.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, kept.
 * @param view - Its view.
 * @param hold - A step of the resolution owes no stage.
 * @returns True when the record was taken whole.
 */
function refresh(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View,
  hold: boolean
): boolean {
  // A stack of alphas owes nothing: its quad takes the new alpha (F54).
  if (drawsDirect(NOW)) {
    turnDirect(kctx, record);

    return false;
  }

  return refreshOutput(kctx, pixi, matrices, record, view, hold);
}

/**
 * Redoes what a record that does not draw direct owes, on its mesh when it is shaded or goes on it now: a stack that
 * stopped fitting leaves and owes stage 3, one at rest may leave, and what is left is today's tail of stage 2 and 3.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, kept.
 * @param view - Its view.
 * @param hold - A step of the resolution owes no stage.
 * @returns True when the record was taken whole.
 */
function refreshOutput(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View,
  hold: boolean
): boolean {
  const fits = shadeFits(kctx, record);
  const unfit = record.shaded && !fits;

  if (unfit) leaveShade(record);

  // What a record left holds is the padded picture, not a filter output: stage 3 is owed whatever the keys say.
  const owed = Math.max(stagesOwed(record, hold), unfit ? OWED.output : OWED.none);

  if (owed === OWED.none) return leaveAtRest(kctx, pixi, matrices, record, view, hold);

  const chain = owed === OWED.chain;
  const why = refreshWhy(record, chain, hold);

  if (hold && record.key[KEY.rs] !== NOW.rs) {
    retakeOrGoLive(kctx, pixi, matrices, record, view, why);

    return true;
  }

  const inputs = firstInputs(record.slots)?.inputs;

  if (inputs === undefined && record.s2Of !== undefined) releaseInputs(kctx, record);

  if (!unfit && enteredOrShaded(kctx, pixi, record, owed, fits)) {
    redrawShade(kctx, pixi, matrices, record);

    return false;
  }

  if (chain && inputs !== undefined) {
    renderStage2(kctx, pixi, matrices, record, { inputs, resolution: NOW.r, padding: NOW.P });
  }

  noteTake(kctx, record, why);
  record.direct = false;
  renderStage3(kctx, pixi, matrices, record, NOW);
  account(kctx, record);
  if (!chain) kctx.state.refreshesOpen += 1;

  return false;
}

/**
 * Lets a record that stayed kept draw its subtree picture itself, when it does not yet: a stack became all alphas.
 *
 * @param kctx - The kept context.
 * @param record - The record, kept.
 */
function turnDirect(kctx: KeptCtx, record: KeptRecord): void {
  if (record.direct) return;

  goDirect(kctx, record);
  account(kctx, record);
}

/**
 * A change of a shaded record: no take and no pass, unless the padded picture must be copied, and the mesh draws what
 * changed, so the pictures above it hold something else now.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, shaded.
 */
function redrawShade(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord
): void {
  const { state } = kctx;
  const passes = state.flushPasses;

  renderShade(kctx, pixi, matrices, record, NOW);
  record.shadedAt = state.frame;
  record.redrawn = true;

  // Only a copy changes a texture: the bytes are counted through an array that a frame of the mesh does not make.
  if (state.flushPasses !== passes) account(kctx, record);
}

/**
 * Tells whether a refresh of a record is drawn by its mesh: it is shaded, or stage 3 alone was owed more than `QUAD_AFTER`
 * times without a gap of `CALM_AFTER` frames and it fits, and it enters now. The gap rule, not a reset on a quiet frame: a
 * tween that writes every second frame reaches the mode.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param record - The record, kept.
 * @param owed - What it owes, not none.
 * @param fits - It fits the mode.
 * @returns True when the mesh draws the change.
 */
function enteredOrShaded(
  kctx: KeptCtx,
  pixi: PixiModule,
  record: KeptRecord,
  owed: number,
  fits: boolean
): boolean {
  if (record.shaded) return true;

  const { frame } = kctx.state;

  record.outputRuns = frame - record.outputAt > CALM_AFTER ? 1 : record.outputRuns + 1;
  record.outputAt = frame;

  const quad = enabledSlot(record.slots)?.quad;

  if (owed !== OWED.output || !fits || record.outputRuns <= QUAD_AFTER || quad === undefined) {
    return false;
  }

  enterShade(kctx, pixi, record, quad, NOW);

  return true;
}

/**
 * A shaded record that owes nothing and stood `QUAD_CALM` frames goes back to its sprite (F126 stage 2): a resting mesh
 * runs the whole body every frame. Under `limitLeft`, shared with the refining and the settle, it stays shaded in a frame
 * the limit is spent. It counts as a refresh. The pixels do not change, so the pass marks nothing above; a stack whose
 * resolution moved under a held step is taken whole, as `refresh` takes it, and that does change them.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, kept.
 * @param view - Its view.
 * @param hold - A step of the resolution owes no stage.
 * @returns True when the record was taken whole.
 */
function leaveAtRest(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View,
  hold: boolean
): boolean {
  const { state } = kctx;

  if (!record.shaded || state.frame - record.shadedAt < QUAD_CALM || !limitLeft(kctx)) return false;

  leaveShade(record);

  if (hold && record.key[KEY.rs] !== NOW.rs) {
    retakeOrGoLive(kctx, pixi, matrices, record, view, RETAKE.filter);

    return true;
  }

  noteTake(kctx, record, RETAKE.filter);
  renderStage3(kctx, pixi, matrices, record, NOW);
  account(kctx, record);
  state.refreshesOpen += 1;
  BEFORE.passes = state.flushPasses;

  return false;
}

/**
 * Tells whether a record's quad shows: visible and hanging in the tree.
 *
 * @param record - The record.
 * @returns True when it does.
 */
function quadShown(record: KeptRecord): boolean {
  return record.quad?.visible === true && record.quad.parent !== null;
}

/**
 * Notes what a record draws before its step, into the one object of the module.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param into - Where it goes.
 */
function noteDrawing(kctx: KeptCtx, record: KeptRecord, into: Drawing): void {
  into.mode = record.mode;
  into.passes = kctx.state.flushPasses;
  into.qtx = record.key[KEY.qtx] ?? Number.NaN;
  into.qty = record.key[KEY.qty] ?? Number.NaN;
  into.shown = quadShown(record);
}

/**
 * Tells whether a step changed what a record draws: its life, a pass of the flush, its quad's place or whether the
 * quad shows.
 *
 * @param kctx - The kept context.
 * @param record - The record, stepped.
 * @param before - What it drew before the step.
 * @returns True when the pictures above it hold something else now.
 */
function drawingChanged(kctx: KeptCtx, record: KeptRecord, before: Readonly<Drawing>): boolean {
  return (
    record.redrawn ||
    before.mode !== record.mode ||
    before.passes !== kctx.state.flushPasses ||
    !Object.is(before.qtx, record.key[KEY.qtx]) ||
    !Object.is(before.qty, record.key[KEY.qty]) ||
    before.shown !== quadShown(record)
  );
}

/**
 * Tells whether a kept record has anything to do in this frame: the frame is not calm, or a flag or a debt is on it.
 *
 * @param state - The kept state.
 * @param record - The record.
 * @returns True when it is to be stepped.
 */
function owesStep(state: KeptState, record: KeptRecord): boolean {
  return (
    !state.calm ||
    state.bypassed ||
    record.mode !== "kept" ||
    record.dirtyS1 ||
    record.dirtyS2 ||
    record.dirtyS3 ||
    record.settle ||
    record.coarse ||
    record.churn !== 0 ||
    (record.shaded && state.frame - record.shadedAt >= QUAD_CALM)
  );
}

/**
 * The frame of a kept record in a calm frame (no mark, no whole-frame reason) that owes nothing: no dirty flag, no
 * settle or refining take, no churn, not bypassed. Its step would find every key as it stands and its quad where it
 * is, so it is counted as drawn from its picture and left alone (E5).
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @returns True when the record was drawn as it stands; false when it is to be stepped.
 */
export function stepCalm(kctx: KeptCtx, record: KeptRecord): boolean {
  const { state } = kctx;

  if (owesStep(state, record)) return false;

  record.lastDrawn = state.frame;
  state.drawnPictures += 1;
  record.quiet += 1;

  return true;
}

/**
 * Marks, before the step, the live records drawn direct that may be taken in this flush (F114): eligible, nothing
 * changed under them. An alpha take costs one pass and its live draw two, so while one is due no other first take
 * happens in this frame. A record due once that did not end its step kept is not due again until a change under it.
 * The others drawn live are counted: a first take among a crowd of them is not spread (F119). The resolution of the
 * flush is read here, once, for every record it steps.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 */
export function markAlphaDue(kctx: KeptCtx, pixi: PixiModule): void {
  const { state } = kctx;

  NOW.r = kctx.host.resolution();
  state.alphaDue = false;
  state.liveWaiting = 0;

  for (let index = 0; index < state.records.length; index += 1) {
    const record = state.records[index];
    const view = record === undefined ? undefined : kctx.ctx.state.sync.views.get(record.entity);

    if (record === undefined || view === undefined || !mayBeDue(kctx, record)) continue;

    // The stack as the step will read it: due when it draws direct and the record may be kept.
    readStack(record.slots, pixi.AlphaFilter, DUE);

    const direct = drawsDirect(DUE);

    record.alphaDue = direct && eligible(kctx, record, view, DUE) === 0;
    state.alphaDue ||= record.alphaDue;
    // Counted without the whole eligibility, which the step reads: the walk up its parents is enough for a crowd.
    if (!direct && drawnLive(kctx, record)) state.liveWaiting += 1;
  }
}

/**
 * Tells whether a record may be taken in this flush as far as is known before its step: live, nothing changed under
 * it, and no earlier refusal that still holds.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @returns True when it may.
 */
function mayBeDue(kctx: KeptCtx, record: KeptRecord): boolean {
  return (
    record.mode === "live" &&
    !record.dirtyS1 &&
    !record.idle &&
    !record.calm &&
    !record.alphaMissed &&
    !record.blended &&
    !refusalHolds(kctx.state, record)
  );
}

/**
 * One drawn frame of a record, inside the flush: eligibility, the keys of this frame, the policy of its life, the quad
 * of a kept one; the dirty flags are cleared. A change under the top forgets a blended node found before: the next
 * take walks the subtree again (F68).
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record.
 * @param view - Its view, whose top is the record's.
 */
export function stepRecord(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View
): void {
  // What the record draws before this frame: a change of it is a change of every picture above it (P4.5).
  noteDrawing(kctx, record, BEFORE);

  // The subtree changed: a glow found under the top may be gone (F68), a take may render something now (F114).
  if (record.dirtyS1) {
    record.blended = false;
    record.idle = false;
    record.alphaMissed = false;
    record.displays = undefined;
    record.idleSeen = false;
  }

  readStack(record.slots, pixi.AlphaFilter, NOW);

  const why = eligible(kctx, record, view, NOW);

  if (why === 0) stepEligible(kctx, pixi, matrices, record, view);
  else stepIneligible(kctx, record, view, why);

  if (drawingChanged(kctx, record, BEFORE)) dirtyAbove(kctx, pixi, record);

  record.quiet = record.dirtyS1 ? 0 : record.quiet + 1;
  record.dirtyS1 = false;
  record.dirtyS2 = false;
  record.dirtyS3 = false;
  record.refined = false;
  record.redrawn = false;
  record.markBy = 0;
  record.spared = false;
  // A due alpha that could not be taken holds the others back once, not every frame (F114).
  if (record.alphaDue && record.mode !== "kept") record.alphaMissed = true;
  record.alphaDue = false;
}

/**
 * The frame of a record that may be kept: its world transform read into this frame's numbers, the policy of its life,
 * and the quad of a kept one placed and counted as drawn.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record.
 * @param view - Its view.
 */
function stepEligible(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  view: View
): void {
  const { state } = kctx;

  readWorld(record);

  if (record.mode === "live") stepLive(kctx, pixi, matrices, record, view);
  else stepKept(kctx, pixi, matrices, record, view);

  if (record.mode === "kept") {
    placeQuad(kctx.sync, pixi, matrices, record, view);
    record.lastDrawn = state.frame;
    state.drawnPictures += 1;
  }

  record.key[KEY.lastTx] = NOW.tx;
  record.key[KEY.lastTy] = NOW.ty;
}

/**
 * The frame of a record that may not be kept: a kept one is drawn live again, calm when it was taken in this frame or
 * the one before (F114), and its still frames start over.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param view - Its view.
 * @param why - The `WHY` of the check that failed.
 */
function stepIneligible(kctx: KeptCtx, record: KeptRecord, view: View, why: number): void {
  if (record.mode === "kept") {
    goLive(kctx, record, view, true);
    // A picture refused in the frame of its take or the next (an alpha that crosses 1 every frame) waits for rest (F114).
    if (kctx.state.frame - record.takenAt <= 1) record.calm = true;
  }

  record.still = 0;
  record.why = why;
  record.calmIn = 0;
}

/**
 * Tells whether a range picture draws a node: the node, or a node above it, is one of the range's entries.
 *
 * @param entries - The entries of the range.
 * @param node - The top of a record.
 * @returns True when the range holds it.
 */
function rangeHolds(entries: readonly PixiContainer[], node: PixiContainer): boolean {
  for (let current: PixiContainer | null = node; current !== null; current = current.parent) {
    if (entries.includes(current)) return true;
  }

  return false;
}

/**
 * Tells whether a record above a refined picture will be taken whole under the limit, after its inner ones: kept,
 * coarser than the canvas, on a stack that follows the canvas (a stack on a fixed resolution would get stage 3 alone), or
 * drawn direct. Read here because that record has not stepped yet. Deepest first, so it comes up once, and needs no mark.
 *
 * @param pixi - The module that draws.
 * @param above - The record above.
 * @returns True when it needs no mark.
 */
function takenAfterInner(pixi: PixiModule, above: KeptRecord): boolean {
  const { key } = above;
  const drawn = drawnResolution(key, above.direct);

  if (above.mode !== "kept" || drawn >= NOW.r || key[KEY.rs] !== drawn) return false;

  readStack(above.slots, pixi.AlphaFilter, DUE);

  return above.direct || DUE.rs === NOW.r;
}

/**
 * Marks every record above a record as changed: its picture holds what this one drew, and the flush renders inner
 * records first, so they are retaken in the same flush (P4.5). A refining alone leaves a record above that is taken
 * whole after it (F126).
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param record - The record whose drawing changed.
 */
function dirtyAbove(kctx: KeptCtx, pixi: PixiModule, record: KeptRecord): void {
  for (let node = record.top.parent; node !== null; node = node.parent) {
    const above = kctx.state.byTop.get(node);

    if (above !== undefined && !(record.refined && takenAfterInner(pixi, above))) {
      above.dirtyS1 = true;
      above.markBy = record.entity;
    }
  }

  // Per frame of a shaded view: no iterator while no overlay holds a picture.
  if (kctx.state.ranges.size === 0) return;

  // A range picture of an overlay that holds the record draws it too: rendered again after the records (spec 22 K1).
  for (const range of kctx.state.ranges.values()) {
    if (rangeHolds(range.entries, record.top)) range.due = true;
  }
}

/**
 * Puts a kept record's filters back on its top and hides its quad for an extract, or the other way back (P13.2): the
 * pixel leg draws every picture live once. No mark, no change of its life.
 *
 * @param kctx - The kept context.
 * @param record - The record, kept.
 * @param view - Its view.
 * @param live - True to draw it live, false to draw its picture again.
 */
export function bypassRecord(kctx: KeptCtx, record: KeptRecord, view: View, live: boolean): void {
  const filters = filtersOf(kctx.ctx.state.sync, record.entity);

  if (live) {
    // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears the filters.
    if (record.standIn !== undefined) record.standIn.filters = null;
    setOrigins(record.slots, 0, 0);
    kctx.sync.applyFilters(view, filters, noMark, record.top);
    kctx.sync.swapHidden(kctx.hidden, view, "kept", false);
    if (record.quad !== undefined) record.quad.visible = false;
    // Drawn live, the top must not stay the render group its picture made of it.
    ungroup(kctx, record);

    return;
  }

  kctx.sync.clearFilters(record.top);
  if (record.standIn !== undefined) kctx.sync.applyFilters(view, filters, noMark, record.standIn);
  kctx.sync.swapHidden(kctx.hidden, view, "kept", true);
  if (record.quad !== undefined) {
    record.quad.visible =
      record.top.visible &&
      !kctx.sync.hiddenBy(view, "alpha") &&
      !kctx.sync.hiddenBy(view, "cover");
  }
}
