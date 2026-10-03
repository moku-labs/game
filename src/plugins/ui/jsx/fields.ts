/**
 * @file ui/jsx — the text fields: one record per `input` element, its four drawn parts, the
 * editing (start, done, submit, fill), the frame pull of the mirror into the component's `local`
 * and the placement after the solve, with the keyboard lift. The DOM is reached through
 * `dom-input.ts` only; headless the mirror is the whole truth.
 */
import type { Message } from "../../i18n/types";
import type { RawSample } from "../../input/types";
import {
  Parent,
  Shape,
  type ShapeValue,
  Transform,
  type TransformValue
} from "../../renderer/components";
import { Text } from "../../text/components";
import type { Entity } from "../../world/types";
import { UI_OWNER } from "../components";
import type { LayoutModule, Rect } from "../layout/types";
import type { TextInputLook, UiCtx } from "../types";
import { visualRectOf } from "../visual";
import {
  configureInput,
  createHiddenInput,
  documentOf,
  type FieldUnder,
  hasFocus,
  listenToInput,
  placeInput,
  pointerDoor,
  readMirror,
  removeHiddenInput,
  watchKeyboard
} from "./dom-input";
import { type FieldLayout, layoutField, liftOf, type PartBox, paddingOf } from "./field-layout";
import type {
  Composing,
  DescriptionNode,
  Element,
  Field,
  FieldKind,
  FieldParts,
  JsxState,
  Mirror,
  Root
} from "./types";

/** The three keyboards a field may open. */
const KINDS: readonly FieldKind[] = ["text", "number", "email"];

/** The alpha the placeholder draws at, so it never reads as a typed value. */
const PLACEHOLDER_ALPHA = 0.5;

/** The separator between the inputs of a field's fingerprint. */
const FIELD_SEPARATOR = "\u0000";

/** The props of an `input` tag a field record keeps. */
type FieldAttributes = Pick<
  Field,
  "local" | "submit" | "maxLength" | "kind" | "textStyle" | "placeholder"
>;

/** One rectangle part: where it rests, and its shape. */
type BoxPart = { pose: TransformValue; shape: Partial<ShapeValue> };

/** What the four parts draw, without their `Parent`. */
type PartValues = {
  selection: BoxPart;
  text: { pose: TransformValue; content: string | Message; style: string; alpha: number };
  caret: BoxPart;
  composing: BoxPart;
};

/** What the jsx module takes from the fields. */
export type Fields = {
  enter(element: Element): void;
  patch(element: Element): void;
  exit(element: Element): void;
  drop(element: Element): void;
  pull(): void;
  place(): void;
  editing(): Entity | undefined;
  isField(entity: Entity): boolean;
  edit(entity: Entity): void;
  done(): void;
  submit(): boolean;
  fill(entity: Entity, value: string): void;
  open(): void;
  pointer(sample: RawSample): void;
};

/** What the fields need from the rest of the jsx module. */
export type FieldLinks = { layout: LayoutModule; topRoot(): Root | undefined };

/**
 * Reads the props of an `input` tag.
 *
 * @param node - The node of the field.
 * @returns The local field, the submit intent, the max length, the kind, the text style and the
 *   placeholder.
 * @example
 * ```ts
 * fieldAttributesOf({ type: "input", props: { local: "name", kind: "email" }, children: [] }).kind; // "email"
 * ```
 */
export function fieldAttributesOf(node: DescriptionNode): FieldAttributes {
  const { props } = node;

  return {
    local: String(props.local),
    submit: typeof props.submit === "string" ? props.submit : undefined,
    maxLength: typeof props.maxLength === "number" ? props.maxLength : undefined,
    kind: KINDS.find(kind => kind === props.kind) ?? "text",
    textStyle: typeof props.textStyle === "string" ? props.textStyle : "body",
    placeholder: props.placeholder as string | Message | undefined
  };
}

/**
 * Cuts a value to the max length of its field.
 *
 * @param value - The text.
 * @param maxLength - The longest value the field keeps, in UTF-16 units.
 * @returns The value the field keeps.
 * @example
 * ```ts
 * clampValue("abcdefghijk", 8); // "abcdefgh"
 * ```
 */
export function clampValue(value: string, maxLength: number | undefined): string {
  return maxLength === undefined ? value : value.slice(0, maxLength);
}

/**
 * A mirror with the caret at the end of a value and nothing selected.
 *
 * @param value - The text.
 * @returns The mirror.
 * @example
 * ```ts
 * mirrorAt("Al"); // { value: "Al", selectionStart: 2, selectionEnd: 2, direction: "none" }
 * ```
 */
export function mirrorAt(value: string): Mirror {
  return { value, selectionStart: value.length, selectionEnd: value.length, direction: "none" };
}

/**
 * Tells whether two mirrors hold the same text and selection.
 *
 * @param first - One mirror.
 * @param second - The other.
 * @returns True when nothing changed.
 * @example
 * ```ts
 * sameMirror(mirrorAt("Al"), mirrorAt("Al")); // true
 * ```
 */
function sameMirror(first: Mirror, second: Mirror): boolean {
  return (
    first.value === second.value &&
    first.selectionStart === second.selectionStart &&
    first.selectionEnd === second.selectionEnd &&
    first.direction === second.direction
  );
}

/**
 * The text a field shows: the mirror while it is edited, else the local field it writes. A field
 * outside every component keeps nothing.
 *
 * @param state - The jsx state.
 * @param field - The field.
 * @returns The value.
 */
export function fieldValue(state: JsxState, field: Field): string {
  if (state.text.editing === field.entity) return state.text.mirror.value;

  const instance = field.instance === undefined ? undefined : state.instances.get(field.instance);
  const value = instance?.local[field.local];

  if (value === undefined) return "";

  return typeof value === "string" ? value : String(value);
}

/**
 * The rest pose of a part at a point of its field.
 *
 * @param x - Left, in the field's own space.
 * @param y - Top, in the field's own space.
 * @returns The transform value.
 * @example
 * ```ts
 * poseAt(20, 30); // { x: 20, y: 30, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }
 * ```
 */
function poseAt(x: number, y: number): TransformValue {
  return { x, y, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } };
}

/**
 * A filled rectangle part, at alpha 0 while it is hidden.
 *
 * @param box - Where it goes and whether it is drawn.
 * @param fill - Its colour.
 * @param alpha - Its alpha while drawn.
 * @returns The pose and the shape.
 * @example
 * ```ts
 * boxPart({ x: 20, y: 30, w: 3, h: 40, shown: false }, 0, 1).shape.alpha; // 0
 * ```
 */
function boxPart(box: PartBox, fill: number, alpha: number): BoxPart {
  return {
    pose: poseAt(box.x, box.y),
    shape: { w: box.w, h: box.h, fill, fillAlpha: 1, alpha: box.shown ? alpha : 0 }
  };
}

/**
 * The component values of the four parts of a laid-out field.
 *
 * @param layout - Where the parts go.
 * @param content - What the text part draws: the value, or the placeholder at half alpha.
 * @param textStyle - The text style of the field.
 * @param look - The caret, selection and underline look of the config.
 * @returns The values, per part.
 */
function partValues(
  layout: FieldLayout,
  content: string | Message,
  textStyle: string,
  look: TextInputLook
): PartValues {
  return {
    selection: boxPart(layout.selection, look.selection, look.selectionAlpha),
    text: {
      pose: poseAt(layout.text.x, layout.text.y),
      content,
      style: textStyle,
      alpha: layout.content === "placeholder" ? PLACEHOLDER_ALPHA : 1
    },
    caret: boxPart(layout.caret, look.caret, 1),
    composing: boxPart(layout.composing, look.caret, 1)
  };
}

/**
 * A cheap fingerprint of what a field is laid out from: the selection and the composing range
 * while it is edited, the box, the padding, the text style, the placeholder and the value. The
 * value goes last, so no character of it can shift another input.
 *
 * @param field - The field.
 * @param element - Its live element.
 * @param mirror - The mirror while the field is edited, else `undefined`.
 * @param composing - The composing range while the field is edited, else `undefined`.
 * @param value - The value it shows.
 * @returns The fingerprint.
 */
function inputsOf(
  field: Field,
  element: Element,
  mirror: Mirror | undefined,
  composing: Composing | undefined,
  value: string
): string {
  const pad = paddingOf(element.style.padding);
  const selection =
    mirror === undefined
      ? "-"
      : `${mirror.selectionStart},${mirror.selectionEnd},${mirror.direction}`;
  const range = composing === undefined ? "-" : `${composing.start},${composing.end}`;
  const box = `${element.rect.w},${element.rect.h},${pad.top},${pad.right},${pad.bottom},${pad.left}`;

  const placeholder = JSON.stringify(field.placeholder ?? "");
  const look = `${field.textStyle}${FIELD_SEPARATOR}${placeholder}`;

  return [selection, range, box, look, value].join(FIELD_SEPARATOR);
}

/**
 * Tells whether a field with parts was laid out from these same inputs last time, so nothing it
 * draws can have changed.
 *
 * @param field - The field.
 * @param inputs - The fingerprint of its inputs now.
 * @returns True when the field is still.
 */
function isStill(field: Field, inputs: string): boolean {
  return field.parts !== undefined && field.inputs === inputs;
}

/**
 * Tells whether a point lies inside a rect.
 *
 * @param point - The point.
 * @param point.x - Its x.
 * @param point.y - Its y.
 * @param rect - The rect.
 * @returns True on the rect or inside it.
 * @example
 * ```ts
 * inside({ x: 5, y: 5 }, { x: 0, y: 0, w: 10, h: 10 }); // true
 * ```
 */
function inside(point: { x: number; y: number }, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

/**
 * Closes the text input in a teardown: the listeners of the element and the keyboard watcher go,
 * the element leaves the page, nothing is edited and the field records are dropped. Takes the
 * state only, as `onStop` does; the part entities left with the ui owner.
 *
 * @param state - The jsx state.
 */
export function stopFields(state: JsxState): void {
  const text = state.text;

  for (const off of text.cleanups) off();

  text.cleanups.length = 0;
  text.watching?.();
  text.watching = undefined;

  if (text.element !== undefined) removeHiddenInput(text.element);

  text.element = undefined;
  text.editing = undefined;
  text.composing = undefined;
  text.lifted = undefined;
  text.placed = undefined;
  text.mirror = mirrorAt("");
  text.keyboard = { inset: 0, innerHeight: 0, lift: 0 };
  state.fields.clear();
}

/**
 * Builds the text fields of the jsx module. Reads nothing of the context until it is used, so
 * the module can be built before `onStart`.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param links - The layout module, for the lift, and the root the keyboard works in.
 * @returns The fields.
 */
export function createFields(ctx: UiCtx, links: FieldLinks): Fields {
  const state: JsxState = ctx.state.jsx;
  const text = state.text;
  const lookup = (entity: Entity): Element | undefined => state.elements.get(entity);
  const wake = (): void => ctx.deps.time.wake();

  /**
   * The field being edited.
   *
   * @returns Its record, or `undefined`.
   */
  function editingField(): Field | undefined {
    return text.editing === undefined ? undefined : state.fields.get(text.editing);
  }

  /**
   * The label of a field: its placeholder, resolved.
   *
   * @param field - The field.
   * @returns The text a screen reader says.
   */
  function labelOf(field: Field): string {
    const placeholder = field.placeholder;

    if (placeholder === undefined) return "";

    return typeof placeholder === "string" ? placeholder : ctx.deps.i18n.plain(placeholder);
  }

  /**
   * What the hidden input takes from a field.
   *
   * @param field - The field.
   * @returns The kind, the max length, the label and the value.
   */
  function setupOf(field: Field): FieldUnder {
    return {
      kind: field.kind,
      maxLength: field.maxLength,
      label: labelOf(field),
      value: clampValue(fieldValue(state, field), field.maxLength)
    };
  }

  /**
   * Writes a value into the local field of the field's component, and marks the instance and its
   * root dirty, so the component re-renders at the next reconcile. A field outside every
   * component writes nothing.
   *
   * @param field - The field.
   * @param value - The value.
   */
  function writeLocal(field: Field, value: string): void {
    const instance = field.instance === undefined ? undefined : state.instances.get(field.instance);

    if (instance === undefined || instance.local[field.local] === value) return;

    instance.local = { ...instance.local, [field.local]: value };
    instance.dirty = true;

    const root = state.roots.get(field.root);

    if (root !== undefined) root.dirty = true;

    wake();
  }

  /**
   * Follows the keyboard of the page the element lives on, until the editing ends.
   *
   * @param element - The hidden input.
   */
  function watch(element: HTMLInputElement): void {
    const view = element.ownerDocument.defaultView;

    if (view === null) return;

    text.watching = watchKeyboard(view, keyboard => {
      text.keyboard.inset = keyboard.inset;
      text.keyboard.innerHeight = keyboard.innerHeight;
      wake();
    });
  }

  /**
   * Ends the editing: nothing is edited, the composing range and the keyboard go, the element is
   * emptied and, when asked, blurred. The local keeps the value; the lift drops at the next
   * placement.
   *
   * @param blur - Whether to take the page focus from the element.
   */
  function finish(blur: boolean): void {
    text.editing = undefined;
    text.composing = undefined;
    text.mirror = mirrorAt("");
    text.watching?.();
    text.watching = undefined;
    text.keyboard.inset = 0;
    text.keyboard.lift = 0;
    text.placed = undefined;

    const element = text.element;

    if (element === undefined) return;

    element.value = "";

    if (blur && hasFocus(element)) element.blur();
  }

  /**
   * Ends the editing, if a field is edited.
   */
  function done(): void {
    if (text.editing === undefined) return;

    finish(true);
    wake();
  }

  /**
   * Makes a field the one being edited: the mirror starts from its local value with the caret at
   * the end, and the element is set up for it and focused. A field already edited only takes the
   * focus back; another one edited before ends without losing the keyboard.
   *
   * @param entity - The field entity.
   */
  function edit(entity: Entity): void {
    const field = state.fields.get(entity);
    const element = text.element;

    if (field === undefined) return;

    // The same field again: focus once more, a no-op while the element holds the focus.
    if (text.editing === entity) {
      element?.focus({ preventScroll: true });

      return;
    }

    if (text.editing !== undefined) finish(false);

    const value = clampValue(fieldValue(state, field), field.maxLength);

    text.editing = entity;
    text.mirror = mirrorAt(value);
    text.composing = undefined;

    if (element !== undefined) {
      configureInput(element, setupOf(field));
      element.value = value;
      element.setSelectionRange(value.length, value.length);
      element.focus({ preventScroll: true });
      watch(element);
    }

    wake();
  }

  /**
   * Tells whether the edited field may stay edited: it lives, and its root is mounted, not
   * covered and not leaving.
   *
   * @param field - The edited field.
   * @returns True while the editing goes on.
   */
  function editable(field: Field): boolean {
    const root = state.roots.get(field.root);

    return (
      state.elements.has(field.entity) &&
      !state.exiting.has(field.entity) &&
      root !== undefined &&
      !root.covered &&
      !state.removing.has(root.entity)
    );
  }

  /**
   * Reads the mirror of the hidden input into the editing, and wakes the frame when it changed.
   *
   * @param element - The hidden input, or nothing when the page has none.
   * @param field - The edited field.
   */
  function readEditedMirror(element: HTMLInputElement | undefined, field: Field): void {
    if (element === undefined) return;

    const next = readMirror(element, field.maxLength);

    if (sameMirror(next, text.mirror)) return;

    text.mirror = next;
    wake();
  }

  /**
   * The frame pull, before the dirty roots of the reconcile: the mirror is read from the element
   * and written into the local, so the component re-renders in this same reconcile. A focus no
   * tap resolved on is taken back; an editing whose field or root went away ends.
   */
  function pull(): void {
    const element = text.element;
    const field = editingField();

    // Nothing is edited: take back a focus no tap resolved on.
    if (text.editing === undefined) {
      const hasStrayFocus = element !== undefined && hasFocus(element);

      if (hasStrayFocus) element.blur();

      return;
    }

    // The field or its root went away: end the editing.
    const isGone = field === undefined || !editable(field);

    if (isGone) {
      done();

      return;
    }

    // Read the mirror and write its value into the local of the component.
    readEditedMirror(element, field);
    writeLocal(field, text.mirror.value);
  }

  /**
   * Spawns the four parts of a field, each a child of the field: its pose, its `Parent`, its
   * visual, in that order, as an element is spawned.
   *
   * @param entity - The field entity.
   * @param values - What the parts draw.
   * @returns The part entities.
   */
  function spawnParts(entity: Entity, values: PartValues): FieldParts {
    const ecs = ctx.deps.world.ecs;
    const parent = Parent({ entity });
    const box = (part: BoxPart): Entity =>
      ecs.spawn(UI_OWNER, [Transform(part.pose), parent, Shape(part.shape)]);

    return {
      selection: box(values.selection),
      text: ecs.spawn(UI_OWNER, [
        Transform(values.text.pose),
        parent,
        Text({
          content: values.text.content,
          style: values.text.style,
          bind: undefined,
          anchor: { x: 0, y: 0 },
          alpha: values.text.alpha
        })
      ]),
      caret: box(values.caret),
      composing: box(values.composing)
    };
  }

  /**
   * Writes the four parts of a field again. The text part writes its content, style and alpha
   * only: the string `text` resolved for it stays.
   *
   * @param parts - The part entities.
   * @param values - What they draw now.
   */
  function writeParts(parts: FieldParts, values: PartValues): void {
    const ecs = ctx.deps.world.ecs;

    for (const name of ["selection", "caret", "composing"] as const) {
      ecs.set(parts[name], Transform, values[name].pose);
      ecs.set(parts[name], Shape, values[name].shape);
    }

    ecs.set(parts.text, Transform, values.text.pose);
    ecs.set(parts.text, Text, {
      content: values.text.content,
      style: values.text.style,
      alpha: values.text.alpha
    });
  }

  /**
   * Forgets the inputs of every field whose text part `text` resolved again this frame. `text`
   * does that for every label when a font arrives or leaves, and on a locale change, so the field
   * is measured again with the metrics it has now. The frame after a field wrote its text part,
   * the same write lays it out once more.
   */
  function forgetRelabelled(): void {
    const ecs = ctx.deps.world.ecs;

    for (const part of ecs.changed(Text)) {
      const owner = ecs.get(part, Parent)?.entity;
      const field = owner === undefined ? undefined : state.fields.get(owner);

      if (field?.parts?.text === part) field.inputs = undefined;
    }
  }

  /**
   * Lays out one field around its value, and the mirror while it is edited.
   *
   * @param field - The field.
   * @param element - Its live element.
   * @param value - The value it shows.
   * @param mirror - The mirror while the field is edited, else `undefined`.
   * @param composing - The composing range while the field is edited, else `undefined`.
   * @returns Where its parts go.
   */
  function layoutOf(
    field: Field,
    element: Element,
    value: string,
    mirror: Mirror | undefined,
    composing: Composing | undefined
  ): FieldLayout {
    const look = ctx.config.textInput;
    const measure = (piece: string): { width: number; height: number } =>
      ctx.deps.text.measure(piece, field.textStyle);

    return layoutField({
      value,
      mirror,
      composing,
      size: { w: element.rect.w, h: element.rect.h },
      padding: paddingOf(element.style.padding),
      lineHeight: measure("").height,
      caretWidth: look.caretWidth,
      underline: look.composingUnderline,
      prefix: piece => measure(piece).width
    });
  }

  /**
   * Draws a laid-out field: spawns its parts the first time, and writes them again only when what
   * they draw changed.
   *
   * @param field - The field.
   * @param layout - Where its parts go.
   * @param value - The value it shows.
   * @param inputs - The fingerprint of what it was laid out from.
   */
  function drawField(field: Field, layout: FieldLayout, value: string, inputs: string): void {
    // Resolve what the parts draw, and a fingerprint of it.
    const look = ctx.config.textInput;
    const content = layout.content === "placeholder" ? (field.placeholder ?? "") : value;
    const values = partValues(layout, content, field.textStyle, look);
    const drawn = JSON.stringify({ layout, content, look, style: field.textStyle });

    field.inputs = inputs;

    // Spawn the parts the first time.
    if (field.parts === undefined) {
      field.parts = spawnParts(field.entity, values);
      field.drawn = drawn;

      return;
    }

    // Write them again only when what they draw changed.
    if (field.drawn === drawn) return;

    field.drawn = drawn;
    writeParts(field.parts, values);
  }

  /**
   * Lays out and draws one live field: spawns its parts the first time, writes them when the
   * mirror, the value or the rect changed, and writes nothing for a still field. A field whose
   * inputs did not change is neither measured nor laid out.
   *
   * @param field - The field.
   */
  function placeField(field: Field): void {
    const element = lookup(field.entity);
    const isLive = element?.live === true;

    if (!isLive) return;

    // Lay the field out around the mirror while it is edited, around its value otherwise.
    const editing = text.editing === field.entity;
    const value = editing ? text.mirror.value : fieldValue(state, field);
    const mirror = editing ? text.mirror : undefined;
    const composing = editing ? text.composing : undefined;

    // A still field is neither measured nor laid out again.
    const inputs = inputsOf(field, element, mirror, composing, value);

    if (isStill(field, inputs)) return;

    drawField(field, layoutOf(field, element, value, mirror, composing), value, inputs);
  }

  /**
   * The root element a field's root reconciled into.
   *
   * @param field - The field element.
   * @returns The root element, or `undefined`.
   */
  function rootElementOf(field: Element): Element | undefined {
    const root = state.roots.get(field.root);

    return root?.element === undefined ? undefined : lookup(root.element);
  }

  /**
   * Moves a root element up by the lift, or back to its rest with 0. A lift already written on the
   * same rest writes nothing; a root lifted before that is not this one gets its rest back.
   *
   * @param root - The root element of the edited field, or nothing.
   * @param units - The lift in reference units.
   */
  function lift(root: Element | undefined, units: number): void {
    // Give a root lifted before, that is not this one, its rest back.
    const lifted = text.lifted;
    const isLiftedElsewhere = lifted !== undefined && lifted.element !== root?.entity;

    if (isLiftedElsewhere) {
      const previous = lookup(lifted.element);

      if (previous !== undefined) links.layout.lift(previous, 0);

      text.lifted = undefined;
    }

    if (root === undefined) return;

    // Write nothing when the root already stands where this lift puts it.
    const current = text.lifted;
    const staysAtRest = current === undefined && units === 0;
    const alreadyLifted =
      current !== undefined && current.units === units && current.rest === root.rest;

    if (staysAtRest || alreadyLifted) return;

    // Move the root, and remember the lift until it is back to 0.
    links.layout.lift(root, units);
    text.lifted = units === 0 ? undefined : { element: root.entity, units, rest: root.rest };
  }

  /**
   * Places the hidden input over the edited field and lifts its root above the keyboard; drops the
   * lift when nothing is edited.
   */
  function placeInputAndLift(): void {
    // Nothing live is edited: drop the lift.
    const element = text.element;
    const field = text.editing === undefined ? undefined : lookup(text.editing);
    const isEditingLive = element !== undefined && field?.live === true;

    if (!isEditingLive) {
      lift(undefined, 0);

      return;
    }

    // Find the rect the field is drawn at, in screen px.
    const viewport = ctx.deps.renderer.viewport;
    const drawn = visualRectOf(field, lookup);
    const topLeft = viewport.toScreen({ x: drawn.x, y: drawn.y });
    const bottomRight = viewport.toScreen({ x: drawn.x + drawn.w, y: drawn.y + drawn.h });
    const rect = {
      x: topLeft.x,
      y: topLeft.y,
      w: bottomRight.x - topLeft.x,
      h: bottomRight.y - topLeft.y
    };

    // Lift by what the keyboard covers under the field.
    const keyboard = text.keyboard;

    keyboard.lift =
      keyboard.inset <= 0
        ? 0
        : liftOf({
            fieldBottom: bottomRight.y,
            margin: ctx.config.textInput.keyboardMargin,
            innerHeight: keyboard.innerHeight,
            inset: keyboard.inset
          });

    // Move the hidden input only when its rect or its lift changed.
    const placed = JSON.stringify({ rect, lift: keyboard.lift });

    if (placed !== text.placed) {
      text.placed = placed;
      placeInput(element, rect, keyboard.lift);
    }

    // Lift the root of the field by the same amount, in reference units.
    const scale = viewport.size().scale;

    lift(rootElementOf(field), keyboard.lift / (scale > 0 ? scale : 1));
  }

  /**
   * The field under a point of the page: a live field of the root the keyboard works in, at the
   * place it is drawn, its root's lift taken off.
   *
   * @param clientX - The x of the point, in client px.
   * @param clientY - The y of the point, in client px.
   * @returns What the hidden input takes from the field, or `undefined`.
   */
  function fieldAt(clientX: number, clientY: number): FieldUnder | undefined {
    const top = links.topRoot();

    if (top === undefined) return undefined;

    // Take the lift of the top root off the point.
    const point = ctx.deps.renderer.viewport.toReference(clientX, clientY);
    const lifted = text.lifted;
    const isTopLifted = lifted !== undefined && lifted.element === top.element;
    const raise = isTopLifted ? lifted.units : 0;

    // Answer the first live field of the top root drawn under it.
    for (const field of state.fields.values()) {
      const element = lookup(field.entity);
      const isTopField = element?.live === true && element.root === top.entity;

      if (!isTopField) continue;
      if (state.exiting.has(field.entity)) continue;

      const rect = visualRectOf(element, lookup);

      if (inside(point, { ...rect, y: rect.y - raise })) return setupOf(field);
    }

    return undefined;
  }

  const pointer = pointerDoor(() => text.element, fieldAt);

  return {
    enter: (element: Element): void => {
      state.fields.set(element.entity, {
        entity: element.entity,
        key: element.key,
        root: element.root,
        instance: element.instance,
        ...fieldAttributesOf(element.node),
        parts: undefined,
        drawn: undefined,
        inputs: undefined
      });

      if (element.instance === undefined) {
        ctx.log.warn("ui:input-without-component", { key: element.key });
      }
    },

    patch: (element: Element): void => {
      const field = state.fields.get(element.entity);

      if (field === undefined) return;

      const before = JSON.stringify([field.kind, field.maxLength, field.placeholder]);

      Object.assign(field, fieldAttributesOf(element.node), { instance: element.instance });

      // The hidden input of the field being edited takes its new kind, length or label.
      const after = JSON.stringify([field.kind, field.maxLength, field.placeholder]);
      const input = text.element;
      const needsReconfigure =
        text.editing === field.entity && input !== undefined && before !== after;

      if (needsReconfigure) configureInput(input, setupOf(field));
    },

    exit: (element: Element): void => {
      if (text.editing === element.entity) done();
    },

    drop: (element: Element): void => {
      const field = state.fields.get(element.entity);

      if (field === undefined) return;

      for (const part of Object.values(field.parts ?? {})) ctx.deps.world.ecs.despawn(part);

      state.fields.delete(element.entity);
    },

    pull,

    place: (): void => {
      forgetRelabelled();

      for (const field of state.fields.values()) placeField(field);

      placeInputAndLift();
    },

    editing: () => text.editing,

    isField: (entity: Entity): boolean => state.fields.has(entity),

    edit,

    done,

    submit: (): boolean => {
      const field = editingField();

      if (field?.submit === undefined) return false;
      if (text.element !== undefined) text.mirror = readMirror(text.element, field.maxLength);

      ctx.deps.flow.gate.answer({
        intent: field.submit,
        payload: { [field.local]: text.mirror.value }
      });

      return true;
    },

    fill: (entity: Entity, value: string): void => {
      const field = state.fields.get(entity);

      if (field === undefined) return;

      const clamped = clampValue(value, field.maxLength);

      edit(entity);
      text.mirror = mirrorAt(clamped);

      if (text.element !== undefined) {
        text.element.value = clamped;
        text.element.setSelectionRange(clamped.length, clamped.length);
      }

      writeLocal(field, clamped);
      wake();
    },

    open: (): void => {
      const document = documentOf(ctx.deps.renderer.host.canvas());

      if (document === undefined || text.element !== undefined) return;

      const element = createHiddenInput(document);

      text.element = element;
      text.cleanups.push(
        listenToInput(element, {
          maxLength: () => editingField()?.maxLength,
          mirror: next => {
            text.mirror = next;
            wake();
          },
          compose: range => {
            text.composing = range;
            wake();
          },
          committed: () => {
            text.composing = undefined;
            wake();
          },
          done
        })
      );
    },

    pointer
  };
}
