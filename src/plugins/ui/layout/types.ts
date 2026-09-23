/**
 * @file ui/layout — type definitions: the Yoga handles the module keeps, its state and the shape
 * it is injected into `jsx` with.
 */
import type { Yoga, Node as YogaNode } from "yoga-layout/load";
import type { FxHandler } from "../../flow/fx/types";
import type { Entity } from "../../world/types";
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
 * layout module state. `nodes` is attach minus detach: Yoga 3.2.1 has no instance counter.
 */
export type LayoutState = {
  yoga: Yoga | undefined;
  byEntity: Map<Entity, YogaNode>;
  nodes: number;
  measured: number;
  solves: number;
  scrolling: Entity | undefined;
  scrollStart: { pointerY: number; offset: number };
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
  affectsRect(first: ResolvedStyle, second: ResolvedStyle): boolean;
  place(parent: Element, children: readonly Element[]): void;
  free(element: Element): void;
  solve(rootElement: Element, size: Rect, lookup: ElementLookup): boolean;
  commit(element: Element, parent: Rect | undefined): void;
  enter(element: Element): void;
  loop(element: Element): void;
  change(element: Element, previous: Rect): boolean;
  repose(element: Element, parent: Rect | undefined, hooked: boolean): void;
  exit(element: Element): void;
  settled(element: Element): boolean;
  scroll(containers: readonly Element[], lookup: ElementLookup): void;
  popupHandler(jsx: JsxModule): FxHandler;
  guideHandler(): FxHandler;
  counters(): { nodes: number; measured: number; solves: number };
};
