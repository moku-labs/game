/**
 * @file renderer/sync — the pipeline warm-up (F4): invisible probe draws, before the stage pass of a drawn frame, that
 * create the GPU pipelines a game will need while it loads, instead of in the frame that first needs them. A WebGPU
 * pipeline is keyed by the bound target's formats and stencil state, so every subject is drawn onto the canvas and into
 * a texture, each with and without a stencil clip; WebGL compiles one program per shader whatever the target, so one
 * draw is enough there. The probes hang in a tree of their own, never in the stage. A canvas variant is rendered onto
 * the canvas without a clear just before the stage pass, which clears the canvas first: nothing shows. A texture variant
 * is rendered into a small texture the module owns, never through a filter of its own: a filter probe is always the one
 * filter of its render, so the warm-up never opens a second level of Pixi's filter stack (Pixi 8.21 reads the stale
 * input texture of that level at its next push, and a pool trim destroys it in between). A probe whose render throws
 * ends the warm-up of the application: a throw inside Pixi's render leaves its filter stack unbalanced, which no public
 * API rebalances, so another probe would only throw again. A filter handed over with its quad draws a mesh of that
 * program after it, on WebGPU, inside an error scope: a quad program that does not fit its pipeline fails asynchronously,
 * as a blank view with nothing in the logs, and this is the one place such a fault can be seen. The end of a run
 * reaches the monitor through `onWarm`; this file never imports the monitor (LEAD-FIXES-3 O24).
 */

import { filterGlobals, quadShader, unitQuad } from "../quad";
import { destroyWhole } from "../sources";
import type { FilterSlotQuad, PixiContainer, PixiFilter, PixiModule, PixiSprite } from "../types";
import { clearFilters } from "./filters";
import type {
  SyncCtx,
  SyncState,
  WarmDraw,
  WarmMesh,
  WarmObjects,
  WarmQuad,
  WarmState,
  WarmSubject,
  WarmVariant
} from "./types";

/** A member of the probe tree that holds a content subject's object. */
type FixedNode =
  | "sprite"
  | "spriteAdd"
  | "spriteScreen"
  | "graphics"
  | "particlesNormal"
  | "particlesAdd";

/** The side of every probe, in CSS pixels: the smallest thing that still draws a triangle. */
const PROBE_SIZE = 4;

/** The content subjects the renderer warms itself, in queue order; the text follows once a font is installed. */
const CONTENT: readonly WarmSubject[] = Object.freeze([
  "sprite",
  "sprite-add",
  "sprite-screen",
  "graphics",
  "particles-normal",
  "particles-add"
]);

/** The probe object of each content subject the tree holds from its first warm frame on. */
const FIXED_NODES: Readonly<
  Record<Exclude<WarmSubject, "text" | PixiFilter | WarmQuad>, FixedNode>
> = Object.freeze({
  sprite: "sprite",
  "sprite-add": "spriteAdd",
  "sprite-screen": "spriteScreen",
  graphics: "graphics",
  "particles-normal": "particlesNormal",
  "particles-add": "particlesAdd"
});

/** Every target a WebGPU pipeline is keyed by. */
const ALL_VARIANTS: readonly WarmVariant[] = Object.freeze([
  "canvas",
  "canvas+clip",
  "texture",
  "texture+clip"
]);

/** The variants of a canvas the stage pass does not clear: only those drawn into a texture leave no pixel. */
const TEXTURE_VARIANTS: readonly WarmVariant[] = Object.freeze(["texture", "texture+clip"]);

/** WebGL: one program per shader, whatever the target. */
const CANVAS_VARIANT: readonly WarmVariant[] = Object.freeze(["canvas"]);

/** WebGL on a canvas that is not cleared: the one variant that leaves no pixel. */
const TEXTURE_VARIANT: readonly WarmVariant[] = Object.freeze(["texture"]);

/**
 * The per-particle properties `effects` uploads every frame: the vertex layout its particle pipeline is keyed by.
 *
 * @returns A fresh record, as `ParticleContainer` takes it.
 */
function particleProperties(): Record<string, boolean> {
  return { position: true, vertex: true, rotation: true, color: true, uvs: false };
}

/**
 * A 4 × 4 sprite of Pixi's white texture: the batch pipeline of sprites, nine-slices, plain bitmap text and batched
 * graphics, with the blend of a `Sprite` or a `NineSlice` glow (part of a WebGPU pipeline's key).
 *
 * @param pixi - The module that draws.
 * @param blend - `"normal"` (Pixi's own mode left as it is), `"add"` or `"screen"`.
 * @returns The sprite, labelled `renderer.warm.sprite`, or `renderer.warm.sprite-<blend>` for a glow.
 */
function whiteSprite(pixi: PixiModule, blend: "normal" | "add" | "screen" = "normal"): PixiSprite {
  const sprite = new pixi.Sprite(pixi.Texture.WHITE);

  sprite.label = blend === "normal" ? "renderer.warm.sprite" : `renderer.warm.sprite-${blend}`;
  sprite.width = PROBE_SIZE;
  sprite.height = PROBE_SIZE;
  if (blend !== "normal") sprite.blendMode = blend;

  return sprite;
}

/**
 * A particle container with one particle of Pixi's white texture and a blend mode, as `effects` draws its emitters.
 *
 * @param pixi - The module that draws.
 * @param blendMode - `"normal"` or `"add"`: part of the pipeline's key.
 * @returns The container.
 */
function particlesOf(pixi: PixiModule, blendMode: "normal" | "add"): PixiContainer {
  const container = new pixi.ParticleContainer({
    dynamicProperties: particleProperties(),
    blendMode,
    texture: pixi.Texture.WHITE
  });

  container.label = `renderer.warm.particles-${blendMode}`;
  container.addParticle(new pixi.Particle({ texture: pixi.Texture.WHITE, x: 0, y: 0 }));
  // A particle container measures nothing: the area gives a filter around it its bounds.
  container.boundsArea = new pixi.Rectangle(0, 0, PROBE_SIZE, PROBE_SIZE);

  return container;
}

/**
 * Builds the probe tree once, at the first warm frame of a device: the root, the clip and its mask, the texture of the
 * texture variants, the filter holder and the content subjects. The text is made at its first draw.
 *
 * @param pixi - The module that draws.
 * @returns The probe tree.
 */
function buildObjects(pixi: PixiModule): WarmObjects {
  const root = new pixi.Container();
  const clipFrame = new pixi.Container();
  const clip = new pixi.Container();
  const mask = new pixi.Graphics().rect(0, 0, PROBE_SIZE, PROBE_SIZE).fill(0xff_ff_ff);
  // A target like a filter pass's: the same format, one sample, a stencil once a clip draws into it.
  const target = pixi.RenderTexture.create({
    width: PROBE_SIZE,
    height: PROBE_SIZE,
    antialias: false,
    autoGarbageCollect: false,
    label: "renderer.warm.texture"
  });
  const holder = new pixi.Container();
  const graphics = new pixi.Graphics().rect(0, 0, PROBE_SIZE, PROBE_SIZE).fill(0xff_ff_ff);

  // Labels name the pieces in a picture of the tree and in the tests; none of them is ever in the stage.
  root.label = "renderer.warm";
  clipFrame.label = "renderer.warm.clip";
  holder.label = "renderer.warm.filter";
  graphics.label = "renderer.warm.graphics";
  // The clip as `sync` hangs one: the masked container, its mask beside it.
  clip.mask = mask;
  clipFrame.addChild(clip, mask);
  holder.addChild(whiteSprite(pixi));
  // The graphics pipe's own shader: a small graphics is batched with the sprites otherwise.
  graphics.context.batchMode = "no-batch";

  return {
    root,
    clipFrame,
    clip,
    mask,
    target,
    holder,
    list: [],
    sprite: whiteSprite(pixi),
    spriteAdd: whiteSprite(pixi, "add"),
    spriteScreen: whiteSprite(pixi, "screen"),
    graphics,
    particlesNormal: particlesOf(pixi, "normal"),
    particlesAdd: particlesOf(pixi, "add"),
    text: undefined,
    quad: undefined
  };
}

/**
 * The mesh of the quad subjects, made at their first draw: a trimmed Pixi that draws no quad has no need of its classes.
 *
 * @param pixi - The module that draws.
 * @returns The mesh, its geometry and the uniforms its probes bind.
 */
function quadMesh(pixi: PixiModule): WarmMesh {
  const geometry = unitQuad(pixi);
  const mesh = new pixi.Mesh({ geometry });

  mesh.label = "renderer.warm.quad";
  mesh.scale.set(PROBE_SIZE);

  return { mesh, geometry, gfu: filterGlobals(pixi), shader: undefined };
}

/**
 * Frees the mesh of the quad subjects: the probes' uniform buffer by hand, as the kept cache frees a view's.
 *
 * @param probe - The mesh, when a quad was drawn on this device.
 */
function dropQuadMesh(probe: WarmMesh | undefined): void {
  if (probe === undefined) return;

  probe.shader?.destroy();
  probe.gfu.buffer?.destroy();
  probe.mesh.destroy();
  probe.geometry.destroy(true);
}

/**
 * Destroys the probe tree of a device that went or of a renderer that stops: the module's own texture and mask
 * included, never a filter it was handed.
 *
 * @param warm - The warm branch of the sync state.
 */
function dropObjects(warm: WarmState): void {
  const objects = warm.objects;

  if (objects === undefined) return;

  warm.objects = undefined;
  clearFilters(objects.holder);
  objects.list.length = 0;
  dropQuadMesh(objects.quad);

  const nodes = [
    objects.root,
    objects.clipFrame,
    objects.holder,
    objects.sprite,
    objects.spriteAdd,
    objects.spriteScreen,
    objects.graphics,
    objects.particlesNormal,
    objects.particlesAdd,
    objects.text
  ];

  for (const node of nodes) node?.destroy({ children: true });
  destroyWhole(objects.target);
}

/**
 * Logs one warning once per key: a probe tree Pixi could not build, or the canvas variants left out.
 *
 * @param sctx - Domain context of the sync module.
 * @param key - What the line is about.
 * @param message - The log message.
 * @param detail - The log detail.
 */
function reportOnce(
  sctx: SyncCtx,
  key: unknown,
  message: string,
  detail: Readonly<Record<string, unknown>>
): void {
  const { reported } = sctx.ctx.state.sync.warm;

  if (reported.has(key)) return;

  reported.add(key);
  sctx.ctx.log.warn(message, detail);
}

/**
 * The targets one subject is drawn into on this device: four on WebGPU, one on WebGL. A canvas the stage pass does not
 * clear gets the texture variants alone, logged once.
 *
 * @param sctx - Domain context of the sync module.
 * @returns The variants.
 */
function variantsOf(sctx: SyncCtx): readonly WarmVariant[] {
  const { host } = sctx.deps;
  const cleared = host.clearsCanvas();

  if (!cleared) reportOnce(sctx, "canvas-off", "renderer:warm-canvas-off", {});
  if (host.kind() !== "webgpu") return cleared ? CANVAS_VARIANT : TEXTURE_VARIANT;

  return cleared ? ALL_VARIANTS : TEXTURE_VARIANTS;
}

/**
 * Appends the draws of one subject to the queue.
 *
 * @param warm - The warm branch of the sync state.
 * @param subject - The subject.
 * @param variants - Its variants.
 */
function enqueue(warm: WarmState, subject: WarmSubject, variants: readonly WarmVariant[]): void {
  for (const variant of variants) warm.queue.push({ subject, variant });
}

/**
 * Queues the draws of a filter, then those of its quad: a quad program is a WebGPU program, and WebGL draws the stage 3
 * it stands for.
 *
 * @param sctx - Domain context of the sync module.
 * @param filter - The filter.
 * @param variants - The variants of this device.
 * @returns The draws queued.
 */
function enqueueFilter(
  sctx: SyncCtx,
  filter: PixiFilter,
  variants: readonly WarmVariant[]
): number {
  const { warm } = sctx.ctx.state.sync;
  const quad = warm.quads.get(filter);

  enqueue(warm, filter, variants);

  if (quad === undefined || sctx.deps.host.kind() !== "webgpu") return variants.length;

  enqueue(warm, { filter, quad }, variants);

  return 2 * variants.length;
}

/**
 * Tells whether the renderer can warm anything now: the config asks for draws, a device draws, and no probe threw on
 * this application.
 *
 * @param sctx - Domain context of the sync module.
 * @returns True when probes may be queued.
 */
function canWarm(sctx: SyncCtx): boolean {
  const state = sctx.ctx.state.sync;

  return (
    sctx.ctx.config.warm > 0 &&
    sctx.deps.host.ready() &&
    state.root !== undefined &&
    !state.warm.failed
  );
}

/**
 * Ends the warm-up of this application early: every waiting promise answers false and the queue empties. A filter
 * answered false is forgotten, since its caller may destroy it; a filter warmed already stays known, so a new
 * application queues it again.
 *
 * @param warm - The warm branch of the sync state.
 */
function abandon(warm: WarmState): void {
  for (const [filter, entry] of warm.waiting) {
    warm.filters.delete(filter);
    warm.quads.delete(filter);
    for (const resolve of entry.resolve) resolve(false);
  }

  warm.waiting.clear();
  warm.queue.length = 0;
  warm.head = 0;
  warm.draws = 0;
}

/**
 * Starts the warm-up of a device, at `sync.start()` and after every rebuild of a restore: the probe tree of an earlier
 * device goes, and the queue starts over with the content subjects, the text when a font is installed, and every filter
 * handed over before (the device is new; no promise is answered again). A probe that threw on the earlier application
 * stops nothing here: the new application has a filter stack of its own. Asks for a frame.
 *
 * @param sctx - Domain context of the sync module.
 */
export function startWarm(sctx: SyncCtx): void {
  const state = sctx.ctx.state.sync;
  const { warm } = state;

  dropObjects(warm);
  warm.queue.length = 0;
  warm.head = 0;
  warm.draws = 0;
  warm.textQueued = false;
  warm.failed = false;

  if (!canWarm(sctx)) return;

  const variants = variantsOf(sctx);

  for (const subject of CONTENT) enqueue(warm, subject, variants);

  const [font] = state.fonts.keys();

  if (font !== undefined) {
    warm.textFont = font;
    warm.textQueued = true;
    enqueue(warm, "text", variants);
  }

  for (const filter of warm.filters) {
    const left = enqueueFilter(sctx, filter, variants);
    const entry = warm.waiting.get(filter);

    if (entry === undefined) warm.waiting.set(filter, { left, resolve: [] });
    else entry.left = left;
  }

  sctx.deps.demand.request();
}

/**
 * Queues the text probe once per device, when the first font is installed: a `BitmapText` in that font, ahead of the
 * filters still waiting, since the first screen draws text. Asks for a frame.
 *
 * @param sctx - Domain context of the sync module.
 * @param key - The font's asset key.
 */
export function queueText(sctx: SyncCtx, key: string): void {
  const { warm } = sctx.ctx.state.sync;

  if (warm.textQueued || !canWarm(sctx)) return;

  warm.textFont = key;
  warm.textQueued = true;

  const draws: WarmDraw[] = variantsOf(sctx).map(variant => ({ subject: "text", variant }));
  let at = warm.head;

  while (at < warm.queue.length && typeof warm.queue[at]?.subject === "string") at += 1;

  warm.queue.splice(at, 0, ...draws);
  sctx.deps.demand.request();
}

/**
 * Queues a filter's probe draws; resolves true once every draw was made (the body of `FiltersApi.warm`). Answers false
 * at once while nothing can be warmed, true at once for a filter whose draws were made on this device, and joins the
 * waiting list of one whose draws are queued.
 *
 * @param sctx - Domain context of the sync module.
 * @param filter - A filter the caller keeps alive while it waits.
 * @param quad - Its body on a quad, drawn after it.
 * @returns Whether the filter's pipelines were created.
 */
export function warmFilter(
  sctx: SyncCtx,
  filter: PixiFilter,
  quad?: FilterSlotQuad
): Promise<boolean> {
  const { warm } = sctx.ctx.state.sync;

  if (!canWarm(sctx)) return Promise.resolve(false);

  const waiting = warm.waiting.get(filter);

  if (waiting === undefined && warm.filters.has(filter)) return Promise.resolve(true);

  const entry = waiting ?? { left: 0, resolve: [] };

  if (waiting === undefined) {
    warm.filters.add(filter);
    if (quad !== undefined) warm.quads.set(filter, quad);
    entry.left = enqueueFilter(sctx, filter, variantsOf(sctx));
    warm.waiting.set(filter, entry);
    sctx.deps.demand.request();
  }

  return new Promise(resolve => {
    entry.resolve.push(resolve);
  });
}

/**
 * Tells a filter's quad from the filter among the subjects that are no names.
 *
 * @param subject - The subject.
 * @returns True for a quad.
 */
function isQuad(subject: Exclude<WarmSubject, string>): subject is WarmQuad {
  return "quad" in subject;
}

/**
 * The filter a subject that is no name belongs to.
 *
 * @param subject - A filter, or its quad.
 * @returns The filter.
 */
function filterOf(subject: Exclude<WarmSubject, string>): PixiFilter {
  return isQuad(subject) ? subject.filter : subject;
}

/**
 * The mesh of a quad subject, with a shader of this program over Pixi's white texture: the pipeline is what the probe
 * is for, and a pipeline is keyed by the layout.
 *
 * @param pixi - The module that draws.
 * @param objects - The probe tree.
 * @param subject - The quad.
 * @returns The mesh.
 */
function quadNode(pixi: PixiModule, objects: WarmObjects, subject: WarmQuad): PixiContainer {
  const probe = objects.quad ?? quadMesh(pixi);

  objects.quad = probe;
  probe.shader = quadShader(pixi, subject.quad, probe.gfu, pixi.Texture.WHITE.source);
  probe.mesh.shader = probe.shader;

  return probe.mesh;
}

/**
 * The node one subject hangs from: a content object, the holder with the draw's filter on it, or the mesh of a quad. The
 * text is made at its first draw, in the font of the warm-up.
 *
 * @param pixi - The module that draws.
 * @param warm - The warm branch of the sync state.
 * @param objects - The probe tree.
 * @param subject - The subject.
 * @returns The node, or `undefined` for the text without a font.
 */
function nodeOf(
  pixi: PixiModule,
  warm: WarmState,
  objects: WarmObjects,
  subject: WarmSubject
): PixiContainer | undefined {
  if (typeof subject !== "string") {
    if (isQuad(subject)) return quadNode(pixi, objects, subject);

    objects.list[0] = subject;
    objects.holder.filters = objects.list;

    return objects.holder;
  }

  if (subject !== "text") return objects[FIXED_NODES[subject]];
  if (warm.textFont === undefined) return undefined;

  objects.text ??= new pixi.BitmapText({
    label: "renderer.warm.text",
    text: "0",
    style: { fontFamily: warm.textFont, fontSize: 16 }
  });

  return objects.text;
}

/**
 * The name of a probe's filter in the log: the name of its WebGPU program (the definition id of one of `effects`'
 * filters), else its class, as Pixi's own filters name no program.
 *
 * @param filter - The filter.
 * @returns The name; `"filter"` when it has neither.
 */
function filterName(filter: PixiFilter): string {
  const program: unknown = filter.gpuProgram?.name;

  if (typeof program === "string" && program !== "") return program;

  const name = filter.constructor.name.replace(/^_/, "");

  return name === "" ? "filter" : name;
}

/**
 * Ends the warm-up of this application after a probe whose render threw, and logs it at error level with the kind of
 * the probe, its variant and, for a filter, its name.
 *
 * @param sctx - Domain context of the sync module.
 * @param draw - The draw whose render threw.
 * @param error - What Pixi threw.
 */
function failWarm(sctx: SyncCtx, draw: WarmDraw, error: unknown): void {
  const { warm } = sctx.ctx.state.sync;
  const { subject, variant } = draw;

  warm.failed = true;
  abandon(warm);
  sctx.ctx.log.error(
    "renderer:warm-failed",
    typeof subject === "string"
      ? { subject, variant, error }
      : { subject: "filter", filter: filterName(filterOf(subject)), variant, error }
  );
}

/**
 * What a scope of a device lost meanwhile answers: nothing to report, its restore warms everything again.
 */
function scopeLost(): void {
  // The restore starts the warm-up over.
}

/**
 * Opens the error scope of a quad's draw.
 *
 * @param sctx - Domain context of the sync module.
 * @param subject - The subject of the draw.
 * @returns The device whose scope is open, `undefined` for any other subject or with no device.
 */
function openScope(sctx: SyncCtx, subject: WarmSubject): GPUDevice | undefined {
  if (typeof subject === "string" || !isQuad(subject)) return undefined;

  const device = sctx.deps.host.device();

  device?.pushErrorScope("validation");

  return device;
}

/**
 * Closes the error scope of a quad's draw, and logs what it caught with the program's name. The warm-up goes on: the
 * draw failed, not Pixi's filter stack, and the views of that kind fall back on a blank mesh only in that kind.
 *
 * @param sctx - Domain context of the sync module.
 * @param device - The device of the scope.
 * @param subject - The subject of the draw.
 */
function closeScope(sctx: SyncCtx, device: GPUDevice, subject: WarmSubject): void {
  const program = typeof subject !== "string" && isQuad(subject) ? subject.quad.program.name : "";

  device
    .popErrorScope()
    .then(error => {
      if (error !== null) {
        sctx.ctx.log.error("renderer:warm-invalid", { program, message: error.message });
      }
    })
    .catch(scopeLost);
}

/**
 * Draws one probe: hangs the subject in its variant under the root, renders the root onto the canvas or, for a texture
 * variant, into the module's texture, and takes it all down again, so the tree holds the subject only during its own
 * render. A render that throws ends the warm-up of the application (`failWarm`).
 *
 * @param sctx - Domain context of the sync module.
 * @param pixi - The module that draws.
 * @param objects - The probe tree.
 * @param draw - The draw.
 * @returns False when the render threw.
 */
function drawProbe(sctx: SyncCtx, pixi: PixiModule, objects: WarmObjects, draw: WarmDraw): boolean {
  const { warm } = sctx.ctx.state.sync;
  const node = nodeOf(pixi, warm, objects, draw.subject);

  if (node === undefined) return true;

  const clipped = draw.variant === "canvas+clip" || draw.variant === "texture+clip";
  const textured = draw.variant === "texture" || draw.variant === "texture+clip";

  if (clipped) {
    objects.clip.addChild(node);
    objects.root.addChild(objects.clipFrame);
  } else {
    objects.root.addChild(node);
  }

  const scope = openScope(sctx, draw.subject);

  try {
    sctx.deps.host.renderProbe(objects.root, textured ? objects.target : undefined);

    return true;
  } catch (error) {
    failWarm(sctx, draw, error);

    return false;
  } finally {
    if (scope !== undefined) closeScope(sctx, scope, draw.subject);

    node.removeFromParent();
    objects.clipFrame.removeFromParent();

    if (node === objects.holder) {
      clearFilters(objects.holder);
      objects.list.length = 0;
    }

    if (node === objects.quad?.mesh) {
      objects.quad.shader?.destroy();
      objects.quad.shader = undefined;
    }
  }
}

/**
 * Counts one draw of a filter done; its promises answer true after its last draw.
 *
 * @param warm - The warm branch of the sync state.
 * @param filter - The filter.
 */
function drawnOnce(warm: WarmState, filter: PixiFilter): void {
  const entry = warm.waiting.get(filter);

  if (entry === undefined) return;

  entry.left -= 1;

  if (entry.left > 0) return;

  warm.waiting.delete(filter);
  for (const resolve of entry.resolve) resolve(true);
}

/**
 * Ends a run of the warm-up: the queue empties and, in an agent build, the listeners hear the draws it made.
 *
 * @param warm - The warm branch of the sync state.
 */
function finishRun(warm: WarmState): void {
  const draws = warm.draws;

  warm.queue.length = 0;
  warm.head = 0;
  warm.draws = 0;

  // Inline and positive (spec 11 "The guard"): a production `define` folds it and the loop goes.
  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__) {
    for (const listener of warm.listeners) listener(draws);
  }
}

/**
 * The probe tree of this device, made at its first warm frame. A Pixi that cannot build it (a trimmed module without
 * the particle or text classes) ends the warm-up of the device: the waiting promises answer false, reported once, and
 * the frame draws on.
 *
 * @param sctx - Domain context of the sync module.
 * @param pixi - The module that draws.
 * @returns The tree, or `undefined` when it cannot be built.
 */
function objectsOf(sctx: SyncCtx, pixi: PixiModule): WarmObjects | undefined {
  const { warm } = sctx.ctx.state.sync;

  if (warm.objects !== undefined) return warm.objects;

  try {
    warm.objects = buildObjects(pixi);

    return warm.objects;
  } catch (error) {
    reportOnce(sctx, "probes", "renderer:warm-failed", { subject: "probes", error });
    abandon(warm);

    return undefined;
  }
}

/**
 * Draws up to `renderer.warm` probes before the stage pass of a drawn frame; answers whether it drew any, so the frame
 * is told to `time` as a probed one. A draw is counted only after its own render call ran; a queue that still holds
 * draws asks for the next frame; a probe that threw ends the warm-up there. Allocates nothing while the queue is empty,
 * and nothing but Pixi's own work on a warm frame: the probe tree is made once per device.
 *
 * @param sctx - Domain context of the sync module.
 * @returns True when a probe was drawn in this frame.
 */
export function warmStep(sctx: SyncCtx): boolean {
  const { warm } = sctx.ctx.state.sync;

  if (warm.head >= warm.queue.length) return false;

  const pixi = sctx.deps.host.pixi();
  const objects = pixi === undefined ? undefined : objectsOf(sctx, pixi);

  if (pixi === undefined || objects === undefined) return false;

  const budget = sctx.ctx.config.warm;
  let drawn = 0;

  while (drawn < budget && warm.head < warm.queue.length) {
    const draw = warm.queue[warm.head];

    warm.head += 1;

    if (draw === undefined) continue;

    drawn += 1;

    // A throw ended the warm-up: the queue is empty and nothing more is drawn on this application.
    if (!drawProbe(sctx, pixi, objects, draw)) return true;

    if (typeof draw.subject !== "string") drawnOnce(warm, filterOf(draw.subject));
  }

  warm.draws += drawn;

  if (warm.head < warm.queue.length) sctx.deps.demand.request();
  else finishRun(warm);

  return drawn > 0;
}

/**
 * Stops the warm-up, from state alone (`onStop` has no context): every waiting promise answers false, the probe tree
 * is destroyed, never a filter it was handed, and the state empties.
 *
 * @param state - The sync branch of the plugin state.
 */
export function stopWarm(state: SyncState): void {
  const { warm } = state;

  for (const entry of warm.waiting.values()) for (const resolve of entry.resolve) resolve(false);

  warm.waiting.clear();
  warm.filters.clear();
  warm.quads.clear();
  dropObjects(warm);
  warm.queue.length = 0;
  warm.head = 0;
  warm.draws = 0;
  warm.textQueued = false;
  warm.textFont = undefined;
  warm.failed = false;
  warm.reported.clear();
  warm.listeners.length = 0;
}
