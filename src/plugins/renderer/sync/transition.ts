/**
 * @file renderer/sync — the transition of a scene switch (spec 36). `scenes` asks for a picture of the screen being
 * left (`capture`): the next drawn frame copies the canvas texture into a texture of its pixel size, one copy and one
 * submit on the GPU, no render pass, the veil and the loader in it as drawn. At the swap `play` hangs the picture in the
 * look's top container, above every layer, and each render phase draws it for this frame of the transition: a sprite
 * that fades or slides off, or the unit quad on the body of a set member `effects` handed (`RevealLine`, `RevealRound`,
 * `Dissolve`), its uniforms written by name. At the end the picture leaves the stage and its texture is destroyed: 0
 * bytes at rest. The sprite, the mesh and its numbers are made once per application and kept, like the veil. This file
 * imports nothing of `leave.ts`; the take-down of the look at `play` is there.
 */
import { easeCell } from "../../anim/tween/easing";
import { filterGlobals, NAMES_PER_INPUT, quadShader, ROOT_TARGET, unitQuad, VECTOR } from "../quad";
import { destroyWhole } from "../sources";
import type {
  FilterSlotQuad,
  PixiContainer,
  PixiModule,
  PixiRenderTexture,
  PixiShader,
  PixiSprite,
  PixiTextureSource,
  PixiUniformGroup
} from "../types";
import { detach } from "./pools";
import type {
  LeaveObjects,
  LeaveState,
  LeaveTransition,
  PictureObjects,
  SyncCtx,
  SyncState,
  TransitionBodyKind,
  TransitionRun
} from "./types";

/** The values of a body's uniform group, by uniform name, as Pixi types them: a number, or the array of a vector. */
type BodyUniforms = PixiUniformGroup["uniforms"];

/** One kind of transition, narrowed. */
type KindOf<Kind extends LeaveTransition["kind"]> = Extract<LeaveTransition, { kind: Kind }>;

/** The canvas in CSS pixels, as the host answers it. */
type Screen = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** The hint of the warning of a missing body: which set member each kind draws on. Export names, not set ids. */
const BODY_HINT =
  "List the set member of the kind in a feature's filters: wipe RevealLine, iris RevealRound, dissolve Dissolve.";

/** Label of the picture's texture and of what draws it. */
const PICTURE_LABEL = "renderer.leave.picture";

/** The eased progress of the frame, in place: `easeCell` takes no number and returns none, so a frame boxes none. */
const EASED = new Float64Array(1);

/** The global filter numbers this frame wants, in the order of the group's vectors. One array: it allocates nothing. */
const WANTED = new Float32Array(6 * VECTOR);

/**
 * Tells whether a kind draws on a set body.
 *
 * @param kind - The transition kind.
 * @returns True for `wipe`, `iris` and `dissolve`.
 * @example
 * ```ts
 * isBodyKind("iris"); // true
 * ```
 */
function isBodyKind(kind: LeaveTransition["kind"]): kind is TransitionBodyKind {
  return kind === "wipe" || kind === "iris" || kind === "dissolve";
}

/**
 * Lets the picture of a run go: no longer counted as kept, destroyed whole, its bind groups let go first.
 *
 * @param sctx - Domain context of the sync module.
 * @param playing - The run.
 */
function freePicture(sctx: SyncCtx, playing: TransitionRun): void {
  const picture = playing.picture;

  if (picture === undefined) return;

  playing.picture = undefined;
  sctx.deps.host.keep(picture.source, false);
  destroyWhole(picture);
}

/**
 * Takes the picture's display objects out of the look's top, the top off the stage when no look runs, and shows the
 * look's own parts again for the next look.
 *
 * @param sctx - Domain context of the sync module.
 * @param objects - The engine's objects.
 */
function unhang(sctx: SyncCtx, objects: LeaveObjects): void {
  const { sprite, mesh } = objects.picture;
  const pixi = sctx.deps.host.pixi();

  if (sprite !== undefined) {
    detach(sprite);
    if (pixi !== undefined) sprite.texture = pixi.Texture.EMPTY;
  }
  if (mesh !== undefined) detach(mesh);

  objects.frame.visible = true;
  if (sctx.ctx.state.sync.leave.run === undefined) detach(objects.top);
}

/**
 * Ends the transition asked for or playing at once: its picture leaves the stage and is destroyed, and a frame is asked
 * for, so the screen without it is drawn. Nothing asked: nothing happens.
 *
 * @param sctx - Domain context of the sync module.
 */
export function endTransition(sctx: SyncCtx): void {
  const leave = sctx.ctx.state.sync.leave;
  const playing = leave.playing;

  if (playing === undefined) return;

  delete leave.playing;

  if (leave.objects !== undefined) unhang(sctx, leave.objects);

  freePicture(sctx, playing);
  sctx.deps.demand.request();
}

/**
 * The transition a look shown now may play: none with reduced motion on for one that is cut then.
 *
 * @param leave - The leave branch of the sync state.
 * @param transition - The look's transition.
 * @returns The transition, or `undefined`.
 */
export function playableOf(
  leave: LeaveState,
  transition: LeaveTransition | undefined
): LeaveTransition | undefined {
  return leave.reduced && transition?.reduced === "cut" ? undefined : transition;
}

/**
 * Answers the swap gate: the picture of the running look's transition, asked for at the first call, which asks for a
 * frame. `"wait"` until a drawn frame took it, `"ready"` then; `"none"` without a transition to play, after the swap,
 * and without a WebGPU device.
 *
 * @param sctx - Domain context of the sync module.
 * @returns What the swap does now.
 */
export function captureLeave(sctx: SyncCtx): "wait" | "ready" | "none" {
  const leave = sctx.ctx.state.sync.leave;
  const playing = leave.playing;

  if (playing !== undefined && playing.capture !== "playing") {
    if (playing.capture === "taken") return "ready";

    sctx.deps.demand.request();

    return "wait";
  }

  const run = leave.run;
  const transition = run === undefined || run.landed ? undefined : run.transition;

  if (transition === undefined || sctx.deps.host.device() === undefined) return "none";

  // A transition still playing when the next look asks: `show` ended it already, unless it showed nothing.
  endTransition(sctx);
  leave.playing = {
    transition,
    picture: undefined,
    playStartedAt: 0,
    capture: "asked",
    drawn: transition.kind,
    quad: undefined,
    edgeColor: -1
  };
  sctx.deps.demand.request();

  return "wait";
}

/**
 * Copies the canvas texture of the frame just drawn into a new picture of its pixel size and format: one encoder, one
 * copy, one submit, no render pass.
 *
 * @param sctx - Domain context of the sync module.
 * @param playing - The run, its picture asked for.
 * @returns True when the picture holds the frame.
 */
function copyCanvas(sctx: SyncCtx, playing: TransitionRun): boolean {
  const host = sctx.deps.host;
  const device = host.device();
  const pixi = host.pixi();
  const canvas = host.canvasTexture();

  if (device === undefined || pixi === undefined || canvas === undefined) return false;

  const picture = pixi.RenderTexture.create({
    width: canvas.width,
    height: canvas.height,
    resolution: 1,
    scaleMode: "linear",
    addressMode: "clamp-to-edge",
    autoGarbageCollect: false,
    // Pixi configures the canvas with the browser's preferred format, one of these two; a copy needs the same.
    format: canvas.format === "rgba8unorm" ? "rgba8unorm" : "bgra8unorm",
    label: PICTURE_LABEL
  });

  playing.picture = picture;
  host.keep(picture.source, true);
  host.initSource(picture.source);

  const target = host.gpuTexture(picture.source);

  if (target === undefined) return false;

  const encoder = device.createCommandEncoder();

  encoder.copyTextureToTexture({ texture: canvas }, { texture: target }, [
    canvas.width,
    canvas.height
  ]);
  device.queue.submit([encoder.finish()]);
  playing.capture = "taken";

  return true;
}

/**
 * The picture of a transition after the stage render: a picture asked for is taken from a drawn frame. A frame with no
 * canvas texture to copy gives the transition up: the swap commits without it.
 *
 * @param sctx - Domain context of the sync module.
 * @param drawn - Whether Pixi drew the frame.
 */
export function afterLeave(sctx: SyncCtx, drawn: boolean): void {
  const leave = sctx.ctx.state.sync.leave;
  const playing = leave.playing;

  // per frame: no picture asked, one field read.
  if (playing === undefined || playing.capture !== "asked" || !drawn) return;
  if (copyCanvas(sctx, playing)) return;

  endTransition(sctx);
  if (leave.run !== undefined) leave.run.transition = undefined;
}

/**
 * Warns once per kind, in a dev or agent build, that a transition plays as a fade for want of its set body.
 *
 * @param sctx - Domain context of the sync module.
 * @param kind - The kind.
 */
function warnMissingBody(sctx: SyncCtx, kind: TransitionBodyKind): void {
  // Inline and positive: a production `define` folds the guard.
  if (
    (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
    (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
  ) {
    const warned = sctx.ctx.state.sync.leave.warnedKinds;

    if (warned.has(kind)) return;

    warned.add(kind);
    sctx.ctx.log.warn("renderer:transition-body-missing", { kind, hint: BODY_HINT });
  }
}

/**
 * Starts a transition whose picture is taken, from now on the clock: what it is drawn with is picked, a kind whose body
 * was not handed is drawn as a fade.
 *
 * @param sctx - Domain context of the sync module.
 * @param playing - The run, its picture taken.
 */
export function startTransition(sctx: SyncCtx, playing: TransitionRun): void {
  const kind = playing.transition.kind;
  const quad = isBodyKind(kind) ? sctx.ctx.state.sync.leave.bodies.get(kind) : undefined;

  playing.capture = "playing";
  playing.playStartedAt = sctx.ctx.deps.clock.now();
  playing.quad = quad;
  playing.drawn = !isBodyKind(kind) || quad !== undefined ? kind : "fade";

  if (isBodyKind(kind) && quad === undefined) warnMissingBody(sctx, kind);

  sctx.deps.demand.request();
}

/**
 * Hands the renderer the body a kind draws on; a body handed again for the kind replaces it.
 *
 * @param sctx - Domain context of the sync module.
 * @param kind - The kind.
 * @param quad - The body.
 * @param member - The member's export name.
 * @returns What takes this body back, once: a later body for the kind stays.
 */
export function handBody(
  sctx: SyncCtx,
  kind: TransitionBodyKind,
  quad: FilterSlotQuad,
  member: string
): () => void {
  const bodies = sctx.ctx.state.sync.leave.bodies;

  bodies.set(kind, quad);

  // Inline and positive: a production `define` folds the guard.
  if (
    (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
    (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
  ) {
    sctx.ctx.log.debug("renderer:transition-body", { kind, member });
  }

  return () => {
    if (bodies.get(kind) === quad) bodies.delete(kind);
  };
}

/**
 * Hangs a display object of the picture in the look's top, the top last on the stage and drawn, the look's own veil and
 * frame hidden: they are in the picture.
 *
 * @param objects - The engine's objects.
 * @param stage - The stage of the application.
 * @param shown - The sprite or the mesh.
 */
function hangPicture(
  objects: LeaveObjects,
  stage: PixiContainer,
  shown: PixiSprite | NonNullable<PictureObjects["mesh"]>
): void {
  if (stage.children.at(-1) !== objects.top) stage.addChild(objects.top);

  objects.top.visible = true;
  objects.veil.visible = false;
  objects.frame.visible = false;

  if (shown.parent !== objects.top) objects.top.addChild(shown);
}

/**
 * The sprite of a fade or a slide, made once and kept: it grows from its top left corner.
 *
 * @param pixi - The module that draws.
 * @param picture - The picture's objects.
 * @returns The sprite.
 */
function spriteOf(pixi: PixiModule, picture: PictureObjects): PixiSprite {
  if (picture.sprite === undefined) {
    picture.sprite = new pixi.Sprite(pixi.Texture.EMPTY);
    picture.sprite.label = PICTURE_LABEL;
    picture.sprite.anchor.set(0, 0);
  }

  return picture.sprite;
}

/**
 * Draws the picture on the sprite over the canvas at the frame's eased progress (`EASED[0]`): a fade lowers its alpha
 * from 1 to 0, a slide moves it whole off the canvas towards `to`.
 *
 * @param sprite - The sprite.
 * @param picture - The picture.
 * @param playing - The run.
 * @param screen - The canvas in CSS pixels.
 */
function paintSprite(
  sprite: PixiSprite,
  picture: PixiRenderTexture,
  playing: TransitionRun,
  screen: Screen
): void {
  const eased = EASED[0] ?? 0;
  const { transition } = playing;
  let x = screen.x;
  let y = screen.y;

  if (sprite.texture !== picture) sprite.texture = picture;

  if (transition.kind === "slide") {
    switch (transition.to) {
      case "left": {
        x -= eased * screen.width;
        break;
      }
      case "right": {
        x += eased * screen.width;
        break;
      }
      case "up": {
        y -= eased * screen.height;
        break;
      }
      case "down": {
        y += eased * screen.height;
        break;
      }
    }
  }

  sprite.alpha = transition.kind === "slide" ? 1 : 1 - eased;
  placeAt(sprite, x, y, screen.width / picture.width, screen.height / picture.height);
}

/**
 * Writes the place and the scale of a display object, each number where it differs: a number handed to Pixi's point
 * setter is boxed in every frame, a number compared is not.
 *
 * @param shown - The sprite or the mesh.
 * @param x - Its left edge, CSS px.
 * @param y - Its top edge, CSS px.
 * @param scaleX - Its scale on x.
 * @param scaleY - Its scale on y.
 */
function placeAt(
  shown: PixiSprite | NonNullable<PictureObjects["mesh"]>,
  x: number,
  y: number,
  scaleX: number,
  scaleY: number
): void {
  const { position, scale } = shown;

  if (position.x !== x) position.x = x;
  if (position.y !== y) position.y = y;
  if (scale.x !== scaleX) scale.x = scaleX;
  if (scale.y !== scaleY) scale.y = scaleY;
}

/**
 * The shader of a kind on its body, bound to the picture: made once per body, built again for another body, and the
 * picture's texture bound in place of the last run's under the texture names and the body's input names.
 *
 * @param pixi - The module that draws.
 * @param picture - The picture's objects, their globals made.
 * @param playing - The run, its body held.
 * @param source - The picture's texture.
 * @returns The shader, or `undefined` for a run with no body.
 */
function shaderOf(
  pixi: PixiModule,
  picture: PictureObjects,
  playing: TransitionRun,
  source: PixiTextureSource
): PixiShader | undefined {
  const { quad } = playing;
  const kind = playing.drawn;

  if (quad === undefined || picture.globals === undefined || !isBodyKind(kind)) return undefined;

  const held = picture.shaders.get(kind);

  if (held !== undefined && held.quad === quad) {
    bindPicture(held.shader, quad, source);

    return held.shader;
  }

  held?.shader.destroy();

  const shader = quadShader(pixi, quad, picture.globals.group, source);

  picture.shaders.set(kind, { quad, shader });

  return shader;
}

/**
 * Binds a picture under the texture and sampler of a shader and of each input its body names, where another is bound.
 *
 * @param shader - The shader.
 * @param quad - Its body.
 * @param source - The picture's texture.
 */
function bindPicture(shader: PixiShader, quad: FilterSlotQuad, source: PixiTextureSource): void {
  const { resources } = shader;

  if (resources.uTexture === source) return;

  resources.uTexture = source;
  resources.uSampler = source.style;

  // Once a run, at its first frame: the walk may allocate.
  for (const [index, name] of (quad.inputNames ?? []).entries()) {
    resources[name] = index % NAMES_PER_INPUT === 0 ? source : source.style;
  }
}

/**
 * Copies a vector of `WANTED` into the group where it differs, both sides 32-bit numbers.
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
 * Writes the numbers a filter pass over the whole canvas hands a body: the input is the picture, `W` x `H` CSS and its
 * `pw` x `ph` pixels, the frame and the target the canvas. Uploaded once, only when one differs.
 *
 * @param picture - The picture's objects, their globals made.
 * @param source - The picture's texture.
 * @param screen - The canvas in CSS pixels.
 * @param resolution - The renderer resolution.
 */
function writeGlobals(
  picture: PictureObjects,
  source: PixiTextureSource,
  screen: Screen,
  resolution: number
): void {
  const globals = picture.globals;

  if (globals === undefined) return;

  const { width, height } = screen;
  const { pixelWidth, pixelHeight } = source;

  // `uInputSize`: the canvas in CSS px and their inverse.
  WANTED[0] = width;
  WANTED[1] = height;
  WANTED[2] = 1 / width;
  WANTED[3] = 1 / height;
  // `uInputPixel`: the picture's pixels.
  WANTED[4] = pixelWidth;
  WANTED[5] = pixelHeight;
  WANTED[6] = 1 / pixelWidth;
  WANTED[7] = 1 / pixelHeight;
  // `uInputClamp`: half a texel in from each edge.
  WANTED[8] = 0.5 / pixelWidth;
  WANTED[9] = 0.5 / pixelHeight;
  WANTED[10] = 1 - 0.5 / pixelWidth;
  WANTED[11] = 1 - 0.5 / pixelHeight;
  // `uOutputFrame`: the whole canvas.
  WANTED[12] = 0;
  WANTED[13] = 0;
  WANTED[14] = width;
  WANTED[15] = height;
  // `uGlobalFrame`: a pass that ends on the canvas, no parent filter.
  WANTED[16] = 0;
  WANTED[17] = 0;
  WANTED[18] = width * resolution;
  WANTED[19] = height * resolution;
  // `uOutputTexture`: the canvas is the target.
  WANTED[20] = width;
  WANTED[21] = height;
  WANTED[22] = ROOT_TARGET;
  WANTED[23] = 0;

  const { vectors } = globals;
  let differs = writeVector(vectors.uInputSize, 0);

  differs = writeVector(vectors.uInputPixel, VECTOR) || differs;
  differs = writeVector(vectors.uInputClamp, 2 * VECTOR) || differs;
  differs = writeVector(vectors.uOutputFrame, 3 * VECTOR) || differs;
  differs = writeVector(vectors.uGlobalFrame, 4 * VECTOR) || differs;
  differs = writeVector(vectors.uOutputTexture, 5 * VECTOR) || differs;

  if (differs) globals.group.update();
}

/**
 * Writes a wipe's uniforms for the frame's eased progress (`EASED[0]`): its line sweeps the picture away, `progress`
 * from 1 to 0; `angle` and `soft` where they differ. One function per kind: each write site sees one body's group.
 *
 * @param transition - The wipe.
 * @param uniforms - The values of the body's uniform group.
 */
function writeWipe(transition: KindOf<"wipe">, uniforms: BodyUniforms): void {
  uniforms.progress = 1 - (EASED[0] ?? 0);
  if (uniforms.angle !== transition.angle) uniforms.angle = transition.angle;
  if (uniforms.soft !== transition.soft) uniforms.soft = transition.soft;
}

/**
 * Writes an iris's uniforms for the frame's eased progress (`EASED[0]`): it closes around (`x`, `y`), `radius` from the
 * distance to the canvas's farthest corner past the soft edge, where every pixel shows, to 0; the rest where they
 * differ.
 *
 * @param transition - The iris.
 * @param uniforms - The values of the body's uniform group.
 */
function writeIris(transition: KindOf<"iris">, uniforms: BodyUniforms): void {
  const reachX = Math.max(transition.x, 1 - transition.x);
  const reachY = Math.max(transition.y, 1 - transition.y);
  // `Math.hypot` measured 60 B a frame here (`transition.perf.ts`); the square root of the sum allocates nothing.
  // eslint-disable-next-line unicorn/prefer-modern-math-apis -- the root of the sum allocates nothing.
  const open = Math.sqrt(reachX * reachX + reachY * reachY) + transition.soft;

  uniforms.radius = open * (1 - (EASED[0] ?? 0));
  if (uniforms.x !== transition.x) uniforms.x = transition.x;
  if (uniforms.y !== transition.y) uniforms.y = transition.y;
  if (uniforms.soft !== transition.soft) uniforms.soft = transition.soft;
}

/**
 * Writes a dissolve's uniforms for the frame's eased progress (`EASED[0]`): the noise eats the picture, `progress` from
 * 0 to 1; `scale` and `edge` where they differ, and `edgeColor` into the three channels of the colour uniform's own
 * array, 0..1 each, once a run.
 *
 * @param playing - The run.
 * @param transition - The dissolve.
 * @param uniforms - The values of the body's uniform group.
 */
function writeDissolve(
  playing: TransitionRun,
  transition: KindOf<"dissolve">,
  uniforms: BodyUniforms
): void {
  uniforms.progress = EASED[0] ?? 0;
  if (uniforms.scale !== transition.scale) uniforms.scale = transition.scale;
  if (uniforms.edge !== transition.edge) uniforms.edge = transition.edge;

  const color = uniforms.edgeColor;
  const hex = transition.edgeColor;

  if (playing.edgeColor === hex || !(color instanceof Float32Array)) return;

  color[0] = ((hex >> 16) & 0xff) / 255;
  color[1] = ((hex >> 8) & 0xff) / 255;
  color[2] = (hex & 0xff) / 255;
  playing.edgeColor = hex;
}

/**
 * Writes the body's own uniforms by name for this frame: the picture goes from whole to nothing.
 *
 * @param playing - The run.
 * @param uniforms - The values of the body's uniform group.
 */
function writeBody(playing: TransitionRun, uniforms: BodyUniforms): void {
  const { transition } = playing;

  switch (transition.kind) {
    case "wipe": {
      writeWipe(transition, uniforms);
      break;
    }
    case "iris": {
      writeIris(transition, uniforms);
      break;
    }
    case "dissolve": {
      writeDissolve(playing, transition, uniforms);
      break;
    }
    default: {
      break;
    }
  }
}

/**
 * Draws the picture on the unit quad with its body over the canvas: the mesh, its geometry and the global numbers made
 * once and kept, the kind's shader on the mesh, bound to the picture.
 *
 * @param sctx - Domain context of the sync module.
 * @param pixi - The module that draws.
 * @param objects - The engine's objects.
 * @param playing - The run, its body held.
 * @param screen - The canvas in CSS pixels.
 * @returns The mesh, or `undefined` for a run with no body.
 */
function paintMesh(
  sctx: SyncCtx,
  pixi: PixiModule,
  objects: LeaveObjects,
  playing: TransitionRun,
  screen: Screen
): PictureObjects["mesh"] {
  const { picture } = objects;
  const texture = playing.picture;
  const fu = playing.quad?.fu;

  if (texture === undefined) return undefined;

  picture.globals ??= filterGlobals(pixi);

  const shader = shaderOf(pixi, picture, playing, texture.source);

  if (shader === undefined) return undefined;

  if (picture.mesh === undefined) {
    picture.geometry ??= unitQuad(pixi);
    picture.mesh = new pixi.Mesh({ geometry: picture.geometry, shader });
    picture.mesh.label = PICTURE_LABEL;
  }

  const { mesh } = picture;

  if (mesh.shader !== shader) mesh.shader = shader;

  placeAt(mesh, screen.x, screen.y, screen.width, screen.height);
  writeGlobals(picture, texture.source, screen, sctx.deps.host.resolution());

  if (fu !== undefined) writeBody(playing, fu.uniforms);

  return mesh;
}

/**
 * The frame of a playing transition: its time on the clock from `play`, eased, the picture drawn for it above every
 * layer, a frame asked for; at the end the picture leaves and is destroyed.
 *
 * @param sctx - Domain context of the sync module.
 * @param objects - The engine's objects.
 * @param stage - The stage of the application.
 * @param screen - The canvas in CSS pixels.
 * @param playing - The run, playing.
 */
export function stepTransition(
  sctx: SyncCtx,
  objects: LeaveObjects,
  stage: PixiContainer,
  screen: Screen,
  playing: TransitionRun
): void {
  const pixi = sctx.deps.host.pixi();
  const texture = playing.picture;
  const { ms, ease } = playing.transition;

  if (pixi === undefined || texture === undefined) return;

  const t = ms > 0 ? (sctx.ctx.deps.clock.now() - playing.playStartedAt) / ms : 1;

  EASED[0] = Math.min(1, Math.max(0, t));
  easeCell(ease, EASED, 0);

  const shown =
    playing.drawn === "fade" || playing.drawn === "slide"
      ? spriteOf(pixi, objects.picture)
      : paintMesh(sctx, pixi, objects, playing, screen);

  if (shown === undefined) return;

  if (shown === objects.picture.sprite) paintSprite(shown, texture, playing, screen);

  hangPicture(objects, stage, shown);

  if (t >= 1) {
    endTransition(sctx);

    return;
  }

  sctx.deps.demand.request();
}

/**
 * Destroys the picture's objects of a stopped application: the sprite, the mesh and its geometry, the shaders, and the
 * global numbers' buffer by hand (Pixi leaves it to a collector).
 *
 * @param picture - The picture's objects.
 */
function destroyPictureObjects(picture: PictureObjects): void {
  if (picture.sprite !== undefined) {
    detach(picture.sprite);
    picture.sprite.destroy();
  }
  if (picture.mesh !== undefined) {
    detach(picture.mesh);
    picture.mesh.destroy();
  }

  picture.geometry?.destroy(true);
  picture.globals?.group.buffer?.destroy();

  for (const { shader } of picture.shaders.values()) shader.destroy();

  picture.shaders.clear();
}

/**
 * Drops the transition and frees what it holds when the plugin stops, while the application exists: the picture and
 * the objects that draw it.
 *
 * @param state - The sync branch of the plugin state.
 */
export function stopTransition(state: SyncState): void {
  const { leave } = state;
  const picture = leave.playing?.picture;

  delete leave.playing;

  if (picture !== undefined) destroyWhole(picture);
  if (leave.objects !== undefined) destroyPictureObjects(leave.objects.picture);
}
