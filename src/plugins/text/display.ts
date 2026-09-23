/**
 * @file text plugin — the screen half: the fonts handed to the renderer, and the display adapter
 * that turns one `Text` into one Pixi container of `BitmapText` runs, their shadows and icon
 * sprites. Pixi is never imported here: the classes come from the module the renderer loaded.
 */
import type { DisplayAdapter } from "../renderer/sync/types";
import type { PixiContainer, PixiModule, PixiSprite, PixiTexture } from "../renderer/types";
import { fontOfRun, lineHeightOf, measureRun, parseAdvances } from "./measure";
import { layoutFor, markDirty, styleOf, warnFor } from "./resolve";
import type {
  DrawnLabel,
  IconRun,
  Line,
  Point,
  Run,
  TextCtx,
  TextLayout,
  TextRun,
  TextShadow,
  TextStyle,
  TextValue
} from "./types";

/** How much of the size a synthetic bold stroke is. */
const SYNTHETIC_BOLD = 20;

/** How many offset copies of a run draw its outline or its synthetic bold. */
const OUTLINE_COPIES = 8;

/** How many copies draw an outline at least `WIDE_OUTLINE` wide, so the ring stays closed. */
const WIDE_OUTLINE_COPIES = 12;

/** From this width on an outline takes `WIDE_OUTLINE_COPIES` copies. */
const WIDE_OUTLINE = 6;

/** How far a synthetic italic run leans. */
const SYNTHETIC_ITALIC = -0.2;

/** What a shadow copy is painted with, so its tint alone gives it the shadow colour. */
const WHITE = 0xff_ff_ff;

/** A ring of copies under a glyph run: its width, and the colour each white copy is tinted. */
type Ring = { width: number; color: number };

/** A Pixi bitmap text: a glyph run, one copy of its rings or its shadow. */
type PixiBitmapText = InstanceType<PixiModule["BitmapText"]>;

/**
 * Reads the fonts of `fontKeys` that `assets` can answer for: the advance table first, then the
 * install in the renderer. Runs in `onStart` and on every bundle that lands.
 *
 * @param ctx - Domain context of the text plugin.
 * @throws {Error} When a `.fnt` is in neither BMFont format.
 */
export function installFonts(ctx: TextCtx): void {
  const renderer = ctx.deps.renderer;
  const ready = renderer.host.ready();
  let arrived = false;

  for (const key of ctx.state.fontKeys) {
    const needsTable = !ctx.state.tables.has(key);
    // The plugin's own mark is the gate: `releaseFonts` drops it, so a reloaded bundle installs again.
    const needsInstall = ready && !ctx.state.installed.has(key);

    if (!needsTable && !needsInstall) continue;

    const font = ctx.deps.assets.font(key);

    if (font === undefined) continue;

    if (needsTable) {
      ctx.state.tables.set(key, parseAdvances(font.fnt, key));
      arrived = true;
    }

    if (needsInstall) {
      renderer.sync.fonts.install(key, font.fnt, font.texture);
      ctx.state.installed.add(key);
    }
  }

  if (arrived) refresh(ctx);
}

/**
 * Drops the fonts a bundle took away, so the next load installs them again.
 *
 * @param ctx - Domain context of the text plugin.
 * @param keys - The asset keys that left with the bundle.
 */
export function releaseFonts(ctx: TextCtx, keys: readonly string[]): void {
  let left = false;

  for (const key of keys) {
    if (!ctx.state.fontKeys.has(key)) continue;

    ctx.state.tables.delete(key);
    ctx.state.installed.delete(key);
    left = true;
  }

  if (left) refresh(ctx);
}

/**
 * Throws away what was measured with the old tables and asks for every label again.
 *
 * @param ctx - Domain context of the text plugin.
 */
function refresh(ctx: TextCtx): void {
  ctx.state.cache.clear();
  markDirty(ctx);
}

/**
 * Where a line starts inside the widest one.
 *
 * @param style - The style of the label.
 * @param layout - The block the line belongs to.
 * @param line - The line.
 * @returns The offset in reference pixels.
 */
function alignOffset(style: TextStyle, layout: TextLayout, line: Line): number {
  if (style.align === "left") return 0;

  const slack = layout.width - line.width;

  return style.align === "center" ? slack / 2 : slack;
}

/**
 * The rings of copies one run is drawn over, bottom first: the outline of a stroked style, then the
 * synthetic bold in the fill when the style names no bold font.
 *
 * @param style - The style of the label.
 * @param run - The run to draw.
 * @param fill - The colour the run is filled with.
 * @returns The rings, none for a plain run.
 */
function ringsOf(style: TextStyle, run: TextRun, fill: number): Ring[] {
  const rings: Ring[] = [];

  if (style.strokeWidth > 0) rings.push({ width: style.strokeWidth, color: style.stroke });
  if (run.bold && style.bold === undefined) {
    rings.push({ width: style.size / SYNTHETIC_BOLD, color: fill });
  }

  return rings;
}

/**
 * How many copies close a ring of this width.
 *
 * @param width - The radius of the ring.
 * @returns 8, or 12 from a width of 6 on.
 * @example
 * ```ts
 * copiesFor(4); // 8
 * ```
 */
function copiesFor(width: number): number {
  return width >= WIDE_OUTLINE ? WIDE_OUTLINE_COPIES : OUTLINE_COPIES;
}

/**
 * The texture of one inline icon: its asset, or the empty texture while the asset is missing.
 *
 * @param ctx - Domain context of the text plugin.
 * @param pixi - The Pixi module the renderer loaded.
 * @param run - The icon to draw.
 * @returns The texture.
 */
function iconTexture(ctx: TextCtx, pixi: PixiModule, run: IconRun): PixiTexture {
  return ctx.deps.assets.texture(run.key) ?? pixi.Texture.EMPTY;
}

/**
 * Sizes the sprite of one inline icon square at the line height and puts it where the icon
 * starts.
 *
 * @param ctx - Domain context of the text plugin.
 * @param sprite - The sprite of the icon.
 * @param style - The style of the label.
 * @param at - Where the icon starts, in the local space of the block.
 */
function placeIcon(ctx: TextCtx, sprite: PixiSprite, style: TextStyle, at: Point): void {
  const side = lineHeightOf(style, ctx.state.tables);

  sprite.width = side;
  sprite.height = side;
  sprite.x = at.x;
  sprite.y = at.y;
}

/**
 * Builds the sprite of one inline icon, square at the line height.
 *
 * @param ctx - Domain context of the text plugin.
 * @param pixi - The Pixi module the renderer loaded.
 * @param run - The icon to draw.
 * @param style - The style of the label.
 * @param at - Where the icon starts, in the local space of the block.
 * @returns The sprite.
 */
function buildIcon(
  ctx: TextCtx,
  pixi: PixiModule,
  run: IconRun,
  style: TextStyle,
  at: Point
): PixiContainer {
  const sprite = new pixi.Sprite(iconTexture(ctx, pixi, run));

  placeIcon(ctx, sprite, style, at);

  return sprite;
}

/**
 * Builds the `BitmapText` of one glyph run in one colour and places it. No stroke goes to Pixi: it
 * draws nothing on an MSDF font and only pads the anchor, so outlines are rings of copies.
 *
 * @param pixi - The Pixi module the renderer loaded.
 * @param run - The glyphs to draw.
 * @param style - The style of the label.
 * @param fill - The colour of the glyphs.
 * @param at - Where the run starts, in the local space of the block.
 * @returns The display object.
 */
function buildGlyphs(
  pixi: PixiModule,
  run: TextRun,
  style: TextStyle,
  fill: number,
  at: Point
): PixiContainer {
  const line = new pixi.BitmapText({
    text: run.text,
    style: {
      fontFamily: fontOfRun(style, run),
      fontSize: style.size,
      fill,
      letterSpacing: style.letterSpacing
    }
  });

  if (run.italic && style.italic === undefined) line.skew.x = SYNTHETIC_ITALIC;

  line.x = at.x;
  line.y = at.y;

  return line;
}

/**
 * Builds the shadow of one glyph run: the same glyphs in white, tinted with the shadow colour, at
 * the shadow alpha, moved by its offset.
 *
 * @param pixi - The Pixi module the renderer loaded.
 * @param run - The glyphs that cast the shadow.
 * @param style - The style of the label.
 * @param shadow - The shadow of the style.
 * @param at - Where the run starts, in the local space of the block.
 * @returns The display object, to be drawn under the run.
 */
function buildShadow(
  pixi: PixiModule,
  run: TextRun,
  style: TextStyle,
  shadow: TextShadow,
  at: Point
): PixiContainer {
  const copy = buildGlyphs(pixi, run, style, WHITE, { x: at.x + shadow.dx, y: at.y + shadow.dy });

  copy.tint = shadow.color;
  copy.alpha = shadow.alpha;

  return copy;
}

/**
 * Where the copies of one ring sit: on a circle of the ring width around the run, starting to the
 * right.
 *
 * @param ring - The width and colour of the ring.
 * @param at - Where the run starts, in the local space of the block.
 * @returns One point per copy.
 * @example
 * ```ts
 * ringSpots({ width: 4, color: 0 }, { x: 0, y: 0 })[0]; // { x: 4, y: 0 }
 * ```
 */
function ringSpots(ring: Ring, at: Point): Point[] {
  const count = copiesFor(ring.width);
  const spots: Point[] = [];

  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;

    spots.push({ x: at.x + Math.cos(angle) * ring.width, y: at.y + Math.sin(angle) * ring.width });
  }

  return spots;
}

/**
 * Builds one ring under a glyph run: white copies of it on a circle of the ring width around the
 * run, tinted with the ring colour, opaque like the run.
 *
 * @param pixi - The Pixi module the renderer loaded.
 * @param run - The glyphs the ring surrounds.
 * @param style - The style of the label.
 * @param ring - The width and colour of the ring.
 * @param at - Where the run starts, in the local space of the block.
 * @returns The copies, to be drawn under the run.
 */
function buildRing(
  pixi: PixiModule,
  run: TextRun,
  style: TextStyle,
  ring: Ring,
  at: Point
): PixiContainer[] {
  return ringSpots(ring, at).map(spot => {
    const copy = buildGlyphs(pixi, run, style, WHITE, spot);

    copy.tint = ring.color;

    return copy;
  });
}

/**
 * Where every object of one glyph run sits, in the order `buildRun` adds them: its shadow, the
 * copies of its rings, then the run itself.
 *
 * @param style - The style of the label.
 * @param run - The glyph run.
 * @param at - Where the run starts, in the local space of the block.
 * @returns One point per object.
 */
function glyphSpots(style: TextStyle, run: TextRun, at: Point): Point[] {
  const shadow = style.shadow;
  const spots = shadow === undefined ? [] : [{ x: at.x + shadow.dx, y: at.y + shadow.dy }];

  for (const ring of ringsOf(style, run, run.color ?? style.fill)) {
    spots.push(...ringSpots(ring, at));
  }

  spots.push(at);

  return spots;
}

/**
 * Builds the Pixi objects of one run, bottom first: an icon is one sprite, and a glyph run is its
 * shadow when the style has one, its outline and synthetic bold rings, then the glyphs.
 *
 * @param ctx - Domain context of the text plugin.
 * @param pixi - The Pixi module the renderer loaded.
 * @param run - The run to draw.
 * @param style - The style of the label.
 * @param at - Where the run starts, in the local space of the block.
 * @returns The display objects in drawing order.
 */
function buildRun(
  ctx: TextCtx,
  pixi: PixiModule,
  run: Run,
  style: TextStyle,
  at: Point
): PixiContainer[] {
  if (run.kind === "icon") return [buildIcon(ctx, pixi, run, style, at)];

  const fill = run.color ?? style.fill;
  const objects =
    style.shadow === undefined ? [] : [buildShadow(pixi, run, style, style.shadow, at)];

  for (const ring of ringsOf(style, run, fill))
    objects.push(...buildRing(pixi, run, style, ring, at));

  objects.push(buildGlyphs(pixi, run, style, fill, at));

  return objects;
}

/**
 * The style and the laid-out block of one component value.
 *
 * @param ctx - Domain context of the text plugin.
 * @param value - The component value.
 * @returns What the container is filled from.
 */
function labelOf(ctx: TextCtx, value: Readonly<TextValue>): DrawnLabel {
  return { style: styleOf(ctx, value.style), layout: layoutFor(ctx, value.resolved, value.style) };
}

/**
 * Calls `visit` with every run of a laid-out block and where it starts, anchored by the
 * component, line after line.
 *
 * @param ctx - Domain context of the text plugin.
 * @param label - The style and the laid-out block.
 * @param anchor - The anchor of the component.
 * @param visit - Called once per run, in reading order.
 */
function eachRun(
  ctx: TextCtx,
  label: DrawnLabel,
  anchor: Point,
  visit: (run: Run, at: Point) => void
): void {
  const { style, layout } = label;
  const height = lineHeightOf(style, ctx.state.tables);
  const options = { missingGlyph: ctx.config.missingGlyph, warn: warnFor(ctx) };
  const left = -anchor.x * layout.width;
  let y = -anchor.y * layout.height;

  for (const line of layout.lines) {
    let x = left + alignOffset(style, layout, line);

    for (const run of line.runs) {
      visit(run, { x, y });
      x += measureRun(run, style, ctx.state.tables, options);
    }

    y += height;
  }
}

/**
 * Fills a container with the objects of every run of the laid-out block, anchored by the
 * component, and remembers what it was filled from. A shadow sits in the same container as its
 * run, so it follows every update, reflow and destroy of it.
 *
 * @param ctx - Domain context of the text plugin.
 * @param pixi - The Pixi module the renderer loaded.
 * @param container - The container of this label.
 * @param value - The component value to draw.
 * @param label - Its style and laid-out block.
 */
function fill(
  ctx: TextCtx,
  pixi: PixiModule,
  container: PixiContainer,
  value: Readonly<TextValue>,
  label: DrawnLabel
): void {
  eachRun(ctx, label, value.anchor, (run, at) => {
    for (const object of buildRun(ctx, pixi, run, label.style, at)) container.addChild(object);
  });
  ctx.state.drawn.set(container, label);
}

/**
 * Tells whether two runs are drawn with the same objects: an icon of the same key, or glyphs with
 * the same bold, italic and colour. Only the text of a glyph run may differ.
 *
 * @param first - One run.
 * @param second - The other, or nothing.
 * @returns True when the objects of `first` can draw `second`.
 */
function sameObjects(first: Run, second: Run | undefined): boolean {
  if (second === undefined || first.kind !== second.kind) return false;
  if (first.kind === "icon") return second.kind === "icon" && first.key === second.key;

  return (
    second.kind === "text" &&
    first.bold === second.bold &&
    first.italic === second.italic &&
    first.color === second.color
  );
}

/**
 * Tells whether two laid-out blocks have the same lines, each with the same runs.
 *
 * @param drawn - The block the container was filled from.
 * @param next - The block to draw now.
 * @returns True when the objects of `drawn` can draw `next`.
 */
function sameShape(drawn: TextLayout, next: TextLayout): boolean {
  return (
    drawn.lines.length === next.lines.length &&
    drawn.lines.every((line, index) => {
      const runs = next.lines[index]?.runs ?? [];

      return (
        line.runs.length === runs.length && line.runs.every((run, at) => sameObjects(run, runs[at]))
      );
    })
  );
}

/**
 * Writes a new block into the objects already in the container, in the order `fill` added them:
 * the text and the spots of every glyph object, the texture, size and spot of every icon.
 *
 * @param ctx - Domain context of the text plugin.
 * @param pixi - The Pixi module the renderer loaded.
 * @param container - The container of this label.
 * @param value - The component value to draw.
 * @param label - Its style and laid-out block, of the same shape as the drawn one.
 */
function retext(
  ctx: TextCtx,
  pixi: PixiModule,
  container: PixiContainer,
  value: Readonly<TextValue>,
  label: DrawnLabel
): void {
  let index = 0;

  eachRun(ctx, label, value.anchor, (run, at) => {
    if (run.kind === "icon") {
      const sprite = container.getChildAt<PixiSprite>(index);

      sprite.texture = iconTexture(ctx, pixi, run);
      placeIcon(ctx, sprite, label.style, at);
      index += 1;

      return;
    }

    for (const spot of glyphSpots(label.style, run, at)) {
      const glyphs = container.getChildAt<PixiBitmapText>(index);

      glyphs.text = run.text;
      glyphs.x = spot.x;
      glyphs.y = spot.y;
      index += 1;
    }
  });
  ctx.state.drawn.set(container, label);
}

/**
 * Tells whether two anchors are the same point.
 *
 * @param first - One anchor.
 * @param second - The other.
 * @returns True when both coordinates match.
 */
function samePoint(first: Point, second: Point): boolean {
  return first.x === second.x && first.y === second.y;
}

/**
 * Draws a changed value into a container that holds a label already. A ticking counter keeps its
 * objects: with the same style object, the same anchor and the same lines and runs, the new text
 * and spots are written into them. Anything else frees the children and fills the container
 * again.
 *
 * @param ctx - Domain context of the text plugin.
 * @param pixi - The Pixi module the renderer loaded.
 * @param container - The container of this label.
 * @param previous - The value the container was drawn from.
 * @param next - The value to draw now.
 */
function redraw(
  ctx: TextCtx,
  pixi: PixiModule,
  container: PixiContainer,
  previous: Readonly<TextValue>,
  next: Readonly<TextValue>
): void {
  const drawn = ctx.state.drawn.get(container);
  const label = labelOf(ctx, next);

  if (
    drawn?.style === label.style &&
    samePoint(previous.anchor, next.anchor) &&
    sameShape(drawn.layout, label.layout)
  ) {
    retext(ctx, pixi, container, next, label);

    return;
  }

  for (const child of container.removeChildren()) {
    child.destroy({ children: true, texture: false });
  }

  fill(ctx, pixi, container, next, label);
}

/**
 * How a `Text` becomes Pixi objects. The renderer parents, orders and frees the container like a
 * sprite and never calls any of this while it is inert, so a headless run builds nothing.
 *
 * @param ctx - Domain context of the text plugin.
 * @returns The adapter `renderer.sync.displays.provide` takes.
 */
export function createTextAdapter(ctx: TextCtx): DisplayAdapter<TextValue> {
  return {
    create: (value): unknown => {
      const pixi = ctx.deps.renderer.host.pixi();

      if (pixi === undefined) return undefined;

      const container = new pixi.Container();

      fill(ctx, pixi, container, value, labelOf(ctx, value));

      return container;
    },

    update: (object, previous, next): void => {
      const pixi = ctx.deps.renderer.host.pixi();

      if (pixi === undefined || object === undefined) return;
      if (
        previous.resolved === next.resolved &&
        previous.style === next.style &&
        samePoint(previous.anchor, next.anchor)
      ) {
        return;
      }

      redraw(ctx, pixi, asContainer(object), previous, next);
    },

    destroy: (object): void => {
      if (object === undefined) return;

      const container = asContainer(object);

      ctx.state.drawn.delete(container);
      container.destroy({ children: true, texture: false });
    }
  };
}

/**
 * Names what `create` returned. The renderer hands the adapter its own object back, so this is a
 * naming step, not a check.
 *
 * @param object - What `create` returned.
 * @returns The same object as a container.
 */
function asContainer(object: unknown): PixiContainer {
  return object as PixiContainer;
}
