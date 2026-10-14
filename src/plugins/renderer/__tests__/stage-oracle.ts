/**
 * @file The tree oracle of the render-on-demand tests (spec 14 T0, K1). Not a test. After every
 * frame it reads whether the frame was drawn and a fingerprint of everything the player can see,
 * from public Pixi properties only, and fails a frame that was skipped while the screen differs
 * from the last drawn one: a missed mark, a frozen view. It is written apart from the renderer's
 * own `demand/shown.ts` and imports nothing of it, so a hole in the renderer's rule is not
 * repeated here.
 */
import type * as Pixi from "pixi.js";
import { expect } from "vitest";
import type { StageApplication } from "./stage-pixi";

/** The real Pixi classes the oracle tells nodes apart by. */
type PixiClasses = Pick<
  typeof Pixi,
  "BitmapText" | "Graphics" | "NineSliceSprite" | "ParticleContainer" | "Sprite" | "Text"
>;

/**
 * One frame the oracle saw skipped while the picture differed: the first line that differs, as
 * the player sees it now and as the last drawn frame showed it.
 */
export type MissedFrame = { frame: number; node: string; was: string };

/** What a test drives the oracle with. */
export type FrameOracle = {
  /** Reads the frame that just ran: drawn or skipped, and what the player sees. */
  check(): void;
  /** Every skipped frame whose picture differed from the last drawn one. */
  readonly missed: MissedFrame[];
  /** Frames checked, and of them drawn. */
  readonly counts: { frames: number; drawn: number };
  /** Fails the test when a skipped frame differed from the last drawn one, naming the first node. */
  expectNoMissedFrame(): void;
};

/**
 * The values of a uniform group as text: numbers, and arrays copied element by element.
 *
 * @param uniforms - The uniforms of a group.
 * @returns Their text.
 */
function uniformText(uniforms: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [name, value] of Object.entries(uniforms)) {
    if (typeof value === "number" || typeof value === "boolean") parts.push(`${name}=${value}`);
    else if (ArrayBuffer.isView(value)) parts.push(`${name}=[${String(value)}]`);
    else if (Array.isArray(value)) parts.push(`${name}=[${value.map(String).join(",")}]`);
  }

  return parts.join(";");
}

/**
 * The oracle's view of the stage of one stand-in application.
 *
 * @param app - The stand-in application the renderer draws with.
 * @param pixi - The real Pixi module, for its classes.
 * @returns The oracle.
 */
export function watchFrames(app: StageApplication, pixi: PixiClasses): FrameOracle {
  const ids = new WeakMap<object, number>();
  const redraws = new WeakMap<object, { count: number }>();
  const missed: MissedFrame[] = [];
  const counts = { frames: 0, drawn: 0 };
  let lastRenders = app.renderer.renders;
  let lastDrawn: string[] | undefined;
  let lastId = 0;

  /**
   * The oracle's own id of an object, stable while the object lives.
   *
   * @param object - Any object of the tree.
   * @returns Its id; 0 for none.
   */
  const idOf = (object: object | null | undefined): number => {
    if (object === null || object === undefined) return 0;

    const known = ids.get(object);

    if (known !== undefined) return known;

    lastId += 1;
    ids.set(object, lastId);

    return lastId;
  };

  /**
   * How often a graphics context told the world it changed since the oracle first saw it: a
   * redraw is a change, an equal one too.
   *
   * @param context - The context of a `Graphics`.
   * @param context.on - Its public event subscription.
   * @returns The count.
   */
  const redrawsOf = (context: { on(event: "update", fn: () => void): unknown }): number => {
    let seen = redraws.get(context);

    if (seen === undefined) {
      const counter = { count: 0 };

      seen = counter;
      redraws.set(context, counter);
      context.on("update", () => {
        counter.count += 1;
      });
    }

    return seen.count;
  };

  /**
   * The filters of a node as text: identity, switch, padding and every uniform value.
   *
   * @param node - The node.
   * @returns Their text.
   */
  const filtersText = (node: Pixi.Container): string => {
    const filters = node.filters as readonly Pixi.Filter[] | null | undefined;

    if (filters === null || filters === undefined || filters.length === 0) return "";

    return filters
      .map(filter => {
        const resources = Object.values(filter.resources as Record<string, unknown>)
          .map(resource =>
            typeof resource === "object" && resource !== null && "uniforms" in resource
              ? uniformText((resource as { uniforms: Record<string, unknown> }).uniforms)
              : ""
          )
          .join("|");

        return `f${idOf(filter)}:${filter.enabled}:${filter.padding}:${resources}`;
      })
      .join(",");
  };

  /**
   * What one counted node looks like, by its kind.
   *
   * @param node - The node.
   * @returns Its text.
   */
  const lookText = (node: Pixi.Container): string => {
    if (node instanceof pixi.NineSliceSprite) {
      return `nine t${idOf(node.texture)} ${node.width}x${node.height} ${node.leftWidth},${node.topHeight},${node.rightWidth},${node.bottomHeight}`;
    }

    if (node instanceof pixi.Sprite) {
      const frame = node.texture.frame;

      return `sprite t${idOf(node.texture)} ${frame.x},${frame.y},${frame.width},${frame.height} a${node.anchor.x},${node.anchor.y}`;
    }

    if (node instanceof pixi.Graphics) {
      return `graphics c${idOf(node.context)} r${redrawsOf(node.context)}`;
    }

    if (node instanceof pixi.BitmapText || node instanceof pixi.Text) {
      return `text ${node.text} ${String(node.style.fontFamily)} ${String(node.style.fontSize)} ${JSON.stringify(node.style.fill)}`;
    }

    if (node instanceof pixi.ParticleContainer) {
      return `particles ${node.particleChildren
        .map(
          particle =>
            `${particle.x},${particle.y},${particle.scaleX},${particle.scaleY},${particle.rotation},${particle.tint},${particle.alpha},t${idOf(particle.texture)}`
        )
        .join(";")}`;
    }

    return "container";
  };

  /**
   * Whether a leaf lands on the screen, its bounds padded by the filters of its chain.
   *
   * @param node - The leaf.
   * @param pad - The paddings of its chain.
   * @returns True when some of it is on the screen.
   */
  const meetsScreen = (node: Pixi.Container, pad: number): boolean => {
    const bounds = node.getBounds();
    const screen = app.screen;

    if (bounds.width <= 0 || bounds.height <= 0) return false;

    return (
      bounds.maxX + pad > screen.x &&
      bounds.minX - pad < screen.x + screen.width &&
      bounds.maxY + pad > screen.y &&
      bounds.minY - pad < screen.y + screen.height
    );
  };

  /**
   * Walks the stage in child order and writes one line per node the player can see: a leaf on the
   * screen, and a container above at least one of them (a container draws nothing itself, so an
   * empty one, or one whose children are all unseen, is left out).
   *
   * @param node - The node.
   * @param pad - The paddings of the filters above it.
   * @param into - Where the lines go.
   * @param place - Its place among the siblings the player sees: a sibling nobody sees moves no
   *   pixel when it leaves.
   * @returns True when the node or something under it is seen.
   */
  const walk = (node: Pixi.Container, pad: number, into: string[], place: number): boolean => {
    if (!node.visible || !node.renderable || node.alpha <= 0) return false;

    const filters = node.filters as readonly Pixi.Filter[] | null | undefined;
    let padding = pad;

    for (const filter of filters ?? []) padding += filter.padding;

    // A leaf (a particle container is one: particles are not children) off the screen is not seen.
    if (node.children.length === 0 && !meetsScreen(node, padding)) return false;

    const parent = node.parent;
    const at = into.length;

    into.push(
      [
        `#${idOf(node)}`,
        node.constructor.name,
        JSON.stringify(node.label),
        `p${idOf(parent)}`,
        `i${place}`,
        `${node.x},${node.y},${node.rotation},${node.scale.x},${node.scale.y}`,
        `${node.pivot.x},${node.pivot.y},${node.skew.x},${node.skew.y}`,
        `a${node.alpha} tint${node.tint} b${node.blendMode} z${node.zIndex}`,
        `m${idOf(node.mask as object | null)}`,
        filtersText(node),
        lookText(node)
      ].join(" ")
    );

    if (node.children.length === 0) return true;

    let seen = 0;

    for (const child of node.children) if (walk(child, padding, into, seen)) seen += 1;

    if (seen === 0) into.length = at;

    return seen > 0;
  };

  /**
   * What the player sees now, one line per node.
   *
   * @returns The lines.
   */
  const fingerprint = (): string[] => {
    const lines: string[] = [];

    walk(app.stage, 0, lines, 0);

    return lines;
  };

  return {
    missed,
    counts,
    check: () => {
      const renders = app.renderer.renders;
      const drawn = renders > lastRenders;
      const now = fingerprint();

      lastRenders = renders;
      counts.frames += 1;

      if (drawn || lastDrawn === undefined) {
        if (drawn) counts.drawn += 1;
        lastDrawn = now;

        return;
      }

      const before = lastDrawn;
      const at = now.findIndex((line, index) => line !== before[index]);

      if (at === -1 && now.length === before.length) return;

      const index = at === -1 ? now.length : at;

      missed.push({ frame: counts.frames, node: now[index] ?? "", was: before[index] ?? "" });
    },
    expectNoMissedFrame: () => {
      expect(missed, "a skipped frame showed a picture other than the last drawn one").toEqual([]);
    }
  };
}
