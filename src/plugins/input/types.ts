/**
 * @file input plugin — type definitions: the raw pointer queue, the gesture machine and the one
 * public API. `InputApi` is what a game, a test and an agent read.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as FlowApi } from "../flow/types";
import type { TransformValue } from "../renderer/components";
import type { Api as RendererApi } from "../renderer/types";
import type { Api as TimeApi } from "../time/types";
import type { AnyComponentType, Entity, Api as WorldApi } from "../world/types";

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
 * `cancel` is a `pointercancel`, `lost` a lost pointer capture, `leave` the pointer leaving the
 * canvas. `pointerType` is the device: only a mouse or a pen hovers.
 *
 * @example
 * ```ts
 * const sample: RawSample = {
 *   kind: "down", pointerType: "touch", pointerId: 1, clientX: 320, clientY: 640
 * };
 * ```
 */
export type RawSample = {
  kind: "down" | "move" | "up" | "cancel" | "lost" | "leave";
  pointerType: "mouse" | "touch" | "pen";
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
export type GesturePhase = "idle" | "pressed" | "longPressed" | "dragging" | "tracing";

/**
 * What `onTap` hands a listener: the view the finger let go on, inside the tap slop.
 *
 * @example
 * ```ts
 * const tapped: Entity[] = [];
 * const listener: TapListener = entity => tapped.push(entity);
 * ```
 */
export type TapListener = (entity: Entity) => void;

/**
 * What `onPointer` registers: called with the raw sample inside the DOM listener, for the kinds
 * `down`, `up` and `cancel`, right after the sample is queued.
 *
 * @example
 * ```ts
 * const lifts: RawSample[] = [];
 * const listener: PointerListener = sample => {
 *   if (sample.kind === "up") lifts.push(sample);
 * };
 * ```
 */
export type PointerListener = (sample: RawSample) => void;

/**
 * One key press as `onKey` hands it to a listener: the DOM `KeyboardEvent.key` and whether Shift
 * was held.
 *
 * @example
 * ```ts
 * const backTab: KeyInput = { key: "Tab", shift: true };
 * ```
 */
export type KeyInput = { key: string; shift: boolean };

/**
 * What `onKey` registers. Returning `true` marks the key handled: input then calls
 * `preventDefault()` on the DOM event, and `app.input.pressKey` answers `true`.
 *
 * @example
 * ```ts
 * const closeOnEscape: KeyListener = key => key.key === "Escape";
 * ```
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a listener that ignores the key returns nothing; `void` names that honestly
export type KeyListener = (key: KeyInput) => boolean | void;

/**
 * input plugin config. Every distance is in reference px, every duration in milliseconds of
 * `time`, so a time scale and a pause apply to the gestures too.
 *
 * @example
 * ```ts
 * createApp({ plugins: [...screen], pluginConfigs: { input: { longPressMs: 300, swipeMinPx: 64 } } });
 * // A merge game carries the item in the hand 8% bigger: a board item resting at scale 0.5 on
 * // screen is drawn at 0.54 from the grab to the drop, even after a press squashed it, then
 * // flies home at 0.5.
 * createApp({ plugins: [...screen], pluginConfigs: { input: { heldScale: 1.08 } } });
 * // A game with its own cursors: the config merges shallowly, so both values are given.
 * createApp({ plugins: [...screen], pluginConfigs: { input: { cursor: { control: "grab", idle: "default" } } } });
 * // A word grid with 40 px cells: the finger's path is hit-tested every 16 px, below the
 * // shortest cell span, so a fast finger skips no letter.
 * createApp({ plugins: [...screen], pluginConfigs: { input: { traceStepPx: 16 } } });
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
  /**
   * How much bigger the view in the hand is drawn: its rest scale in root space times this, from
   * the grab to the release, so a squash a press left on it does not shrink the lift. A view with
   * no recorded rest starts from its scale at the grab. The drop, the cancel and the abort write
   * the rest scale back, so the way home starts at the view's own size. `1` changes nothing.
   */
  heldScale: number;
  /**
   * CSS cursors of the canvas. `control` shows while a mouse or a pen rests on a view that
   * carries `Tappable`, `Draggable`, `Pressable`, `Swipeable` or a component another plugin
   * registered through `controls.add`, such as ui's `LocalWrite`; `idle` shows everywhere else.
   * `""` hands the cursor back to the page's own style.
   */
  cursor: { control: string; idle: string };
  /**
   * Reference px between two hit tests along the finger's path inside one frame of a trace. Keep
   * it below the shortest cell span: a longer step jumps over a cell.
   */
  traceStepPx: number;
  /**
   * The hit circle of a trace cell: its radius is this times the short side of the cell's hit
   * box, around the box centre. A diagonal then crosses no corner of a neighbour.
   */
  traceInset: number;
};

/**
 * One view a drag carries on top of the held one: hung under the held view from the grab to the
 * release.
 */
export type Carried = {
  /** The carried view. */
  entity: Entity;
  /** The `Parent` it had at the grab, hung back under it on the release. */
  parent: Entity | undefined;
  /** The remover `world.projection.mute` returned for its root pose. */
  unmute: () => void;
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
  /** The drop target that carries `Hovered` during a drag. */
  hovered: Entity | undefined;
  /** The view that carries `PointerOver`: a press would take it, and a mouse or a pen is over it. */
  pointerOver: Entity | undefined;
  /** The `Parent` the held view had at the grab. It is hung back under it on the release. */
  parent: Entity | undefined;
  /** The rest scale of the held view in root space: the base of `heldScale`, set back on drop. */
  restScale: number | undefined;
  /**
   * The root pose of the held view, written at the grab and at every move. A carried view is
   * placed from it when the held view despawns before the release and takes its `Transform`.
   */
  heldPose: TransformValue | undefined;
  /** The remover `world.projection.mute` returned, while a drag runs. */
  unmute: (() => void) | undefined;
  /** The views a drag carries on top of the held one, in `carry` order; empty outside a drag. */
  carried: Carried[];
  /** The cells of the trace in progress, in path order; empty outside a trace. */
  path: Entity[];
  /** The intent of the first cell of the trace; a cell of another intent closes the path. */
  traceIntent: string | undefined;
  /** True once a cell of another intent was crossed: the path neither grows nor pops. */
  traceClosed: boolean;
  /** Where the finger was at the last frame of the trace: the segment starts there. */
  lastPoint: Point | undefined;
  canvas: HTMLCanvasElement | undefined;
  offFrame: (() => void) | undefined;
  detach: (() => void) | undefined;
  /** Registered through `onTap`, called in this order on every tap. */
  tapListeners: TapListener[];
  /** Registered through `onKey`, called in this order on every key. */
  keyListeners: KeyListener[];
  /** Registered through `onPointer`, called in this order inside the DOM listener. */
  pointerListeners: PointerListener[];
  /** Takes the one `keydown` listener off `window`; set while a canvas is attached. */
  detachKeys: (() => void) | undefined;
  /** `time.wake`, bound in `onInit`: every pointer sample leaves the idle frame rate. */
  wake: (() => void) | undefined;
  /** The cursor last written on the attached canvas; `undefined` while nothing was written. */
  cursor: string | undefined;
  /** Component types other plugins registered through `controls.add`, once per registration. */
  controls: AnyComponentType[];
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

  /**
   * Reads the `Traceable` of every cell and answers one path, the way a finger drawn through the
   * cells would: the intent of the cells and `{ path }`, the cell payloads in order. Every cell
   * must name the same intent. An empty list, a cell with no `Traceable` and two intents warn and
   * answer `false` without calling the gate. Nothing is tagged `Traced`.
   *
   * @param path - The cells in the order the finger goes through them.
   * @returns What `flow.gate.answer` returned: true when the gate took the answer.
   * @example
   * ```ts
   * // A word-game test spells a word without a finger.
   * app.input.trace([
   *   { projection: "board.cells", key: "b3" },
   *   { projection: "board.cells", key: "c3" },
   *   { projection: "board.cells", key: "d3" }
   * ]);
   * // true: answers { intent: "word", payload: { path: [{ cell: "b3" }, { cell: "c3" }, { cell: "d3" }] } }
   * ```
   */
  trace(path: readonly Target[]): boolean;

  /**
   * Registers a listener called on every tap — a press and a release inside `tapSlopPx` — on the
   * topmost view the hit test accepted, before the `Tappable` answer. A view that carries only
   * `Touchable` reaches the listeners and answers nothing. A listener that throws is logged with
   * its entity, and the listeners after it still run.
   *
   * @param fn - What to run with the tapped entity.
   * @returns The remover; call it to stop listening.
   * @example
   * ```ts
   * // ui applies the local patch of the button the finger tapped.
   * const off = ctx.require(inputPlugin).onTap(entity => {
   *   const write = ctx.require(worldPlugin).ecs.get(entity, LocalWrite);
   *
   *   if (write !== undefined) applyLocal(entity, write.patch);
   * });
   * off(); // in onStop
   * ```
   */
  onTap(fn: TapListener): () => void;

  /**
   * Registers a listener called synchronously inside the DOM pointer listener, right after the
   * sample is queued, for `pointerdown`, `pointerup` and `pointercancel`. It is the one place a
   * browser call that needs the user gesture can run, such as `focus()` on a text field: in the
   * next frame iOS shows no keyboard. Never called for a move, a leave or a lost capture, and never
   * by `tap`, `press`, `drag` or `swipe`, which have no DOM moment. The sample is raw: client px,
   * no hit test. Listeners run in registration order; a listener that throws is logged with the
   * sample kind, and the listeners after it still run.
   *
   * @param fn - What to run with the raw sample.
   * @returns The remover; call it to stop listening.
   * @example
   * ```ts
   * // ui opens the keyboard the moment the finger lifts on a text field, inside the DOM listener.
   * const off = ctx.require(inputPlugin).onPointer(sample => {
   *   if (sample.kind === "up" && fieldAt(sample.clientX, sample.clientY) !== undefined) element.focus({ preventScroll: true });
   *   if (sample.kind === "down" && fieldAt(sample.clientX, sample.clientY) === undefined) element.blur();
   * });
   * // a tap on the Rename field on an iPhone: the keyboard shows; a tap on the parchment next to it: the keyboard hides
   * off(); // in onStop
   * ```
   */
  onPointer(fn: PointerListener): () => void;

  /**
   * Registers a listener called on every key pressed while the canvas is attached, and on every
   * `pressKey` call. A key typed into a text field is not handed over, except Enter and Escape,
   * and an Enter that commits an IME composition is dropped. Listeners run in registration order,
   * all of them, each time. A listener that
   * returns `true` marks the key handled, and input calls `preventDefault()` on the DOM event. A
   * listener that throws is logged with its key, and the listeners after it still run.
   *
   * @param fn - What to run with the key; return `true` when it handled it.
   * @returns The remover; call it to stop listening.
   * @example
   * ```ts
   * // ui moves the keyboard focus on Tab and keeps the browser from leaving the canvas.
   * const off = ctx.require(inputPlugin).onKey(key => {
   *   if (key.key !== "Tab") return false;
   *   moveFocus(key.shift ? -1 : 1);
   *
   *   return true;
   * });
   * off(); // in onStop
   * ```
   */
  onKey(fn: KeyListener): () => void;

  /**
   * Presses a key without a keyboard: runs the `onKey` listeners exactly as a DOM `keydown` does.
   *
   * @param key - The DOM `KeyboardEvent.key`, such as `"Tab"`, `"Enter"`, `" "` or `"Escape"`.
   * @param options - How the key is pressed.
   * @param options.shift - True presses it with Shift held; the default is `false`.
   * @returns True when a listener handled the key.
   * @example
   * ```ts
   * // A headless test walks the settings popup backwards and closes it.
   * app.input.pressKey("Tab", { shift: true }); // true: ui moved the focus to the previous control
   * app.input.pressKey("Escape"); // true: ui tapped the popup's close button
   * app.input.pressKey("q"); // false: no listener handles it
   * ```
   */
  pressKey(key: string, options?: { shift?: boolean }): boolean;

  /**
   * The CSS cursor input set on the canvas: `config.cursor.control` while a mouse or a pen rests
   * on a control, `config.cursor.idle` otherwise and whenever nothing is attached.
   *
   * @returns The cursor value.
   * @example
   * ```ts
   * // An e2e check: the mouse rests on the Play button of the home screen.
   * app.input.cursor(); // "pointer"
   * // The mouse moves to the empty sky above it.
   * app.input.cursor(); // ""
   * ```
   */
  cursor(): string;

  /**
   * The components that make a view a control besides input's own: the cursor shows
   * `config.cursor.control` over a view that carries one of them.
   */
  controls: {
    /**
     * Registers a component type of another plugin as a control. A type registered twice stays
     * a control until both removers ran.
     *
     * @param component - The component or tag type that makes a view answer a press.
     * @returns The remover; call it to take the registration back.
     * @example
     * ```ts
     * // ui counts its local-state buttons as controls, so the mouse over a tab shows a hand.
     * const off = ctx.require(inputPlugin).controls.add(LocalWrite);
     * app.input.cursor(); // "pointer" while the mouse rests on the Audio tab
     * off(); // in onStop
     * ```
     */
    add(component: AnyComponentType): () => void;
  };
};

/**
 * Resolved dependency APIs.
 */
export type Deps = { time: TimeApi; flow: FlowApi; world: WorldApi; renderer: RendererApi };

/**
 * What the kernel context offers before the deps are attached.
 *
 * `input` owns no event, so `emit` is the kernel's and never called here.
 */
export type KernelSlice = PluginCtx<Config, State> & {
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context of the input plugin: the kernel slice plus the four resolved dependencies.
 */
export type InputCtx = KernelSlice & { readonly deps: Deps };
