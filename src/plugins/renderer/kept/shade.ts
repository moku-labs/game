/**
 * @file renderer/kept — a kept view on its filter's own shader (F126 stage 2). A view whose filter numbers change would
 * pay a stage 3 pass in every frame; a shaded record draws instead through a `Mesh` that runs the filter's body over the
 * padded picture, inside the pass that draws the canvas. `s3` then holds the subtree picture copied at `translate(Ps,
 * Ps)` with no filter, one pass only when the picture, the padding or the resolution changed; a new number is drawn by
 * the mesh with no pass at all. The renderer holds no shader text: `effects` hands a built program over the slot. The
 * policy of the mode, when it is entered and left, lives in `record.ts`; this file holds what is made, bound and freed.
 * The filter's uniform group is the instance's own, read by the mesh as it stands.
 */
import { filterGlobals, quadShader, unitQuad, VECTOR } from "../quad";
import type {
  FilterSlot,
  FilterSlotQuad,
  PixiMeshGeometry,
  PixiModule,
  PixiRenderTexture,
  PixiShader,
  PixiSprite,
  PixiTextureSource
} from "../types";
import { KEY } from "./geometry";
import { labelOf, outputOf, setOrigins } from "./render";
import type { KeptCtx, KeptMatrices, KeptQuad, KeptRecord, KeptShade, KeptState } from "./types";

/** The numbers `renderShade` wants in the group this frame, in the order of `writeGlobals`. One array: it allocates nothing. */
const WANTED = new Float32Array(6 * VECTOR);

/** `uOutputTexture.z` of a pass that ends on the canvas: Pixi's sign for a root target, which turns `y` over. */
const ROOT_TARGET = -1;

/**
 * The first enabled slot of a stack: the one slot of a stack that fits the mode.
 *
 * @param slots - The record's slots.
 * @returns The slot, or `undefined` when none is enabled.
 */
export function enabledSlot(slots: readonly FilterSlot[]): FilterSlot | undefined {
  // Per frame of a shaded view: a frozen list, walked by index (`for…of` allocates over a frozen array).
  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];

    if (slot?.filter.enabled === true) return slot;
  }

  return undefined;
}

/**
 * The one unit quad of the run, made on demand.
 *
 * @param state - The kept state.
 * @param pixi - The module that draws.
 * @returns The geometry.
 */
function geometryOf(state: KeptState, pixi: PixiModule): PixiMeshGeometry {
  state.quadGeometry ??= unitQuad(pixi);

  return state.quadGeometry;
}

/**
 * The one sprite that copies a picture into its output, made on demand. It is only ever the root of its own render.
 *
 * @param state - The kept state.
 * @param pixi - The module that draws.
 * @returns The sprite.
 */
function copyOf(state: KeptState, pixi: PixiModule): PixiSprite {
  if (state.quadCopy === undefined) {
    state.quadCopy = new pixi.Sprite(pixi.Texture.EMPTY);
    state.quadCopy.label = "kept:copy";
  }

  return state.quadCopy;
}

/**
 * Makes the mesh of a record: no texture of its own, the shader binds the picture.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param record - The record.
 * @param shader - The shader.
 * @returns The mesh.
 */
function meshOf(
  kctx: KeptCtx,
  pixi: PixiModule,
  record: KeptRecord,
  shader: PixiShader
): KeptShade["mesh"] {
  const mesh = new pixi.Mesh({ geometry: geometryOf(kctx.state, pixi), shader });

  mesh.label = `kept:${labelOf(record.top)}`;

  return mesh;
}

/**
 * Makes what a record draws through, at its first entry.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param record - The record.
 * @param quad - The slot's quad.
 * @param output - The texture the record draws from.
 * @param sprite - The sprite of the record's picture.
 * @returns The shade.
 */
function makeShade(
  kctx: KeptCtx,
  pixi: PixiModule,
  record: KeptRecord,
  quad: FilterSlotQuad,
  output: PixiRenderTexture,
  sprite: PixiSprite
): KeptShade {
  const { group, vectors } = filterGlobals(pixi);
  const { source } = output;
  const shader = quadShader(pixi, quad, group, source);

  return {
    mesh: meshOf(kctx, pixi, record, shader),
    shader,
    gfu: group,
    vectors,
    sprite,
    quad,
    source,
    copied: -1,
    copiedWidth: 0,
    copiedHeight: 0
  };
}

/**
 * Hangs one quad in the place of another in the tree, and takes the other out.
 *
 * @param from - The quad that goes.
 * @param to - The quad that comes.
 */
function swapQuad(from: KeptQuad, to: KeptQuad): void {
  const parent = from.parent;

  if (parent !== null) parent.addChildAt(to, parent.getChildIndex(from));

  from.removeFromParent();
  to.visible = from.visible;
}

/**
 * Puts a record on its mesh: the mesh in the sprite's place, the sprite kept aside, the matrix written again, a copy
 * owed. What it draws through is made at the first entry, and an entry after that makes nothing, unless the mesh went
 * with a parent destroyed around it.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param record - The record, kept, not shaded, its quad placed.
 * @param quad - The slot's quad.
 * @param now - The frame's numbers.
 * @param now.r - The renderer resolution.
 * @param now.P - The padding sum of the enabled filters.
 * @returns True when the record is on its mesh; false for a record with no sprite to take the place of.
 */
export function enterShade(
  kctx: KeptCtx,
  pixi: PixiModule,
  record: KeptRecord,
  quad: FilterSlotQuad,
  now: { readonly r: number; readonly P: number }
): boolean {
  const sprite = record.quad;

  // Out of the mode the quad is the sprite `placeQuad` made.
  if (!(sprite instanceof pixi.Sprite)) return false;

  const output = outputOf(kctx, pixi, record, now.r, now.P);
  const shade = record.shade ?? makeShade(kctx, pixi, record, quad, output, sprite);

  record.shade = shade;

  if (shade.mesh.destroyed) shade.mesh = meshOf(kctx, pixi, record, shade.shader);

  shade.sprite = sprite;
  swapQuad(sprite, shade.mesh);
  record.quad = shade.mesh;
  record.shaded = true;
  shade.copied = -1;
  record.key[KEY.qa] = Number.NaN;

  return true;
}

/**
 * Puts a record back on its sprite: `goLive` and `goDirect` come through here first, so an eviction, a churn, an
 * ineligible frame and a stack reduced to `Alpha` all leave one way, before `s3` is dropped: a mesh never outlives its
 * binding. The sprite shows what `s3` holds next: a caller that keeps the record owes it stage 3.
 *
 * @param record - The record.
 */
export function leaveShade(record: KeptRecord): void {
  const { shade } = record;

  if (!record.shaded || shade === undefined) return;

  swapQuad(shade.mesh, shade.sprite);
  record.quad = shade.sprite;
  record.shaded = false;
  shade.copied = -1;
  record.key[KEY.qa] = Number.NaN;
}

/**
 * Builds the shader again for another slot's quad: `effects` hands one per instance, so the numbers of the view's new
 * instance are bound and those of the old one, which may go at any moment, are not.
 *
 * @param pixi - The module that draws.
 * @param shade - The shade.
 * @param quad - The slot's quad now.
 * @param source - The texture it reads.
 */
function rebuildShader(
  pixi: PixiModule,
  shade: KeptShade,
  quad: FilterSlotQuad,
  source: PixiTextureSource
): void {
  const old = shade.shader;

  shade.shader = quadShader(pixi, quad, shade.gfu, source);
  shade.mesh.shader = shade.shader;
  shade.quad = quad;
  shade.source = source;
  shade.copied = -1;
  old.destroy();
}

/**
 * Copies a vector of `WANTED` into the group where it differs. Both sides are 32-bit numbers: a double would differ from
 * its stored value in every frame, and the group would be uploaded in every frame.
 *
 * @param target - The group's vector.
 * @param at - Where the vector starts in `WANTED`.
 * @returns True when a number differed.
 */
function writeVector(target: Float32Array, at: number): boolean {
  let differs = false;

  for (let index = 0; index < VECTOR; index += 1) {
    const value = WANTED[at + index] ?? 0;

    if (target[index] !== value) {
      target[index] = value;
      differs = true;
    }
  }

  return differs;
}

/**
 * Writes the numbers a filter pass would hand the body for the padded picture at its canvas place: `uv` runs over the
 * whole texture, the frame stands at `O + Δ`, and the target is the canvas. Uploaded once, only when one differs.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param shade - Its shade.
 * @param source - The padded picture.
 * @param now - The frame's numbers.
 * @param now.r - The renderer resolution.
 * @param now.tx - The top's x translation now.
 * @param now.ty - The top's y translation now.
 */
function writeGlobals(
  kctx: KeptCtx,
  record: KeptRecord,
  shade: KeptShade,
  source: PixiTextureSource,
  now: { readonly r: number; readonly tx: number; readonly ty: number }
): void {
  const { key } = record;
  const { width, height, pixelWidth, pixelHeight } = source;
  const screen = kctx.host.screen();
  const screenWidth = screen?.width ?? 0;
  const screenHeight = screen?.height ?? 0;
  const Ps = key[KEY.Ps] ?? 0;

  // `uInputSize`: the padded picture is the whole input, CSS px and their inverse.
  WANTED[0] = width;
  WANTED[1] = height;
  WANTED[2] = 1 / width;
  WANTED[3] = 1 / height;
  // `uInputPixel`: the same in device pixels.
  WANTED[4] = pixelWidth;
  WANTED[5] = pixelHeight;
  WANTED[6] = 1 / pixelWidth;
  WANTED[7] = 1 / pixelHeight;
  // `uInputClamp`: half a texel in from each edge of the whole texture.
  WANTED[8] = 0.5 / pixelWidth;
  WANTED[9] = 0.5 / pixelHeight;
  WANTED[10] = 1 - 0.5 / pixelWidth;
  WANTED[11] = 1 - 0.5 / pixelHeight;
  // `uOutputFrame`: the padded picture's canvas place `O + Δ`, at its CSS size.
  WANTED[12] = (key[KEY.X0] ?? 0) - Ps + now.tx - (key[KEY.tx] ?? 0);
  WANTED[13] = (key[KEY.Y0] ?? 0) - Ps + now.ty - (key[KEY.ty] ?? 0);
  WANTED[14] = width;
  WANTED[15] = height;
  // `uGlobalFrame`: Pixi's numbers for a pass that ends on the canvas: no parent filter, so no offset.
  WANTED[16] = 0;
  WANTED[17] = 0;
  WANTED[18] = screenWidth * now.r;
  WANTED[19] = screenHeight * now.r;
  // `uOutputTexture`: the canvas is the target.
  WANTED[20] = screenWidth;
  WANTED[21] = screenHeight;
  WANTED[22] = ROOT_TARGET;
  WANTED[23] = 0;

  const { vectors } = shade;
  let differs = writeVector(vectors.uInputSize, 0);

  differs = writeVector(vectors.uInputPixel, VECTOR) || differs;
  differs = writeVector(vectors.uInputClamp, 2 * VECTOR) || differs;
  differs = writeVector(vectors.uOutputFrame, 3 * VECTOR) || differs;
  differs = writeVector(vectors.uGlobalFrame, 4 * VECTOR) || differs;
  differs = writeVector(vectors.uOutputTexture, 5 * VECTOR) || differs;

  if (differs) shade.gfu.update();
}

/**
 * Copies the subtree picture into the output at `translate(Ps, Ps)`, no filter, a cleared target: the padded picture the
 * body reads. One pass, counted.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, shaded, its `Ps` written.
 * @param output - The output.
 * @returns True when Pixi rendered it.
 */
function copyPadded(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  output: PixiRenderTexture
): boolean {
  const { key, shade } = record;
  const copy = copyOf(kctx.state, pixi);
  const Ps = key[KEY.Ps] ?? 0;

  copy.texture = record.s1 ?? pixi.Texture.EMPTY;
  matrices.m3.set(1, 0, 0, 1, Ps, Ps);

  if (shade === undefined || !kctx.host.renderTo(copy, output, matrices.m3, true)) return false;

  const { source } = output;

  kctx.state.flushPasses += 1;
  shade.copied = record.s1Version;
  shade.copiedWidth = source.pixelWidth;
  shade.copiedHeight = source.pixelHeight;

  return true;
}

/**
 * The frame of a shaded record: stage 3 for the mesh. The output at its size, the shader on the slot's quad and on that
 * texture, the padded picture copied when `s1`, the padding or the resolution changed (one pass, counted), the global
 * uniforms, then `keptOrigin` at 0: in the mode the place is in `uOutputFrame.xy`, so `canvasPixel` and a body that reads
 * the frame answer the same. The keys stage 3 writes. A new number needs none of it: the mesh reads the instance's own
 * uniform group. Allocates nothing while the size stands.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 * @param record - The record, shaded, stage 1 done.
 * @param now - The frame's numbers.
 * @param now.r - The renderer resolution.
 * @param now.P - The padding sum of the enabled filters.
 * @param now.tx - The top's x translation now.
 * @param now.ty - The top's y translation now.
 * @returns True when the copy, if one was owed, rendered.
 */
export function renderShade(
  kctx: KeptCtx,
  pixi: PixiModule,
  matrices: KeptMatrices,
  record: KeptRecord,
  now: { readonly r: number; readonly P: number; readonly tx: number; readonly ty: number }
): boolean {
  const { key, shade } = record;

  if (shade === undefined) return false;

  // The output at its size, without a size object or a label while the size stands.
  const output = outputOf(kctx, pixi, record, now.r, now.P);
  const { source } = output;
  const quad = enabledSlot(record.slots)?.quad;

  // The numbers of the instance the slot holds now: the old one may go at any moment.
  if (quad !== undefined && quad !== shade.quad) rebuildShader(pixi, shade, quad, source);

  // An evicted record comes back on another texture from the pool.
  if (source !== shade.source) {
    const { resources } = shade.shader;

    resources.uTexture = source;
    resources.uSampler = source.style;
    shade.source = source;
    shade.copied = -1;
  }

  // `outputOf` resizes `s3` in place, which blanks it without moving `s1Version`.
  const resized =
    source.pixelWidth !== shade.copiedWidth || source.pixelHeight !== shade.copiedHeight;

  if (
    (shade.copied !== record.s1Version || resized) &&
    !copyPadded(kctx, pixi, matrices, record, output)
  ) {
    return false;
  }

  // What the body reads of its place: in `uOutputFrame.xy`, so `keptOrigin` stays 0.
  writeGlobals(kctx, record, shade, source, now);
  setOrigins(record.slots, 0, 0);

  // The keys stage 3 writes: what `outputOwed` compares with the next frame.
  key[KEY.r] = now.r;
  key[KEY.P] = now.P;
  key[KEY.s3Tx] = now.tx;
  key[KEY.s3Ty] = now.ty;

  return true;
}

/**
 * Destroys what a record drew through. The uniform buffer goes first, by hand: Pixi's `destroy` leaves it to a collector
 * that runs after a minute. The mesh leaves the shared geometry alone.
 *
 * @param shade - The shade.
 */
export function destroyShade(shade: KeptShade): void {
  shade.gfu.buffer?.destroy();
  shade.mesh.destroy();
  shade.shader.destroy();
  shade.sprite.destroy();
}

/**
 * Destroys what the shaded records of a run share; the next entry makes them again, on the device there is then.
 *
 * @param state - The kept state.
 */
export function dropQuadParts(state: KeptState): void {
  state.quadGeometry?.destroy(true);
  state.quadCopy?.destroy();
  state.quadGeometry = undefined;
  state.quadCopy = undefined;
}
