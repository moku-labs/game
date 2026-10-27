/**
 * @file ui plugin — the anchor pass, the system `ui.anchor` of phase `layout`, right after `ui.solve`.
 * Every `<anchor>` takes the drawn rect of its targets (`drawn.ts`), padded and mapped into the space
 * of its parent, in the frame its targets were laid out. Its subtree is a Yoga tree of its own, laid
 * out only when the anchor's size changed or a node of it is dirty (a child restyled, measured
 * again, added or taken out); a pure move shifts the rects in place. A change of the targets applies the subtree as the solve applies any element, so the
 * anchor's `change.Box` motion plays; following a target never starts a motion. A frame of a still
 * anchor, and of one that follows a moving target, allocates nothing.
 */
import { NineSlice, Shape, Transform, type TransformValue } from "../renderer/components";
import type { Point } from "../renderer/types";
import type { AnchorTarget } from "../world/projection/types";
import type { Entity } from "../world/types";
import { Box, type BoxValue } from "./components";
import { drawnInto, drawnPoseInto, isTargetList, readerOf, unionInto, upOf } from "./drawn";
import { sameValue } from "./jsx/same";
import { ownRect } from "./jsx/state";
import type { Anchor, Element, JsxModule } from "./jsx/types";
import { handleOf, still } from "./layout/motion";
import { fitInto } from "./layout/solve";
import type { Rect } from "./layout/types";
import type { UiCtx } from "./types";
import { ANCHOR, CONTENT, samePose } from "./visual";

/** How deep a parent chain is followed; deeper is treated as a loop. */
const MAX_DEPTH = 32;

/** How far a rect may move off a pure shift and still count as one: rounding, not a relayout. */
const SHIFT_EPSILON = 1e-6;

/** The patch that only marks a component changed: its fields were written in place. */
const NO_PATCH: object = Object.freeze({});

/** The fields of the anchor's `Transform` a follow writes, held from a loop while it follows. */
const FOLLOWED_FIELDS: readonly string[] = Object.freeze(["x", "y"]);

/** The style fields an anchor takes from its targets: a style that sets one is ignored there. */
const PLACED_FIELDS = ["width", "height", "position", "left", "top", "right", "bottom"] as const;

/** What one anchor's targets came to in this frame. */
type Found = { shown: boolean; missing: boolean; own: AnchorTarget | undefined };

/**
 * Tells whether a value is a target: an object with a string `projection` and a string `key`.
 *
 * @param value - One entry of `to`.
 * @returns True for a target.
 * @example
 * ```ts
 * isTarget({ projection: "hud", key: "coins" }); // true
 * ```
 */
function isTarget(value: unknown): value is AnchorTarget {
  if (typeof value !== "object" || value === null) return false;

  const target = value as { projection?: unknown; key?: unknown };

  return typeof target.projection === "string" && typeof target.key === "string";
}

/**
 * The targets a `to` prop names, when it names one or a list of them.
 *
 * @param to - What the render wrote.
 * @returns The target or the list, or `undefined` for anything else: the anchor is not shown.
 * @example
 * ```ts
 * targetsOf("seat0"); // undefined
 * ```
 */
function targetsOf(to: unknown): AnchorTarget | readonly AnchorTarget[] | undefined {
  if (isTarget(to)) return to;

  return Array.isArray(to) && to.every(entry => isTarget(entry)) ? to : undefined;
}

/**
 * Tells whether two rects are the same in every field.
 *
 * @param first - One rect.
 * @param second - The other.
 * @returns True when nothing differs.
 * @example
 * ```ts
 * sameRect({ x: 0, y: 0, w: 4, h: 4 }, { x: 0, y: 0, w: 4, h: 4 }); // true
 * ```
 */
function sameRect(first: Readonly<Rect>, second: Readonly<Rect>): boolean {
  return (
    first.x === second.x && first.y === second.y && first.w === second.w && first.h === second.h
  );
}

/**
 * Tells whether the targets of an anchor are others than the last time it was shown: a new `to`,
 * or keys that resolve to other entities. The entities of this frame become the shown ones.
 *
 * @param anchor - Its record.
 * @returns True when the set changed.
 */
function retargeted(anchor: Anchor): boolean {
  let changed = anchor.retarget || anchor.count !== anchor.shownCount;

  for (let index = 0; index < anchor.count; index += 1) {
    const entity = anchor.seen[index] ?? 0;

    if (anchor.shown[index] !== entity) changed = true;
    if (index < anchor.shown.length) anchor.shown[index] = entity;
    else anchor.shown.push(entity);
  }

  anchor.shownCount = anchor.count;
  anchor.retarget = false;

  return changed;
}

/**
 * Notes where the motion that starts now lands: the anchor's rest pose. A follow while it plays
 * carries it by how far the rest moved since.
 *
 * @param element - The anchor, its rest pose recorded.
 * @param anchor - Its record.
 */
function aim(element: Element, anchor: Anchor): void {
  anchor.aim.x = element.rest.x;
  anchor.aim.y = element.rest.y;
  anchor.wrote.x = Number.NaN;
  anchor.wrote.y = Number.NaN;
}

/**
 * Gives the position of an anchor back to its tracks, when a follow held it from a loop.
 *
 * @param anchor - Its record.
 */
function letGo(anchor: Anchor): void {
  anchor.held?.();
  anchor.held = undefined;
}

/**
 * Creates the set of rects the anchor pass made. Its own function, because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @returns An empty set.
 */
function rectSet(): WeakSet<object> {
  return new WeakSet();
}

/**
 * Tells whether an element moved by more than the shift of its anchor: it was laid out anew, not
 * only carried along.
 *
 * @param element - An element under an anchor whose rect was written.
 * @param shift - How far the anchor moved.
 * @returns True when its size or its place inside the anchor changed.
 */
function relaidOut(element: Element, shift: Readonly<Point>): boolean {
  const { rect, previous } = element;

  return (
    rect.w !== previous.w ||
    rect.h !== previous.h ||
    Math.abs(rect.x - previous.x - shift.x) > SHIFT_EPSILON ||
    Math.abs(rect.y - previous.y - shift.y) > SHIFT_EPSILON
  );
}

/**
 * Tells whether a motion that can end still plays on an element, or one that never ends.
 *
 * @param element - The element.
 * @returns `"finite"` while a motion that ends plays, `"endless"` while the element runs a loop or
 *   only a track that repeats forever plays, `"none"` otherwise.
 */
function motionOn(element: Element): "finite" | "endless" | "none" {
  if (!still(element)) return "finite";
  // A loop is endless by its kind: asking its handle would build the closure of `view.all` a frame.
  if (element.loop !== undefined) return "endless";

  for (const handle of element.handles) if (handle.active()) return "endless";

  return "none";
}

/**
 * Builds the anchor pass. Its records live in the jsx state, made when an anchor enters and
 * dropped when it despawns.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param jsx - The jsx module, which applies a rect the way the solve does.
 * @returns The step the system `ui.anchor` runs once a frame.
 */
export function createAnchorPass(ctx: UiCtx, jsx: Pick<JsxModule, "applyAnchored">): () => void {
  const state = ctx.state.jsx;
  const layout = ctx.state.layout;
  const ecs = ctx.deps.world.ecs;
  const projection = ctx.deps.world.projection;
  const reader = readerOf(ctx);
  const lookup = (entity: Entity): Element | undefined => state.elements.get(entity);
  // Per frame: what the targets of the anchor being placed came to, one object reset in place.
  const found: Found = { shown: false, missing: false, own: undefined };
  // The rects of the elements the pass places, in a shape that takes doubles in place (`ownRect`).
  const owned = rectSet();
  // Per frame: the rect a child is moved to, and how far its anchor moved. A fractional number
  // handed to a call is boxed, so the numbers travel in these two objects, written in place.
  const slot = ownRect(0, 0, 0, 0);
  const shift: Point = { x: 0, y: 0 };

  /**
   * Moves an element to a rect: its `previous` takes the rect it had, by value, and its rect the new
   * numbers, both in place. The first time, the element gets two rects of the pass's own shape, so
   * every later frame writes doubles with no allocation. A rect that changes marks the element moved.
   *
   * @param element - The element.
   * @param to - The new rect, in root coordinates.
   */
  function writeRect(element: Element, to: Readonly<Rect>): void {
    if (!owned.has(element.rect)) {
      const { rect, previous } = element;

      element.rect = ownRect(rect.x, rect.y, rect.w, rect.h);
      element.previous = ownRect(previous.x, previous.y, previous.w, previous.h);
      owned.add(element.rect);
    }

    const { rect, previous } = element;

    if (sameRect(rect, to)) return;

    previous.x = rect.x;
    previous.y = rect.y;
    previous.w = rect.w;
    previous.h = rect.h;
    rect.x = to.x;
    rect.y = to.y;
    rect.w = to.w;
    rect.h = to.h;
    element.moved = true;
  }

  /**
   * Tells whether an element or one above it is leaving: it no longer follows anything.
   *
   * @param element - The anchor.
   * @returns True while it or an ancestor plays its exit.
   */
  function leaving(element: Element): boolean {
    let current: Element | undefined = element;

    while (current !== undefined) {
      if (state.exiting.has(current.entity)) return true;

      current = current.parent === undefined ? undefined : lookup(current.parent);
    }

    return false;
  }

  /**
   * Reads the props of a new render of an anchor: another `to` retargets it, and a dev build names
   * a style that sets what the targets decide, once.
   *
   * @param element - The anchor.
   * @param anchor - Its record.
   */
  function readNode(element: Element, anchor: Anchor): void {
    if (element.node === anchor.node) return;

    const to = targetsOf(element.node.props.to);

    if (anchor.node !== undefined && !sameValue(anchor.to, to)) anchor.retarget = true;

    anchor.node = element.node;
    anchor.to = to;

    // The dev guard is inline: a production `define` folds it away.
    if (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) warnStyle(element, anchor);
  }

  /**
   * Names, once, an anchor whose style sets what its targets decide. Its own function: a closure
   * over `element` in `readNode` would make every call of it, every frame, allocate its context.
   *
   * @param element - The anchor.
   * @param anchor - Its record.
   */
  function warnStyle(element: Element, anchor: Anchor): void {
    if (anchor.warned.style || !PLACED_FIELDS.some(field => element.style[field] !== undefined)) {
      return;
    }

    anchor.warned.style = true;
    ctx.log.warn("ui:anchor-style", { key: element.key ?? element.identity });
  }

  /**
   * Tells whether an entity is the anchor or drawn under it.
   *
   * @param entity - A target's entity.
   * @param anchor - The anchor's entity.
   * @returns True for the anchor and everything in its subtree.
   */
  function within(entity: Entity, anchor: Entity): boolean {
    let current = entity;

    for (let depth = 0; depth < MAX_DEPTH && current !== 0; depth += 1) {
      if (current === anchor) return true;

      current = upOf(reader, current);
    }

    return false;
  }

  /**
   * Resolves one target: notes the entity its key names, and adds its drawn rect to the union when
   * it is shown. A key that names no entity, and a target under the anchor itself, add nothing.
   *
   * @param element - The anchor.
   * @param anchor - Its record.
   * @param target - One entry of `to`.
   */
  function visit(element: Element, anchor: Anchor, target: AnchorTarget): void {
    const entity = projection.entityOf(target.projection, target.key);
    const at = anchor.count;

    // Per frame: written by index into the kept list; it grows only for a longer `to`.
    if (at < anchor.seen.length) anchor.seen[at] = entity ?? 0;
    else anchor.seen.push(entity ?? 0);

    anchor.count += 1;

    if (entity === undefined) {
      found.missing = true;

      return;
    }

    if (within(entity, element.entity)) {
      found.own = target;

      return;
    }

    if (!drawnInto(reader, entity, anchor.part, anchor.pose)) return;

    if (found.shown) {
      unionInto(anchor.screen, anchor.part);
    } else {
      anchor.screen.x = anchor.part.x;
      anchor.screen.y = anchor.part.y;
      anchor.screen.w = anchor.part.w;
      anchor.screen.h = anchor.part.h;
      found.shown = true;
    }
  }

  /**
   * Resolves the targets of an anchor into the union of the shown ones, in screen reference units,
   * and logs what a dev build or the author must know: a key that named no entity for two frames in
   * a row, a target under the anchor itself.
   *
   * @param element - The anchor.
   * @param anchor - Its record.
   * @returns True when at least one target is shown.
   */
  function resolve(element: Element, anchor: Anchor): boolean {
    const to = anchor.to;

    found.shown = false;
    found.missing = false;
    found.own = undefined;
    anchor.count = 0;

    // A `to` that names no target shows nothing.
    if (isTargetList(to)) {
      for (const target of to) visit(element, anchor, target);
    } else if (to !== undefined) {
      visit(element, anchor, to);
    }

    anchor.missing = found.missing ? anchor.missing + 1 : 0;

    if (anchor.missing >= 2) warnMissing(element, anchor);
    if (found.own !== undefined) refuseOwn(element, anchor, found.own);

    return found.shown;
  }

  /**
   * Names, in a dev build, an anchor a key of which named no entity two frames in a row, once.
   *
   * @param element - The anchor.
   * @param anchor - Its record.
   */
  function warnMissing(element: Element, anchor: Anchor): void {
    // The dev guard is inline: a production `define` folds it away.
    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__ || anchor.warned.missing) {
      return;
    }

    anchor.warned.missing = true;
    ctx.log.warn("ui:anchor-target-missing", {
      key: element.key ?? element.identity,
      to: anchor.to
    });
  }

  /**
   * Logs, once per anchor, a target that lies inside the anchor itself: it is treated as not shown.
   *
   * @param element - The anchor.
   * @param anchor - Its record.
   * @param target - The target under the anchor.
   */
  function refuseOwn(element: Element, anchor: Anchor, target: AnchorTarget): void {
    if (anchor.warned.own) return;

    anchor.warned.own = true;
    ctx.log.error(
      "ui:anchor-own-child",
      { key: element.key ?? element.identity, target: target.key },
      new Error(
        `[game] An anchor cannot point at its own child "${target.key}".\n` +
          "  Point it at an element outside the anchor."
      )
    );
  }

  /**
   * Maps the union of the targets into the root coordinates of the anchor: through the root pose of
   * the entity it is drawn under (its parent, or the slot of its root), then by its parent's rect,
   * then padded outward.
   *
   * @param element - The anchor.
   * @param anchor - Its record: `screen` is read, `next` written.
   * @returns False when the space it is drawn in is collapsed: nothing of it could be seen.
   */
  function mapInto(element: Element, anchor: Anchor): boolean {
    const above = element.parent ?? state.roots.get(element.root)?.slot ?? 0;
    const pose = anchor.pose;

    if (above === 0 || !drawnPoseInto(reader, above, pose)) {
      pose.x = 0;
      pose.y = 0;
      pose.scale = 1;
      pose.pivot.x = 0;
      pose.pivot.y = 0;
    }

    const scale = pose.scale;

    if (scale <= 0) return false;

    const parent = element.parent === undefined ? undefined : lookup(element.parent);
    // The `pad` prop, read here: a fractional number a call returns is boxed.
    const given = element.node.props.pad;
    const pad = typeof given === "number" && Number.isFinite(given) ? given : 0;
    const { screen, next } = anchor;

    next.x = pose.pivot.x + (screen.x - pose.x) / scale + (parent?.rect.x ?? 0) - pad;
    next.y = pose.pivot.y + (screen.y - pose.y) / scale + (parent?.rect.y ?? 0) - pad;
    next.w = screen.w / scale + 2 * pad;
    next.h = screen.h / scale + 2 * pad;

    return next.w > 0 && next.h > 0;
  }

  /**
   * Writes the alpha of the anchor's visual, which fades its subtree with it: 0 hides the anchor the
   * way a transparent element is hidden, out of the draw and the hit test. Only a value that
   * differs is written.
   *
   * @param element - The anchor.
   * @param alpha - The alpha to draw it at.
   */
  function fadeTo(element: Element, alpha: number): void {
    const shape: { alpha: number } | undefined = ecs.get(element.entity, Shape);

    if (shape !== undefined) {
      if (shape.alpha === alpha) return;

      shape.alpha = alpha;
      ecs.set(element.entity, Shape, NO_PATCH);

      return;
    }

    const panel: { alpha: number } | undefined = ecs.get(element.entity, NineSlice);

    if (panel === undefined || panel.alpha === alpha) return;

    panel.alpha = alpha;
    ecs.set(element.entity, NineSlice, NO_PATCH);
  }

  /**
   * Hides an anchor none of whose targets is shown. A placed one stays, drawn at alpha 0; one never
   * placed waits with no components.
   *
   * @param element - The anchor.
   * @param anchor - Its record.
   */
  function hide(element: Element, anchor: Anchor): void {
    anchor.hidden = true;

    if (anchor.placed) fadeTo(element, 0);
  }

  /**
   * Shows an anchor again at the alpha of its style.
   *
   * @param element - The anchor.
   * @param anchor - Its record.
   */
  function show(element: Element, anchor: Anchor): void {
    if (!anchor.hidden) return;

    anchor.hidden = false;
    fadeTo(element, element.style.alpha ?? 1);
  }

  /**
   * Writes an element's `Box` from its rect, field by field on the stored value. Nothing is written
   * while it holds the same numbers, or before the `Box` landed.
   *
   * @param element - The element.
   */
  function writeBox(element: Element): void {
    const box: BoxValue | undefined = ecs.get(element.entity, Box);

    if (box === undefined || sameRect(box, element.rect)) return;

    box.x = element.rect.x;
    box.y = element.rect.y;
    box.w = element.rect.w;
    box.h = element.rect.h;
    ecs.set(element.entity, Box, NO_PATCH);
  }

  /**
   * Lays the subtree of an anchor out in its rect: one Yoga calculation of the anchor's own tree at
   * its size, then the rects of everything under it written in place.
   *
   * @param element - The anchor, its rect set.
   */
  function layOut(element: Element): void {
    const yoga = layout.yoga;
    const node = layout.byEntity.get(element.entity);

    if (yoga === undefined || node === undefined) return;

    node.setWidth(element.rect.w);
    node.setHeight(element.rect.h);
    node.calculateLayout(element.rect.w, element.rect.h, yoga.DIRECTION_LTR);
    layout.solves += 1;
    placeUnder(element);
  }

  /**
   * Writes the rects of the children of a laid-out element in root coordinates, and of everything
   * under them: the computed offsets from its rect, a fitted child centred in its content box at
   * the scale that fits it. A nested anchor is left to its own place in the pass.
   *
   * @param parent - The element whose rect is written.
   */
  function placeUnder(parent: Element): void {
    const yoga = layout.yoga;
    const node = layout.byEntity.get(parent.entity);

    if (yoga === undefined || node === undefined) return;

    const left = node.getComputedPadding(yoga.EDGE_LEFT);
    const top = node.getComputedPadding(yoga.EDGE_TOP);
    // Per layout of the subtree, not per frame: the content box a fitted child is centred in.
    const content: Rect = {
      x: parent.rect.x + left,
      y: parent.rect.y + top,
      w: parent.rect.w - left - node.getComputedPadding(yoga.EDGE_RIGHT),
      h: parent.rect.h - top - node.getComputedPadding(yoga.EDGE_BOTTOM)
    };

    for (const child of parent.children) {
      const element = lookup(child);
      const childNode = element === undefined ? undefined : layout.byEntity.get(element.entity);

      if (element === undefined || childNode === undefined || element.type === ANCHOR) continue;

      const w = childNode.getComputedWidth();
      const h = childNode.getComputedHeight();
      const fitted = element.style.fit === "contain" ? fitInto(content, w, h) : undefined;

      slot.x = fitted?.rect.x ?? parent.rect.x + childNode.getComputedLeft();
      slot.y = fitted?.rect.y ?? parent.rect.y + childNode.getComputedTop();
      slot.w = w;
      slot.h = h;
      writeRect(element, slot);

      if ((fitted?.fit ?? 1) !== element.fit) {
        element.fit = fitted?.fit ?? 1;
        element.moved = true;
      }

      placeUnder(element);
    }
  }

  /**
   * Carries everything under an element along by a shift, rects in place. A nested anchor is left
   * to its own place in the pass.
   *
   * @param parent - The element whose children move, by `shift`.
   * @param mark - Whether they stay marked moved, for an application that follows.
   */
  function shiftUnder(parent: Element, mark: boolean): void {
    for (const child of parent.children) {
      const element = lookup(child);

      if (element === undefined || element.type === ANCHOR) continue;

      const { rect } = element;

      slot.x = rect.x + shift.x;
      slot.y = rect.y + shift.y;
      slot.w = rect.w;
      slot.h = rect.h;
      writeRect(element, slot);

      if (!mark) element.moved = false;

      shiftUnder(element, mark);
    }
  }

  /**
   * Writes the `Box` of an element and of everything under it from their rects. A nested anchor is
   * left to its own place in the pass.
   *
   * @param element - The anchor or an element under it.
   */
  function writeBoxes(element: Element): void {
    writeBox(element);

    for (const child of element.children) {
      const childElement = lookup(child);

      if (childElement !== undefined && childElement.type !== ANCHOR) writeBoxes(childElement);
    }
  }

  /**
   * Applies an element and everything under it the way the solve applies a root: a new element
   * spawns its components, a moved live one is committed and plays its `change` hooks. A nested
   * anchor is left to its own place in the pass.
   *
   * @param element - The anchor or an element under it.
   */
  function applyTree(element: Element): void {
    jsx.applyAnchored(element, false);

    for (const child of element.children) {
      const childElement = lookup(child);

      if (childElement !== undefined && childElement.type !== ANCHOR) applyTree(childElement);
    }
  }

  /**
   * Applies what a relayout of an anchor's subtree moved. A child carried along only writes its
   * `Box`; one laid out anew is applied as the solve applies it, with its `change` hooks, unless
   * the anchor's size followed its targets: then it takes its rect and its rest pose with no motion.
   *
   * @param parent - The element whose children were laid out, its anchor moved by `shift`.
   * @param followed - Whether the anchor's size changed by following its targets.
   */
  function applyUnder(parent: Element, followed: boolean): void {
    for (const child of parent.children) {
      const element = lookup(child);

      if (element === undefined || element.type === ANCHOR) continue;

      if (!element.live) {
        // A child that came since the last pass gets its components with its first rect.
        jsx.applyAnchored(element, false);
      } else if (element.moved && !relaidOut(element, shift)) {
        writeBox(element);
        element.moved = false;
      } else if (element.moved && followed) {
        jsx.applyAnchored(element, true);
        settlePose(element);
      } else if (element.moved) {
        jsx.applyAnchored(element, false);
      }

      applyUnder(element, followed);
    }
  }

  /**
   * Brings an element under an anchor to the rest pose a follow gave it, with no motion: a `Transform`
   * a motion is on is taken through a 0 ms rest track, which cuts a finite motion and re-bases a
   * loop, as a repose does; one nothing moves is written at once.
   *
   * @param element - The element, its rest pose recorded.
   */
  function settlePose(element: Element): void {
    if (!element.live || element.type === CONTENT || !ecs.has(element.entity, Transform)) return;

    if (motionOn(element) === "none") {
      ecs.set(element.entity, Transform, { ...element.rest, pivot: { ...element.rest.pivot } });
    } else {
      handleOf(ctx, element)?.toRest(Transform, { ms: 0 });
    }
  }

  /**
   * Carries a motion that ends by how far the targets moved since it began: the position the motion
   * wrote this frame, moved by the rest's shift from where the motion lands. The motion writes its
   * own value again in the next frame, and the carry is added once more, so it lands on the moved
   * rest instead of jumping there at its end.
   *
   * @param element - The anchor.
   * @param anchor - Its record.
   * @param pose - Its stored `Transform`.
   */
  function carry(element: Element, anchor: Anchor, pose: TransformValue): void {
    const { aim: aimed, track, wrote } = anchor;
    const rest = element.rest;

    // A new size moves the pivot: no track writes it (it is no number), so it is set at once, and
    // the position carried below counts its change.
    if (pose.pivot.x !== rest.pivot.x || pose.pivot.y !== rest.pivot.y) {
      ecs.set(element.entity, Transform, { pivot: { x: rest.pivot.x, y: rest.pivot.y } });
    }

    // A value that is not the one the pass left is the motion's own of this frame.
    if (pose.x !== wrote.x) track.x = pose.x;
    if (pose.y !== wrote.y) track.y = pose.y;

    const x = track.x + rest.x - aimed.x;
    const y = track.y + rest.y - aimed.y;

    if (x === pose.x && y === pose.y) return;

    pose.x = x;
    pose.y = y;
    wrote.x = x;
    wrote.y = y;
    ecs.set(element.entity, Transform, NO_PATCH);
  }

  /**
   * Writes the anchor's `Transform` from its rest pose. While a motion that ends plays (the glide of
   * a change of targets, a look tween), the motion is carried by the follow and lands on the rest;
   * the pose is owed to the rest until it ends. Under a loop the follow holds `x` and `y` from every
   * track while it moves (`world.projection.mute`), and the loop goes on from where the anchor
   * stands once it is let go. Each field is written on the stored value.
   *
   * @param element - The anchor.
   * @param anchor - Its record.
   */
  function writePose(element: Element, anchor: Anchor): void {
    const pose: TransformValue | undefined = ecs.get(element.entity, Transform);

    if (!element.live || pose === undefined) return;

    const motion = motionOn(element);

    if (motion === "finite") {
      anchor.owed = true;
      carry(element, anchor, pose);

      return;
    }

    anchor.owed = false;

    // A loop would write its own position over the follow's: the follow holds `x` and `y` from
    // every track until the anchor stands, once per follow, and writes them itself.
    if (motion === "endless" && anchor.held === undefined) {
      anchor.held = projection.mute(element.entity, Transform, FOLLOWED_FIELDS);
    }

    const rest = element.rest;

    if (samePose(pose, rest)) return;

    if (pose.pivot.x !== rest.pivot.x || pose.pivot.y !== rest.pivot.y) {
      ecs.set(element.entity, Transform, { ...rest, pivot: { ...rest.pivot } });

      return;
    }

    // Per frame of a follow: the numbers go onto the stored value, which is only marked changed.
    pose.x = rest.x;
    pose.y = rest.y;
    pose.rotation = rest.rotation;
    pose.scale = rest.scale;
    ecs.set(element.entity, Transform, NO_PATCH);
  }

  /**
   * Moves the anchor's rest pose to where its rect and its parent's put it now, its size, and so its
   * pivot, unchanged: the position of `restTransform`, worked out here, since a fractional number
   * handed to or returned from a call is boxed. The rest is written in place, and the world's copy
   * of it is left behind until the anchor stands still. Then the `Transform` follows.
   *
   * @param element - The anchor.
   * @param anchor - Its record.
   * @returns True when the rest pose moved.
   */
  function follow(element: Element, anchor: Anchor): boolean {
    const parent = element.parent === undefined ? undefined : lookup(element.parent);
    const { rect, rest, style } = element;
    const centreX = rect.w / 2;
    const centreY = rect.h / 2;
    // `restTransform` at fit 1 (an anchor is never fitted), term by term in its order.
    const x =
      rect.x - (parent?.rect.x ?? 0) + centreX + (rest.pivot.x + (style.offsetX ?? 0) - centreX);
    const y =
      rect.y - (parent?.rect.y ?? 0) + centreY + (rest.pivot.y + (style.offsetY ?? 0) - centreY);

    if (x === rest.x && y === rest.y) return false;

    // A motion carried from now on moves by what the target moves from here.
    if (!anchor.owed) aim(element, anchor);

    rest.x = x;
    rest.y = y;
    anchor.stale = true;
    writePose(element, anchor);

    return true;
  }

  /**
   * Places an anchor for the first time: its rect, its subtree laid out, and everything applied as
   * a new root is, so its components spawn with their rects and its `enter` hooks play.
   *
   * @param element - The anchor.
   * @param anchor - Its record, `next` holding its rect.
   */
  function place(element: Element, anchor: Anchor): void {
    const { next } = anchor;

    element.fit = 1;
    writeRect(element, next);
    layOut(element);
    applyTree(element);
    // An enter motion lands where the anchor stands now.
    aim(element, anchor);
    anchor.placed = true;
  }

  /**
   * Moves an anchor to its new targets the way a solve moves an element: its `change.Box` motion
   * plays, and so do the hooks of what moved under it.
   *
   * @param element - The anchor.
   * @param anchor - Its record, `next` holding its new rect.
   * @param relayout - Whether a node of its subtree is dirty.
   */
  function retarget(element: Element, anchor: Anchor, relayout: boolean): void {
    const next = anchor.next;
    const rect = element.rect;
    const resized = next.w !== rect.w || next.h !== rect.h;

    shift.x = next.x - rect.x;
    shift.y = next.y - rect.y;
    writeRect(element, next);

    if (resized || relayout) layOut(element);
    else shiftUnder(element, true);

    anchor.owed = false;
    anchor.stale = false;
    // Its `change.Box` motion writes the position: a hold of a follow ends.
    letGo(anchor);
    applyTree(element);
    // The glide its `change.Box` motion started lands on the new rest.
    aim(element, anchor);
  }

  /**
   * Keeps an anchor on targets that moved, resized or stood: no motion starts. A pure move writes
   * every number in place and leaves the `Box` values for the frame the anchor stands (a fractional
   * number written into a stored `Box` field is boxed); a new size or a dirty node lays the
   * subtree out again.
   *
   * @param element - The anchor.
   * @param anchor - Its record, `next` holding its rect of this frame.
   * @param relayout - Whether a node of its subtree is dirty.
   * @returns True when the anchor's rest pose moved.
   */
  function keep(element: Element, anchor: Anchor, relayout: boolean): boolean {
    const { next } = anchor;
    const rect = element.rect;
    const resized = next.w !== rect.w || next.h !== rect.h;

    shift.x = next.x - rect.x;
    shift.y = next.y - rect.y;
    writeRect(element, next);

    if (resized) {
      // A motion carried from now on moves by what the target moves from here.
      if (!anchor.owed) aim(element, anchor);

      layOut(element);
      // The commit records the new rest with the world.
      jsx.applyAnchored(element, true);
      anchor.stale = false;
      writePose(element, anchor);
      applyUnder(element, true);

      return true;
    }

    if (relayout) {
      layOut(element);
      applyUnder(element, false);
      writeBox(element);
    } else if (shift.x !== 0 || shift.y !== 0) {
      shiftUnder(element, false);
      anchor.boxes = true;
    }

    element.moved = false;

    return follow(element, anchor);
  }

  /**
   * Places one anchor for this frame: its targets resolved, then placed the first time, moved to
   * new targets, kept on moving ones, or hidden while none is shown. Its owed pose and the world's
   * copy of its rest catch up once nothing moves it.
   *
   * @param entity - The anchor's entity.
   * @param anchor - Its record.
   */
  function placeAnchor(entity: Entity, anchor: Anchor): void {
    const element = lookup(entity);

    if (element === undefined) return;

    // A leaving anchor stays where it is; one of a scene built aside waits for the swap.
    if (leaving(element)) {
      letGo(anchor);

      return;
    }

    if (projection.isBuilding(entity)) return;

    readNode(element, anchor);

    if (!resolve(element, anchor) || !mapInto(element, anchor)) {
      hide(element, anchor);

      return;
    }

    // A child restyled, measured again, added or taken out marks the anchor's own tree dirty.
    const relayout = layout.byEntity.get(entity)?.isDirty() === true;

    if (!anchor.placed) {
      place(element, anchor);
      retargeted(anchor);
      anchor.hidden = false;

      return;
    }

    let moved = false;

    if (retargeted(anchor)) retarget(element, anchor, relayout);
    else moved = keep(element, anchor, relayout);

    show(element, anchor);

    // Every frame of a motion the follow carries, and the frame it ends: the pose takes the rest.
    if (anchor.owed && !moved) writePose(element, anchor);

    if (moved) return;

    // The anchor stands: the world's copy of its rest and the `Box` values catch up, once.
    if (anchor.stale) {
      ctx.deps.world.projection.setRest(entity, Transform, element.rest);
      anchor.stale = false;
    }

    if (anchor.boxes) {
      writeBoxes(element);
      anchor.boxes = false;
    }

    // A loop held while the anchor moved goes on from where it stands.
    letGo(anchor);
  }

  return (): void => {
    // Per frame: one size read while no anchor exists.
    if (state.anchors.size === 0) return;

    for (const entity of state.anchors.keys()) {
      const anchor = state.anchors.get(entity);

      if (anchor !== undefined) placeAnchor(entity, anchor);
    }
  };
}
