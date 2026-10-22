/**
 * @file renderer/sync — the rim-only nine-slice (F59): a frame or a glass panel whose centre is empty draws its eight
 * border cells and never the centre. It is the engine's own class over Pixi's public `Mesh` and `MeshGeometry`: 16
 * vertices (the 4 × 4 grid of the cut lines) and a static index buffer of 48 (eight quads, the centre cell (1, 1) left
 * out). It takes the same writable numbers as Pixi's `NineSliceSprite` (the four slice widths, the size, the tint and
 * the texture), so the writes of `views.ts` drive either object unchanged. Positions and uvs are written in place into
 * the geometry's own arrays, the way Pixi 8.22's `NineSliceGeometry` computes them: the corners keep their size until
 * two of them would overlap, then all four shrink by one factor; the uvs cut the texture's frame (its trim, when it has
 * one) at the unscaled borders. A size or a border that changes rewrites the positions, a border or a texture the uvs;
 * nothing is rebuilt and nothing is allocated. No Pixi class is patched and `NineSliceSprite` is not subclassed: the
 * class extends the loaded module's `Mesh`, made once per module, since Pixi arrives lazily.
 */
import type { PixiModule, PixiTexture } from "../types";
import { type SliceBorders, sliceScale } from "./outline";
import type { HollowClass, HollowSlice, SyncState } from "./types";

/** The vertices across and down: the four cut lines of a nine-slice on each axis. */
const SIDE = 4;

/** The vertices of the grid. */
const VERTICES = SIDE * SIDE;

/** The cells of the 3 × 3 slicing on each axis. */
const CELLS = SIDE - 1;

/** The cell left out, row by row: the centre, (1, 1). */
const CENTRE = 4;

/** Indices of one quad: two triangles. */
const QUAD = 6;

/**
 * The four lines a nine-slice is cut at on one axis: its start, the line of the near border, the line of the far
 * border and its end; positions in units, or uvs in the texture.
 */
type Cuts = { start: number; near: number; far: number; end: number };

/** The part of a texture's frame its pixels cover: Pixi's `trim`, absent on a texture without one. */
type Trim = { x: number; y: number; width: number; height: number };

/**
 * The index buffer of the rim: the two triangles of every cell of the 3 × 3 slicing but the centre, in Pixi's
 * `PlaneGeometry` winding. Static: written once per geometry.
 *
 * @returns 48 indices into the 16 vertices.
 * @example
 * ```ts
 * rimIndices().length; // 48
 * ```
 */
function rimIndices(): Uint32Array {
  const indices = new Uint32Array((CELLS * CELLS - 1) * QUAD);
  let at = 0;

  for (let cell = 0; cell < CELLS * CELLS; cell += 1) {
    if (cell === CENTRE) continue;

    const topLeft = Math.floor(cell / CELLS) * SIDE + (cell % CELLS);
    const bottomLeft = topLeft + SIDE;

    indices.set([topLeft, topLeft + 1, bottomLeft, topLeft + 1, bottomLeft + 1, bottomLeft], at);
    at += QUAD;
  }

  return indices;
}

/**
 * Writes one row of the grid: its four vertices, one per cut line across, at the same `y`.
 *
 * @param target - The 32 numbers of the grid: x and y of each vertex, row by row.
 * @param row - The row, 0 to 3.
 * @param y - The row's line down.
 * @param across - The cut lines across.
 */
function writeRow(target: Float32Array, row: number, y: number, across: Readonly<Cuts>): void {
  const at = row * SIDE * 2;

  target[at] = across.start;
  target[at + 1] = y;
  target[at + 2] = across.near;
  target[at + 3] = y;
  target[at + 4] = across.far;
  target[at + 5] = y;
  target[at + 6] = across.end;
  target[at + 7] = y;
}

/**
 * Writes the 4 × 4 grid of the cut lines in place: Pixi's vertex order, row by row.
 *
 * @param target - The 32 numbers of the grid.
 * @param across - The cut lines across.
 * @param down - The cut lines down.
 */
function writeGrid(target: Float32Array, across: Readonly<Cuts>, down: Readonly<Cuts>): void {
  writeRow(target, 0, down.start, across);
  writeRow(target, 1, down.near, across);
  writeRow(target, 2, down.far, across);
  writeRow(target, 3, down.end, across);
}

/**
 * Makes the class of the rim-only nine-slice over one loaded Pixi module.
 *
 * @param pixi - The Pixi module the renderer loaded.
 * @returns The class.
 */
export function createHollowClass(pixi: PixiModule): HollowClass {
  /** A nine-slice that draws its rim alone: Pixi's mesh over the 16 vertices of the slicing and its eight border cells. */
  class HollowNineSlice extends pixi.Mesh {
    /** Tells the rim-only object from Pixi's `NineSliceSprite`. */
    public readonly hollow = true;

    /** The slice widths, in the units the panel is drawn in. */
    private readonly borders: SliceBorders = { left: 0, top: 0, right: 0, bottom: 0 };

    /** The cut lines across, scratch of the next write. */
    private readonly across: Cuts = { start: 0, near: 0, far: 0, end: 0 };

    /** The cut lines down, scratch of the next write. */
    private readonly down: Cuts = { start: 0, near: 0, far: 0, end: 0 };

    private boxWidth = 0;

    private boxHeight = 0;

    /** False while Pixi's constructor writes the first texture: the geometry does not exist yet. */
    private built = false;

    /**
     * Builds the mesh over a geometry of its own, 0 × 0 with no border, its uvs cut for the texture.
     *
     * @param texture - The texture it draws first.
     */
    public constructor(texture: PixiTexture) {
      super({
        geometry: new pixi.MeshGeometry({
          positions: new Float32Array(VERTICES * 2),
          uvs: new Float32Array(VERTICES * 2),
          indices: rimIndices()
        }),
        texture
      });
      this.built = true;
      this.layoutUvs();
    }

    /**
     * The width of the left border column.
     *
     * @returns Units.
     */
    public get leftWidth(): number {
      return this.borders.left;
    }

    /**
     * Sets the width of the left border column: the positions and the uvs are written again.
     *
     * @param value - Units.
     */
    public set leftWidth(value: number) {
      if (this.borders.left === value) return;

      this.borders.left = value;
      this.layoutAll();
    }

    /**
     * The height of the top border row.
     *
     * @returns Units.
     */
    public get topHeight(): number {
      return this.borders.top;
    }

    /**
     * Sets the height of the top border row: the positions and the uvs are written again.
     *
     * @param value - Units.
     */
    public set topHeight(value: number) {
      if (this.borders.top === value) return;

      this.borders.top = value;
      this.layoutAll();
    }

    /**
     * The width of the right border column.
     *
     * @returns Units.
     */
    public get rightWidth(): number {
      return this.borders.right;
    }

    /**
     * Sets the width of the right border column: the positions and the uvs are written again.
     *
     * @param value - Units.
     */
    public set rightWidth(value: number) {
      if (this.borders.right === value) return;

      this.borders.right = value;
      this.layoutAll();
    }

    /**
     * The height of the bottom border row.
     *
     * @returns Units.
     */
    public get bottomHeight(): number {
      return this.borders.bottom;
    }

    /**
     * Sets the height of the bottom border row: the positions and the uvs are written again.
     *
     * @param value - Units.
     */
    public set bottomHeight(value: number) {
      if (this.borders.bottom === value) return;

      this.borders.bottom = value;
      this.layoutAll();
    }

    /**
     * The width of the panel, as on a `NineSliceSprite`: its box, never a scale.
     *
     * @returns Units.
     */
    public override get width(): number {
      return this.boxWidth;
    }

    /**
     * Sets the width of the panel: the positions are written again.
     *
     * @param value - Units.
     */
    public override set width(value: number) {
      if (this.boxWidth === value) return;

      this.boxWidth = value;
      this.layoutPositions();
    }

    /**
     * The height of the panel, as on a `NineSliceSprite`: its box, never a scale.
     *
     * @returns Units.
     */
    public override get height(): number {
      return this.boxHeight;
    }

    /**
     * Sets the height of the panel: the positions are written again.
     *
     * @param value - Units.
     */
    public override set height(value: number) {
      if (this.boxHeight === value) return;

      this.boxHeight = value;
      this.layoutPositions();
    }

    /**
     * The texture the rim is cut from.
     *
     * @returns The texture.
     */
    public override get texture(): PixiTexture {
      return super.texture;
    }

    /**
     * Sets the texture as Pixi's mesh does; the uvs are cut for its frame.
     *
     * @param value - The texture.
     */
    public override set texture(value: PixiTexture) {
      super.texture = value;
      // Pixi's constructor writes the first texture before the geometry exists: the constructor cuts those uvs.
      if (this.built) this.layoutUvs();
    }

    /**
     * Frees the mesh as Pixi does, and its own geometry with it.
     *
     * @param options - Pixi's destroy options; a texture is freed only when they ask.
     */
    public override destroy(
      options?: Parameters<InstanceType<PixiModule["Mesh"]>["destroy"]>[0]
    ): void {
      const geometry = this.geometry;

      super.destroy(options);
      geometry.destroy(true);
    }

    /** Writes the positions and the uvs again: a border changed. */
    private layoutAll(): void {
      this.layoutPositions();
      this.layoutUvs();
    }

    /**
     * Writes the 16 positions in place: the cut lines at the borders, all four shrunk by one factor when two corners
     * would overlap, as Pixi's `NineSliceGeometry` shrinks them.
     */
    private layoutPositions(): void {
      const across = this.across;
      const down = this.down;
      const borders = this.borders;
      const scale = sliceScale(this, borders);

      across.start = 0;
      across.near = borders.left * scale;
      across.far = this.boxWidth - borders.right * scale;
      across.end = this.boxWidth;
      down.start = 0;
      down.near = borders.top * scale;
      down.far = this.boxHeight - borders.bottom * scale;
      down.end = this.boxHeight;
      writeGrid(this.geometry.positions, across, down);
      this.geometry.getBuffer("aPosition").update();
    }

    /**
     * Writes the 16 uvs in place: the texture's frame (its trim, when it has one) cut at the unscaled borders, as
     * Pixi's `NineSliceGeometry` cuts it. Pixi maps them into an atlas page when it batches the mesh.
     */
    private layoutUvs(): void {
      const across = this.across;
      const down = this.down;
      const borders = this.borders;
      const texture = this.texture;
      const width = texture.width;
      const height = texture.height;
      const trim: Trim | undefined = texture.trim;
      const x = trim?.x ?? 0;
      const y = trim?.y ?? 0;
      const u0 = x / width;
      const v0 = y / height;
      const u1 = (x + (trim?.width ?? width)) / width;
      const v1 = (y + (trim?.height ?? height)) / height;
      // One texel in uv, Pixi's own arithmetic: the uvs come out bit for bit as a filled panel's.
      const texelU = 1 / width;
      const texelV = 1 / height;

      across.start = u0;
      across.near = u0 + texelU * borders.left;
      across.far = u1 - texelU * borders.right;
      across.end = u1;
      down.start = v0;
      down.near = v0 + texelV * borders.top;
      down.far = v1 - texelV * borders.bottom;
      down.end = v1;
      writeGrid(this.geometry.uvs, across, down);
      this.geometry.getBuffer("aUV").update();
    }
  }

  return HollowNineSlice;
}

/**
 * Builds a rim-only nine-slice of Pixi's white texture, its class made at the first one over the loaded module.
 *
 * @param state - The sync branch of the plugin state, which keeps the class.
 * @param pixi - The Pixi module the renderer loaded.
 * @returns The object.
 */
export function makeHollow(state: SyncState, pixi: PixiModule): HollowSlice {
  state.hollowClass ??= createHollowClass(pixi);

  return new state.hollowClass(pixi.Texture.WHITE);
}
