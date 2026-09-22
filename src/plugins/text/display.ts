/**
 * @file text plugin — the screen half: the fonts handed to the renderer, and the display adapter
 * that turns one `Text` into one Pixi container of `BitmapText` runs and icon sprites. Pixi is
 * never imported here: the classes come from the module the renderer loaded.
 */
import type { DisplayAdapter } from "../renderer/sync/types";
import type { PixiContainer, PixiModule, PixiTexture } from "../renderer/types";
import { fontOfRun, lineHeightOf, measureRun, parseAdvances } from "./measure";
import { layoutFor, markDirty, styleOf, warnFor } from "./resolve";
import type { Line, Point, Run, TextCtx, TextLayout, TextRun, TextStyle, TextValue } from "./types";

/** How much of the size a synthetic bold stroke is. */
const SYNTHETIC_BOLD = 20;

/** How far a synthetic italic run leans. */
const SYNTHETIC_ITALIC = -0.2;

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
 * The stroke one run is drawn with: the synthetic bold when the style names no bold font, else
 * the stroke of the style, and nothing when there is none.
 *
 * @param style - The style of the label.
 * @param run - The run to draw.
 * @param fill - The colour the run is filled with.
 * @returns The Pixi stroke style, or `undefined`.
 */
function strokeOf(
  style: TextStyle,
  run: TextRun,
  fill: number
): { color: number; width: number } | undefined {
  if (run.bold && style.bold === undefined) {
    return { color: fill, width: style.size / SYNTHETIC_BOLD };
  }

  if (style.strokeWidth > 0) return { color: style.stroke, width: style.strokeWidth };

  return undefined;
}

/**
 * Builds the Pixi object of one run and places it on the line.
 *
 * @param ctx - Domain context of the text plugin.
 * @param pixi - The Pixi module the renderer loaded.
 * @param run - The run to draw.
 * @param style - The style of the label.
 * @param at - Where the run starts, in the local space of the block.
 * @returns The display object.
 */
function buildRun(
  ctx: TextCtx,
  pixi: PixiModule,
  run: Run,
  style: TextStyle,
  at: Point
): PixiContainer {
  if (run.kind === "icon") {
    const texture: PixiTexture = ctx.deps.assets.texture(run.key) ?? pixi.Texture.EMPTY;
    const sprite = new pixi.Sprite(texture);
    const side = lineHeightOf(style, ctx.state.tables);

    sprite.width = side;
    sprite.height = side;
    sprite.x = at.x;
    sprite.y = at.y;

    return sprite;
  }

  const fill = run.color ?? style.fill;
  const stroke = strokeOf(style, run, fill);
  const line = new pixi.BitmapText({
    text: run.text,
    style: {
      fontFamily: fontOfRun(style, run),
      fontSize: style.size,
      fill,
      letterSpacing: style.letterSpacing,
      ...(stroke === undefined ? {} : { stroke })
    }
  });

  if (run.italic && style.italic === undefined) line.skew.x = SYNTHETIC_ITALIC;

  line.x = at.x;
  line.y = at.y;

  return line;
}

/**
 * Fills a container with one object per run of the laid-out block, anchored by the component.
 *
 * @param ctx - Domain context of the text plugin.
 * @param pixi - The Pixi module the renderer loaded.
 * @param container - The container of this label.
 * @param value - The component value to draw.
 */
function fill(
  ctx: TextCtx,
  pixi: PixiModule,
  container: PixiContainer,
  value: Readonly<TextValue>
): void {
  const style = styleOf(ctx, value.style);
  const layout = layoutFor(ctx, value.resolved, value.style);
  const height = lineHeightOf(style, ctx.state.tables);
  const options = { missingGlyph: ctx.config.missingGlyph, warn: warnFor(ctx) };
  const left = -value.anchor.x * layout.width;
  let y = -value.anchor.y * layout.height;

  for (const line of layout.lines) {
    let x = left + alignOffset(style, layout, line);

    for (const run of line.runs) {
      container.addChild(buildRun(ctx, pixi, run, style, { x, y }));
      x += measureRun(run, style, ctx.state.tables, options);
    }

    y += height;
  }
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

      fill(ctx, pixi, container, value);

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

      const container = asContainer(object);

      for (const child of container.removeChildren()) {
        child.destroy({ children: true, texture: false });
      }

      fill(ctx, pixi, container, next);
    },

    destroy: (object): void => {
      if (object === undefined) return;

      asContainer(object).destroy({ children: true, texture: false });
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
