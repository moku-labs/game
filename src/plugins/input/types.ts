/**
 * @file input plugin — type definitions: the raw pointer queue, the gesture machine and the one
 * public API. `InputApi` is what a game, a test and an agent read.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as FlowApi } from "../flow/types";
import type { Api as RendererApi } from "../renderer/types";
import type { Api as TimeApi } from "../time/types";
import type { Entity } from "../world/ecs/types";
import type { Api as WorldApi } from "../world/types";

/**
 * A point in reference units, as `renderer.viewport.toReference` answers it.
 *
 * @example
 * ```ts
 * const point: Point = { x: 540, y: 960 };
 * ```
 */
export type Point = { x: number; y: number };

/**
 * The dominant axis of a swipe.
 *
 * @example
 * ```ts
 * const direction: Direction = "left";
 * ```
 */
export type Direction = "up" | "down" | "left" | "right";

/**
 * What `app.input.*` is pointed at: the projection key of a live view, or an entity. A key never
 * addresses a view in the despawn queue.
 *
 * @example
 * ```ts
 * const target: Target = { projection: "board.items", key: "i5" };
 * ```
 */
export type Target = { projection: string; key: string } | Entity;

/**
 * One pointer event as the DOM handlers queue it: no hit test, no reference units, no decision.
 *
 * @example
 * ```ts
 * const sample: RawSample = { kind: "down", pointerId: 1, clientX: 320, clientY: 640 };
 * ```
 */
export type RawSample = {
  kind: "down" | "move" | "up" | "cancel";
  pointerId: number;
  clientX: number;
  clientY: number;
};

/**
 * Where the one active pointer stands in the gesture machine.
 *
 * @example
 * ```ts
 * const phase: GesturePhase = "dragging";
 * ```
 */
export type GesturePhase = "idle" | "pressed" | "longPressed" | "dragging";

/**
 * input plugin config. Every distance is in reference px, every duration in milliseconds of
 * `time`, so a time scale and a pause apply to the gestures too.
 *
 * @example
 * ```ts
 * createApp({ plugins: [...screen], pluginConfigs: { input: { longPressMs: 300, swipeMinPx: 64 } } });
 * ```
 */
export type Config = {
  /** Largest move, in reference px, that still counts as a tap or a long press. */
  tapSlopPx: number;
  /** Hold time, in ms of `time`, after which a `Pressable` answers. */
  longPressMs: number;
  /** Move, in reference px, that turns a press on a `Draggable` into a drag. */
  dragStartPx: number;
  /** Shortest swipe, in reference px. */
  swipeMinPx: number;
  /** Longest swipe, in ms of `time`, from pointer down to pointer up. */
  swipeMaxMs: number;
};

/**
 * input plugin state: the raw queue the DOM handlers write, and the one gesture in progress.
 */
export type State = {
  /** Written by the DOM handlers, drained by the frame step. */
  samples: RawSample[];
  phase: GesturePhase;
  /** The one active pointer. A sample of any other pointer is dropped while this is set. */
  pointerId: number | undefined;
  /** The pressed or held entity. */
  entity: Entity | undefined;
  /** The projection key of `entity`, read once at press time. */
  key: { projection: string; key: string } | undefined;
  /** Reference px at pointer down. */
  start: Point;
  /** `Transform` minus the pointer at the moment of the grab. */
  grabOffset: Point;
  /** Sum of `time.delta` since pointer down. No device clock is ever read. */
  pressedMs: number;
  hovered: Entity | undefined;
  /** The remover `world.projection.mute` returned, while a drag runs. */
  unmute: (() => void) | undefined;
  canvas: HTMLCanvasElement | undefined;
  offFrame: (() => void) | undefined;
  detach: (() => void) | undefined;
};

/**
 * input plugin API, `app.input`: the same door for the finger, for a test and for an agent. Each
 * method builds the Answer the gesture would build and hands it to `flow.gate.answer`. Nothing
 * moves: no coordinates, no frames, no `Held`, no `settle`.
 *
 * @example
 * ```ts
 * // A headless test plays the board without a screen.
 * app.input.tap({ projection: "board.generators", key: "g1" }); // true: the generator spat an item
 * app.input.drag({ projection: "board.items", key: "i5" }, { projection: "board.items", key: "i7" });
 * ```
 */
export type InputApi = {
  /**
   * Reads the `Tappable` of a view and answers its intent.
   *
   * @param target - The projection key of a live view, or an entity.
   * @returns What `flow.gate.answer` returned: true when the gate took the answer.
   * @example
   * ```ts
   * // A hidden-object test finds one object without touching a pixel.
   * app.input.tap({ projection: "scene.objects", key: "lamp" });
   * // true: answers { intent: "found", payload: { id: "lamp" } }
   * ```
   */
  tap(target: Target): boolean;

  /**
   * Reads the `Pressable` of a view and answers its intent, the way a long press would.
   *
   * @param target - The projection key of a live view, or an entity.
   * @returns What `flow.gate.answer` returned: true when the gate took the answer.
   * @example
   * ```ts
   * // An agent opens the info card of an item without holding a finger for 450 ms.
   * app.input.press({ projection: "board.items", key: "i5" });
   * // true: answers { intent: "info", payload: { id: "i5" } }
   * ```
   */
  press(target: Target): boolean;

  /**
   * Reads the `Draggable` of the source and the `DropTarget` of the destination and answers the
   * destination's intent with both payloads merged. The destination wins a key both carry.
   *
   * @param from - The view that is carried.
   * @param to - The view it is dropped on; this one names the intent.
   * @returns What `flow.gate.answer` returned: true when the gate took the answer.
   * @example
   * ```ts
   * // The merge test of the fixture game: two items of level 1 become one of level 2.
   * app.input.drag({ projection: "board.items", key: "i5" }, { projection: "board.items", key: "i7" });
   * // true: answers { intent: "merge", payload: { from: "c2", to: "c3" } }
   * ```
   */
  drag(from: Target, to: Target): boolean;

  /**
   * Reads the `Swipeable` of a view and answers its intent with the direction in the payload.
   *
   * @param target - The projection key of a live view, or an entity.
   * @param direction - Which way the finger would have gone.
   * @returns What `flow.gate.answer` returned: true when the gate took the answer.
   * @example
   * ```ts
   * // A match-3 test swaps the cell c2 with its right neighbour.
   * app.input.swipe({ projection: "board.cells", key: "c2" }, "right");
   * // true: answers { intent: "swap", payload: { cell: "c2", direction: "right" } }
   * ```
   */
  swipe(target: Target, direction: Direction): boolean;
};

/**
 * Resolved dependency APIs.
 */
export type Deps = { time: TimeApi; flow: FlowApi; world: WorldApi; renderer: RendererApi };

/**
 * What the kernel context offers before the deps are attached.
 *
 * `emit` is declared as the kernel's own, unusable shape on purpose: `input` owns no event, and a
 * property-typed `emit` breaks the kernel's event inference when a factory is passed to
 * `createPlugin` by direct reference.
 */
export type KernelSlice = Omit<PluginCtx<Config, State>, "emit"> & {
  emit(...args: never[]): void;
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context of the input plugin: the kernel slice plus the four resolved dependencies.
 */
export type InputCtx = KernelSlice & { readonly deps: Deps };
