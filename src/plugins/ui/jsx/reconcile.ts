/**
 * @file ui/jsx — the reconcile: a description tree diffed by identity into the entities `ui`
 * owns, and the solve that gives every one of them its rect before it is ever drawn.
 */
import { Tappable, Touchable } from "../../input/components";
import type { Json } from "../../model/types";
import { NineSlice, Parent, Shape, Sprite, Transform } from "../../renderer/components";
import { Text } from "../../text/components";
import { Order, Tree as WORLD_TREE } from "../../world/ecs/define";
import type { AnyComponentValue, Entity } from "../../world/types";
import { Box, LocalWrite, Scroll, UI_OWNER, UiCounters } from "../components";
import { asError, asHandle } from "../errors";
import type { LayoutModule, Rect } from "../layout/types";
import type { IsFlags, Style, StylesModule } from "../styles/types";
import type { UiCtx } from "../types";
import { forgetInstances, instanceFor, runView } from "./instances";
import type { DescriptionNode, Element, ElementMotion, JsxState, Root } from "./types";

/** What the modules injected into `jsx` are. */
export type JsxModules = { styles: StylesModule; layout: LayoutModule };

/** The tag of the one child a scroll container holds: everything inside it moves as one. */
export const CONTENT = "content";

/**
 * The children one element is diffed against. A scroll container holds exactly one of them: the
 * content the finger moves, which keeps the rects of its own children and carries them along.
 *
 * @param node - The node the markup wrote.
 * @returns The children of the element.
 * @example
 * ```ts
 * childrenOf({ type: "scroll", props: {}, children: [] }).length; // 1
 * ```
 */
export function childrenOf(node: DescriptionNode): readonly DescriptionNode[] {
  if (node.type !== "scroll") return node.children;

  return [{ type: CONTENT, props: {}, children: node.children }];
}

/**
 * Tells whether a tag draws nothing of its own, so it takes a `Shape` only when its style fills.
 *
 * @param type - The intrinsic tag.
 * @returns True for the six container tags.
 * @example
 * ```ts
 * isContainer("row"); // true
 * ```
 */
export function isContainer(type: string): boolean {
  return ["screen", "layer", "row", "column", "stack", "spacer", CONTENT].includes(type);
}

/**
 * The identity of one node: its parent, then the key or the type and index, then the type.
 *
 * @param parentIdentity - The identity of the parent element.
 * @param node - The node being placed.
 * @param index - Its position among its siblings.
 * @returns The identity the element keeps for its whole life.
 * @example
 * ```ts
 * identityOf("0", { type: "row", props: {}, children: [] }, 2); // "0|row@2|row"
 * ```
 */
export function identityOf(parentIdentity: string, node: DescriptionNode, index: number): string {
  const name = node.key ?? `${node.type}@${index}`;

  return `${parentIdentity}|${name}|${node.type}`;
}

/**
 * Gives the subtree of a component the key the component tag carried, so the element is
 * addressable under the name the markup wrote.
 *
 * @param node - What the component's view returned.
 * @param key - The key of the component tag.
 * @returns The node, keyed.
 * @example
 * ```ts
 * withKey({ type: "column", props: {}, children: [] }, "panel").key; // "panel"
 * ```
 */
export function withKey(node: DescriptionNode, key: string | undefined): DescriptionNode {
  if (key === undefined) return node;

  return { ...node, key };
}

/**
 * The state flags of an element: what the markup declared plus the pressed flag it already had.
 *
 * @param node - The node being placed.
 * @param pressed - Whether the pointer is on it.
 * @returns The four flags.
 * @example
 * ```ts
 * isFlagsOf({ type: "button", props: { state: { active: true } }, children: [] }, false).active; // true
 * ```
 */
export function isFlagsOf(node: DescriptionNode, pressed: boolean): IsFlags {
  const declared = node.props.state as IsFlags | undefined;

  return {
    pressed,
    disabled: declared?.disabled === true,
    active: declared?.active === true,
    selected: declared?.selected === true
  };
}

/**
 * The layout style of a node. A `text` whose `style` prop is a style key carries no layout style.
 *
 * @param node - The node being placed.
 * @returns The style, or `undefined`.
 */
function styleOf(node: DescriptionNode): Style | undefined {
  const style = node.props.style;

  return typeof style === "object" && style !== null ? (style as Style) : undefined;
}

/**
 * Refuses the two tags that are not in V3.
 *
 * @param node - The node being placed.
 * @throws {Error} For an `input` tag and for a horizontal scroll.
 */
function checkTag(node: DescriptionNode): void {
  if (node.type === "input") {
    throw new Error("[game] Text input arrives in V5.\n  Use a button or a list for now.");
  }

  if (node.type === "scroll" && node.props.axis === "x") {
    throw new Error('[game] Horizontal scroll arrives after V3.\n  Use axis "y".');
  }
}

/**
 * The visual component of an element: a nine-slice, a sprite, a text or a rounded rectangle.
 *
 * @param element - The element to draw.
 * @returns The component values, empty for a container with no fill.
 */
function visualOf(element: Element): AnyComponentValue[] {
  const { style, type, node } = element;
  const sliced = typeof node.props.nineSlice === "string";

  if (type === "image" || type === "icon") {
    const texture = (node.props.texture ?? node.props.name ?? "") as string;

    return [Sprite({ texture, alpha: style.alpha ?? 1, anchor: { x: 0, y: 0 } })];
  }

  if (type === "text") {
    const styleKey = typeof node.props.style === "string" ? node.props.style : "body";

    return [
      Text({
        content: (node.props.content ?? "") as string,
        style: styleKey,
        bind: node.props.bind as undefined,
        anchor: { x: 0, y: 0 }
      })
    ];
  }

  if (type === "panel" && sliced) {
    return [
      NineSlice({
        texture: node.props.nineSlice as string,
        width: element.rect.w,
        height: element.rect.h
      })
    ];
  }

  const filled = style.fill !== undefined || style.stroke !== undefined;

  if (isContainer(type) && !filled) return [];

  return [
    Shape({
      w: element.rect.w,
      h: element.rect.h,
      fill: style.fill ?? Shape.defaults.fill,
      alpha: style.alpha ?? 1,
      radius: style.radius ?? 0,
      stroke: style.stroke ?? Shape.defaults.stroke,
      strokeWidth: style.strokeWidth ?? 0,
      clip: type === "scroll"
    })
  ];
}

/**
 * The input components of an element: a button answers the gate, writes local state, or only
 * swallows the tap; a scroll container takes the press that moves its content.
 *
 * @param element - The element to make touchable.
 * @returns The component values.
 */
function inputOf(element: Element): AnyComponentValue[] {
  const { type, node, is } = element;

  if (type === "scroll") return [Touchable(), Scroll({ axis: "y" })];
  if (type !== "button") return [];
  if (is.disabled) return [Touchable()];

  const intent = node.props.intent;
  const local = node.props.local;

  if (typeof intent === "string") {
    return [Tappable({ intent, payload: (node.props.payload ?? {}) as Json })];
  }

  if (typeof local === "object" && local !== null) {
    return [Touchable(), LocalWrite({ patch: local as Record<string, unknown> })];
  }

  return [Touchable()];
}

/**
 * Everything an entering element gets at once, so a display object never exists without a rect.
 *
 * @param element - The element whose rect is known.
 * @param parent - The rect of its parent, or nothing for a root element.
 * @returns The component values the entity is filled with.
 */
export function componentsOf(element: Element, parent: Rect | undefined): AnyComponentValue[] {
  const values: AnyComponentValue[] = [
    Transform({ x: element.rect.x - (parent?.x ?? 0), y: element.rect.y - (parent?.y ?? 0) })
  ];

  if (element.parent !== undefined) values.push(Parent({ entity: element.parent }));

  // `Box` is last on purpose: the world applies a queued attach in call order and fires
  // `onAdded` as it goes, so the hook on `Box` is the moment the whole entity exists.
  return [...values, ...visualOf(element), ...inputOf(element), Box(element.rect)];
}

/**
 * Creates the key map of one root. Its own function, because lint rule L5 refuses a collection
 * built inside an exported declaration.
 *
 * @returns An empty key map.
 */
function keyMap(): Map<string, Entity> {
  return new Map();
}

/**
 * Tells a live element from a lookup that missed.
 *
 * @param element - What the element map answered.
 * @returns True when the element is there.
 */
function isElement(element: Element | undefined): element is Element {
  return element !== undefined;
}

/**
 * Collects the entities of a change set. Its own function, because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @param entities - What `changed()` answered.
 * @returns The entities as a set.
 */
function entitySet(entities: Iterable<Entity>): Set<Entity> {
  return new Set(entities);
}

/**
 * Builds the reconcile half of the jsx module: the two systems of the frame and the root
 * bookkeeping around them.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param modules - The styles and layout modules, injected in that order.
 * @returns The two frame steps and the root registry.
 */
export function createReconciler(ctx: UiCtx, modules: JsxModules) {
  const state: JsxState = ctx.state.jsx;
  const ecs = ctx.deps.world.ecs;
  const lookup = (entity: Entity): Element | undefined => state.elements.get(entity);

  /**
   * Registers the key of an element under its root, so `entityOf` and `find` answer for it.
   *
   * @param root - The root the element belongs to.
   * @param element - The element that entered.
   */
  function registerKey(root: Root, element: Element): void {
    if (element.key === undefined) return;

    const keys = state.byKey.get(root.entity) ?? keyMap();

    if (keys.has(element.key)) ctx.log.warn("ui:duplicate-key", { key: element.key });
    else keys.set(element.key, element.entity);

    state.byKey.set(root.entity, keys);
    element.dropKey = ctx.deps.world.projection.registerKey(root.name, element.key, element.entity);
  }

  /**
   * Creates one element and its subtree.
   *
   * @param root - The root being reconciled.
   * @param parent - The parent element, or nothing for a root element.
   * @param node - The node to place.
   * @param identity - The identity of the element.
   * @param instance - The identity of the nearest component instance.
   * @returns The new entity.
   */
  function enter(
    root: Root,
    parent: Element | undefined,
    node: DescriptionNode,
    identity: string,
    instance: string | undefined
  ): Entity {
    checkTag(node);

    const entity = ecs.spawn(UI_OWNER, []);
    const is = isFlagsOf(node, false);
    const element: Element = {
      entity,
      identity,
      type: node.type,
      key: node.key,
      parentType: parent?.type,
      root: root.entity,
      node,
      style: modules.styles.resolveElement(styleOf(node), is),
      is,
      rect: { x: 0, y: 0, w: 0, h: 0 },
      previous: { x: 0, y: 0, w: 0, h: 0 },
      moved: true,
      handles: [],
      motion: node.props.motion as ElementMotion | undefined,
      parent: parent?.entity,
      children: [],
      instance,
      live: false,
      entered: false,
      dropKey: undefined
    };

    state.elements.set(entity, element);
    state.byIdentity.set(identity, entity);
    registerKey(root, element);
    modules.layout.attach(element);
    diffChildren(root, element, childrenOf(node), instance);
    root.needsSolve = true;

    return entity;
  }

  /**
   * Updates one live element from its new node.
   *
   * @param root - The root being reconciled.
   * @param element - The element that stayed.
   * @param node - The node of this render.
   * @param instance - The identity of the nearest component instance.
   */
  function patch(
    root: Root,
    element: Element,
    node: DescriptionNode,
    instance: string | undefined
  ): void {
    const previousNode = element.node;
    const is = isFlagsOf(node, element.is.pressed);
    const style = modules.styles.resolveElement(styleOf(node), is);
    const moved = modules.layout.affectsRect(element.style, style);
    const contentChanged =
      previousNode.props.content !== node.props.content ||
      previousNode.props.style !== node.props.style;

    element.node = node;
    element.is = is;
    element.style = style;
    element.motion = node.props.motion as ElementMotion | undefined;
    element.instance = instance;

    if (moved || contentChanged) {
      modules.layout.applyStyle(element);
      root.needsSolve = true;
    }

    if (element.live) writeLive(element);

    diffChildren(root, element, childrenOf(node), instance);
  }

  /**
   * Writes the visual and input components of a live element again.
   *
   * @param element - The element that changed.
   */
  function writeLive(element: Element): void {
    for (const value of [...visualOf(element), ...inputOf(element)]) {
      if (!ecs.has(element.entity, value.type)) {
        ecs.add(element.entity, value);

        continue;
      }

      if (value.value !== true) ecs.set(element.entity, asHandle(value.type), value.value);
    }
  }

  /**
   * Expands a component node with its instance, so the view runs with the local state of that
   * identity.
   *
   * @param node - The node the markup wrote.
   * @param identity - Its identity.
   * @returns The subtree to place and the instance it belongs to.
   */
  function expand(
    node: DescriptionNode,
    identity: string
  ): { node: DescriptionNode | undefined; instance: string | undefined } {
    const definition = state.components.get(node.type);

    if (definition === undefined) return { node, instance: undefined };

    const instance = instanceFor(state, identity, definition, node.props);

    instance.dirty = false;

    const produced = runView(ctx, definition, instance, node.key);

    return { node: produced, instance: identity };
  }

  /**
   * Places one node: enter, patch, or exit and enter when the type at that key changed.
   *
   * @param root - The root being reconciled.
   * @param parent - The parent element, or nothing.
   * @param node - The node the markup wrote.
   * @param index - Its position among its siblings.
   * @param parentIdentity - The identity of the parent element.
   * @param instance - The identity of the nearest component instance.
   * @returns The entity of the element, or `undefined` when a component view threw.
   */
  function diffNode(
    root: Root,
    parent: Element | undefined,
    node: DescriptionNode,
    index: number,
    parentIdentity: string,
    instance?: string
  ): Entity | undefined {
    const identity = identityOf(parentIdentity, node, index);
    const expanded = expand(node, identity);
    const owner = expanded.instance ?? instance;
    const effective =
      expanded.node === undefined || expanded.instance === undefined
        ? expanded.node
        : withKey(expanded.node, node.key);

    if (effective === undefined) return state.byIdentity.get(identity);

    const existing = state.byIdentity.get(identity);
    const element = existing === undefined ? undefined : state.elements.get(existing);

    if (element !== undefined && element.type === effective.type) {
      patch(root, element, effective, owner);

      return element.entity;
    }

    if (element !== undefined) exitElement(element);

    return enter(root, parent, effective, identity, owner);
  }

  /**
   * Diffs the children of one element and re-places them once when the list changed.
   *
   * @param root - The root being reconciled.
   * @param parent - The element whose children are diffed.
   * @param nodes - The children of this render.
   * @param instance - The identity of the nearest component instance.
   */
  function diffChildren(
    root: Root,
    parent: Element,
    nodes: readonly DescriptionNode[],
    instance: string | undefined
  ): void {
    const next: Entity[] = [];

    for (const [index, node] of nodes.entries()) {
      const entity = diffNode(root, parent, node, index, parent.identity, instance);

      if (entity !== undefined) next.push(entity);
    }

    const kept = entitySet(next);

    for (const old of parent.children) {
      if (kept.has(old)) continue;

      const element = state.elements.get(old);

      if (element !== undefined) exitElement(element);
    }

    const same =
      next.length === parent.children.length &&
      next.every((entity, index) => parent.children[index] === entity);

    parent.children = next;

    if (same) return;

    modules.layout.place(
      parent,
      next.map(entity => state.elements.get(entity)).filter(element => isElement(element))
    );
    root.needsSolve = true;
  }

  /**
   * Starts the exit of an element and of everything under it.
   *
   * @param element - The element that left the description.
   */
  function exitElement(element: Element): void {
    forgetSubtree(element);
    forgetInstances(state, element.identity);
    state.exiting.add(element.entity);
    exitSubtree(element);
  }

  /**
   * Plays the exit hook of an element and of everything under it. A child keeps its rect and its
   * `Exiting` tag until the whole subtree stopped moving.
   *
   * @param element - The element that leaves, or one of its children.
   */
  function exitSubtree(element: Element): void {
    modules.layout.exit(element);

    for (const child of element.children) {
      const childElement = state.elements.get(child);

      if (childElement !== undefined) exitSubtree(childElement);
    }
  }

  /**
   * Tells whether an exiting subtree stopped moving.
   *
   * @param element - The top of the subtree.
   * @returns True when no hook under it is still playing.
   */
  function subtreeSettled(element: Element): boolean {
    if (!modules.layout.settled(element)) return false;

    return element.children.every(child => {
      const childElement = state.elements.get(child);

      return childElement === undefined || subtreeSettled(childElement);
    });
  }

  /**
   * Drops the identity, the key and the key registration of an element and of everything under
   * it, so `find` and `entityOf` stop answering for a subtree that is on its way out.
   *
   * @param element - The element that left the description.
   */
  function forgetSubtree(element: Element): void {
    state.byIdentity.delete(element.identity);

    const keys = state.byKey.get(element.root);

    if (element.key !== undefined && keys?.get(element.key) === element.entity) {
      keys.delete(element.key);
    }

    element.dropKey?.();
    element.dropKey = undefined;

    for (const child of element.children) {
      const childElement = state.elements.get(child);

      if (childElement !== undefined) forgetSubtree(childElement);
    }
  }

  /**
   * Despawns an exiting element and everything under it, and frees the Yoga nodes.
   *
   * @param element - The element whose motions finished.
   */
  function despawnTree(element: Element): void {
    for (const child of element.children) {
      const childElement = state.elements.get(child);

      if (childElement !== undefined) despawnTree(childElement);
    }

    modules.layout.free(element);
    state.exiting.delete(element.entity);
    state.elements.delete(element.entity);
    ecs.despawn(element.entity);
  }

  /**
   * Despawns every exiting element whose motions finished, and closes a popup whose root is gone.
   */
  function sweep(): void {
    for (const entity of state.exiting) {
      const element = state.elements.get(entity);

      if (element === undefined) {
        state.exiting.delete(entity);

        continue;
      }

      if (!subtreeSettled(element)) continue;

      despawnTree(element);
    }

    for (const entity of state.removing) {
      const root = state.roots.get(entity);

      if (root === undefined || (root.element !== undefined && state.elements.has(root.element))) {
        continue;
      }

      state.removing.delete(entity);
      state.roots.delete(entity);
      state.byKey.delete(entity);
      ecs.despawn(entity);
      root.popup?.close();
    }
  }

  /**
   * Gives every element of a solved root its components, its rest pose and its motion.
   *
   * @param element - The element to apply.
   */
  function applyRects(element: Element): void {
    const parent = element.parent === undefined ? undefined : lookup(element.parent)?.rect;

    if (element.live) {
      if (element.moved) {
        modules.layout.commit(element, parent);
        modules.layout.change(element, element.previous);
      }
    } else {
      for (const value of componentsOf(element, parent)) ecs.add(element.entity, value);

      modules.layout.commit(element, parent);
      element.live = true;
    }

    element.moved = false;

    for (const child of element.children) {
      const childElement = lookup(child);

      if (childElement !== undefined) applyRects(childElement);
    }
  }

  /**
   * Plays the enter hook of an element whose spawn has just been applied. The world calls it from
   * the `Box` hook, at the flush of phase `layout`, so the entity carries every component and the
   * first `sync` has not run: the element is never drawn at its rest pose by mistake.
   *
   * @param entity - The entity the `Box` was attached to.
   */
  function playEnter(entity: Entity): void {
    const element = state.elements.get(entity);

    if (element === undefined || element.entered) return;

    element.entered = true;
    modules.layout.enter(element);
  }

  /**
   * Reconciles one root from the node its `Tree` carries.
   *
   * @param root - The root to reconcile.
   */
  function reconcileRoot(root: Root): void {
    const identity = String(root.entity);

    root.element = diffNode(root, undefined, root.tree, 0, identity);
  }

  /**
   * The live scroll containers, which the frame step moves with the finger.
   *
   * @returns Every element whose tag is `scroll`.
   */
  function scrollContainers(): Element[] {
    const containers: Element[] = [];

    for (const element of state.elements.values()) {
      if (element.type === "scroll" && element.live) containers.push(element);
    }

    return containers;
  }

  /**
   * Collects the roots that have work this frame: a changed tree, a dirty instance or style, and
   * every root when the viewport changed.
   *
   * @param viewportChanged - Whether the viewport moved since the last frame.
   * @returns The roots to reconcile, in mount order.
   */
  function dirtyRoots(viewportChanged: boolean): Root[] {
    const changed = entitySet(ecs.changed(WORLD_TREE));

    return [...state.roots.values()].filter(root => {
      if (state.removing.has(root.entity)) return false;
      if (viewportChanged) {
        root.needsSolve = true;

        return true;
      }

      return root.dirty || changed.has(root.entity);
    });
  }

  /**
   * The first of the two systems of phase `layout`: the sweep, the viewport, the dirty roots and
   * the scroll offsets.
   */
  function reconcile(): void {
    sweep();
    state.reconciles += 1;

    const viewportChanged = modules.styles.useViewport(ctx.deps.renderer.viewport.size());

    for (const root of dirtyRoots(viewportChanged)) {
      const tree = ecs.get(root.entity, WORLD_TREE);
      const place = ctx.deps.world.projection.keyOf(root.entity);

      if (place !== undefined) root.name = place.projection;

      if (tree !== undefined) root.tree = tree.node as DescriptionNode;

      root.dirty = false;

      if (!modules.layout.loaded()) {
        root.dirty = true;

        continue;
      }

      try {
        reconcileRoot(root);
      } catch (error) {
        ctx.log.error("ui:root-failed", { root: root.name }, asError(error));
      }
    }

    modules.layout.scroll(scrollContainers(), lookup);
    writeCounters();
  }

  /**
   * Copies the counters of the two modules into the resource the acceptance tests read.
   */
  function writeCounters(): void {
    const counters = ecs.resource(UiCounters);
    const { nodes, measured, solves } = modules.layout.counters();

    counters.nodes = nodes;
    counters.measured = measured;
    counters.solves = solves;
    counters.reconciles = state.reconciles;
  }

  /**
   * The second system of phase `layout`: one solve per marked root, then the rects, the rest
   * poses and the hooks.
   */
  function solve(): void {
    const viewport = modules.styles.viewport();
    const size: Rect = { x: 0, y: 0, w: viewport?.width ?? 0, h: viewport?.height ?? 0 };
    let changed = false;

    for (const root of state.roots.values()) {
      const element = root.element === undefined ? undefined : lookup(root.element);

      if (!root.needsSolve || element === undefined) continue;

      modules.layout.solve(element, size, lookup);
      root.needsSolve = false;
      applyRects(element);
      changed = true;
    }

    if (changed) ctx.deps.time.wake();

    writeCounters();
  }

  /**
   * Records a root: a projection view that returned a tree, or a popup this plugin spawned. The
   * `Tree` hook and the popup handler both call it, in either order, so a second call fills in
   * what the first one could not know.
   *
   * @param entity - The entity that carries `Tree`.
   * @param name - The projection name, or the component name of a popup.
   * @param layer - The layer it draws in.
   * @param popup - What to call when a popup root is gone.
   * @param popup.close - Resolves the promise of the popup handler.
   */
  function mountRoot(
    entity: Entity,
    name: string,
    layer: string,
    popup?: { close: () => void }
  ): void {
    const known = state.roots.get(entity);

    if (known !== undefined) {
      known.order = ecs.get(entity, Order)?.value ?? known.order;

      if (popup !== undefined) {
        known.popup = popup;
        known.name = name;
      }

      return;
    }

    const tree = ecs.get(entity, WORLD_TREE);

    state.roots.set(entity, {
      entity,
      name,
      order: ecs.get(entity, Order)?.value ?? 0,
      tree: (tree?.node ?? { type: "screen", props: {}, children: [] }) as DescriptionNode,
      layer,
      dirty: true,
      needsSolve: true,
      element: undefined,
      popup
    });
  }

  /**
   * Starts the teardown of a root: every element exits with its motion, then the sweep frees the
   * nodes and despawns the root entity.
   *
   * @param entity - The root entity.
   */
  function unmountRoot(entity: Entity): void {
    const root = state.roots.get(entity);

    if (root === undefined || state.removing.has(entity)) return;

    const element = root.element === undefined ? undefined : lookup(root.element);

    state.removing.add(entity);

    if (element !== undefined) exitElement(element);

    ctx.deps.time.wake();
  }

  /**
   * Marks the style of one element dirty, which is what a press and a release do.
   *
   * @param entity - The element entity.
   * @param pressed - Whether the pointer is on it now.
   */
  function markPressed(entity: Entity, pressed: boolean): void {
    const element = state.elements.get(entity);

    if (element === undefined) return;

    element.is = { ...element.is, pressed };

    const style = modules.styles.resolveElement(styleOf(element.node), element.is);
    const root = state.roots.get(element.root);

    if (modules.layout.affectsRect(element.style, style)) {
      element.style = style;
      modules.layout.applyStyle(element);

      if (root !== undefined) root.needsSolve = true;
    } else element.style = style;

    if (root !== undefined) root.dirty = true;

    writeLive(element);
  }

  return { reconcile, solve, mountRoot, unmountRoot, markPressed, playEnter, sweep };
}
