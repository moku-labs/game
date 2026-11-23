#!/usr/bin/env bun
/**
 * @file The baked pictures of the `pv-*` arms, drawn ahead on the CPU: what a game would ship instead of a filter.
 * `bun bench/filters/tools/bake.ts` writes them into `features/ui/assets/`, then `moku-game keys` lists them. Each is
 * drawn at 2 texture px a reference unit, as a game ships its art for a phone; the item is 140 units, its effect
 * layers 156 (8 units of padding a side, as the set's `Aura` and `Shadow` pad). The same numbers give the same bytes.
 */
import sharp from "sharp";

/** Texture px a reference unit. */
const SCALE = 2;

/** The item's side and corner radius, units. */
const ITEM = 140;
const RADIUS = 20;

/** The padding of an effect layer, units. */
const PAD = 8;

/** The frames of a baked dissolve and of a baked tilt. */
export const FRAMES = 8;

/** Where the pictures go. */
const OUT = new URL("../features/ui/assets/", import.meta.url);

/** One colour with its alpha, 0–255 each, not premultiplied. */
type Rgba = [number, number, number, number];

/** A picture: its side in px, and the colour of a pixel at a point in units from its centre. */
type Bake = { name: string; side: number; at: (x: number, y: number) => Rgba };

/**
 * The signed distance to the item's rounded square, units: below 0 inside.
 *
 * @param x - Units from the item's centre.
 * @param y - Units from the item's centre.
 * @returns The distance.
 * @example
 * ```ts
 * itemDistance(0, 0); // -70
 * ```
 */
export function itemDistance(x: number, y: number): number {
  const half = ITEM / 2 - RADIUS;
  const qx = Math.abs(x) - half;
  const qy = Math.abs(y) - half;

  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RADIUS;
}

/**
 * The coverage of an edge at a distance: 1 inside, 0 outside, one texel of soft edge.
 *
 * @param distance - Units, below 0 inside.
 * @returns From 0 to 1.
 * @example
 * ```ts
 * cover(-1); // 1
 * ```
 */
function cover(distance: number): number {
  return Math.min(Math.max(0.5 - distance * SCALE, 0), 1);
}

/**
 * The item: a gold rounded square with a blue disc in it.
 *
 * @param x - Units from its centre.
 * @param y - Units from its centre.
 * @returns Its colour.
 */
function item(x: number, y: number): Rgba {
  const disc = cover(Math.hypot(x, y) - 30);
  const alpha = cover(itemDistance(x, y));

  return [
    242 * (1 - disc) + 63 * disc,
    180 * (1 - disc) + 169 * disc,
    61 * (1 - disc) + 245 * disc,
    255 * alpha
  ];
}

/**
 * A hash of a cell, 0 to 1: the noise of a baked dissolve.
 *
 * @param cx - The cell's column.
 * @param cy - The cell's row.
 * @returns From 0 to 1.
 * @example
 * ```ts
 * cellHash(0, 0); // 0
 * ```
 */
function cellHash(cx: number, cy: number): number {
  const mixed = Math.imul(cx * 374_761_393 + cy * 668_265_263, 1_274_126_177) >>> 0;

  return (mixed % 10_000) / 10_000;
}

/** Every picture the `pv-*` arms draw. */
const BAKES: readonly Bake[] = [
  { name: "pv-item", side: ITEM, at: item },
  {
    name: "pv-halo",
    side: ITEM + 2 * PAD,
    at: (x, y) => {
      const distance = Math.max(itemDistance(x, y), 0);

      return [255, 236, 170, 230 * Math.exp(-((distance / (PAD / 2)) ** 2))];
    }
  },
  {
    name: "pv-shadow",
    side: ITEM + 2 * PAD,
    at: (x, y) => [0, 0, 0, 128 * Math.min(Math.max(0.5 - itemDistance(x, y - 4) / 8, 0), 1)]
  },
  {
    name: "pv-outline",
    side: ITEM + 2 * 2,
    at: (x, y) => [
      255,
      255,
      255,
      255 * Math.min(Math.max(1 - Math.abs(itemDistance(x, y) - 1), 0), 1)
    ]
  },
  {
    name: "pv-graded",
    side: ITEM,
    at: (x, y) => {
      const [r, g, b, a] = item(x, y);
      const grey = 0.3 * r + 0.59 * g + 0.11 * b;

      return [grey * 0.6 + r * 0.4 + 20, grey * 0.6 + g * 0.4, grey * 0.6 + b * 0.4 - 20, a];
    }
  },
  {
    name: "pv-frost",
    side: ITEM,
    at: (x, y) => {
      const haze = 150 + 30 * Math.sin(x * 0.05) * Math.cos(y * 0.07);

      return [haze, haze + 10, haze + 25, 255 * cover(itemDistance(x, y))];
    }
  },
  ...Array.from(
    { length: FRAMES },
    (_unused, frame): Bake => ({
      name: `pv-dissolve-${frame}`,
      side: ITEM,
      at: (x, y) => {
        const progress = frame / (FRAMES - 1);
        const cell = cellHash(Math.floor((x + ITEM / 2) / 17.5), Math.floor((y + ITEM / 2) / 17.5));
        const [r, g, b, a] = item(x, y);

        return cell < progress ? [r, g, b, 0] : [r, g, b, a];
      }
    })
  ),
  ...Array.from(
    { length: FRAMES },
    (_unused, frame): Bake => ({
      name: `pv-tilt-${frame}`,
      side: ITEM + 2 * PAD,
      at: (x, y) => {
        const angle = (frame / FRAMES) * Math.PI;
        const flat = Math.max(Math.abs(Math.cos(angle)), 0.02);
        const lean = 1 + Math.sin(angle) * (x / ITEM) * 0.5;

        return item(x / flat / lean, y / lean);
      }
    })
  )
];

/**
 * Draws one picture into RGBA bytes.
 *
 * @param bake - The picture.
 * @returns Its bytes and its side in px.
 */
function draw(bake: Bake): { bytes: Uint8Array; px: number } {
  const px = bake.side * SCALE;
  const bytes = new Uint8Array(px * px * 4);

  for (let row = 0; row < px; row += 1) {
    for (let column = 0; column < px; column += 1) {
      const colour = bake.at(
        (column + 0.5) / SCALE - bake.side / 2,
        (row + 0.5) / SCALE - bake.side / 2
      );
      const at = (row * px + column) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        bytes[at + channel] = Math.round(Math.min(Math.max(colour[channel] ?? 0, 0), 255));
      }
    }
  }

  return { bytes, px };
}

if (import.meta.main) {
  for (const bake of BAKES) {
    const { bytes, px } = draw(bake);
    const file = new URL(`${bake.name}.webp`, OUT);

    await sharp(bytes, { raw: { width: px, height: px, channels: 4 } })
      .webp({ lossless: true })
      .toFile(file.pathname);
    console.info(`${bake.name}.webp ${px} x ${px}`);
  }
}
