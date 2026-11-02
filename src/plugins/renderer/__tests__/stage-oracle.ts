/**
 * @file The tree oracle of the render-on-demand tests (spec 14 T0, K1). Not a test. After every
 * frame it reads whether the frame was drawn and a fingerprint of everything the player can see,
 * from public Pixi properties only, and fails a frame that was skipped while the screen differs
 * from the last drawn one: a missed mark, a frozen view. It is written apart from the renderer's
 * own `demand/shown.ts` and imports nothing of it, so a hole in the renderer's rule is not
 * repeated here.
 *
 * The picture oracle of spec 23 (P13.1, D-f) watches the renders into textures the stand-in logs
 * and checks every drawn frame at its stage render: a sprite that shows a filter output is a
 * quad, followed back to the stand-in and the top it was drawn from; it fails when the top's
 * subtree or the stand-in's filters differ from what was rendered, when the top is drawn too, when
 * the quad is not where the picture lands, and when a top hidden for its picture is shown by no
 * quad. A sprite beside the container whose picture it shows is a quad drawn direct (a stack of
 * alphas, F54), checked as a quad with no stand-in. A mesh whose shader reads a texture an engine
 * render drew into is the quad of a shaded view (F126 stage 2): checked as a quad over the copy of
 * its picture, on a unit square. A sprite that shows a copy with no filter over it is a padded
 * picture left on the screen. Any other sprite that shows a picture of a
 * container directly is a range picture: its leaves must
 * not be drawn live beside it, its nodes must be as they were rendered, and it must not be in its
 * own picture. It imports nothing of the kept module either.
 */
import type * as Pixi from "pixi.js";
import { expect } from "vitest";
import type { RenderCall, StageApplication } from "./stage-pixi";

/** The real Pixi classes the oracle tells nodes apart by. */
type PixiClasses = Pick<
  typeof Pixi,
  "BitmapText" | "Graphics" | "Mesh" | "NineSliceSprite" | "ParticleContainer" | "Sprite" | "Text"
>;

/**
 * One frame the oracle saw skipped while the picture differed: the first line that differs, as
 * the player sees it now and as the last drawn frame showed it.
 */
export type MissedFrame = { frame: number; node: string; was: string };

/** One drawn frame whose pictures were not current: the top's label and the first field that differs. */
export type StalePicture = { frame: number; picture: string; field: string };

/** What a test drives the oracle with. */
export type FrameOracle = {
  /** Reads the frame that just ran: drawn or skipped, and what the player sees. */
  check(): void;
  /** Every skipped frame whose picture differed from the last drawn one. */
  readonly missed: MissedFrame[];
  /** Every drawn frame whose kept pictures were not what their tops draw now (spec 23 P13.1). */
  readonly pictures: StalePicture[];
  /** Frames checked, and of them drawn. */
  readonly counts: { frames: number; drawn: number };
  /** Fails the test when a skipped frame differed from the last drawn one, naming the first node. */
  expectNoMissedFrame(): void;
  /** Fails the test when a drawn frame showed a picture that was not current, naming the top and the field. */
  expectPicturesCurrent(): void;
};

/** A render of a container into a texture: a view's subtree picture, or a range picture of the stage root. */
type PictureRender = {
  container: Pixi.Container;
  /** The container's subtree as drawn in that call, one line per node, the container's own pose left out. */
  lines: Map<object, string>;
  /** The leaves drawn in that call. */
  leaves: Set<object>;
  /** The transform it was drawn with. */
  transform: NonNullable<RenderCall["transform"]>;
};

/** A render of a sprite of a picture into a texture: the stand-in of a filter output, with its filters then. */
type StandInRender = {
  standIn: Pixi.Sprite;
  /** The picture it drew: one copy sprite draws every padded picture, its texture set before the render. */
  picture: Pixi.Texture;
  filters: string;
  transform: NonNullable<RenderCall["transform"]>;
};

/** A transform with no move and no scale. */
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as const;

/** The numbers of a 2D affine transform, in Pixi's order: x' = a·x + c·y + tx, y' = b·x + d·y + ty. */
type Affine = { a: number; b: number; c: number; d: number; tx: number; ty: number };

/**
 * The product `m · n`: `n` first, then `m`.
 *
 * @param m - The outer transform.
 * @param n - The inner transform.
 * @returns The product.
 */
function times(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    tx: m.a * n.tx + m.c * n.ty + m.tx,
    ty: m.b * n.tx + m.d * n.ty + m.ty
  };
}

/**
 * The inverse of an affine transform.
 *
 * @param m - The transform.
 * @returns Its inverse.
 */
function inverted(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;

  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    tx: (m.c * m.ty - m.d * m.tx) / det,
    ty: (m.b * m.tx - m.a * m.ty) / det
  };
}

/** A quad lands where its picture does within this much, CSS px. */
const PLACE_TOLERANCE = 1e-6;

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
  const pictures: StalePicture[] = [];
  /** Renders into each texture so far: a quad of a texture drawn again is another picture. */
  const versions = new WeakMap<object, number>();
  const pictureRenders = new WeakMap<object, PictureRender>();
  const standInRenders = new WeakMap<object, StandInRender>();
  /** The texture of each source a render drew into: a mesh's shader names the source. */
  const targets = new WeakMap<object, Pixi.Texture>();
  /** Every top a filter output was drawn from: a view kept as a quad. */
  const pictured = new Set<Pixi.Container>();
  /** The tops the quads of the last check drew: walked as drawn by the frame oracle. */
  let throughTops = new Set<Pixi.Container>();
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
        // Pixi defines its resource accessors without `enumerable`: their names are read, not their keys.
        const held = filter.resources as Record<string, unknown>;
        const resources = Object.getOwnPropertyNames(held)
          .map(name => held[name])
          .map(resource =>
            typeof resource === "object" && resource !== null && "uniforms" in resource
              ? uniformText((resource as { uniforms: Record<string, unknown> }).uniforms)
              : ""
          )
          .join("|");

        // A disabled filter draws nothing: its values are not on the screen.
        return `f${idOf(filter)}:${filter.enabled}:${filter.padding}:${filter.enabled ? resources : ""}`;
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

      return `sprite t${idOf(node.texture)} v${versions.get(node.texture) ?? 0} ${frame.x},${frame.y},${frame.width},${frame.height} a${node.anchor.x},${node.anchor.y}`;
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
    // A top hidden for its kept picture is seen through its quad: what it draws is what the player sees.
    if (!node.visible || (!node.renderable && !throughTops.has(node)) || node.alpha <= 0) {
      return false;
    }

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

  /**
   * The line of one node of a picture: the frame oracle's fields, its place among the siblings the picture drew, the
   * pose left out for the picture's root.
   *
   * @param node - The node.
   * @param root - True for the container the picture was rendered from.
   * @param place - Its place among the siblings the picture drew.
   * @returns Its text.
   */
  const pictureLine = (node: Pixi.Container, root: boolean, place: number): string =>
    [
      `#${idOf(node)}`,
      node.constructor.name,
      JSON.stringify(node.label),
      root ? "root" : `p${idOf(node.parent)} i${place}`,
      root ? "" : `${node.x},${node.y},${node.rotation},${node.scale.x},${node.scale.y}`,
      root ? "" : `${node.pivot.x},${node.pivot.y},${node.skew.x},${node.skew.y}`,
      // The root's depth sorts its quad among the siblings, never the picture; its alpha is its quad's (F120).
      `a${root ? "" : node.alpha} tint${node.tint} b${node.blendMode} z${root ? "" : node.zIndex}`,
      `m${idOf(node.mask as object | null)}`,
      filtersText(node),
      lookText(node)
    ].join(" ");

  /**
   * What a render of a container draws: every node of its subtree it reaches, as Pixi collects a render group's root
   * (the root itself without the display test, its children by their own flags).
   *
   * @param root - The container rendered.
   * @param lines - Where each node's line goes.
   * @param leaves - Where the drawn leaves go.
   * @param node - The node walked now.
   */
  const drawnBy = (
    root: Pixi.Container,
    lines: Map<object, string>,
    leaves: Set<object>,
    node: Pixi.Container = root,
    place = 0
  ): boolean => {
    if (node !== root && (!node.visible || !node.renderable || node.alpha <= 0)) return false;

    lines.set(node, pictureLine(node, node === root, place));

    if (node.children.length === 0) leaves.add(node);

    let drawnSiblings = 0;

    for (const child of node.children) {
      if (drawnBy(root, lines, leaves, child, drawnSiblings)) drawnSiblings += 1;
    }

    return true;
  };

  /**
   * The place of a node among its siblings a picture drew.
   *
   * @param node - The node.
   * @param lines - The picture's lines.
   * @returns Its place.
   */
  const placeIn = (node: Pixi.Container, lines: ReadonlyMap<object, string>): number => {
    let place = 0;

    for (const sibling of node.parent?.children ?? []) {
      if (sibling === node) break;
      if (lines.has(sibling)) place += 1;
    }

    return place;
  };

  /**
   * Tells whether a node is drawn in the stage pass: it and every node up to the stage are visible, renderable and
   * not fully transparent.
   *
   * @param node - The node.
   * @returns True when the stage pass draws it.
   */
  const drawnInStage = (node: Pixi.Container): boolean => {
    for (let at: Pixi.Container | null = node; at !== app.stage; at = at.parent) {
      if (at === null || !at.visible || !at.renderable || at.alpha <= 0) return false;
    }

    return true;
  };

  /**
   * The texture a node draws: a sprite's own, or the one a mesh's shader reads, which a nine-slice's mesh has not.
   *
   * @param node - The node.
   * @returns The texture, or `undefined`.
   */
  const shownBy = (node: Pixi.Container): Pixi.Texture | undefined => {
    if (node instanceof pixi.Sprite) return node.texture;

    const source: unknown = node instanceof pixi.Mesh ? node.shader?.resources.uTexture : undefined;

    return typeof source === "object" && source !== null ? targets.get(source) : undefined;
  };

  /**
   * Every sprite and mesh the stage pass draws whose texture an engine render drew into: quads and range sprites.
   *
   * @param node - The node walked now.
   * @param into - Where they go.
   * @returns The same list.
   */
  const shownPictures = (node: Pixi.Container, into: Pixi.Container[] = []): Pixi.Container[] => {
    if (!node.visible || !node.renderable || node.alpha <= 0) return into;

    const texture = shownBy(node);

    if (texture !== undefined && versions.has(texture)) into.push(node);

    for (const child of node.children) shownPictures(child, into);

    return into;
  };

  /**
   * Notes a failed picture of the frame being drawn.
   *
   * @param picture - The top's label, or the range sprite's.
   * @param field - What differs.
   */
  const fail = (picture: string, field: string): void => {
    pictures.push({ frame: counts.frames + 1, picture, field });
  };

  /**
   * The first line of a picture that differs from what its container draws now, or `undefined`.
   *
   * @param rendered - The picture.
   * @returns The line as it is now, or the line rendered when the node left.
   */
  const staleLine = (rendered: PictureRender): string | undefined => {
    const lines = new Map<object, string>();

    drawnBy(rendered.container, lines, new Set());

    for (const [node, line] of rendered.lines) {
      const now = lines.get(node);

      if (now !== line) return now ?? `gone: ${line}`;
    }

    for (const [node, line] of lines) if (!rendered.lines.has(node)) return `new: ${line}`;

    return undefined;
  };

  /**
   * Checks one quad (P13.1 a–d): the top's subtree and its linear part, the stand-in's filters, no double draw, the
   * place of the quad.
   *
   * @param quad - The sprite of a filter output, or the mesh over a copy of a picture.
   * @param standIn - The render of its stand-in.
   */
  const checkQuad = (quad: Pixi.Container, standIn: StandInRender): void => {
    const rendered = pictureRenders.get(standIn.picture);

    if (rendered === undefined) {
      fail(quad.label, "a quad whose stand-in shows no picture");

      return;
    }

    const top = rendered.container;
    const name = top.label;
    const world = top.getGlobalTransform(undefined, false);
    const { transform } = rendered;
    const stale = staleLine(rendered);

    if (stale !== undefined) fail(name, `subtree: ${stale}`);

    if (filtersText(standIn.standIn) !== standIn.filters) {
      fail(name, `filters: ${filtersText(standIn.standIn)}`);
    }

    // The copy of a picture is for a shader to read: a sprite of it shows no filter at all.
    if (quad !== standIn.standIn && quad instanceof pixi.Sprite && standIn.filters === "") {
      fail(name, "a sprite shows the padded picture of a shaded view");
    }

    if (drawnInStage(top)) fail(name, "the top is drawn beside its quad");
    // The picture leaves the top's own alpha out, the quad draws it (F120); a quad drawn direct (F54) also carries the
    // alpha of its stack, so only the quad of a stand-in is compared.
    if (standIn.standIn !== quad && Math.abs(quad.alpha - top.alpha) > PLACE_TOLERANCE) {
      fail(name, `quad alpha ${quad.alpha}, top alpha ${top.alpha}`);
    }
    if (quad.zIndex !== top.zIndex)
      fail(name, `quad depth ${quad.zIndex}, top depth ${top.zIndex}`);

    // The picture lands where the top draws now: `W · T⁻¹ · S⁻¹`, this frame's world transform after the inverse of
    // the one it was taken at and of the stand-in's offset. A changed linear part draws it scaled (F67).
    const placed = quad.getGlobalTransform(undefined, false);
    const lands = times(times(world, inverted(transform)), inverted(standIn.transform));
    // A mesh stands on the unit square: its transform carries the size a sprite takes from its texture.
    const shown = quad instanceof pixi.Mesh ? shownBy(quad) : undefined;
    const across = shown?.width ?? 1;
    const down = shown?.height ?? 1;

    if (
      Math.abs(placed.tx - lands.tx) > PLACE_TOLERANCE ||
      Math.abs(placed.ty - lands.ty) > PLACE_TOLERANCE ||
      Math.abs(placed.a - lands.a * across) > PLACE_TOLERANCE ||
      Math.abs(placed.b - lands.b * across) > PLACE_TOLERANCE ||
      Math.abs(placed.c - lands.c * down) > PLACE_TOLERANCE ||
      Math.abs(placed.d - lands.d * down) > PLACE_TOLERANCE
    ) {
      fail(name, `quad at ${placed.tx},${placed.ty}, its picture lands at ${lands.tx},${lands.ty}`);
    }

    throughTops.add(top);
  };

  /**
   * Checks one range picture (P13.1 c, e): its nodes as they were rendered, no leaf of it drawn live beside it, and the
   * sprite out of its own picture.
   *
   * @param sprite - The sprite of a range picture.
   * @param rendered - Its render.
   */
  const checkRange = (sprite: Pixi.Sprite, rendered: PictureRender): void => {
    if (rendered.lines.has(sprite)) fail(sprite.label, "the sprite is in its own picture");

    for (const leaf of rendered.leaves) {
      if (leaf !== sprite && drawnInStage(leaf as Pixi.Container)) {
        fail(sprite.label, `drawn live beside its picture: ${rendered.lines.get(leaf) ?? ""}`);

        return;
      }
    }

    for (const [node, line] of rendered.lines) {
      const at = node as Pixi.Container;
      const now = pictureLine(at, at === rendered.container, placeIn(at, rendered.lines));

      if (now !== line && node !== rendered.container) {
        fail(sprite.label, `entry: ${now}`);

        return;
      }
    }
  };

  /**
   * Checks the pictures of the frame at its stage render, and that no top hidden for its picture is left without a
   * quad (no frame shows neither).
   */
  const checkPictures = (): void => {
    const inRanges = new Set<object>();

    throughTops = new Set();

    for (const shown of shownPictures(app.stage)) {
      const texture = shownBy(shown) as Pixi.Texture;
      const standIn = standInRenders.get(texture);
      const rendered = pictureRenders.get(texture);
      const sprite = shown as Pixi.Sprite;

      if (standIn !== undefined) checkQuad(shown, standIn);
      else if (rendered !== undefined && rendered.container.parent === sprite.parent) {
        // A quad that draws its top's subtree picture itself (a stack of alphas, F54): beside its top, no stand-in.
        checkQuad(sprite, {
          standIn: sprite,
          picture: texture,
          filters: filtersText(sprite),
          transform: IDENTITY
        });
        pictured.add(rendered.container);
      } else if (rendered !== undefined) {
        checkRange(sprite, rendered);
        noteRange(rendered, inRanges);
      }
    }

    for (const top of pictured) {
      if (unseenTop(top, inRanges)) fail(top.label, "hidden for a picture that no quad shows");
    }
  };

  /**
   * Notes what a shown range picture draws: its nodes, and the top of every quad drawn into it.
   *
   * @param rendered - The range picture.
   * @param inRanges - Where the nodes go.
   */
  const noteRange = (rendered: PictureRender, inRanges: Set<object>): void => {
    for (const node of rendered.lines.keys()) {
      inRanges.add(node);

      const texture = shownBy(node as Pixi.Container);
      const quad = texture === undefined ? undefined : standInRenders.get(texture);
      const top = quad === undefined ? undefined : pictureRenders.get(quad.picture);
      // A quad drawn direct (F54) shows its top's picture itself, beside the top.
      const direct = node instanceof pixi.Sprite ? pictureRenders.get(node.texture) : undefined;

      if (top !== undefined) inRanges.add(top.container);
      if (direct !== undefined && direct.container.parent === (node as Pixi.Sprite).parent) {
        inRanges.add(direct.container);
      }
    }
  };

  /**
   * Tells whether a node is a quad drawn direct (F54) of a top's picture, shown at alpha 0.
   *
   * @param node - A sibling of the top.
   * @param top - The top.
   * @returns True when it is.
   */
  const fadedOut = (node: Pixi.Container, top: Pixi.Container): boolean =>
    node instanceof pixi.Sprite &&
    node.visible &&
    node.renderable &&
    node.alpha <= 0 &&
    pictureRenders.get(node.texture)?.container === top;

  /**
   * Tells whether a top hidden for its picture would be seen without it, while neither a quad nor a range picture
   * shows it: the frame shows neither the view nor its picture.
   *
   * @param top - A top a filter output was drawn from.
   * @param inRanges - What the shown range pictures draw.
   * @returns True when the player sees nothing of it.
   */
  const unseenTop = (top: Pixi.Container, inRanges: ReadonlySet<object>): boolean => {
    if (top.destroyed || top.renderable || throughTops.has(top) || inRanges.has(top)) return false;
    if (top.parent === null || !top.visible || top.alpha <= 0) return false;
    // A quad drawn direct at its stack's alpha 0 (F54) shows the top as the alpha pass would: not at all.
    if (top.parent.children.some(sibling => fadedOut(sibling, top))) return false;

    for (let at: Pixi.Container | null = top.parent; at !== app.stage; at = at.parent) {
      if (at === null || !at.visible || !at.renderable || at.alpha <= 0) return false;
    }

    return true;
  };

  /**
   * Notes a render: into a texture, what it drew; onto the canvas, the check of the pictures.
   *
   * @param call - The render call.
   */
  const onRender = (call: RenderCall): void => {
    const { target, container } = call;

    if (target === undefined) {
      checkPictures();

      return;
    }

    versions.set(target, (versions.get(target) ?? 0) + 1);
    targets.set(target.source, target);

    const transform = call.transform ?? IDENTITY;

    const picture =
      container instanceof pixi.Sprite ? pictureRenders.get(container.texture) : undefined;

    if (container instanceof pixi.Sprite && picture !== undefined) {
      standInRenders.set(target, {
        standIn: container,
        picture: container.texture,
        filters: filtersText(container),
        transform
      });
      pictured.add(picture.container);

      return;
    }

    const lines = new Map<object, string>();
    const leaves = new Set<object>();

    drawnBy(container, lines, leaves);
    // A pooled texture changes roles: what was a filter output is a subtree picture now, not a stand-in's render.
    standInRenders.delete(target);
    pictureRenders.set(target, { container, lines, leaves, transform });
  };

  app.renderer.watchers.push(onRender);

  return {
    missed,
    pictures,
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
    },
    expectPicturesCurrent: () => {
      expect(pictures, "a drawn frame showed a kept picture that was not current").toEqual([]);
    }
  };
}
