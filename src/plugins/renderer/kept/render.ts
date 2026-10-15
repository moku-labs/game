/**
 * @file renderer/kept — the three stages of one cached view: the subtree picture (stage 1), the pre-pass result of the
 * first filter with inputs (stage 2), the filter output (stage 3), and the quad that draws it beside the view. Every
 * render is a public `renderer.render` call made before the stage pass (`host.renderTo`); every texture is the
 * engine's own, registered with `host.keep` and destroyed explicitly.
 */
import type {
  FilterSlot,
  FilterSlotInputs,
  PixiContainer,
  PixiFilterManager,
  PixiModule,
  PixiRenderTexture,
  PixiTexture
} from "../types";
import { KEY, paddingOnGrid, textureBytes } from "./geometry";
import type { KeptCtx, KeptMatrices, KeptRecord } from "./types";

/**
 * Tells whether a Pixi module can draw kept pictures: it has render textures and matrices. A stand-in module of the
 * tests without them draws every view live.
 *
 * @param pixi - The module the renderer loaded.
 * @returns True when pictures can be taken.
 */
export function canKeep(pixi: PixiModule | undefined): pixi is PixiModule {
  return (
    pixi !== undefined &&
    typeof pixi.RenderTexture?.create === "function" &&
    typeof pixi.Matrix === "function"
  );
}

/**
 * The scratch matrices of the module, made once from the Pixi module that draws.
 *
 * @param kctx - The kept context.
 * @returns The matrices, or `undefined` while nothing can be kept.
 */
export function matricesOf(kctx: KeptCtx): KeptMatrices | undefined {
  const pixi = kctx.host.pixi();

  if (!canKeep(pixi)) return undefined;
  if (kctx.matrices !== undefined && kctx.pixi === pixi) return kctx.matrices;

  kctx.pixi = pixi;
  kctx.matrices = {
    m1: new pixi.Matrix(),
    m3: new pixi.Matrix(),
    parent: new pixi.Matrix(),
    local: new pixi.Matrix()
  };

  return kctx.matrices;
}

/**
 * The name a picture's textures and passes carry: the label of the view's top.
 *
 * @param top - The view's top.
 * @returns The label, `view` when it has none.
 */
export function labelOf(top: PixiContainer): string {
  // Pixi answers `null` for a container nobody named, which its type does not say.
  const label: string | null = top.label;

  return label === null || label === "" ? "view" : label;
}

/**
 * Gives a texture the asked size and resolution: the one held, resized in place when it differs, or a new one,
 * registered with `host.keep`. Pixi rounds the device size at `resize`.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param current - The texture held, or `undefined`.
 * @param size - CSS px and texels per CSS px.
 * @param size.width - CSS width.
 * @param size.height - CSS height.
 * @param size.resolution - Texels per CSS px.
 * @param label - Its label, for the pass records.
 * @returns The texture.
 */
export function fitTexture(
  kctx: KeptCtx,
  pixi: PixiModule,
  current: PixiRenderTexture | undefined,
  size: { width: number; height: number; resolution: number },
  label: string
): PixiRenderTexture {
  const { width, height, resolution } = size;

  if (current !== undefined && !current.destroyed) {
    const source = current.source;

    if (source.width !== width || source.height !== height || source.resolution !== resolution) {
      current.resize(width, height, resolution);
    }

    return current;
  }

  const texture = pixi.RenderTexture.create({
    width,
    height,
    resolution,
    antialias: false,
    autoGarbageCollect: false,
    label
  });

  // Rounds the device size, which `create` leaves as the product.
  texture.resize(width, height, resolution);
  kctx.host.keep(texture.source, true);

  return texture;
}

/**
 * Destroys a texture of the module: out of `host.keep`, then its source.
 *
 * @param kctx - The kept context.
 * @param texture - The texture.
 */
export function dropTexture(kctx: KeptCtx, texture: PixiRenderTexture): void {
  kctx.host.keep(texture.source, false);
  texture.destroy(true);
}

/**
 * The bytes a record's textures hold now (P6.1).
 *
 * @param record - The record.
 * @returns Bytes.
 */
export function bytesOf(record: KeptRecord): number {
  let bytes = 0;

  for (const texture of [record.s1, record.s3, ...record.s2]) {
    if (texture !== undefined && !texture.destroyed) {
      const { source } = texture;

      bytes += textureBytes(source.width, source.height, source.resolution);
    }
  }

  return bytes;
}

/**
 * Ends the loan of a filter's kept results (spec 24 `hold`): its next apply draws its chain again.
 *
 * @param inputs - The seam of the filter, or `undefined` when the record holds none.
 */
export function endLoan(inputs: FilterSlotInputs | undefined): void {
  // eslint-disable-next-line unicorn/no-useless-undefined -- `hold` takes `undefined` to end the loan; it is not optional.
  inputs?.hold(undefined);
}

/**
 * The first enabled slot of a stack, when it reads inputs: the one stage 2 keeps (OQ23-5).
 *
 * @param slots - The record's slots.
 * @returns The slot and its inputs, or `undefined`.
 */
export function firstInputs(
  slots: readonly FilterSlot[]
): { slot: FilterSlot; inputs: FilterSlotInputs } | undefined {
  for (const slot of slots) {
    if (!slot.filter.enabled) continue;

    return slot.inputs === undefined ? undefined : { slot, inputs: slot.inputs };
  }

  return undefined;
}

/**
 * Stage 1, the subtree picture: the top is rendered as the root of the call, at its canvas phase on the grid of the
 * stack resolution (`M1 = (a, b, c, d, tx − X0, ty − Y0)`), its own alpha and tint in, its filters not (they hang on
 * the stand-in). The render makes the top a render group; the record keeps it one while it lives.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, its take keys written.
 * @returns True when Pixi rendered it.
 */
export function renderStage1(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord
): boolean {
  const { key, top } = record;
  const rs = key[KEY.rs] ?? 1;
  const s1 = fitTexture(
    kctx,
    pixi,
    record.s1,
    { width: key[KEY.w1] ?? 0, height: key[KEY.h1] ?? 0, resolution: rs },
    `kept:${labelOf(top)}#1`
  );

  record.s1 = s1;
  matrices.m1.set(
    key[KEY.a] ?? 1,
    key[KEY.b] ?? 0,
    key[KEY.c] ?? 0,
    key[KEY.d] ?? 1,
    (key[KEY.tx] ?? 0) - (key[KEY.X0] ?? 0),
    (key[KEY.ty] ?? 0) - (key[KEY.Y0] ?? 0)
  );

  const group = top.isRenderGroup;

  if (!kctx.host.renderTo(top, s1, matrices.m1, true)) return false;
  if (!group && !record.wasGroup) kctx.state.madeGroups.add(top);

  record.s1Version += 1;
  kctx.state.takesOpen += 1;
  kctx.state.frameTakes += 1;
  kctx.state.flushPasses += 1;

  return true;
}

/**
 * The stand-in of stage 3: a sprite of the subtree picture that carries the record's filters while it is kept. Made
 * at the first take, following `s1` when it is made again.
 *
 * @param pixi - The module that draws.
 * @param record - The record, `s1` set.
 * @returns The stand-in.
 */
export function standInOf(
  pixi: PixiModule,
  record: KeptRecord
): NonNullable<KeptRecord["standIn"]> {
  const s1 = record.s1 ?? pixi.Texture.EMPTY;

  if (record.standIn === undefined || record.standIn.destroyed) {
    record.standIn = new pixi.Sprite(s1);
    record.standIn.label = `kept:${labelOf(record.top)}#3`;
  } else if (record.standIn.texture !== s1) {
    record.standIn.texture = s1;
  }

  return record.standIn;
}

/**
 * The output texture of stage 3 at its size: the subtree picture padded by the stack's padding on its grid, at the
 * renderer resolution. Stage 2 renders into it too, before stage 3 clears it.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param record - The record.
 * @param resolution - The renderer resolution.
 * @param padding - The padding sum of the enabled filters.
 * @returns The texture.
 */
function outputOf(
  kctx: KeptCtx,
  pixi: PixiModule,
  record: KeptRecord,
  resolution: number,
  padding: number
): PixiRenderTexture {
  const { key } = record;
  const Ps = paddingOnGrid(padding, key[KEY.rs] ?? 1);

  key[KEY.Ps] = Ps;
  record.s3 = fitTexture(
    kctx,
    pixi,
    record.s3,
    {
      width: (key[KEY.w1] ?? 0) + 2 * Ps,
      height: (key[KEY.h1] ?? 0) + 2 * Ps,
      resolution
    },
    `kept:${labelOf(record.top)}#3`
  );

  return record.s3;
}

/**
 * The keeper of stage 2: an `AlphaFilter` at the stack's resolution and padding, so Pixi hands its `apply` the same
 * padded input the filter gets live, with an own `apply` (Pixi's extension point) that runs the chain into the
 * record's targets and draws nothing itself. Made once per record; its stand-in carries it and nothing else.
 *
 * @param pixi - The module that draws.
 * @param record - The record.
 * @param resolution - The stack resolution.
 * @param padding - The padding sum.
 * @returns The keeper's stand-in.
 */
function keeperOf(
  pixi: PixiModule,
  record: KeptRecord,
  resolution: number,
  padding: number
): NonNullable<KeptRecord["keeperStandIn"]> {
  if (record.keeper === undefined) {
    const keeper = new pixi.AlphaFilter({ alpha: 1 });

    keeper.apply = (manager: PixiFilterManager, input: PixiTexture): void => {
      record.s2Of?.draw(manager, input, record.s2);
    };
    record.keeper = keeper;
  }

  if (record.keeper.resolution !== resolution) record.keeper.resolution = resolution;
  if (record.keeper.padding !== padding) record.keeper.padding = padding;

  const s1 = record.s1 ?? pixi.Texture.EMPTY;

  if (record.keeperStandIn === undefined || record.keeperStandIn.destroyed) {
    record.keeperStandIn = new pixi.Sprite(s1);
    record.keeperStandIn.label = `kept:${labelOf(record.top)}#2`;
    record.keeperStandIn.filters = [record.keeper];
  } else if (record.keeperStandIn.texture !== s1) {
    record.keeperStandIn.texture = s1;
  }

  return record.keeperStandIn;
}

/**
 * The scale of every input's result, or `undefined` when one chain is empty (its result is the view's own input:
 * nothing to keep, OQ23-4).
 *
 * @param inputs - The seam of the filter.
 * @returns The scales in input order, or `undefined`.
 */
function scalesOf(inputs: FilterSlotInputs): number[] | undefined {
  const scales: number[] = [];

  for (let index = 0; index < inputs.count; index += 1) {
    const scale = inputs.scaleOf(index);

    if (scale === undefined) return undefined;

    scales.push(scale);
  }

  return scales;
}

/**
 * Sizes the record's stage-2 targets from the picture's padded frame at the stack resolution times each scale; a
 * target past the count is destroyed.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param record - The record.
 * @param scales - The scale of each input.
 * @param padding - The padding sum.
 */
function sizeTargets(
  kctx: KeptCtx,
  pixi: PixiModule,
  record: KeptRecord,
  scales: readonly number[],
  padding: number
): void {
  const { key } = record;
  const rs = key[KEY.rs] ?? 1;
  const width = (key[KEY.w1] ?? 0) + 2 * padding;
  const height = (key[KEY.h1] ?? 0) + 2 * padding;

  for (const [index, scale] of scales.entries()) {
    record.s2[index] = fitTexture(
      kctx,
      pixi,
      record.s2[index],
      { width, height, resolution: rs * scale },
      `kept:${labelOf(record.top)}#2.${index}`
    );
  }

  for (const extra of record.s2.splice(scales.length)) dropTexture(kctx, extra);
}

/**
 * Stage 2, the pre-pass result of the first enabled filter with inputs (spec 24 B3.9): the keeper's stand-in is
 * rendered over the picture, its apply draws the chain into engine targets; the version is read after the draw, a
 * scale that changed inside it resizes the targets and draws once more; the filter then holds the results. An empty
 * chain holds nothing.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, stage 1 done.
 * @param context - What stage 3 works with.
 * @param context.inputs - The seam of the first filter with inputs.
 * @param context.resolution - The renderer resolution.
 * @param context.padding - The padding sum of the enabled filters.
 */
export function renderStage2(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  context: { inputs: FilterSlotInputs; resolution: number; padding: number }
): void {
  const { inputs, resolution, padding } = context;
  const scales = scalesOf(inputs);

  if (record.s2Of !== inputs) endLoan(record.s2Of);

  record.s2Of = inputs;

  // An empty chain holds nothing: its targets go.
  if (scales === undefined) {
    endLoan(inputs);
    for (const target of record.s2.splice(0)) dropTexture(kctx, target);
    noteStage2(record, inputs);

    return;
  }

  const output = outputOf(kctx, pixi, record, resolution, padding);
  const keeper = keeperOf(pixi, record, record.key[KEY.rs] ?? 1, padding);
  const Ps = record.key[KEY.Ps] ?? 0;

  // The loan ends while the chain draws: the targets are its own, written in place.
  endLoan(inputs);
  sizeTargets(kctx, pixi, record, scales, padding);
  matrices.m3.set(1, 0, 0, 1, Ps, Ps);
  kctx.host.renderTo(keeper, output, matrices.m3, true);

  // A scale that changed inside the draw resizes the targets and draws once more.
  const after = scalesOf(inputs);

  if (after?.some((scale, index) => scale !== scales[index])) {
    sizeTargets(kctx, pixi, record, after, padding);
    kctx.host.renderTo(keeper, output, matrices.m3, true);
  }

  inputs.hold(record.s2);
  kctx.state.flushPasses += 1 + inputs.stages.length;
  noteStage2(record, inputs);
}

/**
 * Notes the versions stage 2 drew: the chain's, and the subtree picture's it drew over.
 *
 * @param record - The record, stage 2 done.
 * @param inputs - The seam of the first filter with inputs.
 */
function noteStage2(record: KeptRecord, inputs: FilterSlotInputs): void {
  record.s2InputsVersion = inputs.version();
  record.s2PictureVersion = record.s1Version;
}

/**
 * Stage 3, the filter output: the stand-in, carrying the record's filters, is rendered at `M3 = translate(Ps, Ps)`
 * into the output texture. A placed filter's origin gets the picture's canvas origin first, `O + Δ`; a local one
 * writes nothing.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, stage 1 done.
 * @param now - The frame's numbers.
 * @param now.r - The renderer resolution.
 * @param now.P - The padding sum of the enabled filters.
 * @param now.tx - The top's translation now.
 * @param now.ty - The top's translation now.
 * @returns True when Pixi rendered it.
 */
export function renderStage3(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  now: { readonly r: number; readonly P: number; readonly tx: number; readonly ty: number }
): boolean {
  const { key } = record;
  const output = outputOf(kctx, pixi, record, now.r, now.P);
  const standIn = standInOf(pixi, record);
  const Ps = key[KEY.Ps] ?? 0;

  if (record.category === "placed") {
    const x = (key[KEY.X0] ?? 0) - Ps + now.tx - (key[KEY.tx] ?? 0);
    const y = (key[KEY.Y0] ?? 0) - Ps + now.ty - (key[KEY.ty] ?? 0);

    for (const slot of record.slots) {
      if (slot.origin !== undefined) {
        slot.origin[0] = x;
        slot.origin[1] = y;
      }
    }
  }

  matrices.m3.set(1, 0, 0, 1, Ps, Ps);

  if (!kctx.host.renderTo(standIn, output, matrices.m3, true)) return false;

  key[KEY.r] = now.r;
  key[KEY.P] = now.P;
  key[KEY.s3Tx] = now.tx;
  key[KEY.s3Ty] = now.ty;

  let passes = 1;

  for (const slot of record.slots) if (slot.filter.enabled) passes += slot.passes;

  kctx.state.flushPasses += passes;

  return true;
}
