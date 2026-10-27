/**
 * @file ui/layout — the visual half of `guide` and its input lock. A veil dims the screen around a
 * window cut over the guide's targets: one target, or the union of the shown ones of a list, grown
 * by `pad`. The system `ui.guide` of phase `layout` places it every frame, after the anchor pass,
 * through the resolver the anchors use (`drawn.ts`), so the window follows a target that moves or
 * scrolls. The window, written in place, is also the lock `input` keeps presses outside of, and the
 * text fields' pointer door honours it. The gate narrowing belongs to the runner. A frame of a guide
 * allocates nothing.
 */
import type { FxHandler } from "../../flow/fx/types";
import type { PointerListener } from "../../input/types";
import type { Json } from "../../model/types";
import { Shape, type ShapeValue, Transform, type TransformValue } from "../../renderer/components";
import { Layer, Order } from "../../world/ecs/define";
import type { AnchorTarget } from "../../world/projection/types";
import type { EcsApi, Entity } from "../../world/types";
import { UI_OWNER } from "../components";
import { type DrawnReader, readerOf, targetsInto } from "../drawn";
import type { UiCtx } from "../types";
import type { Guide, Rect } from "./types";

/** How dark the veil is when the guide names no alpha. */
const DIM_ALPHA = 0.6;

/** The colour of the veil when the guide names none. */
const DIM_COLOR = 0x00_00_00;

/** Where the guide is drawn: above every popup root of the `ui` layer. */
const GUIDE_ORDER = 1_000_000;

/** The patch that only marks a component changed: its fields were written in place. */
const NO_PATCH: object = Object.freeze({});

/**
 * Frames of the pass a guide that replaced one with the same targets keeps that guide's window while
 * none of its targets is shown yet: a node that derives its guide again in the tick its edge
 * committed finds a view the edge made before the world laid it out.
 */
const GRACE_FRAMES = 2;

/** Frames in a row a key of the guide names no entity before a dev build names it, as for an anchor. */
const MISSING_FRAMES = 2;

/** How the veil of a guide is drawn: its colour and alpha, or not at all. */
type Veil = { color: number; alpha: number } | false;

/** The viewport the veil covers: `renderer.viewport`. */
type ViewportReader = UiCtx["deps"]["renderer"]["viewport"];

/**
 * Creates a rect the guide writes in place every frame. Its keys come in the order `w, h, x, y`, the
 * order of `ownRect` in `jsx/state.ts`: a rect of the order `x, y, w, h` shares its shape with the
 * frozen `Box` values, and V8 boxes every fractional number written into one.
 *
 * @returns A rect at 0, 0 of size 0.
 * @example
 * ```ts
 * Object.keys(emptyRect()); // ["w", "h", "x", "y"]
 * ```
 */
function emptyRect(): Rect {
  return { w: 0, h: 0, x: 0, y: 0 };
}

/**
 * Tells whether a JSON value is an object with keys: not `null`, not an array.
 *
 * @param value - Any JSON value, or nothing.
 * @returns `true` for a plain object.
 * @example
 * ```ts
 * isPlainRecord({ target: [] }); // true
 * ```
 */
function isPlainRecord(value: Json | undefined): value is Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Tells whether a JSON value is a target: an object with a string `projection` and a string `key`.
 *
 * @param value - One entry of a guide's `target`.
 * @returns True for a target.
 * @example
 * ```ts
 * isTarget({ projection: "hud", key: "play" }); // true
 * ```
 */
function isTarget(value: Json | undefined): value is AnchorTarget {
  return (
    isPlainRecord(value) && typeof value.projection === "string" && typeof value.key === "string"
  );
}

/**
 * Reads the payload of a guide, or of its veil, as a record.
 *
 * @param payload - What `guide()` put in the descriptor, or one of its fields.
 * @returns The record, or an empty one for anything else.
 * @example
 * ```ts
 * fieldsOf(undefined); // {}
 * ```
 */
function fieldsOf(payload: Json | undefined): Record<string, Json> {
  return isPlainRecord(payload) ? payload : {};
}

/**
 * Reads the target a guide names out of its payload, when it names one.
 *
 * @param payload - What `guide()` put in the descriptor.
 * @returns The projection and key, or `undefined` when the guide names no single target.
 * @example
 * ```ts
 * readTarget({ target: { projection: "hud", key: "play" } })?.key; // "play"
 * ```
 */
export function readTarget(
  payload: Json | undefined
): { projection: string; key: string } | undefined {
  const target = fieldsOf(payload).target;

  if (!isTarget(target)) return undefined;

  return { projection: target.projection, key: target.key };
}

/**
 * Reads every target a guide names: its one target, or the targets of its list.
 *
 * @param payload - What `guide()` put in the descriptor.
 * @returns The targets, copied; empty when the guide names none.
 * @example
 * ```ts
 * readTargets({ target: [{ projection: "board", key: "c2" }, { projection: "board", key: "c3" }] }).length; // 2
 * ```
 */
function readTargets(payload: Json | undefined): AnchorTarget[] {
  const target = fieldsOf(payload).target;

  if (!Array.isArray(target)) {
    const one = readTarget(payload);

    return one === undefined ? [] : [one];
  }

  return target
    .filter(entry => isTarget(entry))
    .map(entry => ({ projection: entry.projection, key: entry.key }));
}

/**
 * Reads the padding of a guide's window: a finite number, 0 otherwise.
 *
 * @param payload - What `guide()` put in the descriptor.
 * @returns The padding in screen reference units.
 * @example
 * ```ts
 * readPad({ pad: 4 }); // 4
 * ```
 */
function readPad(payload: Json | undefined): number {
  const pad = fieldsOf(payload).pad;

  return typeof pad === "number" && Number.isFinite(pad) ? pad : 0;
}

/**
 * Reads the veil of a guide: `false` draws none, otherwise its colour and alpha, black at 0.6 for
 * what the guide leaves out.
 *
 * @param payload - What `guide()` put in the descriptor.
 * @returns The veil.
 * @example
 * ```ts
 * readVeil({ veil: { alpha: 0 } }); // { color: 0, alpha: 0 }
 * ```
 */
function readVeil(payload: Json | undefined): Veil {
  const veil = fieldsOf(payload).veil;

  if (veil === false) return false;

  const { color, alpha } = fieldsOf(veil);

  return {
    color: typeof color === "number" ? color : DIM_COLOR,
    alpha: typeof alpha === "number" ? alpha : DIM_ALPHA
  };
}

/**
 * Writes one rect in place.
 *
 * @param out - The rect written.
 * @param x - Its left.
 * @param y - Its top.
 * @param w - Its width.
 * @param h - Its height.
 */
function setRect(out: Rect | undefined, x: number, y: number, w: number, h: number): void {
  if (out === undefined) return;

  out.x = x;
  out.y = y;
  out.w = w;
  out.h = h;
}

/**
 * Writes the rectangles that cover the screen except the window, in place: one over the whole
 * screen when there is no window (the others, if any, take no room), four around it otherwise. A
 * side the window leaves no room for has size 0.
 *
 * @param screen - The viewport rect.
 * @param hole - The window left uncovered, or nothing for a full veil.
 * @param out - One rect for a guide with no target, four for one with a window, none for no veil.
 */
function dimInto(
  screen: Readonly<Rect>,
  hole: Readonly<Rect> | undefined,
  out: readonly Rect[]
): void {
  if (hole === undefined) {
    setRect(out[0], 0, 0, screen.w, screen.h);
    for (let index = 1; index < out.length; index += 1) setRect(out[index], 0, 0, 0, 0);

    return;
  }

  const below = hole.y + hole.h;
  const after = hole.x + hole.w;

  setRect(out[0], 0, 0, screen.w, Math.max(0, hole.y));
  setRect(out[1], 0, below, screen.w, Math.max(0, screen.h - below));
  setRect(out[2], 0, hole.y, Math.max(0, hole.x), hole.h);
  setRect(out[3], after, hole.y, Math.max(0, screen.w - after), hole.h);
}

/**
 * Places a guide for this frame: its window over the union of its shown targets, grown by its
 * padding, and the rects of its veil around it, all written in place. No target shown: the window
 * keeps its last numbers; during its grace, a guide that took over the window of the one it
 * replaced keeps that window, otherwise the veil covers the screen.
 *
 * @param reader - What the resolver reads.
 * @param viewport - The viewport the veil covers.
 * @param guide - The guide: `found` is written.
 * @returns True when the window holds a rect to cut: a shown target's, or the one kept.
 */
function placeGuide(reader: DrawnReader, viewport: ViewportReader, guide: Guide): boolean {
  const { window, pad } = guide;

  guide.found =
    guide.targets.length > 0 && targetsInto(reader, guide.targets, window, guide.scratch);

  // Not found: the resolver left the window as it was, the kept one during the grace.
  let shown = guide.grace > 0;

  if (guide.found) {
    window.x -= pad;
    window.y -= pad;
    window.w += 2 * pad;
    window.h += 2 * pad;
    shown = window.w > 0 && window.h > 0;
    // The window is the guide's own from now on.
    guide.grace = 0;
  }

  const size = viewport.size();

  guide.screen.w = size.width;
  guide.screen.h = size.height;
  dimInto(guide.screen, shown ? window : undefined, guide.rects);

  return shown;
}

/**
 * Writes the rects of a guide onto its veil, field by field on the stored `Transform` and `Shape`
 * values, which are only marked changed: a patch of doubles boxes 16 B a field. A rect that did not
 * move writes nothing; a veil whose components wait for the flush is written in the next frame.
 *
 * @param ecs - The world's entities.
 * @param guide - The guide, its rects placed.
 */
function writeVeils(ecs: EcsApi, guide: Guide): void {
  const rects = guide.rects;
  let index = 0;

  for (const entity of guide.veils) {
    const rect = rects[index];
    const pose: TransformValue | undefined = ecs.get(entity, Transform);
    const shape: ShapeValue | undefined = ecs.get(entity, Shape);

    index += 1;

    if (rect === undefined || pose === undefined || shape === undefined) continue;

    if (pose.x !== rect.x || pose.y !== rect.y) {
      pose.x = rect.x;
      pose.y = rect.y;
      ecs.set(entity, Transform, NO_PATCH);
    }

    if (shape.w !== rect.w || shape.h !== rect.h) {
      shape.w = rect.w;
      shape.h = rect.h;
      ecs.set(entity, Shape, NO_PATCH);
    }
  }
}

/**
 * Hands `input` the lock of a guide when it changes: the window while a target is shown, everything
 * while none is. The window is handed by reference once; `placeGuide` writes it in place.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param guide - The guide.
 * @param shown - Whether a target is shown in this frame.
 */
function lockTo(ctx: UiCtx, guide: Guide, shown: boolean): void {
  const wanted = shown ? "window" : "all";

  if (guide.locked === wanted) return;

  guide.locked = wanted;
  // eslint-disable-next-line unicorn/no-null -- `null` locks every press: no window is shown.
  ctx.deps.input.lock.window(shown ? guide.window : null);
}

/**
 * Spawns the veil of a guide at the rects placed for it: none for `veil: false`, one over the
 * screen for a guide with no target, four around its window otherwise.
 *
 * @param ecs - The world's entities.
 * @param rects - The rects placed for the guide, one per rectangle of the veil.
 * @param veil - The colour and alpha of the veil.
 * @returns The spawned rectangles, in the order of `rects`.
 */
function spawnVeils(ecs: EcsApi, rects: readonly Rect[], veil: Veil): Entity[] {
  if (veil === false) return [];

  return rects.map(rect =>
    ecs.spawn(UI_OWNER, [
      Layer({ name: "ui" }),
      Order({ value: GUIDE_ORDER }),
      Transform({ x: rect.x, y: rect.y }),
      Shape({ w: rect.w, h: rect.h, fill: veil.color, alpha: veil.alpha })
    ])
  );
}

/**
 * Ends a guide once: its veil leaves and, when it is still the guide `ui` shows, the lock is
 * lifted.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param guide - The guide that ends.
 */
function endGuide(ctx: UiCtx, guide: Guide): void {
  if (guide.ended) return;

  guide.ended = true;

  for (const veil of guide.veils) ctx.deps.world.ecs.despawn(veil);

  if (ctx.state.layout.guide !== guide) return;

  ctx.state.layout.guide = undefined;
  // A guide that follows in this frame with the same targets takes its window over.
  ctx.state.layout.lastGuide = guide;
  guide.endedAt = ctx.deps.time.snapshot().frame;
  // eslint-disable-next-line unicorn/no-useless-undefined -- `undefined` lifts the lock.
  ctx.deps.input.lock.window(undefined);
}

/**
 * Tells whether two guides name the same targets, in the same order.
 *
 * @param first - One list of targets.
 * @param second - The other.
 * @returns True when every target matches.
 * @example
 * ```ts
 * sameTargets([{ projection: "hud", key: "play" }], [{ projection: "hud", key: "play" }]); // true
 * ```
 */
function sameTargets(first: readonly AnchorTarget[], second: readonly AnchorTarget[]): boolean {
  return (
    first.length === second.length &&
    first.every(
      (target, index) =>
        target.projection === second[index]?.projection && target.key === second[index]?.key
    )
  );
}

/**
 * Hands a new guide the window of the guide it replaces, when that one names the same targets and
 * cut a window: the guide shown now, or one that ended in this frame (a node left and entered again
 * in one tick). The new guide keeps it for its grace while none of its targets is shown.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param guide - The new guide, not placed yet.
 * @param replaced - The guide shown now, if any.
 */
function takeOver(ctx: UiCtx, guide: Guide, replaced: Guide | undefined): void {
  const last = ctx.state.layout.lastGuide;
  const before =
    replaced ??
    (last !== undefined && last.endedAt === ctx.deps.time.snapshot().frame ? last : undefined);

  if (before?.locked !== "window" || !sameTargets(before.targets, guide.targets)) return;

  guide.window.x = before.window.x;
  guide.window.y = before.window.y;
  guide.window.w = before.window.w;
  guide.window.h = before.window.h;
  guide.grace = GRACE_FRAMES;
}

/**
 * Names, in a dev build, a guide a key of which named no entity two frames in a row, once: a target
 * that never shows keeps the whole screen veiled and every press locked.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param guide - The guide.
 */
function countMissing(ctx: UiCtx, guide: Guide): void {
  const projection = ctx.deps.world.projection;
  let missing = false;

  for (const target of guide.targets) {
    if (projection.entityOf(target.projection, target.key) === undefined) missing = true;
  }

  guide.missing = missing ? guide.missing + 1 : 0;

  if (guide.missing < MISSING_FRAMES) return;

  guide.warned = true;
  ctx.log.warn("ui:guide-target-missing", { targets: guide.targets });
}

/**
 * Builds the guide a descriptor names, before its first placement: the targets, the padding, one
 * rect per rectangle of its veil and the window.
 *
 * @param payload - What `guide()` put in the descriptor.
 * @param veil - The veil of the guide.
 * @returns The guide, nothing placed and nothing locked yet.
 */
function createGuide(payload: Json | undefined, veil: Veil): Guide {
  const targets = readTargets(payload);
  const count = targets.length === 0 ? 1 : 4;

  return {
    targets,
    pad: readPad(payload),
    veils: [],
    rects: veil === false ? [] : Array.from({ length: count }, () => emptyRect()),
    window: emptyRect(),
    screen: emptyRect(),
    scratch: {
      part: emptyRect(),
      pose: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }
    },
    locked: "none",
    found: false,
    grace: 0,
    missing: 0,
    warned: false,
    ended: false,
    endedAt: -1
  };
}

/**
 * Builds the system `ui.guide`: places the guide `ui` shows, its veil and its lock, once a frame.
 *
 * @param ctx - Domain context of the ui plugin.
 * @returns The step the system runs once a frame.
 */
export function createGuidePass(ctx: UiCtx): () => void {
  const reader = readerOf(ctx);
  const viewport = ctx.deps.renderer.viewport;
  const ecs = ctx.deps.world.ecs;

  return (): void => {
    const guide = ctx.state.layout.guide;

    // Per frame: one field read while no guide stands.
    if (guide === undefined) return;

    const shown = placeGuide(reader, viewport, guide);

    if (!guide.found && guide.grace > 0) guide.grace -= 1;

    // The dev guard is inline: a production `define` folds the count away.
    if (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__ && !guide.warned) {
      countMissing(ctx, guide);
    }

    writeVeils(ecs, guide);
    lockTo(ctx, guide, shown);
  };
}

/**
 * Builds the `guide` handler. It returns at once: the node continues while the veil stays on
 * screen, and the veil and the lock leave when the narrow is lifted. A new guide replaces the one
 * `ui` shows; one with the same targets as the guide it replaces (shown now, or ended in this
 * frame) keeps that guide's window for its grace while its targets are not laid out yet. Fast mode
 * draws nothing.
 *
 * @param ctx - Domain context of the ui plugin.
 * @returns The handler `flow.fx.handle("guide", ...)` takes.
 */
export function createGuideHandler(ctx: UiCtx): FxHandler {
  const reader = readerOf(ctx);
  const viewport = ctx.deps.renderer.viewport;

  return (descriptor, { signal, mode }) => {
    // A node left before its guide reached the handler shows nothing: no abort would take it down.
    if (mode === "fast" || signal.aborted) return;

    const replaced = ctx.state.layout.guide;

    if (replaced !== undefined) endGuide(ctx, replaced);

    const veil = readVeil(descriptor.payload);
    const guide = createGuide(descriptor.payload, veil);

    takeOver(ctx, guide, replaced);

    const shown = placeGuide(reader, viewport, guide);

    guide.veils = spawnVeils(ctx.deps.world.ecs, guide.rects, veil);
    ctx.state.layout.guide = guide;
    lockTo(ctx, guide, shown);
    signal.addEventListener("abort", () => endGuide(ctx, guide), { once: true });
  };
}

/**
 * Tells whether the lock of a guide keeps a point from every view: it locks everything, or the
 * point lies outside its window, edges included, as `input` decides it.
 *
 * @param guide - The guide on screen.
 * @param x - Reference x.
 * @param y - Reference y.
 * @returns True when the point is locked.
 */
function locksPoint(guide: Guide, x: number, y: number): boolean {
  if (guide.locked === "all") return true;
  if (guide.locked !== "window") return false;

  const { window } = guide;

  return x < window.x || x > window.x + window.w || y < window.y || y > window.y + window.h;
}

/**
 * Wraps the pointer door of the text fields, which finds the field under a sample on its own:
 * while a guide stands, a sample whose point its lock keeps from every view does nothing, so a
 * field outside the window is neither focused nor blurred. The point is brought into reference
 * units as `input` brings it.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param door - The `onPointer` listener of the text fields.
 * @returns The listener `input.onPointer` takes.
 */
export function guardPointer(ctx: UiCtx, door: PointerListener): PointerListener {
  return sample => {
    const guide = ctx.state.layout.guide;

    if (guide !== undefined) {
      const point = ctx.deps.renderer.viewport.toReference(sample.clientX, sample.clientY);

      if (locksPoint(guide, point.x, point.y)) return;
    }

    door(sample);
  };
}
