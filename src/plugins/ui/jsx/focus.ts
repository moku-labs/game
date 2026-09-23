/**
 * @file ui/jsx — the keyboard focus. Tab and Shift+Tab walk the controls of the top root in
 * reading order, Enter and Space tap the focused one, Escape taps the `escape` button of the top
 * root, and a pointer tap clears the focus. The ring around the focused control is two ui-owned
 * shapes, a solid halo under a dashed ring, drawn in the layer of that root above its elements.
 */
import { Tappable } from "../../input/components";
import type { KeyInput } from "../../input/types";
import { Shape, Transform } from "../../renderer/components";
import { Layer, Order } from "../../world/ecs/define";
import type { AnyComponentValue, Entity } from "../../world/types";
import { Escapable, LocalWrite, UI_OWNER } from "../components";
import { asHandle } from "../errors";
import type { Rect } from "../layout/types";
import type { FocusRing, UiCtx } from "../types";
import { visualRectOf } from "../visual";
import { sortedRoots } from "./tree";
import type { Element, JsxState, PointerFlag, Root } from "./types";

/** Where the halo draws inside the layer of the focused root: above the root, under the next. */
const HALO_ORDER = 0.5;

/** Where the dashed ring draws: above the halo, still under the next root. */
const RING_ORDER = 0.75;

/** What the jsx module takes from the focus: the key listener, the pointer tap and the frame step. */
export type Focus = {
  key(input: KeyInput): boolean;
  blur(): void;
  refresh(): void;
};

/**
 * Compares two rects in reading order: the upper one first, and on the same top the left one.
 *
 * @param first - One rect.
 * @param second - The other.
 * @returns A negative number when `first` reads first.
 * @example
 * ```ts
 * readingOrder({ x: 500, y: 0, w: 10, h: 10 }, { x: 0, y: 100, w: 10, h: 10 }); // -100
 * ```
 */
export function readingOrder(first: Rect, second: Rect): number {
  return first.y === second.y ? first.x - second.x : first.y - second.y;
}

/**
 * The root the keyboard works in: the first uncovered popup in reader order, else the last screen
 * root, the one in the top layer. A root on its way out does not count.
 *
 * @param state - The jsx state.
 * @param layers - The layer names of the scene, in draw order.
 * @returns The root, or `undefined` when nothing is mounted.
 */
export function focusRoot(state: JsxState, layers: readonly string[]): Root | undefined {
  const roots = sortedRoots(state, layers).filter(
    root => root.element !== undefined && !state.removing.has(root.entity)
  );
  const popup = roots.find(root => root.popup !== undefined && !root.covered);

  return popup ?? roots.findLast(root => root.popup === undefined);
}

/**
 * The four components of one part of the ring: where it is, the layer and order it draws at, and
 * the stroked rectangle.
 *
 * @param root - The root of the focused element.
 * @param order - How far above the root this part draws.
 * @param rect - The focused rect grown by the ring offset.
 * @param stroke - The colour, the width, the dash and the radius of this part.
 * @param stroke.color - The stroke colour.
 * @param stroke.width - The stroke width.
 * @param stroke.dash - The dash length, 0 for a solid line.
 * @param stroke.radius - The corner radius.
 * @returns The component values.
 */
function partOf(
  root: Root,
  order: number,
  rect: Rect,
  stroke: { color: number; width: number; dash: number; radius: number }
): AnyComponentValue[] {
  return [
    Transform({ x: rect.x, y: rect.y, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }),
    Layer({ name: root.layer }),
    Order({ value: root.order + order }),
    Shape({
      w: rect.w,
      h: rect.h,
      fillAlpha: 0,
      alpha: 1,
      radius: stroke.radius,
      stroke: stroke.color,
      strokeWidth: stroke.width,
      dash: stroke.dash
    })
  ];
}

/**
 * Builds the keyboard focus of the jsx module.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param mark - Sets the `focus` flag of an element and re-resolves its style.
 * @returns The key listener, the pointer tap and the frame step.
 */
export function createFocus(
  ctx: UiCtx,
  mark: (entity: Entity, flag: PointerFlag, on: boolean) => void
): Focus {
  const state: JsxState = ctx.state.jsx;
  const focus = state.focus;
  const ecs = ctx.deps.world.ecs;
  const lookup = (entity: Entity): Element | undefined => state.elements.get(entity);
  const topRoot = (): Root | undefined =>
    focusRoot(
      state,
      ctx.deps.world.projection.layers().map(layer => layer.name)
    );
  const usable = (element: Element): boolean => element.live && !state.exiting.has(element.entity);

  /**
   * The controls of a root in reading order: its live elements that answer a tap.
   *
   * @param root - The root the keyboard works in.
   * @returns The elements, upper first, then left first.
   */
  function controlsOf(root: Root): Element[] {
    const found: { element: Element; rect: Rect }[] = [];

    for (const element of state.elements.values()) {
      if (element.root !== root.entity || !usable(element)) continue;

      const answers = ecs.has(element.entity, Tappable) || ecs.has(element.entity, LocalWrite);

      if (answers) found.push({ element, rect: visualRectOf(element, lookup) });
    }

    found.sort((first, second) => readingOrder(first.rect, second.rect));

    return found.map(entry => entry.element);
  }

  /**
   * Writes one part of the ring: spawns it the first time, patches it after.
   *
   * @param entity - The part, or nothing before the first focus.
   * @param values - Its components.
   * @returns The entity of the part.
   */
  function writePart(entity: Entity | undefined, values: AnyComponentValue[]): Entity {
    if (entity === undefined) return ecs.spawn(UI_OWNER, values);

    for (const value of values) ecs.set(entity, asHandle(value.type), value.value as object);

    return entity;
  }

  /**
   * Draws the ring around the drawn rect of an element, grown by the offset. Nothing is written
   * when the ring already stands there.
   *
   * @param element - The focused element.
   */
  function draw(element: Element): void {
    const root = state.roots.get(element.root);

    if (root === undefined) return;

    const look: FocusRing = ctx.config.focusRing;
    const drawn = visualRectOf(element, lookup);
    const rect = {
      x: drawn.x - look.offset,
      y: drawn.y - look.offset,
      w: drawn.w + 2 * look.offset,
      h: drawn.h + 2 * look.offset
    };
    const radius = (element.style.radius ?? 0) + look.offset;
    const signature = [root.layer, root.order, rect.x, rect.y, rect.w, rect.h, radius].join("|");

    if (signature === focus.drawn) return;

    focus.drawn = signature;
    focus.ring = {
      halo: writePart(
        focus.ring?.halo,
        partOf(root, HALO_ORDER, rect, { color: look.halo, width: look.haloWidth, dash: 0, radius })
      ),
      ring: writePart(
        focus.ring?.ring,
        partOf(root, RING_ORDER, rect, {
          color: look.stroke,
          width: look.strokeWidth,
          dash: look.dash,
          radius
        })
      )
    };
  }

  /**
   * Hides the ring: both parts stay spawned at alpha 0 for the next focus.
   */
  function hide(): void {
    focus.drawn = undefined;

    if (focus.ring === undefined) return;

    ecs.set(focus.ring.halo, Shape, { alpha: 0 });
    ecs.set(focus.ring.ring, Shape, { alpha: 0 });
  }

  /**
   * Drops the focus: the element loses its `focus` flag and the ring hides.
   */
  function drop(): void {
    const entity = focus.entity;

    focus.entity = undefined;

    if (entity !== undefined) mark(entity, "focus", false);

    hide();
    ctx.deps.time.wake();
  }

  /**
   * Moves the focus to an element and draws the ring around it.
   *
   * @param element - The control to focus.
   */
  function focusOn(element: Element): void {
    const previous = focus.entity;

    if (previous !== undefined && previous !== element.entity) mark(previous, "focus", false);

    focus.entity = element.entity;
    mark(element.entity, "focus", true);
    draw(element);
    ctx.deps.time.wake();
  }

  /**
   * Keeps the focus honest once per frame: it drops when its element left or its root is no
   * longer the top one (covered, or another root came over it), and the ring follows the rect.
   */
  function refresh(): void {
    const entity = focus.entity;

    if (entity === undefined) return;

    const element = state.elements.get(entity);

    if (element === undefined || !usable(element) || topRoot()?.entity !== element.root) {
      drop();

      return;
    }

    draw(element);
  }

  /**
   * Taps an entity the way a finger does, through `input`, without reading as a pointer tap.
   *
   * @param entity - The control to tap.
   */
  function tap(entity: Entity): void {
    focus.tapping = true;

    try {
      ctx.deps.input.tap(entity);
    } finally {
      focus.tapping = false;
    }
  }

  /**
   * Moves the focus one control forward or back in the top root, wrapping at both ends.
   *
   * @param step - 1 for Tab, -1 for Shift+Tab.
   * @returns True when the focus moved; false when the root has no control.
   */
  function move(step: 1 | -1): boolean {
    refresh();

    const root = topRoot();
    const controls = root === undefined ? [] : controlsOf(root);
    const at = controls.findIndex(element => element.entity === focus.entity);
    const fresh = step === 1 ? 0 : controls.length - 1;
    const next = controls[at === -1 ? fresh : (at + step + controls.length) % controls.length];

    if (next === undefined) return false;

    focusOn(next);

    return true;
  }

  /**
   * Taps the focused control, for Enter and Space.
   *
   * @returns True when a control was focused and tapped.
   */
  function press(): boolean {
    refresh();

    const entity = focus.entity;

    if (entity === undefined) return false;

    tap(entity);

    return true;
  }

  /**
   * Taps the `escape` button of the top root.
   *
   * @returns True when the top root has one.
   */
  function dismiss(): boolean {
    const root = topRoot();

    for (const element of state.elements.values()) {
      if (root === undefined || element.root !== root.entity || !usable(element)) continue;
      if (!ecs.has(element.entity, Escapable)) continue;

      tap(element.entity);

      return true;
    }

    return false;
  }

  return {
    key: (input: KeyInput): boolean => {
      if (input.key === "Tab") return move(input.shift ? -1 : 1);
      if (input.key === "Enter" || input.key === " ") return press();
      if (input.key === "Escape") return dismiss();

      return false;
    },

    blur: (): void => {
      if (!focus.tapping && focus.entity !== undefined) drop();
    },

    refresh
  };
}
