/**
 * @file ui/layout — the visual half of `guide` and its input lock. A veil dims the screen around a
 * window cut over the guide's targets: one target, or the union of the shown ones of a list, grown
 * by `pad`. The system `ui.guide` of phase `layout` places it every frame, after the anchor pass,
 * through the resolver the anchors use (`drawn.ts`), so the window follows a target that moves or
 * scrolls. The window, written in place, is also the lock `input` keeps presses outside of. The
 * gate narrowing belongs to the runner. A frame of a guide allocates nothing.
 */
import type { FxHandler } from "../../flow/fx/types";
import {
  NineSlice,
  Shape,
  type ShapeValue,
  Sprite,
  Transform,
  type TransformValue
} from "../../renderer/components";
import { rootPoseOf } from "../../renderer/sync/pose";
import { Layer, Order } from "../../world/ecs/define";
import type { AnchorTarget } from "../../world/projection/types";
import type { EcsApi, Entity } from "../../world/types";
import { Box, UI_OWNER } from "../components";
import { type DrawnReader, readerOf, targetsInto } from "../drawn";
import type { UiCtx } from "../types";
import { drawnRect, visualRectOf } from "../visual";
import type { ElementLookup, Guide, Rect } from "./types";

/** How dark the veil is when the guide names no alpha. */
const DIM_ALPHA = 0.6;

/** The colour of the veil when the guide names none. */
const DIM_COLOR = 0x00_00_00;

/** Where the guide is drawn: above every popup root of the `ui` layer. */
const GUIDE_ORDER = 1_000_000;

/** The patch that only marks a component changed: its fields were written in place. */
const NO_PATCH: object = Object.freeze({});

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
 * Tells whether a value is a target: an object with a string `projection` and a string `key`.
 *
 * @param value - One entry of a guide's `target`.
 * @returns True for a target.
 * @example
 * ```ts
 * isTarget({ projection: "hud", key: "play" }); // true
 * ```
 */
function isTarget(value: unknown): value is AnchorTarget {
  if (typeof value !== "object" || value === null) return false;

  const record = value as { projection?: unknown; key?: unknown };

  return typeof record.projection === "string" && typeof record.key === "string";
}

/**
 * Reads the payload of a guide as a record.
 *
 * @param payload - What `guide()` put in the descriptor.
 * @returns The payload's fields, or an empty record for no payload.
 * @example
 * ```ts
 * fieldsOf(undefined); // {}
 * ```
 */
function fieldsOf(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) return {};

  return payload as Record<string, unknown>;
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
export function readTarget(payload: unknown): { projection: string; key: string } | undefined {
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
function readTargets(payload: unknown): AnchorTarget[] {
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
function readPad(payload: unknown): number {
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
function readVeil(payload: unknown): Veil {
  const veil = fieldsOf(payload).veil;

  if (veil === false) return false;

  const { color, alpha } = fieldsOf(veil);

  return {
    color: typeof color === "number" ? color : DIM_COLOR,
    alpha: typeof alpha === "number" ? alpha : DIM_ALPHA
  };
}

/**
 * The rect of the view a guide points at: where a ui element is drawn (its `Box` scaled by every
 * fitted element on the way up, through the pose of its slot for a root laid out in one), the `Box`
 * of an element the lookup does not know, else where a
 * view is drawn: its pose composed through the `Parent` chain (a view a ui slot hosts sits in the
 * slot's space) with the size of its panel or its sprite. A sprite of size 0 is drawn at its
 * texture's size, which `ui` does not know: its hole has size 0.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param entity - The entity the target named.
 * @param lookup - How an entity becomes its ui element; nothing for a view `ui` does not own.
 * @returns The rect, or `undefined` when the view carries no size.
 */
export function rectOfTarget(ctx: UiCtx, entity: Entity, lookup?: ElementLookup): Rect | undefined {
  const element = lookup?.(entity);

  if (element !== undefined && lookup !== undefined) {
    const rect = visualRectOf(element, lookup);
    // A root laid out in a slot is solved in the slot's units: its rect is mapped through the slot's pose (spec 16 U3).
    const slot = ctx.state.jsx.roots.get(element.root)?.slot;

    return slot === undefined ? rect : drawnRect(rootPoseOf(ctx.deps.world.ecs, slot), rect);
  }

  const ecs = ctx.deps.world.ecs;
  const box = ecs.get(entity, Box);

  if (box !== undefined) return { x: box.x, y: box.y, w: box.w, h: box.h };
  if (!ecs.has(entity, Transform)) return undefined;

  const pose = rootPoseOf(ecs, entity);
  const panel = ecs.get(entity, NineSlice);

  if (panel !== undefined) return drawnRect(pose, { x: 0, y: 0, w: panel.width, h: panel.height });

  const sprite = ecs.get(entity, Sprite);

  if (sprite === undefined) return undefined;

  const { anchor, width, height } = sprite;

  return drawnRect(pose, { x: -anchor.x * width, y: -anchor.y * height, w: width, h: height });
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
 * The four rectangles that cover the screen except the hole: `dimInto` on new rects.
 *
 * @param screen - The viewport rect.
 * @param hole - The rect left uncovered, or nothing for a full dim.
 * @returns Between one and four rectangles.
 * @example
 * ```ts
 * dimRects({ x: 0, y: 0, w: 100, h: 100 }, undefined).length; // 1
 * ```
 */
export function dimRects(screen: Rect, hole: Rect | undefined): Rect[] {
  if (hole === undefined) return [screen];

  const out = [emptyRect(), emptyRect(), emptyRect(), emptyRect()];

  dimInto(screen, hole, out);

  return out.map(rect => ({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }));
}

/**
 * Places a guide for this frame: its window over the union of its shown targets, grown by its
 * padding, and the rects of its veil around it, all written in place. No target shown: the window
 * keeps its last numbers and the veil covers the screen.
 *
 * @param reader - What the resolver reads.
 * @param viewport - The viewport the veil covers.
 * @param guide - The guide.
 * @returns True when a target is shown and the window holds its rect.
 */
function placeGuide(reader: DrawnReader, viewport: ViewportReader, guide: Guide): boolean {
  const { window, pad } = guide;
  let shown = guide.targets.length > 0 && targetsInto(reader, guide.targets, window, guide.scratch);

  if (shown) {
    window.x -= pad;
    window.y -= pad;
    window.w += 2 * pad;
    window.h += 2 * pad;
    shown = window.w > 0 && window.h > 0;
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

    index += 1;
    const shape: ShapeValue | undefined = ecs.get(entity, Shape);

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
  // eslint-disable-next-line unicorn/no-useless-undefined -- `undefined` lifts the lock.
  ctx.deps.input.lock.window(undefined);
}

/**
 * Builds the guide a descriptor names, before its first placement: the targets, the padding, one
 * rect per rectangle of its veil and the window.
 *
 * @param payload - What `guide()` put in the descriptor.
 * @param veil - The veil of the guide.
 * @returns The guide, nothing placed and nothing locked yet.
 */
function createGuide(payload: unknown, veil: Veil): Guide {
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
    ended: false
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

    writeVeils(ecs, guide);
    lockTo(ctx, guide, shown);
  };
}

/**
 * Builds the `guide` handler. It returns at once: the node continues while the veil stays on
 * screen, and the veil and the lock leave when the narrow is lifted. A new guide replaces the one
 * `ui` shows. Fast mode draws nothing.
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

    const shownBefore = ctx.state.layout.guide;

    if (shownBefore !== undefined) endGuide(ctx, shownBefore);

    const veil = readVeil(descriptor.payload);
    const guide = createGuide(descriptor.payload, veil);
    const shown = placeGuide(reader, viewport, guide);

    if (guide.targets.length > 0 && !shown) {
      ctx.log.warn(
        "ui:guide-target-missing",
        readTarget(descriptor.payload) ?? { targets: guide.targets }
      );
    }

    guide.veils = spawnVeils(ctx.deps.world.ecs, guide.rects, veil);
    ctx.state.layout.guide = guide;
    lockTo(ctx, guide, shown);
    signal.addEventListener("abort", () => endGuide(ctx, guide), { once: true });
  };
}
