import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHollowClass } from "../../sync/hollow";
import type { HollowSlice } from "../../sync/types";
import type { PixiModule, PixiTexture } from "../../types";

// ---------------------------------------------------------------------------
// Unit test of the rim-only nine-slice (F59) against the real pixi.js module, no GPU: the engine's class over Pixi's
// `Mesh` keeps 16 vertices and the 48 indices of the eight border cells, and writes its positions and uvs in place as
// Pixi's own `NineSliceGeometry` computes them for a filled panel, so a hollow panel and a filled one draw the same
// rim.
// ---------------------------------------------------------------------------

const Hollow = createHollowClass(pixi as unknown as PixiModule);

afterEach(() => {
  vi.restoreAllMocks();
});

/** The slicing of one case: the four borders and the size. */
type Slicing = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/**
 * A texture of its own source, `width × height`; with a trim, its pixels cover only that part of the frame, as a
 * packed atlas frame whose transparent edge was cut.
 *
 * @param width - Frame width.
 * @param height - Frame height.
 * @param trim - The part of the frame the pixels cover.
 * @returns The texture.
 */
function textureOf(width: number, height: number, trim?: pixi.Rectangle): PixiTexture {
  const source = new pixi.TextureSource({
    width: trim?.width ?? width,
    height: trim?.height ?? height
  });

  return new pixi.Texture({
    source,
    ...(trim === undefined ? {} : { trim, orig: new pixi.Rectangle(0, 0, width, height) })
  }) as unknown as PixiTexture;
}

/**
 * A hollow panel written as `views.ts` writes one: the texture, the four borders, then the size.
 *
 * @param texture - The texture.
 * @param slicing - Borders and size.
 * @returns The panel.
 */
function hollowOf(texture: PixiTexture, slicing: Slicing): HollowSlice {
  const panel = new Hollow(pixi.Texture.WHITE as unknown as PixiTexture);

  panel.texture = texture;
  panel.leftWidth = slicing.left;
  panel.topHeight = slicing.top;
  panel.rightWidth = slicing.right;
  panel.bottomHeight = slicing.bottom;
  panel.width = slicing.width;
  panel.height = slicing.height;

  return panel;
}

/**
 * The geometry of a panel.
 *
 * @param panel - The panel.
 * @returns Pixi's mesh geometry it draws.
 */
function geometryOf(panel: HollowSlice): pixi.MeshGeometry {
  return (panel as unknown as pixi.Mesh).geometry;
}

/**
 * What Pixi's own `NineSliceGeometry` computes for a filled panel of the same texture and slicing, as Pixi's
 * `NineSliceSprite` hands it over: the frame's size, its trim, anchor 0.
 *
 * @param texture - The texture.
 * @param slicing - Borders and size.
 * @returns Pixi's geometry.
 */
function pixiSlicing(texture: PixiTexture, slicing: Slicing): pixi.NineSliceGeometry {
  return new pixi.NineSliceGeometry({
    width: slicing.width,
    height: slicing.height,
    originalWidth: texture.width,
    originalHeight: texture.height,
    leftWidth: slicing.left,
    topHeight: slicing.top,
    rightWidth: slicing.right,
    bottomHeight: slicing.bottom,
    anchor: { x: 0, y: 0 },
    ...(texture.trim === undefined ? {} : { trim: texture.trim })
  });
}

/**
 * The numbers of an array, `-0` read as `0` (Pixi writes `-0` where its anchor offset is 0).
 *
 * @param numbers - Positions or uvs.
 * @returns A plain array.
 */
function plain(numbers: ArrayLike<number>): number[] {
  return Array.from(numbers, value => value + 0);
}

describe("the rim-only nine-slice", () => {
  // Bug: the centre cell is in the index buffer (the hollow panel fills its middle), or a border cell is missing.
  it("has 16 vertices and the 48 indices of Pixi's 4 × 4 plane without the centre cell, and batches", () => {
    const panel = hollowOf(textureOf(200, 100), {
      left: 48,
      top: 40,
      right: 32,
      bottom: 24,
      width: 600,
      height: 320
    });
    const plane = new pixi.PlaneGeometry({ verticesX: 4, verticesY: 4 });
    // Cell (1, 1) is the fifth of nine, six indices a cell.
    const rim = [...plane.indices.slice(0, 24), ...plane.indices.slice(30)];

    expect(geometryOf(panel).positions).toHaveLength(32);
    expect([...geometryOf(panel).indices]).toEqual([...rim]);
    // A mesh of 16 vertices with no shader joins the batch of the sprites around it: one draw per batch.
    expect((panel as unknown as pixi.Mesh).batched).toBe(true);
  });

  // Bug: a hollow panel cuts its rim elsewhere than a filled one: wrong overlap scale, uvs off the frame or its trim.
  it.each([
    ["a panel larger than its borders", 200, 100, undefined, [48, 40, 32, 24, 600, 320]],
    [
      "corners that overlap across, all four shrunk",
      200,
      100,
      undefined,
      [48, 40, 32, 24, 60, 320]
    ],
    ["corners that overlap down only", 200, 100, undefined, [48, 40, 32, 24, 600, 50]],
    [
      "a trimmed atlas frame",
      200,
      100,
      new pixi.Rectangle(10, 5, 180, 90),
      [48, 40, 32, 24, 600, 320]
    ]
  ] as const)("writes Pixi's positions and uvs: %s", (_name, width, height, trim, numbers) => {
    const [left, top, right, bottom, panelWidth, panelHeight] = numbers;
    const slicing = { left, top, right, bottom, width: panelWidth, height: panelHeight };
    const texture = textureOf(width, height, trim);
    const panel = hollowOf(texture, slicing);
    const filled = pixiSlicing(texture, slicing);

    expect(plain(geometryOf(panel).positions)).toEqual(plain(filled.positions));
    expect(plain(geometryOf(panel).uvs)).toEqual(plain(filled.uvs));
  });

  // Bug: a fresh panel of size 0 with no border has NaN positions (Pixi's 0 / 0), so its bounds poison the
  // off-screen test.
  it("puts every vertex of a 0 × 0 panel without borders at the origin", () => {
    const panel = new Hollow(pixi.Texture.WHITE as unknown as PixiTexture);

    expect(plain(geometryOf(panel).positions)).toEqual(Array.from({ length: 32 }, () => 0));
  });

  // Bug: a resize makes new arrays (garbage every frame of a size tween), or rewrites the uvs, or an equal write
  // rewrites the buffer (Pixi uploads the vertices again).
  it("rewrites the positions in place on a resize, leaves the uvs, and writes nothing for an equal number", () => {
    const texture = textureOf(200, 100);
    const panel = hollowOf(texture, {
      left: 48,
      top: 40,
      right: 32,
      bottom: 24,
      width: 600,
      height: 320
    });
    const geometry = geometryOf(panel);
    const positions = geometry.positions;
    const uvs = plain(geometry.uvs);
    const positionUpdate = vi.spyOn(geometry.getBuffer("aPosition"), "update");
    const uvUpdate = vi.spyOn(geometry.getBuffer("aUV"), "update");

    panel.width = 700;

    expect(geometry.positions).toBe(positions);
    expect(plain(positions)).toEqual(
      plain(
        pixiSlicing(texture, {
          left: 48,
          top: 40,
          right: 32,
          bottom: 24,
          width: 700,
          height: 320
        }).positions
      )
    );
    expect(plain(geometry.uvs)).toEqual(uvs);
    expect(uvUpdate).not.toHaveBeenCalled();
    expect(positionUpdate).toHaveBeenCalledTimes(1);

    panel.width = 700;
    panel.leftWidth = 48;

    expect(positionUpdate).toHaveBeenCalledTimes(1);
  });

  // Bug: the uvs stay cut for the texture drawn before, so a new texture of another frame size is sampled wrong.
  it("cuts the uvs again, in place, when it gets a texture of another frame", () => {
    const slicing = { left: 48, top: 40, right: 32, bottom: 24, width: 600, height: 320 };
    const panel = hollowOf(textureOf(200, 100), slicing);
    const uvs = geometryOf(panel).uvs;
    const wider = textureOf(400, 160);

    panel.texture = wider;

    expect(geometryOf(panel).uvs).toBe(uvs);
    expect(plain(uvs)).toEqual(plain(pixiSlicing(wider, slicing).uvs));
    expect(panel.texture).toBe(wider);
  });
});
