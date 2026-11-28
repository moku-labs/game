/**
 * @file ui/layout — type definitions: the Yoga handles the module keeps, its state and the shape
 * it is injected into `jsx` with.
 */
import type { Align, Justify, Overflow, Yoga, Node as YogaNode } from "yoga-layout/load";
import type { FxHandler } from "../../flow/fx/types";
import type { Hint } from "../../flow/types";
import type { Message } from "../../i18n/types";
import type { TransformValue } from "../../renderer/components";
import type { AxisPose } from "../../renderer/sync/types";
import type { FormattedNumber, Size } from "../../text/types";
import type { Time } from "../../time/types";
import type { AnchorTarget, Motion, ViewHandle } from "../../world/projection/types";
import type { Ease, Entity, MotionCause, ReducedMotion } from "../../world/types";
import type { Element, JsxModule } from "../jsx/types";
import type { ResolvedStyle } from "../styles/types";

/**
 * A rectangle in root coordinates, in reference units.
 *
 * @example
 * ```ts
 * const rect: Rect = { x: 0, y: 0, w: 1080, h: 1920 };
 * ```
 */
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * The rows of a windowed scroll that exist: the first and the last index; `last` is `first - 1`
 * for an empty list.
 *
 * @example
 * ```ts
 * const range: RowRange = { first: 27, last: 50 };
 * ```
 */
export type RowRange = { first: number; last: number };

/**
 * How the solve finds the element of a child entity. The records live in the `jsx` state, so the
 * walk is handed a reader instead of reaching across the module border.
 *
 * @example
 * ```ts
 * const lookup: ElementLookup = entity => elements.get(entity);
 * ```
 */
export type ElementLookup = (entity: Entity) => Element | undefined;

/**
 * What a text element is measured through: the advance table of `text`, at the width Yoga offers
 * for a style that wraps at its box (`undefined` when the width is not bounded); the `Text.content`
 * of an entity, which a system may write outside the projection, the string `text` resolved for it
 * and its `Text.style` (each `undefined` before the entity carries its `Text`); what a format of
 * the game answers, for a bound text before its first resolve; and the duration words of `i18n`,
 * for a bound `"duration"` before its first resolve.
 */
export type TextSource = {
  measure(content: string | Message, style: string, width?: number): Size;
  content(entity: Entity): string | Message | undefined;
  resolved(entity: Entity): string | undefined;
  style(entity: Entity): string | undefined;
  formatted(name: string, value: number): FormattedNumber | undefined;
  duration(ms: number): string;
};

/**
 * The patches the scroll step writes with, one object each, filled in place: a frame builds none.
 * Every number in them is a whole reference unit. `Scrollable` has two: `scrollable` when only
 * `moving` changed, `scrollLock` when `locked` did, so a scroll never locked keeps a `Scrollable`
 * with no `locked` field.
 */
export type ScrollPatches = {
  scroll: { offset: number; min: number };
  state: { offset: number; max: number; moving: boolean };
  scrollable: { moving: boolean };
  scrollLock: { moving: boolean; locked: boolean };
  x: { x: number };
  y: { y: number };
};

/**
 * The guide `ui` shows: its targets and padding, the veil it spawned, and the rects it writes in
 * place every frame. `window` is the object `input` keeps as the lock while a target is shown.
 */
export type Guide = {
  /** The targets the window is cut over; empty for a guide with no target: a full veil. */
  targets: readonly AnchorTarget[];
  /** How far the window grows outward on every side, in screen reference units. */
  pad: number;
  /** The rectangles of the veil, in the order of `rects`; none for `veil: false`. */
  veils: Entity[];
  /** One rect per rectangle of the veil: one for a guide with no target, four around a window. */
  rects: readonly Rect[];
  /** The union of the shown targets, padded: the window of the veil and of the lock. */
  window: Rect;
  /** The viewport, read every frame. */
  screen: Rect;
  /** What the resolver writes on its way: one target's rect and its pose. */
  scratch: { part: Rect; pose: AxisPose };
  /** What `input` locks now: the window, every press, or nothing yet. */
  locked: "window" | "all" | "none";
  /** Whether a target was shown at the last placement. */
  found: boolean;
  /**
   * Frames of the pass the window taken over from the guide this one replaced is kept while no
   * target is shown; 0 when nothing was taken over, or once a target showed.
   */
  grace: number;
  /** Frames in a row a key of the guide named no entity; counted in a dev build. */
  missing: number;
  /** True once a dev build named a key that named no entity. */
  warned: boolean;
  /** True once the guide ended: its veil left. */
  ended: boolean;
  /** The frame the guide ended in; -1 while it stands. */
  endedAt: number;
};

/**
 * The Yoga-level values last written onto one node, one slot a scalar (an enum, a flex factor, the
 * aspect ratio) and two a length (its kind, then its number; `NaN` for unset). `apply.ts` owns the
 * slot order.
 */
export type KeptStyle = Float64Array;

/** A record written in place per component name, with the names of its fields in order (F244 В). */
export type KeptFields = { names: string[]; record: Record<string, unknown> };

/**
 * What a style write reads for one loaded Yoga module, built once: the module, the enum of every
 * word a style names, the kept record of a node Yoga just made (its scalars read from a fresh node's
 * getters, its lengths unset), and the record a write stages its numbers in.
 */
export type StyleTables = {
  yoga: Yoga;
  justify: Readonly<Record<NonNullable<ResolvedStyle["justify"]>, Justify>>;
  align: Readonly<Record<NonNullable<ResolvedStyle["align"]>, Align>>;
  alignSelf: Readonly<Record<NonNullable<ResolvedStyle["alignSelf"]>, Align>>;
  overflow: Readonly<Record<NonNullable<ResolvedStyle["overflow"]>, Overflow>>;
  fresh: KeptStyle;
  /** The numbers of the write in hand, in the slot order of a kept record; written in place. */
  staged: KeptStyle;
};

/**
 * layout module state. `nodes` is attach minus detach: Yoga 3.2.1 has no instance counter.
 * `scrolling` is the scroll the finger holds; `scrollClock` the ms the scroll step has run, the
 * clock of the samples; `scrollRing` the last pointer samples of the press on its axis, a
 * position and a time each, `scrollHead` the slot the next one takes and `scrollSamples` how
 * many it holds; `scrollMoved` when the finger last moved.
 */
export type LayoutState = {
  yoga: Yoga | undefined;
  byEntity: Map<Entity, YogaNode>;
  /** The style tables of the loaded module; none before Yoga loads. */
  tables: StyleTables | undefined;
  /** The values last written onto each node, from its creation to its free. */
  kept: Map<YogaNode, KeptStyle>;
  /**
   * The children each parent's node holds, in order, as `placeChildren` and `appendChildren` inserted them: the
   * handles of `byEntity`, so taking them out again asks Yoga for no child, whose answer is a new handle (F244 В).
   */
  placed: Map<YogaNode, YogaNode[]>;
  /** The parent's node each placed child's node sits in, for `detachNode`. */
  parents: Map<YogaNode, YogaNode>;
  /** The element whose measure function each node holds; a node that measures nothing is not in it. */
  measuring: Map<YogaNode, Element>;
  /** Freed nodes put aside for the next elements, out of every parent, with no children and no measure (hp-2ab). */
  spare: YogaNode[];
  /** The kept record of each node of `spare`, at the same index. */
  spareKept: KeptStyle[];
  /** The patches a live element's write is handed, per component name, written in place (`keptLivePatch`). */
  livePatches: Map<string, KeptFields>;
  /** The rest values a recorded rest is handed, per component name, written in place (`keptRestValue`). */
  restValues: Map<string, KeptFields>;
  nodes: number;
  measured: number;
  solves: number;
  /** The frames of the solve's walk by depth, written in place: where a parent sits and its content box (F244). */
  frames: { origin: { x: number; y: number }; content: Rect }[];
  /** How far the parent at each depth of the solve's walk moved, x then y, written in place (F244). */
  steps: Float64Array[];
  /** The rest pose a repose compares before it builds one, written in place (F244). */
  pose: TransformValue & { scaleX: number; scaleY: number };
  scrolling: Entity | undefined;
  scrollClock: number;
  scrollRing: Float64Array;
  scrollHead: number;
  scrollSamples: number;
  scrollMoved: number;
  scrollPatches: ScrollPatches;
  /** One line of the `body` style as the icons were last measured with it; none before that. */
  iconLine: number | undefined;
  order: number;
  cleanups: Array<() => void>;
  /** The guide on screen, placed every frame by the system `ui.guide`; none while no guide stands. */
  guide: Guide | undefined;
  /** The last guide that ended: one that follows in its frame with the same targets takes its window. */
  lastGuide: Guide | undefined;
};

/**
 * layout module shape, injected into `jsx`. Nothing here is public.
 */
export type LayoutModule = {
  load(): Promise<void>;
  loaded(): boolean;
  attach(element: Element): void;
  applyStyle(element: Element): void;
  remeasure(element: Element): boolean;
  /** Tells, once, that the line the icons without a size are squared on moved. */
  iconLineMoved(): boolean;
  markMeasured(element: Element): void;
  affectsRect(first: ResolvedStyle, second: ResolvedStyle): boolean;
  place(parent: Element, children: readonly Element[]): void;
  /** Puts new children after the ones the parent's node holds, without touching those. */
  append(parent: Element, children: readonly Element[]): void;
  free(element: Element): void;
  solve(rootElement: Element, size: Rect, lookup: ElementLookup): boolean;
  /**
   * The content box of an element in its own units: a JSX root laid out in it as a slot is solved
   * there. One box the module writes in place: valid until the next call, copied by a caller that
   * keeps it.
   */
  contentRect(element: Element): Rect;
  commit(element: Element, parent: Rect | undefined): void;
  /**
   * Plays the enter hook, unless its play at the `Box` stands, and starts the loop; `span` notes the longest finite
   * track the hook started.
   */
  enter(element: Element, span?: MotionSpan): void;
  /**
   * Plays the enter hook at the element's `Box`, so the game's systems of `sync` see its start pose (F49); `enter`
   * keeps the play, or plays the hook again when a system changed what it read (F48).
   */
  pose(element: Element, span?: MotionSpan): void;
  loop(element: Element): void;
  change(element: Element, previous: Rect, hint?: Hint): boolean;
  /**
   * Plays the `change` hook of an extra or of the visual by its component name, after the motion
   * the last change of that name started was cancelled; true when the hook returned a motion.
   */
  changeExtra(
    element: Element,
    name: string,
    values: { previous: object; next: object },
    hint: Hint | undefined
  ): boolean;
  repose(element: Element, parent: Rect | undefined, hooked: boolean, hint?: Hint): void;
  lift(element: Element, units: number): void;
  /** Brings an element a drag let go home: its `settle` hook, else a `toRest` of its `Transform` (F166). */
  settleHome(element: Element): void;
  /**
   * Starts the exit, telling the hook why the element leaves; `span` notes the longest finite track the exit hook
   * started; `stands` plays no hook: the element goes with the exit over it.
   */
  exit(element: Element, cause: MotionCause, span?: MotionSpan, stands?: boolean): void;
  /** Plays a hook on the element's handle and keeps its motion with the element's handles (the level of an overlay). */
  playTrack(element: Element, hook: (view: ViewHandle<unknown>) => Motion): void;
  settled(element: Element): boolean;
  /** Moves every scroll by the frame: the finger, a fling or a glide. */
  scroll(containers: readonly Element[], lookup: ElementLookup, time: Readonly<Time>): void;
  /**
   * After a solve or a render: the first place of a new scroll, a new range, a new `offset` prop.
   * A scroll `stands` answers true for is not on the screen yet: it stands at its prop, no glide.
   */
  settleScroll(
    containers: readonly Element[],
    lookup: ElementLookup,
    time: Readonly<Time>,
    stands?: (container: Element) => boolean
  ): void;
  clampScroll(container: Element, contentHeight: number, lookup: ElementLookup): number;
  /** Puts a live scroll at an offset at once; false when it has not been placed yet. */
  scrollTo(container: Element, to: number, lookup: ElementLookup): boolean;
  /** The stops a `snap` prop names as a release uses them: numbers as a release uses them, each kept inside 0 to `max` (`Infinity` reads as `max`), in prop order, `NaN` and non-numbers left out; none when no stop remains. */
  stopsOf(snap: unknown, max: number): number[] | undefined;
  windowOf(
    offset: number,
    viewportHeight: number,
    rows: number,
    rowHeight: number,
    overscan: number
  ): RowRange;
  popupHandler(jsx: JsxModule): FxHandler;
  guideHandler(): FxHandler;
  counters(): { nodes: number; measured: number; solves: number };
};

/**
 * The longest finite track a motion hook started through its view handle: where it ends (delay included), its length,
 * delay, ease and reduced-motion rule. The level of an overlay follows the root's own enter and exit motion by it
 * (spec 22, LEAD-FIXES-4 item 5a); `end` 0 means the hook started no timed track.
 *
 * @example
 * ```ts
 * // A sheet that fades in over 250 ms after 40 ms.
 * const span: MotionSpan = { end: 290, ms: 250, delayMs: 40, ease: "out", reduced: undefined };
 * ```
 */
export type MotionSpan = {
  end: number;
  ms: number;
  delayMs: number;
  ease: Ease | undefined;
  reduced: ReducedMotion | undefined;
};
