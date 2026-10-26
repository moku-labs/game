/**
 * @file renderer/sync — the picture of a scene being left (spec 33, slice A2). `scenes` shows a look at the start of a
 * live switch: a veil over the whole canvas that fades in, and a loader that waits for its `afterMs`. Both hang in one
 * container of the engine, last on the stage, so above the root and every layer, overlay and HUD in it; the hit test
 * walks the layers of the root only, so neither takes a hit. The render phase steps the look on the clock: the veil's
 * level, the loader's turn, and a frame asked for while either moves. At the swap the loader goes and the veil fades
 * out; an abort drops both. The objects are made once per application and kept; with no look running a step reads one
 * field.
 */
import type { ShapeValue } from "../components";
import type { PixiContainer } from "../types";
import type { ViewportSize } from "../viewport/types";
import { layerContainer } from "./layers";
import { detach } from "./pools";
import { paintShape } from "./shape-path";
import { placeholderTexture, resolveTexture, warnMissing } from "./textures";
import type { LeaveLook, LeaveObjects, LeaveRun, SyncCtx, SyncState } from "./types";

/** Label of the container the look hangs in, last on the stage. */
const TOP_LABEL = "renderer.leave";

/** Clock milliseconds of one turn of the loader. */
const TURN_MS = 1000;

/** A whole turn, in radians. */
const TURN = 2 * Math.PI;

/** The engine's ring: three quarters of a white circle 96 u across, 10 u wide, round ends, turned about its centre. */
const RING: Readonly<ShapeValue> = Object.freeze({
  kind: "arc",
  w: 96,
  h: 96,
  fill: 0xff_ff_ff,
  fillAlpha: 0,
  alpha: 1,
  radius: 0,
  stroke: 0xff_ff_ff,
  strokeWidth: 10,
  dash: 0,
  clip: false,
  sweep: 0.75,
  cap: "round"
});

/**
 * Makes the engine's objects of the picture, once per application: the top container with the veil and the frame, and
 * in the frame the holder of a lifted layer, the ring and the spinner. Nothing hangs on the stage yet.
 *
 * @param sctx - Domain context of the sync module.
 * @returns The objects, or `undefined` while nothing draws (inert, a lost device).
 */
function objectsOf(sctx: SyncCtx): LeaveObjects | undefined {
  const leave = sctx.ctx.state.sync.leave;

  // Made once per application: every later look reuses them.
  if (leave.objects !== undefined) return leave.objects;

  const pixi = sctx.deps.host.pixi();

  if (pixi === undefined || sctx.deps.host.stage() === undefined) return undefined;

  // The objects: the top container, the veil, the frame in reference units and the three loaders in it.
  const top = new pixi.Container();
  const veil = new pixi.Sprite(pixi.Texture.WHITE);
  const frame = new pixi.Container();
  const held = new pixi.Container();
  const ring = new pixi.Graphics();
  const spinner = new pixi.Sprite(pixi.Texture.WHITE);

  // Labels for the doors and the tests; the veil grows from its top left corner.
  top.label = TOP_LABEL;
  veil.label = `${TOP_LABEL}.cover`;
  veil.anchor.set(0, 0);
  held.label = `${TOP_LABEL}.layer`;
  ring.label = `${TOP_LABEL}.ring`;
  // Drawn once: a turn writes the rotation only.
  paintShape(ring, RING, RING.stroke);
  ring.pivot.set(RING.w / 2, RING.h / 2);
  spinner.label = `${TOP_LABEL}.texture`;
  spinner.anchor.set(0.5, 0.5);
  // The tree: the veil under the frame, the frame's loaders above it.
  frame.addChild(held);
  frame.addChild(ring);
  frame.addChild(spinner);
  top.addChild(veil);
  top.addChild(frame);
  leave.objects = { top, veil, frame, held, ring, spinner };

  return leave.objects;
}

/**
 * What the loader of a look draws once due: a game texture, a layer above the veil, or the engine's ring. A texture key
 * no provider answers is warned once and draws the ring.
 *
 * @param sctx - Domain context of the sync module.
 * @param look - The look being shown.
 * @returns The loader's kind, and the texture of a `"texture"` loader.
 */
function loaderOf(sctx: SyncCtx, look: LeaveLook): Pick<LeaveRun, "loader" | "texture"> {
  const loader = look.loader;

  if (loader === undefined) return { loader: "none" };
  if (loader.texture === undefined) return { loader: loader.due === undefined ? "ring" : "layer" };

  const texture = resolveTexture(sctx, loader.texture);

  if (texture !== undefined) return { loader: "texture", texture };

  warnMissing(sctx, loader.texture);

  return { loader: "ring" };
}

/**
 * Puts a layer the look drew above the veil back under the root, at the place of its layer: the layer list of the
 * scene orders the root's children. A layer the list of a swap took back already, or let go, is left alone.
 *
 * @param sctx - Domain context of the sync module.
 * @param run - The look whose layer goes back.
 */
function unlift(sctx: SyncCtx, run: LeaveRun): void {
  const lifted = run.lifted;

  if (lifted === undefined) return;

  delete run.lifted;

  const state = sctx.ctx.state.sync;

  if (lifted.parent !== state.leave.objects?.held) return;

  const name = run.layer;
  const at = state.layerList?.findIndex(spec => spec.name === name) ?? -1;
  const root = state.root;

  // The walks of `shown` and the render passes see the layer where it hangs now.
  state.passesVersion += 1;

  if (root === undefined || at === -1) {
    detach(lifted);

    return;
  }

  root.addChildAt(lifted, Math.min(at, root.children.length));
}

/**
 * Takes the look down at once: its layer goes back, its objects leave the stage and are kept for the next look, and the
 * spinner lets the game's texture go. A frame is asked for, so the screen without it is drawn.
 *
 * @param sctx - Domain context of the sync module.
 */
function takeDown(sctx: SyncCtx): void {
  const leave = sctx.ctx.state.sync.leave;
  const run = leave.run;

  if (run !== undefined) unlift(sctx, run);

  delete leave.run;

  const objects = leave.objects;

  if (objects !== undefined) {
    detach(objects.top);

    const white = placeholderTexture(sctx);

    if (white !== undefined) objects.spinner.texture = white;
  }

  sctx.deps.demand.request();
}

/**
 * Moves the veil's level on the clock: up to 1 over `inMs` before the swap, down to 0 over `outMs` after it.
 *
 * @param run - The running look.
 * @param now - The clock now, ms.
 * @returns True when the level moved: the frame is drawn.
 */
function advance(run: LeaveRun, now: number): boolean {
  const cover = run.look.cover;
  const elapsed = Math.max(0, now - run.steppedAt);
  const before = run.level;

  run.steppedAt = now;

  if (cover === undefined) return false;

  if (run.landed) run.level = cover.outMs > 0 ? Math.max(0, before - elapsed / cover.outMs) : 0;
  else run.level = cover.inMs > 0 ? Math.min(1, before + elapsed / cover.inMs) : 1;

  return run.level !== before;
}

/**
 * Hangs the look last on the stage and over the canvas as it stands: the veil covers the screen, the frame carries the
 * root's transform, so what it holds lands where the scene's reference units do.
 *
 * @param sctx - Domain context of the sync module.
 * @param objects - The engine's objects.
 * @param stage - The stage of the application.
 * @param screen - The canvas in CSS pixels, the stage's own space.
 * @param screen.x - Its left edge.
 * @param screen.y - Its top edge.
 * @param screen.width - Its width.
 * @param screen.height - Its height.
 */
function hang(
  sctx: SyncCtx,
  objects: LeaveObjects,
  stage: PixiContainer,
  screen: { x: number; y: number; width: number; height: number }
): void {
  // Last on the stage: above the root, so above every layer, overlay and HUD in it.
  if (stage.children.at(-1) !== objects.top) stage.addChild(objects.top);

  // The white texture is 1 x 1: its scale is its size.
  objects.veil.position.set(screen.x, screen.y);
  objects.veil.scale.set(screen.width, screen.height);
  sctx.deps.viewport.apply(objects.frame);
}

/**
 * Asks a `"layer"` loader's `due`, once, the first frame it is due: what it draws is made now, and it answers the
 * layer that holds it. No layer, or a throw (logged), draws the ring instead.
 *
 * @param sctx - Domain context of the sync module.
 * @param run - The running look, its loader due.
 */
function ask(sctx: SyncCtx, run: LeaveRun): void {
  run.asked = true;

  let layer: string | undefined;

  try {
    layer = run.look.loader?.due?.();
  } catch (error) {
    sctx.ctx.log.error("renderer: the loader of a scene being left threw", { error });
  }

  if (layer === undefined) run.loader = "ring";
  else run.layer = layer;
}

/**
 * Writes the veil of a running look: its colour, and its alpha at the level it stands at; hidden for a look without one.
 *
 * @param objects - The engine's objects.
 * @param run - The running look.
 */
function paintVeil(objects: LeaveObjects, run: LeaveRun): void {
  const cover = run.look.cover;

  objects.veil.visible = cover !== undefined;

  if (cover === undefined) return;

  objects.veil.tint = cover.color;
  objects.veil.alpha = cover.alpha * run.level;
}

/**
 * Keeps the layer of a shown `"layer"` loader in the holder above the veil until the swap. A layer the scene does not
 * declare draws nothing.
 *
 * @param sctx - Domain context of the sync module.
 * @param objects - The engine's objects.
 * @param run - The running look, its loader shown.
 */
function lift(sctx: SyncCtx, objects: LeaveObjects, run: LeaveRun): void {
  const state = sctx.ctx.state.sync;
  const container = run.layer === undefined ? undefined : layerContainer(state, run.layer);

  if (container === undefined || container.parent === objects.held) return;

  objects.held.addChild(container);
  run.lifted = container;
  // The walks of `shown` and the render passes see the layer where it hangs now.
  state.passesVersion += 1;
}

/**
 * Turns the ring or the spinner at the centre of the frame: one turn a second from the switch start.
 *
 * @param objects - The engine's objects.
 * @param run - The running look, its loader shown.
 * @param now - The clock now, ms.
 * @param size - The frame in reference units.
 */
function turn(
  objects: LeaveObjects,
  run: LeaveRun,
  now: number,
  size: Readonly<ViewportSize>
): void {
  const angle = (((now - run.startedAt) % TURN_MS) / TURN_MS) * TURN;
  const turned = run.loader === "ring" ? objects.ring : objects.spinner;

  if (run.texture !== undefined && objects.spinner.texture !== run.texture) {
    objects.spinner.texture = run.texture;
  }

  turned.position.set(size.width / 2, size.height / 2);
  turned.rotation = angle;
}

/**
 * Shows the loader once the switch took `afterMs`, until the swap: a layer loader asks its `due` then and lifts the
 * layer it answers above the veil; a ring or a texture turns. A loader that comes or goes moves the walks of `shown`,
 * so the loops of a lifted layer's views run while it shows.
 *
 * @param sctx - Domain context of the sync module.
 * @param objects - The engine's objects.
 * @param run - The running look.
 * @param now - The clock now, ms.
 * @returns True when the loader came, went or turns in this frame: the frame is drawn.
 */
function paintLoader(sctx: SyncCtx, objects: LeaveObjects, run: LeaveRun, now: number): boolean {
  const afterMs = run.look.loader?.afterMs ?? 0;
  const shown = !run.landed && run.loader !== "none" && now - run.startedAt >= afterMs;
  const due = shown && run.loader === "layer";

  // A layer loader asks for its layer once, the first frame it is due, and lifts it from then on.
  if (due && !run.asked) ask(sctx, run);
  if (due) lift(sctx, objects, run);

  const toggled = shown !== run.shown;

  if (toggled) {
    run.shown = shown;
    sctx.ctx.state.sync.passesVersion += 1;
  }

  // `ask` may have turned the layer loader into the ring.
  const isLayer = shown && run.loader === "layer";

  objects.held.visible = isLayer;
  objects.ring.visible = shown && run.loader === "ring";
  objects.spinner.visible = shown && run.loader === "texture";

  if (!shown || isLayer) return toggled;

  turn(objects, run, now, sctx.deps.viewport.size());

  return true;
}

/**
 * Shows a look from now, in place of one that runs: the veil fades in from where it stands (0, or the level of a veil
 * still fading out after the last swap), the loader waits for its `afterMs`. Inert, nothing is kept.
 *
 * @param sctx - Domain context of the sync module.
 * @param look - The veil and the loader, resolved.
 */
export function showLeave(sctx: SyncCtx, look: LeaveLook): void {
  const state = sctx.ctx.state.sync;

  if (state.root === undefined) return;

  const before = state.leave.run;

  if (before !== undefined) unlift(sctx, before);

  const now = sctx.ctx.deps.clock.now();
  const level = before?.look.cover === undefined ? 0 : before.level;
  const loader = loaderOf(sctx, look);

  state.leave.run = {
    look,
    startedAt: now,
    steppedAt: now,
    level,
    landed: false,
    asked: false,
    shown: false,
    ...loader
  };
  sctx.deps.demand.request();
}

/**
 * The swap came: the loader goes at once and the veil fades out over its `outMs` from where it stands; a look without
 * a veil, or with `outMs: 0`, is taken down at once. Nothing runs, or the swap was told already: nothing happens.
 *
 * @param sctx - Domain context of the sync module.
 */
export function landLeave(sctx: SyncCtx): void {
  const run = sctx.ctx.state.sync.leave.run;

  if (run === undefined || run.landed) return;

  const cover = run.look.cover;

  if (cover === undefined || cover.outMs <= 0) {
    takeDown(sctx);

    return;
  }

  unlift(sctx, run);
  run.landed = true;
  // The fade-out counts from the swap.
  run.steppedAt = sctx.ctx.deps.clock.now();
  sctx.deps.demand.request();
}

/**
 * The switch ended without a swap: the veil and the loader go at once. Nothing runs: nothing happens.
 *
 * @param sctx - Domain context of the sync module.
 */
export function dropLeave(sctx: SyncCtx): void {
  if (sctx.ctx.state.sync.leave.run === undefined) return;

  takeDown(sctx);
}

/**
 * The look of this frame, before the decision: the veil's level from the clock, the loader once due, both placed over
 * the canvas as it stands, and a frame asked for while either moves. A look whose veil faded out after the swap is
 * taken down. One field read and no allocation while no look runs; a lost device leaves the look waiting for the
 * restore, which makes its objects again.
 *
 * @param sctx - Domain context of the sync module.
 */
export function stepLeave(sctx: SyncCtx): void {
  const run = sctx.ctx.state.sync.leave.run;

  // per frame: no switch runs, one field read.
  if (run === undefined) return;

  const objects = objectsOf(sctx);
  const stage = sctx.deps.host.stage();
  const screen = sctx.deps.host.screen();

  if (objects === undefined || stage === undefined || screen === undefined) return;

  const now = sctx.ctx.deps.clock.now();
  const moved = advance(run, now);

  if (run.landed && run.level <= 0) {
    takeDown(sctx);

    return;
  }

  hang(sctx, objects, stage, screen);
  paintVeil(objects, run);

  const loading = paintLoader(sctx, objects, run, now);

  if (moved || loading) sctx.deps.demand.request();
}

/**
 * Forgets the objects of a lost application: they go with its stage, and so does a layer lifted above the veil. The
 * running look stays: the step makes its objects again on the restored device.
 *
 * @param state - The sync branch of the plugin state.
 */
export function forgetLeave(state: SyncState): void {
  delete state.leave.objects;

  if (state.leave.run !== undefined) delete state.leave.run.lifted;
}

/**
 * Drops the look and frees the engine's objects when the plugin stops. A lifted layer is the layer table's and the
 * spinner's texture is the game's: neither is freed with them.
 *
 * @param state - The sync branch of the plugin state.
 */
export function stopLeave(state: SyncState): void {
  const objects = state.leave.objects;

  delete state.leave.run;
  delete state.leave.objects;

  if (objects === undefined) return;

  objects.held.removeChildren();
  objects.top.destroy({ children: true });
}
