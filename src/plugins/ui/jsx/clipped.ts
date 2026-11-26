/**
 * @file ui/jsx — a new subtree wholly behind its clip, built in parts inside a live root (spec 33, slice G). A new
 * `position: "absolute"` element of at least 32 description nodes whose span on one axis, known from its own style
 * and its parent's extent there, lies wholly outside its nearest `overflow: "hidden"` ancestor enters alone: its
 * children wait in a queue and are made over the next frames, at most 48 a frame and while 4 ms of the page clock
 * last. The parts are laid out and applied by the root's live solve, under the clip, which keeps them unseen and the
 * hit test keeps them untouchable; their enters wait. The build finishes in one block in the first frame the
 * subtree meets its clip in phase `layout`, before the root's next diff, and its held enters play there. With no
 * build open every check is a field read. Only with a renderer that draws: a headless app mounts whole, as before.
 */
import type { AxisPose } from "../../renderer/sync/types";
import type { Entity } from "../../world/types";
import { drawnPoseInto, readerOf } from "../drawn";
import { asError } from "../errors";
import type { Rect } from "../layout/types";
import type { ResolvedStyle } from "../styles/types";
import type { UiCtx } from "../types";
import { ANCHOR, CONTENT } from "../visual";
import type { DescriptionNode, Element, Parked, Root } from "./types";

/** The fewest description nodes under a new element that make its build in parts worth a queue. */
const PART_MIN = 32;

/** The page-clock milliseconds the parts of a frame may take. */
const LIVE_PART_MS = 4;

/**
 * The most elements the parts of a frame make. Their solve, their application, the flush of the components it adds
 * and the renderer's views for them come later in the frame, where the clock of the parts does not see them.
 */
const LIVE_PART_CAP = 48;

/** How many elements are made between two reads of the page clock. */
const CLOCK_EVERY = 8;

/** How deep the walk up to the clip goes; deeper is treated as no clip. */
const MAX_DEPTH = 64;

/** What a part holds once it is back in the pool: no nodes and no element, so the pool keeps no tree alive. */
const NO_NODES: readonly DescriptionNode[] = [];

/** The axis a subtree is wholly outside its clip on. */
type ClipAxis = "x" | "y";

/**
 * One open build: the root, the top of the subtree (entered, its children parked), its clip, the axis it was found
 * outside on, the parts that wait in the order they were parked, and whether a dev build named it already.
 */
type ClipBuild = {
  root: Root;
  top: Element;
  clip: Element;
  axis: ClipAxis;
  parts: Parked[];
  warned: boolean;
};

/** What the build borrows from the reconcile: the making of children, whether a range moves, the release of enters. */
export type ClipReconcile = {
  /** Makes the children of a new element from the node at `from` on, after the ones made before. */
  enterChildren(
    root: Root,
    parent: Element,
    nodes: readonly DescriptionNode[],
    instance: string | undefined,
    from: number
  ): void;
  /** True while the range step diffs a windowed list. */
  isMoving(): boolean;
  /** Releases the held enters: the solve of this frame poses them, `ui.enter` plays them. */
  released(): void;
};

/**
 * Creates the list of one build's parts. Its own function, because lint rule L5 refuses a collection built inside an
 * exported declaration.
 *
 * @returns An empty list.
 */
function partList(): Parked[] {
  return [];
}

/**
 * Tells whether a style moves or scales an element in a way its span does not follow: a margin, a turn, a scale or a
 * fit.
 *
 * @param style - The resolved style of the element.
 * @returns True when the span of its offsets and size is not where it is drawn.
 */
function reshaped(style: ResolvedStyle): boolean {
  return (
    style.margin !== undefined ||
    style.rotation !== undefined ||
    style.scale !== undefined ||
    style.scaleX !== undefined ||
    style.scaleY !== undefined ||
    style.fit !== undefined
  );
}

/**
 * Builds the half of the reconcile that builds a clipped-out subtree in parts: the trigger of `enter`, the queues and
 * their pools, the meet test, the drain, the finish and the forget.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param reconcile - What the reconcile lends.
 * @returns The steps the reconcile calls.
 */
export function createClipped(ctx: UiCtx, reconcile: ClipReconcile) {
  const state = ctx.state.jsx;
  const reader = readerOf(ctx);
  const lookup = (entity: Entity): Element | undefined => state.elements.get(entity);
  // The open builds in the order they opened, the parts that wait over all of them, and the pools.
  const builds: ClipBuild[] = [];
  const partPool: Parked[] = [];
  const listPool: Parked[][] = [];
  let queued = 0;
  // The build whose part is being made: its new elements are marked and their children may park. While a build
  // finishes, no element opens another.
  let making: ClipBuild | undefined;
  let finishing = false;
  // The parts of this frame: the elements made, whether the clock was read spent, the nodes the count reached. The
  // moment the frame's parts began, and the spans the meet test writes, live in typed arrays: a fractional number in a
  // closure would be a new heap number at every write.
  let entered = 0;
  let spent = false;
  let counted = 0;
  const began = new Float64Array(1);
  const span = new Float64Array(4);
  const pose: AxisPose = {
    x: 0,
    y: 0,
    rotation: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    pivot: { x: 0, y: 0 }
  };

  /**
   * Counts the nodes under a description node, a component counted as one and not expanded, until `PART_MIN`.
   *
   * @param nodes - The children of a node.
   */
  function countUnder(nodes: readonly DescriptionNode[]): void {
    for (let index = 0; index < nodes.length && counted < PART_MIN; index += 1) {
      const child = nodes[index];

      if (child === undefined) continue;

      counted += 1;
      if (!state.components.has(child.type)) countUnder(child.children);
    }
  }

  /**
   * Tells whether a new element has enough below it for a build in parts.
   *
   * @param nodes - Its children.
   * @returns True with at least `PART_MIN` description nodes under it.
   */
  function holdsMany(nodes: readonly DescriptionNode[]): boolean {
    counted = 0;
    countUnder(nodes);

    return counted >= PART_MIN;
  }

  /**
   * The nearest `overflow: "hidden"` ancestor of a new element, laid out by an earlier solve: none when a scroll is
   * anywhere above it, as the scroll step moves the clip with the finger.
   *
   * @param parent - The parent of the new element.
   * @returns The clip, or `undefined`.
   */
  function clipOf(parent: Element): Element | undefined {
    let clip: Element | undefined;
    let current: Element | undefined = parent;

    for (let depth = 0; depth < MAX_DEPTH && current !== undefined; depth += 1) {
      if (current.type === "scroll" || current.style.overflow === "scroll") return undefined;
      if (clip === undefined && current.style.overflow === "hidden") clip = current;

      current = current.parent === undefined ? undefined : lookup(current.parent);
    }

    return clip?.live === true ? clip : undefined;
  }

  /**
   * Writes where a box `0 … w` (or `0 … h`) of an entity's own units lies in root space on one axis, through the
   * pose `drawnPoseInto` wrote last, the lower end first.
   *
   * @param axis - The axis.
   * @param rect - The box, by its size.
   * @param at - Where in the spans the two ends go.
   */
  function boxSpan(axis: ClipAxis, rect: Readonly<Rect>, at: number): void {
    span[at] = 0;
    span[at + 1] = axis === "x" ? rect.w : rect.h;
    mapSpan(axis, at);
  }

  /**
   * Moves a span of an entity's own units into root space on one axis, in place, through the pose `drawnPoseInto`
   * wrote last: scaled around its pivot, the lower end first.
   *
   * @param axis - The axis.
   * @param at - Where in the spans the two ends are.
   */
  function mapSpan(axis: ClipAxis, at: number): void {
    const factor = pose.scale * (axis === "x" ? pose.scaleX : pose.scaleY);
    const origin = axis === "x" ? pose.x : pose.y;
    const pivot = axis === "x" ? pose.pivot.x : pose.pivot.y;
    const from = origin + factor * ((span[at] ?? 0) - pivot);
    const to = origin + factor * ((span[at + 1] ?? 0) - pivot);

    span[at] = Math.min(from, to);
    span[at + 1] = Math.max(from, to);
  }

  /**
   * Writes the span a new element takes in its parent on one axis, from its style: an offset and a size, or two
   * offsets, numbers both, the parent's extent for an offset from its far side.
   *
   * @param axis - The axis.
   * @param style - The element's resolved style.
   * @param parent - The parent's rect, from an earlier solve.
   * @returns False when the style does not say where the element is on that axis.
   */
  function localSpan(axis: ClipAxis, style: ResolvedStyle, parent: Readonly<Rect>): boolean {
    const lead = axis === "x" ? style.left : style.top;
    const trail = axis === "x" ? style.right : style.bottom;
    const size = axis === "x" ? style.width : style.height;
    const extent = axis === "x" ? parent.w : parent.h;
    const offset = (axis === "x" ? style.offsetX : style.offsetY) ?? 0;

    if (typeof size === "number" && lead !== undefined) {
      span[2] = lead + offset;
      span[3] = lead + size + offset;
    } else if (typeof size === "number" && trail !== undefined) {
      span[2] = extent - trail - size + offset;
      span[3] = extent - trail + offset;
    } else if (lead !== undefined && trail !== undefined) {
      span[2] = lead + offset;
      span[3] = extent - trail + offset;
    } else {
      return false;
    }

    return true;
  }

  /**
   * Tells whether a new element lies wholly outside its clip on one axis, as it would be drawn now: its span from its
   * style, through its parent's drawn pose, against the clip's drawn box.
   *
   * @param axis - The axis.
   * @param parent - Its parent, laid out by an earlier solve.
   * @param element - The new element.
   * @param clip - Its clip.
   * @returns True when the two spans do not overlap.
   */
  function outsideOn(axis: ClipAxis, parent: Element, element: Element, clip: Element): boolean {
    if (!localSpan(axis, element.style, parent.rect)) return false;
    if (!drawnPoseInto(reader, parent.entity, pose) || pose.rotation !== 0) return false;

    mapSpan(axis, 2);

    if (!drawnPoseInto(reader, clip.entity, pose) || pose.rotation !== 0) return false;

    boxSpan(axis, clip.rect, 0);

    return (span[3] ?? 0) <= (span[0] ?? 0) || (span[2] ?? 0) >= (span[1] ?? 0);
  }

  /**
   * Tells whether the top of an open build meets its clip as it is drawn now, on the axis it was found outside on. A
   * turned pose is taken as a meet: its span is not known.
   *
   * @param build - The open build.
   * @returns True when its top overlaps its clip.
   */
  function meets(build: ClipBuild): boolean {
    const { top, clip, axis } = build;

    if (!top.live) return false;
    if (!drawnPoseInto(reader, clip.entity, pose) || pose.rotation !== 0) return true;

    boxSpan(axis, clip.rect, 0);

    if (!drawnPoseInto(reader, top.entity, pose) || pose.rotation !== 0) return true;

    boxSpan(axis, top.rect, 2);

    return (span[3] ?? 0) > (span[0] ?? 0) && (span[2] ?? 0) < (span[1] ?? 0);
  }

  /**
   * Tells whether the top or the clip of a build left: despawned, dropped, or on its way out (its identity forgotten).
   *
   * @param build - The open build.
   * @returns True when the build has nothing to finish.
   */
  function gone(build: ClipBuild): boolean {
    const top = build.top;

    return (
      lookup(top.entity) !== top ||
      state.byIdentity.get(top.identity) !== top.entity ||
      lookup(build.clip.entity) !== build.clip
    );
  }

  /**
   * Counts an element made by a part of this frame; at every 8th the clock is read.
   */
  function count(): void {
    entered += 1;

    if (!spent && entered % CLOCK_EVERY === 0) {
      // The page clock: the parts' budget is real time, whatever the game's time scale.
      spent = globalThis.performance.now() - (began[0] ?? 0) >= LIVE_PART_MS;
    }
  }

  /**
   * Tells whether the parts of this frame are over: the clock was read spent, or the cap is reached.
   *
   * @returns True when the next element waits for a later frame.
   */
  function over(): boolean {
    return spent || entered >= LIVE_PART_CAP;
  }

  /**
   * Queues the children of an element of a build, from the node at `from` on, behind the build's other parts, with
   * the cause of the diff running now, and asks for a frame.
   *
   * @param build - The open build.
   * @param element - The element whose children wait.
   * @param nodes - Its children.
   * @param instance - The identity of the nearest component instance.
   * @param from - The first node that waits.
   */
  function queue(
    build: ClipBuild,
    element: Element,
    nodes: readonly DescriptionNode[],
    instance: string | undefined,
    from: number
  ): void {
    const cause = state.building;
    const part = partPool.pop() ?? { element, nodes, instance, cause, from };

    part.element = element;
    part.nodes = nodes;
    part.instance = instance;
    part.cause = cause;
    part.from = from;
    build.parts.push(part);
    queued += 1;
    ctx.deps.time.wake();
  }

  /**
   * Puts a part back in the pool, its element and nodes dropped.
   *
   * @param part - A part made or forgotten.
   */
  function recycle(part: Parked): void {
    part.element = undefined;
    part.nodes = NO_NODES;
    partPool.push(part);
  }

  /**
   * Opens a build for a new element whose children wait: the element is marked, its children are its first part.
   *
   * @param root - The live root.
   * @param element - The new element, entered.
   * @param clip - Its clip.
   * @param axis - The axis it is outside on.
   * @param nodes - Its children.
   * @param instance - The identity of the nearest component instance.
   */
  function open(
    root: Root,
    element: Element,
    clip: Element,
    axis: ClipAxis,
    nodes: readonly DescriptionNode[],
    instance: string | undefined
  ): void {
    const build: ClipBuild = {
      root,
      top: element,
      clip,
      axis,
      parts: listPool.pop() ?? partList(),
      warned: false
    };

    builds.push(build);
    element.clipped = true;
    queue(build, element, nodes, instance, 0);
  }

  /**
   * Tells whether a new element of a live root opens a build: the renderer draws, it is out of flow and not a scroll
   * or an anchor, it holds at least `PART_MIN` nodes, no windowed range is moving, and it lies wholly outside its clip
   * on an axis its style places it on.
   *
   * @param parent - Its parent.
   * @param element - The new element.
   * @param nodes - Its children.
   * @returns The axis it is outside on, with the clip found, or `undefined`.
   */
  function triggerOf(
    parent: Element | undefined,
    element: Element,
    nodes: readonly DescriptionNode[]
  ): { clip: Element; axis: ClipAxis } | undefined {
    // The gate: `ui`'s start read whether the renderer draws, as for the part of a scene build. A headless app (a test,
    // the CLI) mounts whole, so a test that commits and reads the tree in one frame sees it all. The world runs phase
    // `layout` only while it is live (world/ecs/systems.ts, `runPhase`): a fast or paused world reconciles nothing,
    // so no mode is read here.
    if (!state.draws || finishing || element.style.position !== "absolute" || nodes.length === 0) {
      return undefined;
    }

    if (parent?.live !== true || element.type === "scroll" || element.type === ANCHOR)
      return undefined;
    if (element.type === CONTENT || reconcile.isMoving() || reshaped(element.style))
      return undefined;
    if (parent.style.padding !== undefined || !holdsMany(nodes)) return undefined;

    const clip = clipOf(parent);

    if (clip === undefined) return undefined;
    if (outsideOn("x", parent, element, clip)) return { clip, axis: "x" };
    if (outsideOn("y", parent, element, clip)) return { clip, axis: "y" };

    return undefined;
  }

  /**
   * Makes the children of a new element of a live root, or leaves them for a later frame: the element of a part in
   * work is marked and its children wait once the frame's parts are over; a new element wholly behind its clip opens
   * a build. Anything else is left to the caller, which diffs the children at once.
   *
   * @param root - The live root.
   * @param parent - The parent of the new element.
   * @param element - The new element, entered.
   * @param nodes - Its children.
   * @param instance - The identity of the nearest component instance.
   * @returns True when the children were made or queued here.
   */
  function takes(
    root: Root,
    parent: Element | undefined,
    element: Element,
    nodes: readonly DescriptionNode[],
    instance: string | undefined
  ): boolean {
    if (making !== undefined) {
      element.clipped = true;
      count();

      if (nodes.length > 0 && over()) queue(making, element, nodes, instance, 0);
      else reconcile.enterChildren(root, element, nodes, instance, 0);

      return true;
    }

    const trigger = triggerOf(parent, element, nodes);

    if (trigger === undefined) return false;

    open(root, element, trigger.clip, trigger.axis, nodes, instance);

    return true;
  }

  /**
   * Tells whether the rest of a child list in work waits for a later frame: a part is being made and the frame's parts
   * are over.
   *
   * @returns True when the next child waits.
   */
  function stops(): boolean {
    return making !== undefined && over();
  }

  /**
   * Queues the rest of a child list of the part in work, from the node at `from` on.
   *
   * @param element - The element whose children are made.
   * @param nodes - Its children.
   * @param instance - The identity of the nearest component instance.
   * @param from - The first node that waits.
   */
  function park(
    element: Element,
    nodes: readonly DescriptionNode[],
    instance: string | undefined,
    from: number
  ): void {
    if (making !== undefined) queue(making, element, nodes, instance, from);
  }

  /**
   * Makes one part, under the cause it was parked with: as a part of its build, or, while the build finishes, at once
   * and whole. A part whose element left is dropped. A part that throws fails its root alone, as the root's own diff
   * does.
   *
   * @param build - The build.
   * @param part - The part.
   * @param as - The build its new elements belong to, or nothing while it finishes.
   */
  function makePart(build: ClipBuild, part: Parked, as?: ClipBuild): void {
    const element = part.element;

    if (element === undefined || lookup(element.entity) !== element) return;

    const cause = state.building;
    const before = making;

    making = as;
    state.building = part.cause;

    try {
      reconcile.enterChildren(build.root, element, part.nodes, part.instance, part.from);
    } catch (error) {
      ctx.log.error("ui:root-failed", { root: build.root.name }, asError(error));
    } finally {
      state.building = cause;
      making = before;
    }

    build.root.needsSolve = true;
  }

  /**
   * Takes the marks off a finished subtree: from its top down, only through marked elements, as an element made at
   * the finish and everything under it carry none.
   *
   * @param element - The top, or a marked element under it.
   */
  function unmark(element: Element): void {
    if (element.clipped !== true) return;

    delete element.clipped;

    for (const child of element.children) {
      const childElement = lookup(child);

      if (childElement !== undefined) unmark(childElement);
    }
  }

  /**
   * Takes a build out of the open list, keeping the order of the others, and gives its list back to the pool, empty.
   *
   * @param index - Its place in the list.
   */
  function close(index: number): void {
    const build = builds[index];

    for (let at = index; at < builds.length - 1; at += 1) builds[at] = builds[at + 1] as ClipBuild;

    builds.pop();

    if (build === undefined) return;

    while (build.parts.length > 0) {
      const part = build.parts.pop();

      queued -= 1;
      if (part !== undefined) recycle(part);
    }

    listPool.push(build.parts);
  }

  /**
   * Finishes a build in one block: every part left is made now, whole, the marks come off, and the held enters are
   * released, so the solve of this frame lays the subtree out and applies it, its enters play in this frame's
   * `ui.enter`, and the frame draws it whole.
   *
   * @param index - The build's place in the open list.
   */
  function finishAt(index: number): void {
    const build = builds[index];

    if (build === undefined) return;

    finishing = true;

    try {
      while (build.parts.length > 0) {
        const part = build.parts.shift();

        if (part === undefined) break;

        queued -= 1;
        makePart(build, part);
        recycle(part);
      }
    } finally {
      finishing = false;
    }

    unmark(build.top);
    build.root.needsSolve = true;
    close(index);
    reconcile.released();
  }

  /**
   * The meet test of phase `layout`, after the scroll step: a build whose top left is forgotten, one whose top meets
   * its clip as it is drawn now finishes. A `Transform` the game wrote in `input` or `animate` is seen here.
   */
  function meet(): void {
    // Per frame: one length read while no build is open.
    for (let index = 0; index < builds.length; ) {
      const build = builds[index];

      if (build === undefined) break;

      if (gone(build)) close(index);
      else if (meets(build)) finishAt(index);
      else index += 1;
    }
  }

  /**
   * Makes the parts that wait, the oldest build first and each build's in the order they were parked, while 4 ms of
   * the page clock and the cap of 48 elements last; the first part of a frame always runs, so a build always moves.
   * Children that park again go to the end. While parts wait, every frame asks for the next.
   */
  function drain(): void {
    // Per frame: one number while no part waits.
    if (queued === 0) return;

    ctx.deps.time.wake();
    began[0] = globalThis.performance.now();
    entered = 0;
    spent = false;

    // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing, also cold.
    for (let index = 0; index < builds.length; index += 1) {
      const build = builds[index];

      if (build === undefined) continue;

      while (build.parts.length > 0) {
        if (entered > 0 && over()) return;

        const part = build.parts.shift();

        if (part === undefined) break;

        queued -= 1;
        makePart(build, part, build);
        recycle(part);
      }
    }
  }

  /**
   * Finishes the open builds of a root before its next diff, so the diff meets every element once. A build whose top
   * left is forgotten.
   *
   * @param root - A root about to be diffed.
   */
  function finishRoot(root: Root): void {
    // Per dirty root: one length read while no build is open.
    for (let index = 0; index < builds.length; ) {
      const build = builds[index];

      if (build === undefined) break;

      if (build.root !== root) index += 1;
      else if (gone(build)) close(index);
      else finishAt(index);
    }
  }

  /**
   * Forgets the open builds of a root whose tree goes: a drop, a discard, its exit or a restore. Their parts are not
   * made; the elements made so far go with the tree.
   *
   * @param root - The root.
   */
  function forgetRoot(root: Root): void {
    for (let index = 0; index < builds.length; ) {
      if (builds[index]?.root === root) close(index);
      else index += 1;
    }
  }

  /**
   * The check of a dev build in phase `sync`, before `ui.enter`: a build whose top meets its clip only now, after a
   * game system wrote a `Transform` late, is drawn half-built in this frame; it is named once, and finishes at the next
   * layout. A release build registers no such system.
   */
  function checkLate(): void {
    for (const build of builds) {
      if (build.warned || gone(build) || !meets(build)) continue;

      build.warned = true;
      ctx.log.warn("ui:clip-late", {
        key: build.top.key ?? build.top.identity,
        root: build.root.name
      });
    }
  }

  return { takes, stops, park, meet, drain, finishRoot, forgetRoot, checkLate };
}
