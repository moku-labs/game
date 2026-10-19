/**
 * @file ui/layout — type definitions: the Yoga handles the module keeps, its state and the shape
 * it is injected into `jsx` with.
 */
import type { Yoga, Node as YogaNode } from "yoga-layout/load";
import type { FxHandler } from "../../flow/fx/types";
import type { Hint } from "../../flow/types";
import type { Message } from "../../i18n/types";
import type { Size } from "../../text/types";
import type { Time } from "../../time/types";
import type { Motion, ViewHandle } from "../../world/projection/types";
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
 * What a text element is measured through: the advance table of `text`, the string `text`
 * resolved for an entity (`undefined` before the entity carries its `Text`), and the duration
 * words of `i18n`, for a bound `"duration"` before its first resolve.
 */
export type TextSource = {
  measure(content: string | Message, style: string): Size;
  resolved(entity: Entity): string | undefined;
  duration(ms: number): string;
};

/**
 * The patches the scroll step writes with, one object each, filled in place: a frame builds none.
 * Every number in them is a whole reference unit.
 */
export type ScrollPatches = {
  scroll: { offset: number; min: number };
  state: { offset: number; max: number; moving: boolean };
  scrollable: { moving: boolean };
  x: { x: number };
  y: { y: number };
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
  nodes: number;
  measured: number;
  solves: number;
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
  free(element: Element): void;
  solve(rootElement: Element, size: Rect, lookup: ElementLookup): boolean;
  /**
   * The content box of an element in its own units: a JSX root laid out in it as a slot is solved
   * there. One box the module writes in place: valid until the next call, copied by a caller that
   * keeps it.
   */
  contentRect(element: Element): Rect;
  commit(element: Element, parent: Rect | undefined): void;
  /** Plays the enter hook and starts the loop; `span` notes the longest finite track the hook started. */
  enter(element: Element, span?: MotionSpan): void;
  loop(element: Element): void;
  change(element: Element, previous: Rect, hint?: Hint): boolean;
  changeExtra(
    element: Element,
    name: string,
    values: { previous: object; next: object },
    hint: Hint | undefined
  ): boolean;
  repose(element: Element, parent: Rect | undefined, hooked: boolean, hint?: Hint): void;
  lift(element: Element, units: number): void;
  /** Starts the exit, telling the hook why the element leaves; `span` notes the longest finite track the exit hook started. */
  exit(element: Element, cause: MotionCause, span?: MotionSpan): void;
  /** Plays a hook on the element's handle and keeps its motion with the element's handles (the level of an overlay). */
  playTrack(element: Element, hook: (view: ViewHandle<unknown>) => Motion): void;
  settled(element: Element): boolean;
  /** Moves every scroll by the frame: the finger, a fling or a glide. */
  scroll(containers: readonly Element[], lookup: ElementLookup, time: Readonly<Time>): void;
  /** After a solve or a render: the first place of a new scroll, a new range, a new `offset` prop. */
  settleScroll(containers: readonly Element[], lookup: ElementLookup): void;
  clampScroll(container: Element, contentHeight: number, lookup: ElementLookup): number;
  /** Puts a live scroll at an offset at once; false when it has not been placed yet. */
  scrollTo(container: Element, to: number, lookup: ElementLookup): boolean;
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
